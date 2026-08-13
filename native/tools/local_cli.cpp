// island_chatter_local: speaks a line with a neural model that runs on this
// machine, and opens no socket to do it.
//
// It is the third renderer, and deliberately the same shape as the second. The
// panel already knows how to press a button, get a WAV beside the project, and
// read the mouth out of it; island_chatter_voice made that shape work for a
// model somebody else runs, and this makes it work for one running here. The
// protocol on stdout is byte-for-byte the one the panel already parses, so
// nothing in the panel had to learn a third dialect.
//
// Why a separate executable rather than a mode of island_chatter_voice: this
// one links onnxruntime, which is 17 MB, and the model beside it is 170 MB.
// Somebody who only ever uses the cloud voice should not carry either, and
// somebody who has not installed the model should see no local option at all
// rather than an option that fails when pressed.
//
// Why it is not GPL: Piper — the obvious choice — moved to GPL-3.0 in October
// 2025, and even its MIT-era releases linked espeak-ng, which is GPL v3 or
// later. Either would force this whole product open. sherpa-onnx is Apache-2.0,
// the MeloTTS weights are MIT, onnxruntime is MIT, and the Chinese pipeline
// uses a lexicon rather than espeak-ng, so the question does not arise. That
// chain is the reason this file exists at all; do not swap the engine without
// re-reading it.

#include "island_chatter/cloud.hpp"
#include "sherpa-onnx/c-api/c-api.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

#include <windows.h>
#include <winhttp.h>

namespace {

namespace cloud = island_chatter::cloud;

/*
 * Where the model comes from, and why the fetch lives in *this* tool.
 *
 * island_chatter_voice has a hardened WinHTTP transport already, and the
 * obvious move is to reuse it. It is the wrong move. That transport refuses to
 * follow redirects, on purpose, because it carries an API key in a header and
 * WinHTTP re-sends headers to whatever host a 3xx names. A download from a
 * release host redirects to a CDN on every request, so it *needs* redirects —
 * and the only safe place for a request that follows them is a tool that has no
 * credential to leak. This one accepts --key-file and throws it away without
 * reading it, so there is nothing here to follow a redirect with.
 *
 * The files are fetched individually rather than as the published .tar.bz2,
 * which means no bzip2 decoder ships in this product. The sizes are checked in
 * because "downloaded" has to be a question with an answer: a truncated
 * model.onnx loads and then fails somewhere far away from the cause.
 */
struct ModelFile {
    const char* name;
    std::uint64_t bytes;
};

const ModelFile kModelFiles[] = {
    {"model.onnx", 170429550u},
    {"lexicon.txt", 6837671u},
    {"tokens.txt", 655u},
    {"date.fst", 59154u},
    {"number.fst", 64482u},
    {"phone.fst", 88630u},
    {"new_heteronym.fst", 21974u},
};

// The dict/ folder in the published package is deliberately not here: from
// sherpa-onnx 1.12.15 this model does not use it, and it is 11 MB.
const wchar_t* kModelHost = L"huggingface.co";
const wchar_t* kModelPathPrefix = L"/csukuangfj/vits-melo-tts-zh_en/resolve/main/";

/*
 * The one local source, described the same way a cloud one is.
 *
 * It borrows cloud::Provider rather than inventing a parallel type, so
 * cache_file_name() — and therefore the rule that an unchanged line is never
 * rendered twice — is literally the same code. `on_this_machine` is what the
 * panel reads to stop asking for an API key and to stop warning that the text
 * is leaving the computer, which for this row would be false.
 *
 * The rate here is what the model is documented to produce. Nothing trusts it:
 * the WAV is written with the rate the model states at runtime, and this value
 * only ever reaches the cache key.
 */
const cloud::Provider& local_provider() {
    static const cloud::Provider row{
        "local-melo",
        "Local model (zh+en)",
        "-",                       // no host; it never leaves this machine
        "-",
        "",
        "",
        cloud::Escape::Json,
        cloud::Reply::RawPcm16,
        44100,
        "vits-melo-tts-zh_en",
        "default",
        false,                     // no region
        true                       // on this machine
    };
    return row;
}

std::filesystem::path model_root(const std::string& override_dir) {
    if (!override_dir.empty()) { return std::filesystem::u8path(override_dir); }
    /*
     * Under LOCALAPPDATA, not beside the .aex.
     *
     * Program Files needs administrator rights, and this is 170 MB of data the
     * user chose to fetch rather than part of the installed product. Putting it
     * beside the plug-in would mean the installer has to carry it, which is the
     * whole thing this arrangement exists to avoid.
     */
    std::string base;
    {
        // _dupenv_s rather than getenv, which MSVC deprecates; the buffer is
        // ours to free and is freed whether or not the variable was set.
        char* value = nullptr;
        std::size_t length = 0;
        if (_dupenv_s(&value, &length, "LOCALAPPDATA") == 0 && value) { base = value; }
        std::free(value);
    }
    if (base.empty()) {
        throw std::runtime_error("LOCALAPPDATA is not set, so the model folder cannot be found");
    }
    return std::filesystem::u8path(base) / "Island Chatter" / "models" /
           local_provider().default_model;
}

/*
 * "Installed" means every file is there *and the right size*.
 *
 * Presence alone is not enough: a download interrupted at 90% leaves a
 * model.onnx that exists, loads far enough to look plausible, and then fails
 * somewhere with no connection to the cause. Checking the size costs a stat per
 * file and turns that into "the model is incomplete, install it again".
 */
bool model_is_installed(const std::filesystem::path& root) {
    for (const auto& file : kModelFiles) {
        std::error_code failed;
        const auto path = root / file.name;
        if (!std::filesystem::is_regular_file(path, failed)) { return false; }
        if (std::filesystem::file_size(path, failed) != file.bytes) { return false; }
    }
    return true;
}

std::string rule_fsts(const std::filesystem::path& root) {
    // Text normalisation: phone numbers, dates, digits, and the heteronyms a
    // lexicon alone gets wrong. Each is optional, so a model package without
    // one still runs rather than refusing.
    std::string joined;
    for (const char* name : {"phone.fst", "date.fst", "number.fst", "new_heteronym.fst"}) {
        const auto path = root / name;
        std::error_code failed;
        if (!std::filesystem::is_regular_file(path, failed)) { continue; }
        if (!joined.empty()) { joined += ","; }
        joined += path.u8string();
    }
    return joined;
}

void write_atomically(const std::filesystem::path& path,
                      const std::vector<unsigned char>& bytes) {
    // Same reasoning as the cloud tool: a half-written file in the cache is
    // worse than no cache, because it exists and every later run hits it.
    auto temporary = path;
    temporary += ".part";
    {
        std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
        if (!out) { throw std::runtime_error("the audio could not be written beside the project"); }
        out.write(reinterpret_cast<const char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()));
        if (!out) { throw std::runtime_error("writing the audio file failed part of the way through"); }
    }
    std::error_code failed;
    std::filesystem::rename(temporary, path, failed);
    if (failed) {
        std::filesystem::remove(path, failed);
        std::filesystem::rename(temporary, path, failed);
    }
    if (failed) {
        std::filesystem::remove(temporary, failed);
        throw std::runtime_error("the finished audio could not be moved into place");
    }
}

std::vector<unsigned char> read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) { return {}; }
    return std::vector<unsigned char>(std::istreambuf_iterator<char>(file),
                                      std::istreambuf_iterator<char>());
}

bool usable_wav(const std::vector<unsigned char>& bytes) {
    return bytes.size() >= 44 && std::equal(bytes.begin(), bytes.begin() + 4, "RIFF") &&
           std::equal(bytes.begin() + 8, bytes.begin() + 12, "WAVE");
}

/*
 * The model is only listed when it is actually there.
 *
 * An option that appears and then fails when pressed is worse than no option:
 * it reads as the feature being broken rather than as not installed. So an
 * absent model prints an empty list, and the panel simply shows the cloud
 * sources.
 */
void print_providers(const std::string& override_dir) {
    std::cout << "VOICE 1\n";
    std::size_t listed = 0;
    std::filesystem::path root;
    try { root = model_root(override_dir); } catch (const std::exception&) { root.clear(); }
    if (!root.empty() && model_is_installed(root)) {
        const auto& row = local_provider();
        std::cout << "P " << row.id
                  << " " << cloud::as_hex(row.label)
                  << " " << row.host
                  << " " << cloud::as_hex(row.default_model)
                  << " " << cloud::as_hex(row.default_voice)
                  << " " << (row.needs_region ? 1 : 0)
                  << " " << (row.on_this_machine ? 1 : 0)
                  << "\n";
        listed = 1;
    }
    std::cout << "END " << listed << "\n";
}

// --- fetching the model ------------------------------------------------------

struct Net {
    HINTERNET value = nullptr;
    explicit Net(HINTERNET handle) : value(handle) {}
    ~Net() { if (value) { WinHttpCloseHandle(value); } }
    Net(const Net&) = delete;
    Net& operator=(const Net&) = delete;
};

std::string describe_net_error(DWORD code) {
    return cloud::meaning_of_network_error(code) + " [WinHTTP " + std::to_string(code) + "]";
}

/*
 * One file, streamed to disk.
 *
 * Streamed rather than buffered because the largest of them is 170 MB and the
 * cloud tool's 64 MB ceiling exists for a reason — but the reason there was an
 * endpoint that will not stop sending, and here the expected length is known in
 * advance and checked, which is a better bound than a constant.
 *
 * Written to a .part and renamed, so an interrupted download cannot leave a
 * file that model_is_installed() would accept.
 */
void fetch_one(HINTERNET session, const ModelFile& file, const std::filesystem::path& root) {
    const auto destination = root / file.name;
    std::error_code failed;
    if (std::filesystem::is_regular_file(destination, failed) &&
        std::filesystem::file_size(destination, failed) == file.bytes) {
        return;   // already here and the right length
    }

    Net connection(WinHttpConnect(session, kModelHost, INTERNET_DEFAULT_HTTPS_PORT, 0));
    if (!connection.value) { throw std::runtime_error(describe_net_error(GetLastError())); }

    std::wstring path = kModelPathPrefix;
    for (const char* letter = file.name; *letter; ++letter) {
        path.push_back(static_cast<wchar_t>(*letter));
    }
    Net call(WinHttpOpenRequest(connection.value, L"GET", path.c_str(), nullptr,
                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                WINHTTP_FLAG_SECURE));
    if (!call.value) { throw std::runtime_error(describe_net_error(GetLastError())); }
    // Redirects are left ON here, unlike the cloud transport, and that is safe
    // only because this request carries no credential of any kind. Do not add
    // a header to it.
    if (!WinHttpSendRequest(call.value, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                            WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(call.value, nullptr)) {
        throw std::runtime_error(describe_net_error(GetLastError()));
    }
    DWORD status = 0;
    DWORD status_size = sizeof status;
    if (!WinHttpQueryHeaders(call.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size,
                             WINHTTP_NO_HEADER_INDEX)) {
        throw std::runtime_error(describe_net_error(GetLastError()));
    }
    if (status < 200 || status >= 300) {
        throw std::runtime_error(std::string("could not download ") + file.name + ": " +
                                 cloud::message_from_error(static_cast<int>(status), ""));
    }

    auto temporary = destination;
    temporary += ".part";
    std::uint64_t written = 0;
    {
        std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
        if (!out) {
            throw std::runtime_error(std::string("cannot write ") + file.name + " to disk");
        }
        std::vector<char> chunk;
        for (;;) {
            DWORD available = 0;
            if (!WinHttpQueryDataAvailable(call.value, &available)) {
                throw std::runtime_error(describe_net_error(GetLastError()));
            }
            if (available == 0) { break; }
            // The declared length is the bound. An endpoint that keeps sending
            // past it is not the file that was asked for.
            if (written + available > file.bytes) {
                throw std::runtime_error(std::string("the download of ") + file.name +
                                         " is longer than the file should be");
            }
            chunk.resize(available);
            DWORD read = 0;
            if (!WinHttpReadData(call.value, chunk.data(), available, &read)) {
                throw std::runtime_error(describe_net_error(GetLastError()));
            }
            if (read == 0) { break; }
            out.write(chunk.data(), static_cast<std::streamsize>(read));
            if (!out) {
                throw std::runtime_error(std::string("writing ") + file.name +
                                         " failed part of the way through; is the disk full?");
            }
            written += read;
        }
    }
    if (written != file.bytes) {
        std::filesystem::remove(temporary, failed);
        throw std::runtime_error(std::string("the download of ") + file.name + " stopped after " +
                                 std::to_string(written) + " of " + std::to_string(file.bytes) +
                                 " bytes");
    }
    std::filesystem::remove(destination, failed);
    std::filesystem::rename(temporary, destination, failed);
    if (failed) {
        std::filesystem::remove(temporary, failed);
        throw std::runtime_error(std::string("could not move ") + file.name + " into place");
    }
}

void install_model(const std::filesystem::path& root) {
    std::error_code failed;
    std::filesystem::create_directories(root, failed);
    Net session(WinHttpOpen(L"IslandChatter", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                            WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session.value) { throw std::runtime_error(describe_net_error(GetLastError())); }
    // Generous: this is a 170 MB file, not a sentence.
    WinHttpSetTimeouts(session.value, 15000, 15000, 30000, 600000);
    std::uint64_t total = 0;
    for (const auto& file : kModelFiles) {
        fetch_one(session.value, file, root);
        total += file.bytes;
    }
    if (!model_is_installed(root)) {
        throw std::runtime_error("the model is still incomplete after downloading");
    }
    std::cout << "VOICE 1\nOK " << cloud::as_hex(root.u8string()) << " " << total << " 0\n";
}

std::vector<unsigned char> speak(const std::filesystem::path& root, const std::string& text,
                                 std::uint32_t* rate_out) {
    const auto model = (root / "model.onnx").u8string();
    const auto lexicon = (root / "lexicon.txt").u8string();
    const auto tokens = (root / "tokens.txt").u8string();
    const auto rules = rule_fsts(root);

    SherpaOnnxOfflineTtsConfig config{};
    config.model.vits.model = model.c_str();
    config.model.vits.lexicon = lexicon.c_str();
    config.model.vits.tokens = tokens.c_str();
    config.model.vits.noise_scale = 0.667f;
    config.model.vits.noise_scale_w = 0.8f;
    config.model.vits.length_scale = 1.0f;
    config.model.num_threads = 2;
    config.model.provider = "cpu";
    config.rule_fsts = rules.c_str();
    // One sentence at a time. The panel bakes a line, not a paragraph, and
    // batching changes where the silences fall.
    config.max_num_sentences = 1;

    const SherpaOnnxOfflineTts* tts = SherpaOnnxCreateOfflineTts(&config);
    if (!tts) {
        throw std::runtime_error("the local model could not be loaded; it may be incomplete");
    }
    // GenerateWithConfig, not the older Generate: the three-argument form is
    // marked deprecated in 1.13, and starting a new file on an API the vendor
    // has already announced the end of is a rewrite scheduled for later.
    SherpaOnnxGenerationConfig generation{};
    generation.sid = 0;
    generation.speed = 1.0f;
    generation.silence_scale = 0.2f;
    const SherpaOnnxGeneratedAudio* audio =
        SherpaOnnxOfflineTtsGenerateWithConfig(tts, text.c_str(), &generation, nullptr, nullptr);
    if (!audio || !audio->samples || audio->n <= 0) {
        if (audio) { SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio); }
        SherpaOnnxDestroyOfflineTts(tts);
        throw std::runtime_error("the local model produced no audio for that line");
    }

    std::vector<unsigned char> pcm;
    pcm.reserve(static_cast<std::size_t>(audio->n) * 2U);
    for (std::int32_t index = 0; index < audio->n; ++index) {
        const auto value = static_cast<std::int16_t>(
            std::lround(std::clamp(audio->samples[index], -1.0f, 1.0f) * 32767.0f));
        pcm.push_back(static_cast<unsigned char>(value & 0xFF));
        pcm.push_back(static_cast<unsigned char>((value >> 8) & 0xFF));
    }
    // The rate the model states, not the one the table guesses.
    *rate_out = static_cast<std::uint32_t>(audio->sample_rate);

    SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
    SherpaOnnxDestroyOfflineTts(tts);
    return cloud::wav_from_pcm16(pcm, *rate_out);
}

[[noreturn]] void usage() {
    std::cerr <<
        "island_chatter_local --providers [--model-dir <hex-utf8-path>]\n"
        "island_chatter_local --install [--model-dir <hex-utf8-path>]\n"
        "island_chatter_local --cache-path --text <hex-utf8> --cache-dir <hex-utf8-path>\n"
        "island_chatter_local --speak --text <hex-utf8> --cache-dir <hex-utf8-path>\n"
        "                     [--model-dir <hex-utf8-path>]\n"
        "\n"
        "Speaks with a model on this machine. No network, no account, no key —\n"
        "--key-file is accepted and ignored so the panel can drive every voice\n"
        "source through one code path.\n";
    std::exit(2);
}

}  // namespace

int main(int argc, char** argv) {
    try {
        std::vector<std::string> args(argv + 1, argv + argc);
        if (args.empty()) { usage(); }

        // --model-dir is this tool's own, so it is peeled off before the shared
        // parser sees the rest; everything else is the cloud tool's contract,
        // parsed by the cloud tool's parser so the two cannot drift.
        std::string override_dir;
        bool installing = false;
        std::vector<std::string> rest;
        for (std::size_t index = 0; index < args.size(); ++index) {
            if (args[index] == "--model-dir" && index + 1 < args.size()) {
                override_dir = cloud::from_hex(args[++index]);
                continue;
            }
            if (args[index] == "--install") { installing = true; continue; }
            // A key means nothing here and is accepted rather than refused, so
            // the panel does not need a second command builder. It is never
            // read, never stored and never printed.
            if (args[index] == "--key-file" && index + 1 < args.size()) { ++index; continue; }
            rest.push_back(args[index]);
        }
        if (installing) {
            install_model(model_root(override_dir));
            return 0;
        }
        const auto command = cloud::parse_arguments(rest);

        if (command.mode == cloud::Mode::Providers) {
            print_providers(override_dir);
            return 0;
        }

        const auto root = model_root(override_dir);
        if (!model_is_installed(root)) {
            throw std::runtime_error(
                "the local model is not installed in " + root.u8string());
        }
        if (command.cache_dir.empty()) {
            throw std::runtime_error("--cache-dir is required");
        }
        if (command.params.text.empty()) {
            throw std::runtime_error("there is no text to speak");
        }

        const auto folder = std::filesystem::u8path(command.cache_dir);
        auto params = command.params;
        params.provider = local_provider().id;
        const auto destination = folder / cloud::cache_file_name(local_provider(), params);
        const auto printable = cloud::as_hex(destination.u8string());

        if (command.mode == cloud::Mode::CachePath) {
            std::cout << "VOICE 1\nPATH " << printable << "\n";
            return 0;
        }

        // The same saving as the cloud path, for a different currency: here an
        // unchanged line costs seconds of CPU rather than money, and the check
        // comes first for the same reason.
        const auto existing = read_file(destination);
        if (usable_wav(existing)) {
            std::cout << "VOICE 1\nOK " << printable << " " << existing.size() << " 1\n";
            return 0;
        }

        std::uint32_t rate = 0;
        const auto wav = speak(root, params.text, &rate);
        std::error_code ignored;
        std::filesystem::create_directories(folder, ignored);
        write_atomically(destination, wav);
        std::cout << "VOICE 1\nOK " << printable << " " << wav.size() << " 0\n";
        return 0;
    } catch (const std::exception& error) {
        // stdout as hex, for the reason island_chatter_voice gives: callSystem()
        // returns stdout, and the console code page would destroy the message.
        std::cout << "VOICE 1\nERROR " << cloud::as_hex(error.what()) << "\n";
        return 1;
    }
}

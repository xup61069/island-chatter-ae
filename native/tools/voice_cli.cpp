// island_chatter_voice: fetches one line of speech from a cloud model and
// leaves a WAV on disk. Nothing else in the product talks to a network.
//
// Why a separate executable at all: ExtendScript has no TLS. There is no
// socket, no HTTPS client and no way to add one, so the panel cannot make this
// request however it is written. Windows already ships a TLS stack that
// validates certificates and honours the system proxy — WinHTTP — so the whole
// of the network side is this file, sitting beside the .aex exactly as
// island_chatter_bake does.
//
// Why not inside the .aex: because the .aex is loaded into the audio render
// path, and nothing that can block for an unbounded time belongs there. Keeping
// the network in a process that After Effects starts, waits for, and reaps is
// what makes "the engine is deterministic" (invariant 8) still true in 2.4.0.
//
// Everything a person could read crosses this boundary as hex UTF-8, in both
// directions, for the reason bake_cli.cpp gives: the command line and stdout
// both go through the console code page, and a provider's error message is
// exactly the kind of text that gets destroyed by it.

#include "island_chatter/cloud.hpp"

#include <algorithm>
#include <cstdint>
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

std::wstring widen(const std::string& utf8) {
    if (utf8.empty()) { return std::wstring(); }
    const int needed = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(),
                                           static_cast<int>(utf8.size()), nullptr, 0);
    std::wstring wide(static_cast<std::size_t>(needed), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), static_cast<int>(utf8.size()),
                        wide.data(), needed);
    return wide;
}

std::string narrow(const std::wstring& wide) {
    if (wide.empty()) { return std::string(); }
    const int needed = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(),
                                           static_cast<int>(wide.size()), nullptr, 0,
                                           nullptr, nullptr);
    std::string utf8(static_cast<std::size_t>(needed), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()),
                        utf8.data(), needed, nullptr, nullptr);
    return utf8;
}

/*
 * What Windows says went wrong, in Windows' own words.
 *
 * WinHTTP's error codes live in winhttp.dll's message table rather than in the
 * system one, so FormatMessage has to be pointed at the module or every network
 * failure comes back as "Unknown error". The three that actually happen get a
 * sentence in front of them, because "12007" tells a user nothing and "the name
 * could not be resolved" tells them to check their connection.
 */
std::string describe_windows_error(DWORD code) {
    // The sentence comes from cloud.cpp, where a test can reach it; only the
    // vendor's own wording is fetched here, because only here is there a
    // winhttp.dll to fetch it from.
    std::string plain = cloud::meaning_of_network_error(code);
    wchar_t* buffer = nullptr;
    const auto length = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
            FORMAT_MESSAGE_FROM_HMODULE | FORMAT_MESSAGE_IGNORE_INSERTS,
        GetModuleHandleW(L"winhttp.dll"), code, 0,
        reinterpret_cast<wchar_t*>(&buffer), 0, nullptr);
    std::string detail;
    if (length && buffer) {
        detail = narrow(std::wstring(buffer, length));
        while (!detail.empty() && (detail.back() == '\r' || detail.back() == '\n' ||
                                   detail.back() == ' ')) {
            detail.pop_back();
        }
    }
    if (buffer) { LocalFree(buffer); }
    if (!detail.empty()) { plain += " (" + detail + ")"; }
    return plain + " [WinHTTP " + std::to_string(code) + "]";
}

// Closes on the way out of any scope, including the one an exception leaves.
struct Handle {
    HINTERNET value = nullptr;
    explicit Handle(HINTERNET handle) : value(handle) {}
    ~Handle() { if (value) { WinHttpCloseHandle(value); } }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
};

struct Response {
    int status = 0;
    std::vector<unsigned char> body;
};

/*
 * One request, start to finish.
 *
 * The timeouts are generous rather than tight: a long line through a large
 * model is a few seconds of real work at the provider's end, and the failure
 * mode of a short timeout is a request that was paid for and then abandoned.
 * They are not absent, because the panel is blocked on this call and After
 * Effects is blocked on the panel.
 */
Response send(const cloud::Request& request) {
    Handle session(WinHttpOpen(L"IslandChatter",
                               WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                               WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session.value) {
        throw std::runtime_error(describe_windows_error(GetLastError()));
    }
    WinHttpSetTimeouts(session.value, 15000, 15000, 30000, 180000);

    Handle connection(WinHttpConnect(session.value, widen(request.host).c_str(),
                                     INTERNET_DEFAULT_HTTPS_PORT, 0));
    if (!connection.value) {
        throw std::runtime_error(describe_windows_error(GetLastError()));
    }
    // WINHTTP_FLAG_SECURE is what makes this HTTPS. There is no plain-HTTP path
    // in this tool and there must never be one: the key travels in a header.
    Handle call(WinHttpOpenRequest(connection.value, L"POST", widen(request.path).c_str(),
                                   nullptr, WINHTTP_NO_REFERER,
                                   WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    if (!call.value) {
        throw std::runtime_error(describe_windows_error(GetLastError()));
    }

    /*
     * A credential must not follow a redirect.
     *
     * WinHTTP follows 3xx by default, and on the redirected request it re-sends
     * the headers it was given — which here means the API key. A provider that
     * redirected, an endpoint typed slightly wrong, or a hijacked DNS answer
     * would therefore hand somebody else's host a working billing credential,
     * and nothing on this end would look unusual. None of the three endpoints
     * legitimately redirects: they are direct POST APIs. So redirects are off,
     * and a 3xx comes back as a status the caller reports rather than as a
     * request nobody saw.
     */
    DWORD noRedirects = WINHTTP_DISABLE_REDIRECTS;
    // Checked, not fired and forgotten. A security option that silently failed
    // to apply is worse than one that was never set, because the comment above
    // would then describe a protection that is not there.
    if (!WinHttpSetOption(call.value, WINHTTP_OPTION_DISABLE_FEATURE,
                          &noRedirects, sizeof noRedirects)) {
        throw std::runtime_error(
            "redirects could not be turned off, and the API key must not be allowed to "
            "follow one: " + describe_windows_error(GetLastError()));
    }
    /*
     * Ask for modern TLS explicitly rather than inheriting whatever this
     * machine's defaults happen to allow.
     *
     * Best-effort on purpose, unlike the redirect setting: the TLS 1.3 flag
     * does not exist in every SDK this might be built against, and a machine
     * that refuses the combination should still be able to reach a provider
     * over TLS 1.2 rather than be unable to use the feature at all. The
     * connection is HTTPS either way — that part is not optional.
     */
    DWORD protocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
#ifdef WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3
    protocols |= WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
#endif
    WinHttpSetOption(session.value, WINHTTP_OPTION_SECURE_PROTOCOLS,
                     &protocols, sizeof protocols);

    for (const auto& header : request.headers) {
        const auto line = widen(header.first + ": " + header.second);
        if (!WinHttpAddRequestHeaders(call.value, line.c_str(),
                                      static_cast<DWORD>(line.size()),
                                      WINHTTP_ADDREQ_FLAG_ADD)) {
            throw std::runtime_error(describe_windows_error(GetLastError()));
        }
    }
    if (!WinHttpSendRequest(call.value, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                            const_cast<char*>(request.body.data()),
                            static_cast<DWORD>(request.body.size()),
                            static_cast<DWORD>(request.body.size()), 0)) {
        throw std::runtime_error(describe_windows_error(GetLastError()));
    }
    if (!WinHttpReceiveResponse(call.value, nullptr)) {
        throw std::runtime_error(describe_windows_error(GetLastError()));
    }

    DWORD status = 0;
    DWORD status_size = sizeof status;
    if (!WinHttpQueryHeaders(call.value,
                             WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                             WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size,
                             WINHTTP_NO_HEADER_INDEX)) {
        throw std::runtime_error(describe_windows_error(GetLastError()));
    }

    Response response;
    response.status = static_cast<int>(status);
    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(call.value, &available)) {
            throw std::runtime_error(describe_windows_error(GetLastError()));
        }
        if (available == 0) { break; }
        // See kMaxReplyBytes: the loop has no other reason to stop, so an
        // endpoint that never stops sending would be read until the machine
        // runs out of memory.
        if (response.body.size() + available > cloud::kMaxReplyBytes) {
            throw std::runtime_error(
                "the provider sent more than " +
                std::to_string(cloud::kMaxReplyBytes / (1024u * 1024u)) +
                " MB, which is not a line of speech; the request was abandoned");
        }
        const auto from = response.body.size();
        response.body.resize(from + available);
        DWORD read = 0;
        if (!WinHttpReadData(call.value, response.body.data() + from, available, &read)) {
            throw std::runtime_error(describe_windows_error(GetLastError()));
        }
        response.body.resize(from + read);
        if (read == 0) { break; }
    }
    return response;
}

/*
 * Read the key, then delete the file, before anything else happens.
 *
 * The file exists for the few milliseconds between the panel writing it and
 * this line running. It is removed before the socket is opened rather than
 * afterwards, so a network call that hangs, or a process that is killed while
 * waiting, does not leave a credential lying in the temp directory. The panel
 * removes it as well, because two attempts at deleting a file is cheaper than
 * one missed one.
 */
std::string take_key(const std::string& path) {
    std::ifstream file(std::filesystem::u8path(path), std::ios::binary);
    if (!file) {
        throw std::runtime_error("the API key file could not be read");
    }
    std::string key((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    file.close();
    std::error_code ignored;
    std::filesystem::remove(std::filesystem::u8path(path), ignored);

    // A key pasted from a web page arrives with a newline on it, and a header
    // value with a newline in it is refused further down. Strip rather than
    // refuse: this is the one whitespace nobody typed on purpose.
    if (key.size() >= 3 && static_cast<unsigned char>(key[0]) == 0xEF &&
        static_cast<unsigned char>(key[1]) == 0xBB &&
        static_cast<unsigned char>(key[2]) == 0xBF) {
        key.erase(0, 3);
    }
    while (!key.empty() && (key.back() == '\r' || key.back() == '\n' || key.back() == ' ' ||
                            key.back() == '\t')) {
        key.pop_back();
    }
    while (!key.empty() && (key.front() == ' ' || key.front() == '\t')) { key.erase(0, 1); }
    if (key.empty()) {
        throw std::runtime_error("the API key file was empty");
    }
    return key;
}

void forget(std::string& secret) {
    if (!secret.empty()) {
        SecureZeroMemory(secret.data(), secret.size());
    }
    secret.clear();
}

std::vector<unsigned char> read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) { return {}; }
    return std::vector<unsigned char>(std::istreambuf_iterator<char>(file),
                                      std::istreambuf_iterator<char>());
}

/*
 * Written to one side and moved into place.
 *
 * A half-written file in the cache is worse than no cache at all: it exists, so
 * every later run is a hit, and every later run plays a truncated or empty
 * recording that costs nothing and cannot be fixed by pressing the button
 * again. Renaming is atomic on NTFS, so the file either is not there or is
 * complete.
 */
void write_atomically(const std::filesystem::path& path,
                      const std::vector<unsigned char>& bytes) {
    auto temporary = path;
    temporary += ".part";
    {
        std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
        if (!out) {
            throw std::runtime_error("the audio could not be written beside the project");
        }
        out.write(reinterpret_cast<const char*>(bytes.data()),
                  static_cast<std::streamsize>(bytes.size()));
        if (!out) {
            throw std::runtime_error("writing the audio file failed part of the way through");
        }
    }
    std::error_code failed;
    std::filesystem::rename(temporary, path, failed);
    if (failed) {
        // A rename onto an existing file fails on some volumes; the file being
        // replaced is the same content by definition, so removing first is safe.
        std::filesystem::remove(path, failed);
        std::filesystem::rename(temporary, path, failed);
    }
    if (failed) {
        std::filesystem::remove(temporary, failed);
        throw std::runtime_error("the finished audio could not be moved into place");
    }
}

// A cache entry that is not a WAV is a poisoned one — from a build that wrote
// the file before checking it, or from a disk that filled up mid-write. Cheaper
// to notice here than to hand After Effects a file it imports as silence.
bool usable_wav(const std::vector<unsigned char>& bytes) {
    return bytes.size() >= 44 && std::equal(bytes.begin(), bytes.begin() + 4, "RIFF") &&
           std::equal(bytes.begin() + 8, bytes.begin() + 12, "WAVE");
}

void print_providers() {
    std::cout << "VOICE 1\n";
    for (const auto& provider : cloud::providers()) {
        // Label, model and voice go over as hex for the same reason everything
        // else does. The id and the host are ASCII by construction.
        std::cout << "P " << provider.id
                  << " " << cloud::as_hex(provider.label)
                  << " " << provider.host
                  << " " << cloud::as_hex(std::string(provider.default_model).empty()
                                              ? std::string("-")
                                              : std::string(provider.default_model))
                  << " " << cloud::as_hex(provider.default_voice)
                  << " " << (provider.needs_region ? 1 : 0)
                  // Whether it runs here. Nothing does yet; the panel reads it
                  // rather than assuming, so 3.0.0's offline model is a row.
                  << " " << (provider.on_this_machine ? 1 : 0)
                  << "\n";
    }
    std::cout << "END " << cloud::providers().size() << "\n";
}

[[noreturn]] void usage() {
    std::cerr <<
        "island_chatter_voice --providers\n"
        "island_chatter_voice --cache-path --provider <id> --text <hex-utf8>\n"
        "                     [--voice <hex>] [--model <hex>] [--region <hex>]\n"
        "                     --cache-dir <hex-utf8-path>\n"
        "island_chatter_voice --speak --provider <id> --text <hex-utf8>\n"
        "                     --key-file <hex-utf8-path> --cache-dir <hex-utf8-path>\n"
        "                     [--voice <hex>] [--model <hex>] [--region <hex>]\n"
        "\n"
        "The API key is read from --key-file and that file is deleted before the\n"
        "request is sent. There is deliberately no way to pass it as an argument:\n"
        "a command line is readable by every process on the machine.\n";
    std::exit(2);
}

}  // namespace

int main(int argc, char** argv) {
    std::string key;
    try {
        std::vector<std::string> args(argv + 1, argv + argc);
        if (args.empty()) { usage(); }
        const auto command = cloud::parse_arguments(args);

        if (command.mode == cloud::Mode::Providers) {
            print_providers();
            return 0;
        }

        const auto* provider = cloud::find(command.params.provider);
        if (!provider) {
            throw std::runtime_error("there is no provider called '" +
                                     command.params.provider + "'");
        }
        if (command.cache_dir.empty()) {
            throw std::runtime_error("--cache-dir is required");
        }
        const auto folder = std::filesystem::u8path(command.cache_dir);
        const auto destination = folder / cloud::cache_file_name(*provider, command.params);
        // Printed as hex for the same reason it was read as hex: a project
        // folder with a Chinese name would otherwise come back full of '?'.
        const auto printable = cloud::as_hex(destination.u8string());

        if (command.mode == cloud::Mode::CachePath) {
            std::cout << "VOICE 1\nPATH " << printable << "\n";
            return 0;
        }

        /*
         * The cache check happens before the key is even read.
         *
         * This is the line that saves money, and it has to come first for that
         * to be true: everything below it costs something. A line whose text
         * and settings have not changed is answered from disk, and the panel is
         * told which of the two happened so it can say so.
         */
        const auto existing = read_file(destination);
        if (usable_wav(existing)) {
            std::cout << "VOICE 1\nOK " << printable << " " << existing.size() << " 1\n";
            return 0;
        }

        if (command.key_file.empty()) {
            throw std::runtime_error("--key-file is required to speak");
        }
        key = take_key(command.key_file);
        auto params = command.params;
        params.key = key;
        const auto request = cloud::build_request(*provider, params);
        forget(params.key);
        forget(key);

        const auto response = send(request);
        if (response.status < 200 || response.status >= 300) {
            throw std::runtime_error(cloud::message_from_error(
                response.status,
                std::string(response.body.begin(), response.body.end())));
        }
        const auto audio = cloud::wav_from_reply(*provider, response.body);
        std::error_code ignored;
        std::filesystem::create_directories(folder, ignored);
        write_atomically(destination, audio);
        std::cout << "VOICE 1\nOK " << printable << " " << audio.size() << " 0\n";
        return 0;
    } catch (const std::exception& error) {
        forget(key);
        /*
         * The message goes to stdout, as hex, and that is not decoration.
         *
         * system.callSystem() returns stdout; a message on stderr may or may
         * not reach the panel depending on how the host was launched, and a
         * provider's error is the one thing here that must never be lost.
         * Invariant 8k is the record of what happens when a real error is
         * replaced by a generic one: hours spent on the wrong problem.
         */
        std::cout << "VOICE 1\nERROR " << cloud::as_hex(error.what()) << "\n";
        return 1;
    }
}

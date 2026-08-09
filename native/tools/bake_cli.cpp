// island_chatter_bake: renders one utterance straight to a WAV file.
//
// The panel's Bake command used to drive After Effects' render queue, which
// meant juggling output-module templates, muting every other layer, moving the
// work area and blocking the UI behind the render window. This tool does the
// same job with the same engine in a few hundred milliseconds and no host
// involvement, so Bake is just "write a file, import it".
//
// Text arrives as hex-encoded UTF-8 so nothing depends on the console code page.

#include "island_chatter/dsp.hpp"
#include "island_chatter/midi.hpp"
#include "island_chatter/song.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void write_u16(std::ofstream& out, std::uint16_t value) {
    out.put(static_cast<char>(value & 0xFFU));
    out.put(static_cast<char>((value >> 8U) & 0xFFU));
}

void write_u32(std::ofstream& out, std::uint32_t value) {
    write_u16(out, static_cast<std::uint16_t>(value & 0xFFFFU));
    write_u16(out, static_cast<std::uint16_t>((value >> 16U) & 0xFFFFU));
}

std::string decode_hex(const std::string& hex) {
    if (hex.size() % 2U != 0U) {
        throw std::runtime_error("--text must contain an even number of hex digits");
    }
    std::string out;
    out.reserve(hex.size() / 2U);
    for (std::size_t index = 0; index + 1 < hex.size(); index += 2) {
        const auto byte = std::strtoul(hex.substr(index, 2).c_str(), nullptr, 16);
        out.push_back(static_cast<char>(byte));
    }
    return out;
}

// The panel used to reimplement the engine's text planning in ExtendScript so it
// could place markers, size layers and drive Type-On. Two copies of Mandarin
// readings, sandhi, the phrase table and the timing constants drifted apart
// every time either side changed. This prints the plan the engine actually
// uses, so there is only one copy.
//
// Everything on these lines is ASCII, including the characters, which travel as
// decimal codepoints. system.callSystem() hands stdout back through the console
// code page, so a Chinese character printed as text would come back as "?" for
// exactly the same reason the arguments go over as hex.
void print_plan(const island_chatter::Settings& settings) {
    const island_chatter::Utterance utterance(settings);
    const auto& plan = utterance.diagnostics();
    std::cout << "PLAN 1\n"
              << "RATE " << settings.sample_rate << "\n"
              << "SAMPLES " << utterance.sample_count() << "\n";
    for (std::size_t index = 0; index < plan.event_count; ++index) {
        // A reading is empty for anything the engine has no Mandarin syllable
        // for; "-" keeps the field count fixed so the parser stays trivial.
        const auto& reading = plan.readings[index];
        std::cout << "E " << plan.start_samples[index] << " " << plan.length_samples[index]
                  << " " << (reading.empty() ? "-" : reading);
        for (const auto codepoint : plan.source_units[index]) {
            std::cout << " " << codepoint;
        }
        std::cout << "\n";
    }
    // The caller checks this count: callSystem() gives no exit status, so a
    // truncated read would otherwise look like a short utterance.
    std::cout << "END " << plan.event_count << "\n";
}

// Decimal codepoints, for the same reason print_plan() uses them: stdout comes
// back through the console code page and would turn anything outside it into
// "?" before the panel ever sees it.
void print_codepoints(const std::string& utf8) {
    std::size_t index = 0;
    while (index < utf8.size()) {
        const auto first = static_cast<unsigned char>(utf8[index]);
        std::uint32_t codepoint = first;
        std::size_t count = 1;
        if ((first & 0xE0U) == 0xC0U) { codepoint = first & 0x1FU; count = 2; }
        else if ((first & 0xF0U) == 0xE0U) { codepoint = first & 0x0FU; count = 3; }
        else if ((first & 0xF8U) == 0xF0U) { codepoint = first & 0x07U; count = 4; }
        if (index + count > utf8.size()) { break; }
        for (std::size_t at = 1; at < count; ++at) {
            codepoint = (codepoint << 6U) |
                (static_cast<unsigned char>(utf8[index + at]) & 0x3FU);
        }
        std::cout << " " << codepoint;
        index += count;
    }
}

std::string as_hex(const std::string& bytes) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2U);
    for (const char letter : bytes) {
        const auto value = static_cast<unsigned char>(letter);
        out.push_back(digits[value >> 4U]);
        out.push_back(digits[value & 0x0FU]);
    }
    return out;
}

std::vector<unsigned char> read_all(const std::string& path) {
    std::ifstream file(std::filesystem::u8path(path), std::ios::binary);
    if (!file) {
        throw std::runtime_error("cannot open the MIDI file for reading");
    }
    return std::vector<unsigned char>(
        std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
}

std::vector<island_chatter::MelodyNote> parse_melody(const std::string& value) {
    std::vector<island_chatter::MelodyNote> melody;
    std::size_t index = 0;
    while (index < value.size()) {
        std::size_t next = value.find(',', index);
        if (next == std::string::npos) { next = value.size(); }
        if (next > index) {
            melody.push_back(island_chatter::decode_melody_slot(
                std::atoi(value.substr(index, next - index).c_str())));
        }
        index = next + 1U;
    }
    if (melody.size() > island_chatter::kMelodySlots) {
        throw std::runtime_error("--melody carries more slots than the transport holds");
    }
    return melody;
}

// A track picker needs a name and a note count, and nothing else. The name is
// handed over as raw hex because SMF track names have no declared encoding:
// deciding here that they are UTF-8 would turn a Shift-JIS name into an error
// instead of into something the panel can quietly fall back from.
void print_tracks(const island_chatter::midi::File& file) {
    std::cout << "TRACKS 1\n"
              << "BPM " << file.bpm_at(0) << "\n";
    for (std::size_t index = 0; index < file.tracks.size(); ++index) {
        const auto& track = file.tracks[index];
        std::cout << "T " << index << " " << track.notes.size() << " "
                  << (track.name.empty() ? "-" : as_hex(track.name)) << "\n";
    }
    std::cout << "END " << file.tracks.size() << "\n";
}

void print_song(const island_chatter::song::Assignment& assignment) {
    std::cout << "SONG 1\n"
              << "BPM " << assignment.bpm << "\n"
              << "EXTRA " << assignment.extra_notes << " " << assignment.extra_syllables
              << " " << assignment.dropped_chord_notes << " "
              << assignment.split_lines << "\n";
    for (std::size_t index = 0; index < assignment.lines.size(); ++index) {
        const auto& line = assignment.lines[index];
        std::cout << "L " << index << " " << line.start_seconds << " " << line.bpm << " "
                  << line.syllables << " " << line.notes << " " << (line.continued ? 1 : 0) << "\n";
        std::cout << "X " << index;
        print_codepoints(line.text);
        std::cout << "\n";
        std::cout << "N " << index;
        for (const int slot : line.slots) {
            std::cout << " " << slot;
        }
        std::cout << "\n";
    }
    std::cout << "END " << assignment.lines.size() << "\n";
}

[[noreturn]] void usage() {
    std::cerr <<
        "island_chatter_bake --out <file.wav> | --out-hex <hex-utf8-path> | --plan\n"
        "                    --text <hex-utf8>\n"
        "  [--voice N] [--emotion N] [--size N] [--seed N] [--rate N]\n"
        "  [--pitch F] [--speed F] [--volume F] [--consonant F]\n"
        "  [--clarity F] [--cuteness F] [--tempo-lock 0|1]\n"
        "  [--formant F] [--source 0-5] [--vibrato F] [--vibrato-rate F]\n"
        "  [--melody slot,slot,...] [--melody-bpm F] [--transpose N]\n"
        "  [--tone-blend F] [--portamento F] [--vibrato-delay F]\n"
        "\n"
        "island_chatter_bake --midi-hex <hex-utf8-path> --list-tracks\n"
        "island_chatter_bake --midi-hex <hex-utf8-path> --track N\n"
        "                    --lyrics <hex-utf8> --dump-song\n"
        "\n"
        "Prefer --out-hex from scripts: a path handed over as plain text is\n"
        "converted to the console code page first, so any character outside it\n"
        "arrives as '?' and the write fails.\n";
    std::exit(2);
}

}  // namespace

int main(int argc, char** argv) {
    try {
        island_chatter::Settings settings;
        std::string output;
        std::string midi_path;
        std::string lyrics;
        std::size_t track = 0;
        int tonic = 0;
        bool have_text = false;
        bool plan_only = false;
        bool list_tracks = false;
        bool dump_song = false;

        for (int index = 1; index < argc; ++index) {
            const std::string flag = argv[index];
            // The flags that take no value, handled before the loop reaches for
            // one.
            if (flag == "--plan") { plan_only = true; continue; }
            if (flag == "--list-tracks") { list_tracks = true; continue; }
            if (flag == "--dump-song") { dump_song = true; continue; }
            if (index + 1 >= argc) usage();
            const std::string value = argv[++index];
            if (flag == "--midi-hex") midi_path = decode_hex(value);
            else if (flag == "--lyrics") lyrics = decode_hex(value);
            else if (flag == "--track") track = std::strtoul(value.c_str(), nullptr, 10);
            else if (flag == "--tonic") tonic = std::atoi(value.c_str());
            else if (flag == "--melody") {
                settings.melody = parse_melody(value);
                // Asking for a melody is what turns the sung path on. Nothing
                // else does, which is why a project saved before 1.7.0 — whose
                // melody length reads as zero — still speaks.
                settings.melody_mode = !settings.melody.empty();
            }
            else if (flag == "--melody-bpm") settings.melody_bpm = std::atof(value.c_str());
            else if (flag == "--transpose") settings.transpose = std::atoi(value.c_str());
            else if (flag == "--tone-blend") settings.tone_blend = std::atof(value.c_str());
            else if (flag == "--portamento") settings.portamento_seconds = std::atof(value.c_str());
            else if (flag == "--vibrato-delay") settings.vibrato_delay = std::atof(value.c_str());
            else if (flag == "--out") output = value;
            else if (flag == "--out-hex") output = decode_hex(value);
            else if (flag == "--text") { settings.text = decode_hex(value); have_text = true; }
            else if (flag == "--voice") settings.voice_index = std::strtoul(value.c_str(), nullptr, 10);
            else if (flag == "--emotion")
                settings.emotion = static_cast<island_chatter::Emotion>(std::atoi(value.c_str()));
            else if (flag == "--size")
                settings.character_size = static_cast<island_chatter::CharacterSize>(std::atoi(value.c_str()));
            else if (flag == "--seed")
                settings.seed = static_cast<std::uint32_t>(std::strtoul(value.c_str(), nullptr, 10));
            else if (flag == "--rate")
                settings.sample_rate = static_cast<std::uint32_t>(std::strtoul(value.c_str(), nullptr, 10));
            else if (flag == "--pitch") settings.pitch = std::atof(value.c_str());
            else if (flag == "--speed") settings.speed = std::atof(value.c_str());
            else if (flag == "--volume") settings.volume = std::atof(value.c_str());
            else if (flag == "--consonant") settings.consonant = std::atof(value.c_str());
            else if (flag == "--clarity") settings.clarity = std::atof(value.c_str());
            else if (flag == "--cuteness") settings.cuteness = std::atof(value.c_str());
            else if (flag == "--tempo-lock") settings.tempo_lock = std::atoi(value.c_str()) != 0;
            else if (flag == "--formant") settings.formant = std::atof(value.c_str());
            else if (flag == "--source")
                settings.source = static_cast<island_chatter::SourceType>(std::atoi(value.c_str()));
            else if (flag == "--vibrato") settings.vibrato_depth = std::atof(value.c_str());
            else if (flag == "--vibrato-rate") settings.vibrato_rate = std::atof(value.c_str());
            else usage();
        }
        // The MIDI modes are about a file, not about an utterance, so they run
        // before the text is required.
        if (list_tracks || dump_song) {
            if (midi_path.empty()) usage();
            const auto file = island_chatter::midi::parse(read_all(midi_path));
            if (list_tracks) {
                print_tracks(file);
                return 0;
            }
            print_song(island_chatter::song::assign(file, track, lyrics, tonic));
            return 0;
        }
        if (!have_text) usage();
        if (plan_only) {
            print_plan(settings);
            return 0;
        }
        if (output.empty()) usage();

        const auto rendered = island_chatter::synthesize(settings);

        // u8path reaches the wide Windows API, so a path containing characters
        // the console code page cannot represent still opens correctly.
        const auto destination = std::filesystem::u8path(output);
        std::ofstream file(destination, std::ios::binary);
        if (!file) {
            // The path is deliberately not echoed: stderr is read back through
            // the same lossy code page. The caller knows the path it asked for.
            throw std::runtime_error("cannot open the output file for writing");
        }
        const auto frames = static_cast<std::uint32_t>(rendered.samples.size());
        const std::uint32_t data_bytes = frames * 2U;
        file.write("RIFF", 4);
        write_u32(file, 36U + data_bytes);
        file.write("WAVE", 4);
        file.write("fmt ", 4);
        write_u32(file, 16U);
        write_u16(file, 1U);                       // PCM
        write_u16(file, 1U);                       // mono
        write_u32(file, settings.sample_rate);
        write_u32(file, settings.sample_rate * 2U);
        write_u16(file, 2U);
        write_u16(file, 16U);
        file.write("data", 4);
        write_u32(file, data_bytes);
        for (const float sample : rendered.samples) {
            const auto pcm = static_cast<std::int16_t>(
                std::lround(std::clamp(sample, -1.0F, 1.0F) * 32767.0F));
            write_u16(file, static_cast<std::uint16_t>(pcm));
        }
        if (!file) {
            throw std::runtime_error("failed while writing the output file");
        }
        // The panel parses this line to confirm the render really happened.
        std::cout << "OK " << frames << " " << settings.sample_rate << " "
                  << rendered.diagnostics.duration_seconds << "\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "ERROR " << error.what() << "\n";
        return 1;
    }
}

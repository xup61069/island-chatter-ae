// Island Chatter — a voice that comes back from somebody else's model.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0

#include "island_chatter/cloud.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>

namespace island_chatter::cloud {

namespace {

/*
 * The table.
 *
 * Every provider here returns audio that needs no decoder — a WAV, or raw
 * little-endian 16-bit PCM which is a WAV with the header left off. That is the
 * selection rule and it is the reason these three are the three: an mp3-only
 * provider would mean shipping a decoder, and a decoder is a large piece of
 * untrusted-input parsing to add to a product whose only current exposure of
 * that kind is one carefully bounds-checked WAV reader.
 *
 * The rate on each row is the rate the *requested format* comes back at, and it
 * is written next to the request that asks for it: the format is in ElevenLabs'
 * query string and in Azure's X-Microsoft-OutputFormat header, so changing one
 * without the other would silently mislabel the file. The panel never needs to
 * know any of this; it asks for a WAV and gets a WAV.
 */
const std::vector<Provider>& table() {
    static const std::vector<Provider> rows = {
        Provider{
            "openai",
            "OpenAI",
            "api.openai.com",
            "/v1/audio/speech",
            "Content-Type: application/json\n"
            "Authorization: Bearer $KEY",
            "{\"model\":\"$MODEL\",\"voice\":\"$VOICE\",\"input\":\"$TEXT\","
            "\"response_format\":\"wav\"}",
            Escape::Json,
            Reply::Wav,
            24000,
            "gpt-4o-mini-tts",
            "alloy",
            false,
            false
        },
        Provider{
            "elevenlabs",
            "ElevenLabs",
            "api.elevenlabs.io",
            // pcm_24000 is the uncompressed option. It arrives as headerless
            // 16-bit little-endian mono, which is why Reply::RawPcm16 exists at
            // all — the alternative was asking for mp3 and decoding it.
            "/v1/text-to-speech/$VOICE?output_format=pcm_24000",
            "Content-Type: application/json\n"
            "xi-api-key: $KEY",
            "{\"text\":\"$TEXT\",\"model_id\":\"$MODEL\"}",
            Escape::Json,
            Reply::RawPcm16,
            24000,
            "eleven_multilingual_v2",
            "21m00Tcm4TlvDq8ikWAM",
            false,
            false
        },
        Provider{
            "azure",
            "Azure Speech",
            "$REGION.tts.speech.microsoft.com",
            "/cognitiveservices/v1",
            "Content-Type: application/ssml+xml\n"
            "X-Microsoft-OutputFormat: riff-24khz-16bit-mono-pcm\n"
            "Ocp-Apim-Subscription-Key: $KEY\n"
            // Azure rejects a request with no User-Agent, with a 400 whose body
            // does not say so.
            "User-Agent: IslandChatter",
            "<speak version='1.0' xml:lang='$LANG'>"
            "<voice name='$VOICE'>$TEXT</voice></speak>",
            Escape::Xml,
            Reply::Wav,
            24000,
            "",
            "zh-TW-HsiaoChenNeural",
            true,
            false
        },
    };
    return rows;
}

/*
 * Azure needs the language beside the voice, and the voice already contains it.
 *
 * Every Azure voice is named `<language>-<region>-<name>Neural`, so asking the
 * user to type "zh-TW" into a second field would be asking them to repeat
 * themselves and to get it wrong. Anything that does not look like that falls
 * back to en-US, which Azure accepts and which the voice name overrides anyway.
 */
std::string language_from_voice(const std::string& voice) {
    const auto first = voice.find('-');
    if (first == std::string::npos) { return "en-US"; }
    const auto second = voice.find('-', first + 1);
    if (second == std::string::npos) { return "en-US"; }
    return voice.substr(0, second);
}

std::string replace_all(std::string text, const std::string& from, const std::string& to) {
    if (from.empty()) { return text; }
    std::size_t at = 0;
    while ((at = text.find(from, at)) != std::string::npos) {
        text.replace(at, from.size(), to);
        at += to.size();
    }
    return text;
}

// The placeholder names, in one place, so a template and its expansion cannot
// disagree about what they are called.
struct Values {
    std::string key;
    std::string voice;
    std::string model;
    std::string region;
    std::string language;
    std::string text;
};

Values values_for(const Provider& provider, const Params& params) {
    Values values;
    values.key = params.key;
    values.voice = params.voice.empty() ? provider.default_voice : params.voice;
    values.model = params.model.empty() ? provider.default_model : params.model;
    values.region = params.region;
    values.language = language_from_voice(values.voice);
    values.text = params.text;
    return values;
}

std::string expand(const std::string& source, const Values& values,
                   std::string (*escape)(const std::string&)) {
    std::string out = source;
    out = replace_all(out, "$TEXT", escape(values.text));
    out = replace_all(out, "$VOICE", escape(values.voice));
    out = replace_all(out, "$MODEL", escape(values.model));
    out = replace_all(out, "$REGION", escape(values.region));
    out = replace_all(out, "$LANG", escape(values.language));
    out = replace_all(out, "$KEY", escape(values.key));
    return out;
}

std::string no_escape(const std::string& value) { return value; }

/*
 * A value that carries a newline is a header injection, and it has to be caught
 * *before* the template is expanded.
 *
 * The first version of this checked each finished header line instead, which
 * cannot work and which cloud_tests.cpp proved cannot work: a key of
 * "sk-good\r\nX-Injected: yes" expands into the template and then splits on the
 * newline into two lines, both of which look like perfectly well-formed
 * headers. Nothing downstream can tell that one of them was never in the table.
 * Checking the value is checking the mechanism; checking the line is checking a
 * symptom that has already gone.
 *
 * The text is exempt, and only the text: a line of dialogue may contain
 * anything, and it reaches the body through an escaper rather than a header.
 * Everything else here — a key, a voice id, a model name, a region — is a short
 * identifier that has no legitimate line break in it, and the most likely way
 * to acquire one is pasting from a web page.
 */
void reject_control_characters(const std::string& name, const std::string& value) {
    for (const char letter : value) {
        const auto code = static_cast<unsigned char>(letter);
        if (code == '\r' || code == '\n' || code < 0x20) {
            throw std::runtime_error(
                "the value for " + name + " contains a line break or control character");
        }
    }
}

bool starts_with(const std::vector<unsigned char>& bytes, const char* marker,
                 std::size_t at = 0) {
    const auto length = std::strlen(marker);
    if (bytes.size() < at + length) { return false; }
    return std::memcmp(bytes.data() + at, marker, length) == 0;
}

/*
 * What did we actually get, if it was not a WAV.
 *
 * Naming it is the whole value of this function. A provider that quietly
 * ignored the format we asked for hands back an mp3 with a 200 status, and a
 * .wav file containing mp3 imports into After Effects as silence — which looks
 * exactly like the voice not working rather than like the wrong format.
 */
std::string describe_bytes(const std::vector<unsigned char>& bytes) {
    if (bytes.empty()) { return "nothing at all"; }
    if (starts_with(bytes, "ID3") ||
        (bytes.size() > 1 && bytes[0] == 0xFF && (bytes[1] & 0xE0U) == 0xE0U)) {
        return "an mp3";
    }
    if (starts_with(bytes, "OggS")) { return "an Ogg file"; }
    if (starts_with(bytes, "fLaC")) { return "a FLAC file"; }
    if (starts_with(bytes, "FORM")) { return "an AIFF file"; }
    if (bytes.size() > 4 && starts_with(bytes, "ftyp", 4)) { return "an MP4/M4A file"; }
    if (bytes[0] == '{' || bytes[0] == '[') { return "a JSON message, not audio"; }
    if (bytes[0] == '<') { return "an XML or HTML page, not audio"; }
    return "something that is not audio";
}

void write_u16(std::string& out, std::uint16_t value) {
    out.push_back(static_cast<char>(value & 0xFFU));
    out.push_back(static_cast<char>((value >> 8U) & 0xFFU));
}

void write_u32(std::string& out, std::uint32_t value) {
    write_u16(out, static_cast<std::uint16_t>(value & 0xFFFFU));
    write_u16(out, static_cast<std::uint16_t>((value >> 16U) & 0xFFFFU));
}

/*
 * Pull one JSON string value out by name, without a JSON parser.
 *
 * This reads error bodies, not audio, and it is allowed to fail: everything it
 * cannot make sense of falls back to the raw body. A real parser here would be
 * several hundred lines of untrusted-input handling to improve the wording of a
 * message. What it does have to get right is not walking off the end of a
 * truncated body, which is the only way this could hurt anybody.
 */
std::string json_string_field(const std::string& body, const std::string& name) {
    const std::string needle = "\"" + name + "\"";
    std::size_t at = body.find(needle);
    while (at != std::string::npos) {
        std::size_t cursor = at + needle.size();
        while (cursor < body.size() && (body[cursor] == ' ' || body[cursor] == '\t')) { ++cursor; }
        if (cursor < body.size() && body[cursor] == ':') {
            ++cursor;
            while (cursor < body.size() && (body[cursor] == ' ' || body[cursor] == '\t')) {
                ++cursor;
            }
            if (cursor < body.size() && body[cursor] == '"') {
                ++cursor;
                std::string value;
                while (cursor < body.size() && body[cursor] != '"') {
                    if (body[cursor] == '\\' && cursor + 1 < body.size()) {
                        ++cursor;
                        switch (body[cursor]) {
                            case 'n': value.push_back('\n'); break;
                            case 't': value.push_back(' '); break;
                            case 'r': break;
                            // \uXXXX is left as it was written rather than
                            // decoded: it is rare in these bodies, and a wrong
                            // decode would corrupt the one thing this function
                            // exists to preserve.
                            default: value.push_back(body[cursor]); break;
                        }
                        ++cursor;
                        continue;
                    }
                    value.push_back(body[cursor]);
                    ++cursor;
                }
                if (!value.empty()) { return value; }
            }
        }
        at = body.find(needle, at + needle.size());
    }
    return "";
}

std::string trimmed(const std::string& text) {
    std::size_t from = 0;
    std::size_t until = text.size();
    while (from < until && std::isspace(static_cast<unsigned char>(text[from]))) { ++from; }
    while (until > from && std::isspace(static_cast<unsigned char>(text[until - 1]))) { --until; }
    return text.substr(from, until - from);
}

// --- SHA-256 ---------------------------------------------------------------
//
// FIPS 180-4, written out rather than pulled in, because the runtime is
// dependency-free and this is eighty lines. It is pinned against the published
// test vectors in cloud_tests.cpp, which is the only reason to trust a hash
// somebody typed in from memory.

struct Sha256 {
    std::array<std::uint32_t, 8> state{0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
                                       0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U};
    std::array<unsigned char, 64> block{};
    std::size_t filled = 0;
    std::uint64_t total_bits = 0;

    static std::uint32_t rotate(std::uint32_t value, unsigned by) {
        return (value >> by) | (value << (32U - by));
    }

    void compress() {
        static const std::uint32_t k[64] = {
            0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U,
            0x923f82a4U, 0xab1c5ed5U, 0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
            0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U, 0xe49b69c1U, 0xefbe4786U,
            0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
            0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U,
            0x06ca6351U, 0x14292967U, 0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
            0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U, 0xa2bfe8a1U, 0xa81a664bU,
            0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
            0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU,
            0x5b9cca4fU, 0x682e6ff3U, 0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
            0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U};
        std::uint32_t w[64];
        for (std::size_t index = 0; index < 16; ++index) {
            w[index] = (static_cast<std::uint32_t>(block[index * 4]) << 24U) |
                       (static_cast<std::uint32_t>(block[index * 4 + 1]) << 16U) |
                       (static_cast<std::uint32_t>(block[index * 4 + 2]) << 8U) |
                       static_cast<std::uint32_t>(block[index * 4 + 3]);
        }
        for (std::size_t index = 16; index < 64; ++index) {
            const auto s0 = rotate(w[index - 15], 7) ^ rotate(w[index - 15], 18) ^
                            (w[index - 15] >> 3U);
            const auto s1 = rotate(w[index - 2], 17) ^ rotate(w[index - 2], 19) ^
                            (w[index - 2] >> 10U);
            w[index] = w[index - 16] + s0 + w[index - 7] + s1;
        }
        auto a = state[0], b = state[1], c = state[2], d = state[3];
        auto e = state[4], f = state[5], g = state[6], h = state[7];
        for (std::size_t index = 0; index < 64; ++index) {
            const auto s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const auto choice = (e & f) ^ (~e & g);
            const auto temp1 = h + s1 + choice + k[index] + w[index];
            const auto s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const auto majority = (a & b) ^ (a & c) ^ (b & c);
            const auto temp2 = s0 + majority;
            h = g; g = f; f = e; e = d + temp1;
            d = c; c = b; b = a; a = temp1 + temp2;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d;
        state[4] += e; state[5] += f; state[6] += g; state[7] += h;
    }

    void update(const std::string& bytes) {
        for (const char letter : bytes) {
            block[filled++] = static_cast<unsigned char>(letter);
            total_bits += 8;
            if (filled == 64) { compress(); filled = 0; }
        }
    }

    std::string finish() {
        const auto length = total_bits;
        block[filled++] = 0x80U;
        if (filled > 56) {
            while (filled < 64) { block[filled++] = 0; }
            compress();
            filled = 0;
        }
        while (filled < 56) { block[filled++] = 0; }
        for (int shift = 56; shift >= 0; shift -= 8) {
            block[filled++] = static_cast<unsigned char>((length >> shift) & 0xFFU);
        }
        compress();
        static const char* digits = "0123456789abcdef";
        std::string out;
        out.reserve(64);
        for (const auto word : state) {
            for (int shift = 28; shift >= 0; shift -= 4) {
                out.push_back(digits[(word >> shift) & 0x0FU]);
            }
        }
        return out;
    }
};

}  // namespace

const std::vector<Provider>& providers() { return table(); }

const Provider* find(const std::string& id) {
    for (const auto& provider : table()) {
        if (id == provider.id) { return &provider; }
    }
    return nullptr;
}

std::string json_escape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const char letter : value) {
        const auto code = static_cast<unsigned char>(letter);
        switch (letter) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                // Everything below 0x20 has to be escaped or the body is not
                // JSON. Everything at or above it, including every byte of
                // UTF-8, goes through untouched: escaping those to \u would
                // mean decoding UTF-8 here for no gain.
                if (code < 0x20U) {
                    char buffer[8];
                    std::snprintf(buffer, sizeof buffer, "\\u%04x", code);
                    out += buffer;
                } else {
                    out.push_back(letter);
                }
                break;
        }
    }
    return out;
}

std::string xml_escape(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const char letter : value) {
        switch (letter) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            case '"': out += "&quot;"; break;
            case '\'': out += "&apos;"; break;
            default: out.push_back(letter); break;
        }
    }
    return out;
}

std::string url_escape(const std::string& value) {
    static const char* digits = "0123456789ABCDEF";
    std::string out;
    out.reserve(value.size());
    for (const char letter : value) {
        const auto code = static_cast<unsigned char>(letter);
        if (std::isalnum(code) || code == '-' || code == '_' || code == '.' || code == '~') {
            out.push_back(letter);
        } else {
            out.push_back('%');
            out.push_back(digits[code >> 4U]);
            out.push_back(digits[code & 0x0FU]);
        }
    }
    return out;
}

Request build_request(const Provider& provider, const Params& params) {
    if (params.text.empty()) {
        throw std::runtime_error("there is no text to speak");
    }
    if (provider.needs_region && params.region.empty()) {
        throw std::runtime_error(
            std::string(provider.label) + " needs the region its resource is in");
    }
    if (params.key.empty()) {
        throw std::runtime_error(std::string(provider.label) + " needs an API key");
    }
    const auto values = values_for(provider, params);
    // Before anything is expanded into anything. See the note on the function.
    reject_control_characters("the API key", values.key);
    reject_control_characters("the voice", values.voice);
    reject_control_characters("the model", values.model);
    reject_control_characters("the region", values.region);

    Request request;
    // A host is not escaped: it is a name, and the only field that reaches it
    // is the region, which is checked below rather than mangled.
    request.host = expand(provider.host, values, no_escape);
    for (const char letter : request.host) {
        const auto code = static_cast<unsigned char>(letter);
        if (!std::isalnum(code) && letter != '.' && letter != '-') {
            throw std::runtime_error("the region contains a character a host name cannot have");
        }
    }
    // A path carries the voice id in one provider, so it is URL-escaped. The
    // literal '/' and '?' in the template survive because they are in the
    // template rather than in a value.
    request.path = expand(provider.path, values, url_escape);

    // The values that reach these were checked for line breaks above, so what
    // is split here is only ever the template's own newlines.
    std::string headers = expand(provider.headers, values, no_escape);
    std::size_t from = 0;
    while (from <= headers.size()) {
        auto until = headers.find('\n', from);
        if (until == std::string::npos) { until = headers.size(); }
        const auto line = trimmed(headers.substr(from, until - from));
        from = until + 1;
        if (line.empty()) { continue; }
        const auto colon = line.find(':');
        if (colon == std::string::npos) {
            throw std::runtime_error("a header template has no colon in it");
        }
        const auto name = trimmed(line.substr(0, colon));
        const auto value = trimmed(line.substr(colon + 1));
        if (value.empty()) {
            throw std::runtime_error("the header " + name + " expanded to nothing");
        }
        request.headers.emplace_back(name, value);
    }
    request.body = expand(provider.body,
                          values,
                          provider.body_escape == Escape::Xml ? xml_escape : json_escape);
    return request;
}

std::string sha256_hex(const std::string& bytes) {
    Sha256 hash;
    hash.update(bytes);
    return hash.finish();
}

namespace {

/*
 * Three decimals, and the same three every time.
 *
 * This string goes into the cache key, so a number that spells itself two ways
 * is two cache entries holding identical audio. `%.3f` is finer than any
 * control the panel offers and coarser than anything a listener could pick out,
 * and it is a fixed format rather than a shortest round-trip one for exactly
 * that reason.
 *
 * The tool never calls setlocale, so the decimal point is `.` here and in
 * strtod below. That is not an assumption about the machine: it is the C
 * locale, which is where a program starts and where this one stays.
 */
std::string fixed3(double value) {
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%.3f", value);
    return buffer;
}

std::string spell_tuning(const Tuning& tuning) {
    return "speaker=" + std::to_string(tuning.speaker) +
           ";variation=" + fixed3(tuning.variation) +
           ";timbre=" + fixed3(tuning.timbre) +
           ";speed=" + fixed3(tuning.speed);
}

// Refused rather than clamped, and refused with the number in the message: a
// value silently pulled back into range is a render the user cannot account
// for. The comparison is written the positive way round so that a NaN — which
// strtod happily produces from "nan" — fails it rather than passing every test
// against it.
double number_in(const char* name, const std::string& value, double low, double high) {
    char* stopped = nullptr;
    const double parsed = std::strtod(value.c_str(), &stopped);
    if (value.empty() || stopped == nullptr || *stopped != '\0') {
        throw std::runtime_error(std::string("the voice setting ") + name +
                                 " is not a number: \"" + value + "\"");
    }
    if (!(parsed >= low && parsed <= high)) {
        throw std::runtime_error(std::string("the voice setting ") + name + " is " + value +
                                 ", which is outside " + fixed3(low) + " to " + fixed3(high));
    }
    return parsed;
}

}  // namespace

/*
 * Spelled always, defaults included.
 *
 * 3.4.0 returned an empty string for the defaults so an untuned line kept its
 * cache file, and 3.5.0 took that out. The header carries the argument: an
 * empty spelling records "the defaults" rather than the numbers, so a build
 * that changes a default silently reinterprets every file already named that
 * way. `variation` changing from sherpa-onnx's 0.667 to MeloTTS's own 0.6 is
 * that case, and it happened one release after the shortcut was introduced.
 */
std::string tuning_text(const Tuning& tuning) {
    return spell_tuning(tuning);
}

Tuning tuning_from_text(const std::string& text) {
    Tuning tuning;
    // "default" is what the provider table carries for a source on this
    // machine, so it arrives here whenever nobody has opened the dialog.
    if (text.empty() || text == "default") { return tuning; }
    std::size_t at = 0;
    while (at <= text.size()) {
        const auto end = std::min(text.find(';', at), text.size());
        const auto piece = text.substr(at, end - at);
        at = end + 1;
        if (piece.empty()) { continue; }
        const auto equals = piece.find('=');
        if (equals == std::string::npos) {
            throw std::runtime_error("the voice setting \"" + piece + "\" is not name=value");
        }
        const auto name = piece.substr(0, equals);
        const auto value = piece.substr(equals + 1);
        if (name == "speaker") {
            char* stopped = nullptr;
            const long parsed = std::strtol(value.c_str(), &stopped, 10);
            if (value.empty() || stopped == nullptr || *stopped != '\0') {
                throw std::runtime_error("the speaker is not a whole number: \"" + value + "\"");
            }
            if (parsed < -1 || parsed > kMaxSpeaker) {
                throw std::runtime_error("the speaker is " + value + ", which is outside -1 to " +
                                         std::to_string(kMaxSpeaker));
            }
            tuning.speaker = static_cast<int>(parsed);
        } else if (name == "variation") {
            tuning.variation = number_in("variation", value, kMinVariation, kMaxVariation);
        } else if (name == "timbre") {
            tuning.timbre = number_in("timbre", value, kMinVariation, kMaxVariation);
        } else if (name == "speed") {
            tuning.speed = number_in("speed", value, kMinSpeed, kMaxSpeed);
        } else {
            /*
             * Not ignored, for the reason parse_arguments() refuses --key
             * rather than not implementing it: an unknown name here means the
             * panel and the tool disagree about what a voice is, and a setting
             * quietly dropped renders a voice the user did not ask for while
             * everything reports success.
             */
            throw std::runtime_error("there is no voice setting called \"" + name + "\"");
        }
    }
    return tuning;
}

std::string cache_material(const Provider& provider, const Params& params) {
    const auto values = values_for(provider, params);
    /*
     * Newline-separated, and the text goes last.
     *
     * Separators matter: without them a voice of "ab" with a model of "c" and a
     * voice of "a" with a model of "bc" hash the same, and the second line
     * silently plays the first line's audio. Text last because it is the only
     * field that can itself contain a newline, so it cannot be confused with a
     * field boundary once nothing follows it.
     *
     * Built through one helper rather than by hand, so a field cannot be added
     * without its separator — which is exactly the mistake that got past the
     * first version of the test, because only some of these boundaries can be
     * reached from the outside at all.
     */
    std::string material;
    const auto field = [&material](const std::string& value) {
        if (!material.empty()) { material += "\n"; }
        material += value;
    };
    field(provider.id);
    field(values.model);
    field(values.voice);
    field(values.region);
    field(std::to_string(provider.rate));
    field(std::to_string(static_cast<int>(provider.reply)));
    field(values.text);
    return material;
}

std::string cache_key(const Provider& provider, const Params& params) {
    return sha256_hex(cache_material(provider, params));
}

std::string cache_file_name(const Provider& provider, const Params& params) {
    return std::string(provider.id) + "-" + cache_key(provider, params).substr(0, 32) + ".wav";
}

std::vector<unsigned char> trim_silence(const std::vector<unsigned char>& pcm,
                                        std::uint32_t rate) {
    const std::size_t frames = pcm.size() / 2U;
    if (frames == 0U || rate == 0U) { return pcm; }
    // Little-endian 16-bit, which is what every path into here produces.
    const auto sample_at = [&pcm](std::size_t index) {
        const auto low = static_cast<unsigned>(pcm[index * 2U]);
        const auto high = static_cast<unsigned>(pcm[index * 2U + 1U]);
        return static_cast<int>(static_cast<std::int16_t>(
            static_cast<std::uint16_t>(low | (high << 8))));
    };
    const auto level_at = [&sample_at](std::size_t index) {
        const int value = sample_at(index);
        return value < 0 ? -value : value;
    };

    /*
     * Decided over windows, not sample by sample, and that is the whole
     * difference between a trim that works and one that makes things worse.
     *
     * The first version walked to the first sample above a threshold. It cut
     * the padding — and turned a render that had been the same length every
     * time into one that varied by 60 ms, 15% of a two-syllable word.
     * Measured: five renders of 早安 gave five different files.
     *
     * The model's output is not bit-identical between runs; ONNX Runtime is
     * asked for two intra-op threads and a threaded reduction does not add in
     * a fixed order, so the low bits move. That is inaudible in itself. What
     * made it audible was asking *where does the first sample cross a line* —
     * on a consonant that rises slowly out of the noise floor, one bit of
     * difference moves that answer by hundreds of samples.
     *
     * A mean over 10 ms suppresses it: 441 samples averaged do not move when
     * a few of them change by a bit. The answer is then quantised to a window,
     * so the worst a flip can cost is 10 ms rather than 60 — and it takes a
     * real change in the audio to flip one.
     */
    const std::size_t window = static_cast<std::size_t>(rate) / 100U;   // 10 ms
    if (window == 0U) { return pcm; }
    const std::size_t windows = (frames + window - 1U) / window;
    std::vector<int> loudness(windows, 0);
    std::size_t at;
    for (at = 0; at < windows; ++at) {
        const std::size_t from = at * window;
        const std::size_t to = (from + window < frames) ? from + window : frames;
        long long total = 0;
        for (std::size_t index = from; index < to; ++index) { total += level_at(index); }
        const std::size_t span = to - from;
        loudness[at] = span ? static_cast<int>(total / static_cast<long long>(span)) : 0;
    }

    int peak = 0;
    for (at = 0; at < windows; ++at) { if (loudness[at] > peak) { peak = loudness[at]; } }
    if (peak == 0) { return pcm; }
    /*
     * Relative to the loudest window, with an absolute floor under it.
     *
     * peak/64 is about 36 dB below the loudest part of the line: under any
     * speech, over the model's padding. Relative rather than absolute so a
     * quietly spoken line is not trimmed away entirely; the constant stops a
     * very quiet render treating its own noise as signal.
     *
     * It was peak/32 for one afternoon and that is too close to speech. A
     * render of 等一下 came back at 0.155 s against a normal 0.45 — a line
     * whose second half happened to be far quieter than its first, with the
     * quiet half inside the threshold. Half a line is a much worse failure
     * than the padding this exists to remove.
     */
    int quiet = peak / 64;
    if (quiet < 24) { quiet = 24; }

    std::size_t firstWindow = 0;
    while (firstWindow < windows && loudness[firstWindow] < quiet) { ++firstWindow; }
    std::size_t lastWindow = windows;
    while (lastWindow > firstWindow && loudness[lastWindow - 1U] < quiet) { --lastWindow; }
    if (firstWindow >= lastWindow) { return pcm; }

    /*
     * And never more than this from either end, whatever the levels say.
     *
     * The measured padding is 210 ms at its worst, so a cap above that removes
     * all of it and still cannot remove a syllable. Without a cap the failure
     * mode is unbounded: a line whose quiet half falls under the threshold
     * loses the quiet half, which is exactly what a 0.155 s 等一下 was. **A
     * trim that can delete speech is worse than the padding it removes**, so
     * the bound is on the damage rather than on the cleverness of the
     * threshold.
     */
    const std::size_t cap = static_cast<std::size_t>(rate) * kTrimMostMs / 1000U;
    const std::size_t capWindows = cap / window;
    if (firstWindow > capWindows) { firstWindow = capWindows; }
    if (windows - lastWindow > capWindows) { lastWindow = windows - capWindows; }

    std::size_t first = firstWindow * window;
    std::size_t last = lastWindow * window;
    if (last > frames) { last = frames; }

    const std::size_t head = static_cast<std::size_t>(rate) * kTrimHeadMs / 1000U;
    const std::size_t tail = static_cast<std::size_t>(rate) * kTrimTailMs / 1000U;
    first = first > head ? first - head : 0U;
    last = last + tail < frames ? last + tail : frames;
    if (first == 0U && last == frames) { return pcm; }
    return std::vector<unsigned char>(pcm.begin() + static_cast<std::ptrdiff_t>(first * 2U),
                                      pcm.begin() + static_cast<std::ptrdiff_t>(last * 2U));
}

std::vector<unsigned char> wav_from_pcm16(const std::vector<unsigned char>& pcm,
                                          std::uint32_t rate) {
    // An odd byte count cannot be whole 16-bit samples. The half sample at the
    // end is dropped rather than read past the end of the buffer.
    const auto frames = static_cast<std::uint32_t>(pcm.size() / 2U);
    const std::uint32_t data_bytes = frames * 2U;
    std::string header;
    header += "RIFF";
    write_u32(header, 36U + data_bytes);
    header += "WAVE";
    header += "fmt ";
    write_u32(header, 16U);
    write_u16(header, 1U);                    // PCM
    write_u16(header, 1U);                    // mono
    write_u32(header, rate);
    write_u32(header, rate * 2U);
    write_u16(header, 2U);
    write_u16(header, 16U);
    header += "data";
    write_u32(header, data_bytes);
    std::vector<unsigned char> out(header.begin(), header.end());
    out.insert(out.end(), pcm.begin(), pcm.begin() + data_bytes);
    return out;
}

std::vector<unsigned char> wav_from_reply(const Provider& provider,
                                          const std::vector<unsigned char>& body) {
    if (body.empty()) {
        throw std::runtime_error("the provider returned no audio at all");
    }
    if (provider.reply == Reply::RawPcm16) {
        if (body.size() < 2) {
            throw std::runtime_error("the provider returned too few bytes to be audio");
        }
        return wav_from_pcm16(body, provider.rate);
    }
    // A WAV is checked, not trusted. Everything downstream — the analyser, and
    // After Effects itself — treats the extension as a promise.
    if (!(starts_with(body, "RIFF") && starts_with(body, "WAVE", 8))) {
        throw std::runtime_error(std::string(provider.label) + " returned " +
                                 describe_bytes(body) + " instead of a WAV");
    }
    if (body.size() < 44) {
        throw std::runtime_error("the WAV that came back is too short to contain a header");
    }
    return body;
}

std::string meaning_of_status(int status) {
    switch (status) {
        case 401:
        case 403:
            return "the API key was refused";
        case 402:
            return "the account cannot be billed for this request";
        case 404:
            return "the endpoint or the voice does not exist";
        case 413:
            return "the text is longer than the provider accepts";
        case 429:
            return "too many requests, or the quota for this key is used up";
        default:
            break;
    }
    if (status >= 500) { return "the provider had a server error"; }
    if (status >= 400) { return "the provider refused the request"; }
    return "the provider answered with status " + std::to_string(status);
}

std::string meaning_of_network_error(unsigned long code) {
    switch (code) {
        case 12007UL:
            return "the provider's address could not be looked up; check the network";
        case 12029UL:
        case 12030UL:
            return "nothing answered at the provider's address; check the network or a firewall";
        case 12002UL:
            return "the request timed out";
        case 12175UL:
            return "the secure connection could not be established";
        default:
            return "the request could not be sent";
    }
}

std::string message_from_error(int status, const std::string& body) {
    /*
     * The provider's own words first.
     *
     * "message" covers OpenAI's {"error":{"message":...}} and most others;
     * "detail" is ElevenLabs, which uses it both as a string and as an object
     * containing a message, so the message lookup runs first and finds the
     * inner one either way. Azure sends plain text or nothing at all, which is
     * what the fall-through is for.
     */
    std::string said = json_string_field(body, "message");
    if (said.empty()) { said = json_string_field(body, "detail"); }
    if (said.empty()) { said = json_string_field(body, "error"); }
    if (said.empty()) {
        const auto plain = trimmed(body);
        // A body that is still JSON, or HTML, or a megabyte of anything, is
        // worse than useless in a dialog. The status line has to carry it.
        if (!plain.empty() && plain.size() <= 400 && plain[0] != '{' && plain[0] != '<' &&
            plain[0] != '[') {
            said = plain;
        }
    }
    std::string out = "HTTP " + std::to_string(status) + ": " + meaning_of_status(status);
    if (!said.empty()) { out += "\n" + said; }
    return out;
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

std::string from_hex(const std::string& hex) {
    if (hex.size() % 2U != 0U) {
        throw std::runtime_error("a hex argument has an odd number of digits");
    }
    std::string out;
    out.reserve(hex.size() / 2U);
    for (std::size_t index = 0; index + 1 < hex.size(); index += 2) {
        int value = 0;
        for (std::size_t at = 0; at < 2; ++at) {
            const auto letter = hex[index + at];
            int digit = 0;
            if (letter >= '0' && letter <= '9') { digit = letter - '0'; }
            else if (letter >= 'a' && letter <= 'f') { digit = letter - 'a' + 10; }
            else if (letter >= 'A' && letter <= 'F') { digit = letter - 'A' + 10; }
            else { throw std::runtime_error("a hex argument contains a non-hex digit"); }
            value = value * 16 + digit;
        }
        out.push_back(static_cast<char>(value));
    }
    return out;
}

Command parse_arguments(const std::vector<std::string>& args) {
    Command command;
    for (std::size_t index = 0; index < args.size(); ++index) {
        const auto& flag = args[index];
        if (flag == "--providers") { command.mode = Mode::Providers; continue; }
        if (flag == "--cache-path") { command.mode = Mode::CachePath; continue; }
        if (flag == "--speak") { command.mode = Mode::Speak; continue; }
        /*
         * The key has no command-line form, and the refusal is the point.
         *
         * Not implementing --key would leave it as an unrecognised flag, which
         * this loop also rejects — but only because every unknown flag is
         * rejected, and that could be relaxed by someone adding an option one
         * day. Naming it here says why, and cloud_tests.cpp pins it.
         */
        if (flag == "--key" || flag == "--api-key") {
            throw std::runtime_error(
                "the API key is never passed on the command line, where every process on "
                "the machine can read it; write it to a file and pass --key-file");
        }
        if (index + 1 >= args.size()) {
            throw std::runtime_error("the option " + flag + " needs a value");
        }
        const auto& value = args[++index];
        if (flag == "--provider") { command.params.provider = value; }
        else if (flag == "--text") { command.params.text = from_hex(value); }
        else if (flag == "--voice") { command.params.voice = from_hex(value); }
        else if (flag == "--model") { command.params.model = from_hex(value); }
        else if (flag == "--region") { command.params.region = from_hex(value); }
        else if (flag == "--key-file") { command.key_file = from_hex(value); }
        else if (flag == "--cache-dir") { command.cache_dir = from_hex(value); }
        else { throw std::runtime_error("unknown option " + flag); }
    }
    return command;
}

}  // namespace island_chatter::cloud

// Island Chatter — tests for the half of the cloud voice that has no network.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
//
// What is here is everything that decides what gets sent, what a reply means
// and what a file is called. What is not here is WinHTTP, which lives in
// tools/voice_cli.cpp and cannot be exercised without spending money at a
// provider — so the split between the two files is drawn exactly where the
// testable part ends.

#include "island_chatter/cloud.hpp"

#include <algorithm>
#include <iostream>
#include <set>
#include <string>
#include <vector>

namespace {

namespace cloud = island_chatter::cloud;

int failures = 0;

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        failures += 1;
    }
}

void note(const std::string& message) { std::cout << "  " << message << '\n'; }

bool contains(const std::string& haystack, const std::string& needle) {
    return haystack.find(needle) != std::string::npos;
}

std::string header_of(const cloud::Request& request, const std::string& name) {
    for (const auto& header : request.headers) {
        if (header.first == name) { return header.second; }
    }
    return "";
}

cloud::Params sample(const std::string& provider) {
    cloud::Params params;
    params.provider = provider;
    params.text = "你好，歡迎來到小島！";
    params.key = "sk-test-key";
    return params;
}

std::vector<unsigned char> bytes_of(const std::string& text) {
    return std::vector<unsigned char>(text.begin(), text.end());
}

// --- the table --------------------------------------------------------------

void test_table() {
    const auto& rows = cloud::providers();
    require(rows.size() >= 3, "the provider table has the three shipped providers in it");
    std::set<std::string> ids;
    for (const auto& provider : rows) {
        require(ids.insert(provider.id).second,
                std::string("provider ids are unique, ") + provider.id + " is not");
        require(std::string(provider.label).size() > 0,
                std::string(provider.id) + " has a label a person can read");
        require(std::string(provider.default_voice).size() > 0,
                std::string(provider.id) + " has a default voice, so a first press works");
        require(provider.rate >= 8000 && provider.rate <= 48000,
                std::string(provider.id) + " states a plausible sample rate");
        // The whole selection rule for a provider: no decoder needed.
        require(provider.reply == cloud::Reply::Wav ||
                    provider.reply == cloud::Reply::RawPcm16,
                std::string(provider.id) + " returns something that needs no decoder");
    }
    require(cloud::find("openai") != nullptr, "openai is in the table");
    require(cloud::find("nobody") == nullptr, "an unknown id finds nothing rather than row 0");
    note("providers: " + std::to_string(rows.size()));
}

// --- what actually goes over the wire ---------------------------------------

void test_requests() {
    for (const auto& provider : cloud::providers()) {
        auto params = sample(provider.id);
        if (provider.needs_region) { params.region = "eastasia"; }
        const auto request = cloud::build_request(provider, params);

        require(!request.host.empty(), std::string(provider.id) + " builds a host");
        require(request.path.size() > 1 && request.path[0] == '/',
                std::string(provider.id) + " builds an absolute path");
        require(!request.body.empty(), std::string(provider.id) + " builds a body");
        require(!header_of(request, "Content-Type").empty(),
                std::string(provider.id) + " states a content type");

        // The key reaches a header and nothing else. A key in a URL is in every
        // proxy log between here and the provider; a key in a body is in
        // whatever the provider logs.
        require(!contains(request.path, params.key),
                std::string(provider.id) + " keeps the key out of the URL");
        require(!contains(request.body, params.key),
                std::string(provider.id) + " keeps the key out of the body");
        bool keyed = false;
        for (const auto& header : request.headers) {
            if (contains(header.second, params.key)) { keyed = true; }
        }
        require(keyed, std::string(provider.id) + " sends the key in a header");
        note(std::string(provider.id) + " -> " + request.host + request.path);
    }

    // No placeholder may survive into a finished request; one that does is a
    // template naming a value that is no longer supplied, and it would be sent
    // to the provider as the literal text "$MODEL".
    for (const auto& provider : cloud::providers()) {
        auto params = sample(provider.id);
        if (provider.needs_region) { params.region = "eastasia"; }
        const auto request = cloud::build_request(provider, params);
        require(!contains(request.body, "$"),
                std::string(provider.id) + " expanded every placeholder in its body");
        require(!contains(request.path, "$"),
                std::string(provider.id) + " expanded every placeholder in its path");
        for (const auto& header : request.headers) {
            require(!contains(header.second, "$"),
                    std::string(provider.id) + " expanded every placeholder in " +
                        header.first);
        }
    }

    // Azure reads the language out of the voice name rather than asking for it
    // twice. A voice that does not look like one falls back rather than sending
    // half a language tag.
    {
        auto params = sample("azure");
        params.region = "eastasia";
        params.voice = "ja-JP-NanamiNeural";
        const auto request = cloud::build_request(*cloud::find("azure"), params);
        require(contains(request.body, "xml:lang='ja-JP'"),
                "azure takes the language from the voice name");
        params.voice = "custom";
        const auto fallback = cloud::build_request(*cloud::find("azure"), params);
        require(contains(fallback.body, "xml:lang='en-US'"),
                "a voice name with no language in it still produces valid SSML");
    }
}

void test_missing_settings_are_named() {
    // Each of these is something the user can fix, so each has to say which one
    // it is. This is the same rule the lip-sync refusals follow.
    auto params = sample("azure");
    bool refused = false;
    try { cloud::build_request(*cloud::find("azure"), params); }
    catch (const std::exception& error) {
        refused = contains(error.what(), "region");
    }
    require(refused, "azure without a region says the region is what is missing");

    params.region = "eastasia";
    params.key.clear();
    refused = false;
    try { cloud::build_request(*cloud::find("azure"), params); }
    catch (const std::exception& error) { refused = contains(error.what(), "API key"); }
    require(refused, "a missing key says the key is what is missing");

    params.key = "k";
    params.text.clear();
    refused = false;
    try { cloud::build_request(*cloud::find("azure"), params); }
    catch (const std::exception& error) { refused = contains(error.what(), "text"); }
    require(refused, "an empty line says there is nothing to speak");
}

void test_escaping() {
    // A quote in the text would end the JSON string and everything after it
    // would be read as JSON. This is the ordinary case, not an attack: a line of
    // dialogue containing "..." is a line of dialogue.
    auto params = sample("openai");
    params.text = "he said \"no\"\nand left\\";
    const auto request = cloud::build_request(*cloud::find("openai"), params);
    require(contains(request.body, "\\\"no\\\""), "a quote in the line is escaped");
    require(contains(request.body, "\\n"), "a line break in the line is escaped");
    require(contains(request.body, "\\\\"), "a backslash in the line is escaped");
    require(!contains(request.body, "\n"), "no raw newline survives into the JSON body");

    auto ssml = sample("azure");
    ssml.region = "eastasia";
    ssml.text = "5 < 6 & \"quoted\"";
    const auto xml = cloud::build_request(*cloud::find("azure"), ssml);
    require(contains(xml.body, "5 &lt; 6 &amp;"), "a < in the line is escaped for SSML");
    require(!contains(xml.body, "< 6"), "no raw angle bracket survives into the SSML body");

    // ElevenLabs puts the voice id in the path. A space or a slash typed into
    // that field must not become part of the URL structure.
    auto pathed = sample("elevenlabs");
    pathed.voice = "a b/c";
    const auto url = cloud::build_request(*cloud::find("elevenlabs"), pathed);
    require(contains(url.path, "a%20b%2Fc"), "a voice id is URL-escaped into the path");
}

void test_header_injection_is_refused() {
    /*
     * A key pasted with a newline in the middle of it would otherwise end the
     * Authorization header and start a new one of the attacker's choosing. It
     * is far more likely to be a copy-paste accident than an attack, and it
     * fails the same way either way, so it is refused by name.
     */
    auto params = sample("openai");
    params.key = "sk-good\r\nX-Injected: yes";
    bool refused = false;
    try { cloud::build_request(*cloud::find("openai"), params); }
    catch (const std::exception&) { refused = true; }
    require(refused, "a key containing a line break is refused rather than sent");

    auto region = sample("azure");
    region.region = "east asia/../evil.example.com";
    refused = false;
    try { cloud::build_request(*cloud::find("azure"), region); }
    catch (const std::exception&) { refused = true; }
    require(refused, "a region that is not a host name fragment is refused");
}

// --- the key never touches a command line -----------------------------------

void test_key_has_no_command_line_form() {
    /*
     * The mechanism, not the symptom.
     *
     * Task Manager will show a process's full command line to anyone who turns
     * the column on, and it is in the WMI process table for the life of the
     * process. So there is no --key, and asking for one is an error rather than
     * an ignored argument: an ignored argument would let a future edit to the
     * panel put the key back on the command line and see nothing go wrong.
     */
    bool refused = false;
    std::string said;
    try {
        cloud::parse_arguments({"--speak", "--key", "sk-secret"});
    } catch (const std::exception& error) {
        refused = true;
        said = error.what();
    }
    require(refused, "--key is refused");
    require(contains(said, "--key-file"), "and the refusal says what to do instead");

    refused = false;
    try { cloud::parse_arguments({"--api-key", "sk-secret"}); }
    catch (const std::exception&) { refused = true; }
    require(refused, "--api-key is refused too");

    refused = false;
    try { cloud::parse_arguments({"--not-a-flag", "x"}); }
    catch (const std::exception&) { refused = true; }
    require(refused, "an unknown option is refused rather than ignored");

    refused = false;
    try { cloud::parse_arguments({"--provider"}); }
    catch (const std::exception&) { refused = true; }
    require(refused, "an option with no value is refused rather than read past the end");

    const auto parsed = cloud::parse_arguments(
        {"--speak", "--provider", "openai", "--text", cloud::as_hex("hi"),
         "--key-file", cloud::as_hex("C:\\Temp\\k")});
    require(parsed.mode == cloud::Mode::Speak, "--speak selects the speaking mode");
    require(parsed.params.text == "hi", "text arrives as hex and comes back whole");
    require(parsed.key_file == "C:\\Temp\\k", "the key file path arrives as hex");
    require(parsed.params.key.empty(), "parsing an argument list never produces a key");
}

void test_hex_round_trip() {
    // Everything a person could read crosses the process boundary this way, in
    // both directions, so a character outside the console code page has to
    // survive it exactly.
    const std::string original = "找不到 API 金鑰 — 429 配額用完了";
    require(cloud::from_hex(cloud::as_hex(original)) == original,
            "hex survives a full round trip with Chinese and an em dash in it");
    bool refused = false;
    try { cloud::from_hex("abc"); }
    catch (const std::exception&) { refused = true; }
    require(refused, "an odd number of hex digits is refused");
    refused = false;
    try { cloud::from_hex("zz"); }
    catch (const std::exception&) { refused = true; }
    require(refused, "a non-hex digit is refused");
}

// --- SHA-256 and the cache --------------------------------------------------

void test_sha256() {
    // FIPS 180-4's own vectors. A hash written out from memory is worth exactly
    // as much as the vectors it is checked against.
    require(cloud::sha256_hex("") ==
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "sha256 of the empty string");
    require(cloud::sha256_hex("abc") ==
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "sha256 of \"abc\"");
    require(cloud::sha256_hex(
                "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            "sha256 of the 56-byte vector, which is the padding edge case");
    // 64 bytes exactly: the message fills a block and the padding needs a whole
    // second one. This is the case a hand-written implementation gets wrong.
    require(cloud::sha256_hex(std::string(64, 'a')) ==
                "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
            "sha256 of 64 bytes, where padding spills into a second block");
    require(cloud::sha256_hex(std::string(1000000, 'a')) ==
                "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
            "sha256 of a million bytes");
}

void test_cache_key() {
    const auto* openai = cloud::find("openai");
    auto params = sample("openai");
    const auto first = cloud::cache_file_name(*openai, params);
    require(cloud::cache_file_name(*openai, params) == first,
            "the same line and settings always name the same file, which is the saving");

    /*
     * Every field that changes the sound has to change the name.
     *
     * A field left out of the key is not a missed cache hit: it is the old
     * audio played for the new setting, silently, for as long as the file
     * exists. This is the same completeness argument the synthesis cache key
     * makes in invariant 8.
     */
    auto changed = params;
    changed.text += "!";
    require(cloud::cache_file_name(*openai, changed) != first, "text changes the file name");
    changed = params;
    changed.voice = "nova";
    require(cloud::cache_file_name(*openai, changed) != first, "voice changes the file name");
    changed = params;
    changed.model = "tts-1";
    require(cloud::cache_file_name(*openai, changed) != first, "model changes the file name");

    // The key does not, because two people asking for the same sentence should
    // share a file — and because a credential has no business in a file name.
    changed = params;
    changed.key = "sk-somebody-else";
    require(cloud::cache_file_name(*openai, changed) == first,
            "the API key is not part of the cache key");

    // Different providers cannot collide even on identical text, because the id
    // is both hashed and written into the name.
    const auto* eleven = cloud::find("elevenlabs");
    auto same = sample("elevenlabs");
    require(cloud::cache_file_name(*eleven, same) != first,
            "two providers never name the same file");
    require(cloud::cache_file_name(*eleven, same).rfind("elevenlabs-", 0) == 0,
            "the file name says which provider made it");

    /*
     * Field boundaries, counted rather than sampled.
     *
     * Without a separator, a voice of "ab" with model "c" and a voice of "a"
     * with model "bc" hash identically, and the second line then plays the
     * first one's audio with nothing on screen to say why. That pair is the
     * reachable case and it is checked below — but only some of these
     * boundaries can be reached from Params at all: the provider id and the
     * reply format are not free to vary. A test built only from the outside
     * covers two boundaries and reports that it has covered the mechanism,
     * which is how the missing separator after the provider id survived the
     * first version of this. Counting the fields covers every boundary,
     * including the ones a provider added later would bring.
     */
    std::size_t boundaries = 1;
    for (const char letter : cloud::cache_material(*openai, params)) {
        if (letter == '\n') { boundaries += 1; }
    }
    require(boundaries == cloud::kCacheFields,
            "every field in the cache key is separated from the next (" +
                std::to_string(boundaries) + " of " +
                std::to_string(cloud::kCacheFields) + ")");

    auto left = sample("openai");
    left.voice = "ab";
    left.model = "c";
    auto right = sample("openai");
    right.voice = "a";
    right.model = "bc";
    require(cloud::cache_file_name(*openai, left) != cloud::cache_file_name(*openai, right),
            "adjacent fields cannot run together into the same key");

    require(first.size() == std::string("openai-").size() + 32 + std::string(".wav").size(),
            "the file name is the id, 128 bits of hash, and .wav");
    note("cache name: " + first);
}

// --- what came back ---------------------------------------------------------

void test_reply_handling() {
    const auto* eleven = cloud::find("elevenlabs");
    // Raw PCM is wrapped rather than decoded: a header is prepended and the
    // samples are already what a WAV holds.
    std::vector<unsigned char> pcm(4800, 0);
    const auto wrapped = cloud::wav_from_reply(*eleven, pcm);
    require(wrapped.size() == pcm.size() + 44, "raw PCM gains exactly a WAV header");
    require(std::equal(wrapped.begin(), wrapped.begin() + 4, "RIFF"),
            "the wrapped file is a RIFF");
    require(std::equal(wrapped.begin() + 8, wrapped.begin() + 12, "WAVE"),
            "the wrapped file is a WAVE");
    const std::uint32_t rate = static_cast<std::uint32_t>(wrapped[24]) |
                               (static_cast<std::uint32_t>(wrapped[25]) << 8) |
                               (static_cast<std::uint32_t>(wrapped[26]) << 16) |
                               (static_cast<std::uint32_t>(wrapped[27]) << 24);
    require(rate == eleven->rate,
            "the header states the rate the requested format actually comes back at");

    /*
     * A provider that ignored the format we asked for.
     *
     * It answers 200 and hands back an mp3, and writing that into a .wav
     * produces a file After Effects imports as silence — which looks exactly
     * like the feature not working. Naming what arrived is the difference
     * between a five-minute fix and an afternoon.
     */
    const auto* openai = cloud::find("openai");
    bool named = false;
    std::string said;
    try {
        cloud::wav_from_reply(*openai, bytes_of("ID3\x03\x00\x00\x00 fake mp3 payload"));
    } catch (const std::exception& error) { named = true; said = error.what(); }
    require(named && contains(said, "mp3"), "an mp3 in a WAV's clothing is named as an mp3");

    named = false;
    try { cloud::wav_from_reply(*openai, bytes_of("{\"error\":{\"message\":\"nope\"}}")); }
    catch (const std::exception& error) { named = true; said = error.what(); }
    require(named && contains(said, "JSON"),
            "a JSON body returned with a 200 is named as a message, not as audio");

    named = false;
    try { cloud::wav_from_reply(*openai, {}); }
    catch (const std::exception& error) { named = true; said = error.what(); }
    require(named && contains(said, "no audio"), "an empty 200 is named");

    // A WAV that is a WAV goes through untouched, byte for byte.
    std::vector<unsigned char> real(44, 0);
    const char* riff = "RIFF";
    const char* wave = "WAVE";
    std::copy(riff, riff + 4, real.begin());
    std::copy(wave, wave + 4, real.begin() + 8);
    require(cloud::wav_from_reply(*openai, real) == real, "a real WAV is passed through as-is");
}

// --- saying what the provider said ------------------------------------------

void test_errors_are_the_providers_own_words() {
    /*
     * Invariant 8k, applied before it can happen again.
     *
     * A wrong key, a rate limit, an exhausted quota and an unreachable host are
     * four different things to do next. Folding them into "the cloud voice
     * failed" is what cost this project time once already, so each of these
     * bodies is shaped like the one its provider actually sends and each has to
     * come back out carrying what it said.
     */
    struct Case {
        int status;
        const char* body;
        const char* must_contain;
        const char* what;
    };
    const Case cases[] = {
        {401,
         "{\"error\":{\"message\":\"Incorrect API key provided: sk-abc.\","
         "\"type\":\"invalid_request_error\"}}",
         "Incorrect API key provided",
         "OpenAI's wrong-key body"},
        {429,
         "{\"error\":{\"message\":\"Rate limit reached for gpt-4o-mini-tts\","
         "\"type\":\"rate_limit_error\"}}",
         "Rate limit reached",
         "OpenAI's rate limit"},
        {401,
         "{\"detail\":{\"status\":\"invalid_api_key\","
         "\"message\":\"Invalid API key provided\"}}",
         "Invalid API key",
         "ElevenLabs' wrong-key body"},
        {401,
         "{\"detail\":\"Unauthenticated\"}",
         "Unauthenticated",
         "ElevenLabs' bare string detail"},
        {429,
         "{\"detail\":{\"status\":\"quota_exceeded\",\"message\":"
         "\"This request exceeds your quota of 10000 credits.\"}}",
         "exceeds your quota",
         "ElevenLabs' quota body"},
        {401,
         "Access denied due to invalid subscription key or wrong API endpoint.",
         "invalid subscription key",
         "Azure's plain-text body"},
    };
    for (const auto& example : cases) {
        const auto message = cloud::message_from_error(example.status, example.body);
        require(contains(message, example.must_contain),
                std::string(example.what) + " reaches the user intact");
        require(contains(message, std::to_string(example.status)),
                std::string(example.what) + " carries its status");
        note(std::string(example.what) + ": " + message.substr(0, 80));
    }

    // Four statuses, four different sentences. A test that only checked one
    // would pass against an implementation that returned the same words always.
    std::set<std::string> distinct;
    for (const int status : {401, 402, 429, 500}) {
        distinct.insert(cloud::meaning_of_status(status));
    }
    require(distinct.size() == 4, "four different failures produce four different sentences");

    // A provider that sends nothing usable still has to say something better
    // than the number.
    const auto empty = cloud::message_from_error(503, "");
    require(contains(empty, "503") && contains(empty, "server error"),
            "an empty body falls back to what the status means");
    const auto html = cloud::message_from_error(502, "<html><body>Bad Gateway</body></html>");
    require(!contains(html, "<html>"), "a page of HTML is not pasted into a dialog");
}

/*
 * The failures that never reach a status code.
 *
 * A request refused by DNS, by a firewall, by a timeout or by TLS never gets an
 * HTTP answer at all, and those four need four different things done about
 * them. They cannot be provoked for real: making a live request fail on demand
 * needs either a paid account or an --endpoint override, and an endpoint
 * override is exactly the hole that disabling redirects exists to close — a
 * flag that points the tool at an arbitrary host is a flag that hands it the
 * API key. So the socket stays untested on purpose, and the *decision* it feeds
 * is tested instead.
 */
void test_network_failures_are_distinguished() {
    const unsigned long codes[] = {12002UL, 12007UL, 12029UL, 12175UL};
    std::set<std::string> distinct;
    for (const auto code : codes) {
        const auto said = cloud::meaning_of_network_error(code);
        require(!said.empty(), "every network failure says something");
        distinct.insert(said);
        note(std::to_string(code) + ": " + said);
    }
    require(distinct.size() == 4,
            "a timeout, a name that will not resolve, a refused connection and a TLS "
            "failure are four different sentences");
    // 12030 is the same problem as 12029 from the user's side, so it shares the
    // sentence rather than inventing a fifth thing to try.
    require(cloud::meaning_of_network_error(12030UL) ==
                cloud::meaning_of_network_error(12029UL),
            "a dropped connection reads the same as one that was never made");
    require(!cloud::meaning_of_network_error(999UL).empty(),
            "an unrecognised code still produces a sentence rather than nothing");
}

/*
 * Bodies that are the right length and the wrong thing.
 *
 * These are the shapes a fake server would have been stood up to produce: a
 * half-written file, an HTML error page delivered with a 200, an odd number of
 * PCM bytes. Every one of them becomes a .wav on disk unless something refuses
 * it, and a .wav that After Effects imports as silence looks exactly like the
 * feature not working rather than like the wrong format arriving.
 */
void test_broken_replies_are_refused_by_name() {
    const auto* openai = cloud::find("openai");
    const auto* eleven = cloud::find("elevenlabs");

    struct Case {
        const cloud::Provider* provider;
        std::string body;
        const char* must_contain;
        const char* what;
    };
    /*
     * A RIFF/WAVE header and nothing after it: the write died part way through.
     *
     * Built a byte at a time on purpose. Written as `half_wav += "\x24\x00\x00\x00"`
     * the literal stops at the first NUL, so "WAVE" lands at offset 5 instead of
     * 8 and the case silently becomes "some bytes that are not a WAV" — which
     * still fails, just for the wrong reason and against the wrong message.
     */
    std::string half_wav = "RIFF";
    half_wav.append(std::string("\x24\x00\x00\x00", 4));
    half_wav += "WAVE";
    const Case cases[] = {
        {openai, half_wav, "too short", "a WAV cut off after its header"},
        {openai, "<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", "XML or HTML",
         "an HTML error page delivered with a 200"},
        {openai, std::string("RIF"), "instead of a WAV", "three bytes"},
        {openai, std::string("OggS") + std::string(60, ' '), "Ogg",
         "an Ogg file where a WAV was asked for"},
        {eleven, std::string(1, '\x01'), "too few bytes", "a single byte of PCM"},
    };
    for (const auto& example : cases) {
        bool refused = false;
        std::string said;
        try {
            cloud::wav_from_reply(*example.provider, bytes_of(example.body));
        } catch (const std::exception& error) {
            refused = true;
            said = error.what();
        }
        require(refused && contains(said, example.must_contain),
                std::string(example.what) + " is refused by name: " + said);
    }

    // An odd byte count cannot be whole 16-bit samples. The half sample at the
    // end is dropped rather than read past the end of the buffer.
    std::vector<unsigned char> odd(4801, 0);
    const auto wrapped = cloud::wav_from_reply(*eleven, odd);
    require(wrapped.size() == 44u + 4800u,
            "an odd number of PCM bytes drops the half sample rather than overrunning");
}

/*
 * A source that runs on this machine is not a special case in the code, and
 * that is the point.
 *
 * 3.0.0 puts an offline model here. The expensive part of adding one is not the
 * model: it is a panel that has assumed everywhere that a voice source needs an
 * API key, needs a network and needs to warn that the text is leaving the
 * computer. The table carries the flag now, every shipped row says false, and
 * the panel asks rather than assumes — validate-script.js pins that end.
 */
void test_local_sources_are_representable() {
    for (const auto& provider : cloud::providers()) {
        require(!provider.on_this_machine,
                std::string(provider.id) + " is a remote service, and says so");
    }
    // The flag is real rather than decorative: a row can be built with it set,
    // and nothing in the table's shape prevents one.
    cloud::Provider local = *cloud::find("openai");
    local.id = "local-test";
    local.on_this_machine = true;
    require(local.on_this_machine && !cloud::find("local-test"),
            "a local row is expressible today without one being shipped");
}

/*
 * The tuning of a model that runs here, and the two things about it that would
 * be wrong silently.
 *
 * The first is the cache. Every one of these four numbers changes the sound, so
 * a tuning that did not reach the cache key would hand back the previous
 * setting's audio for as long as the file existed — the line would simply not
 * change when the dialog was closed, and nothing on screen would say why. It
 * reaches the key by being the `voice`, which is already field three.
 *
 * The second is the other direction: the defaults must round-trip to an *empty*
 * voice, or every offline line rendered before 3.4.0 gets a new file name and
 * is rendered again from scratch on the next press.
 */
void test_local_tuning() {
    const cloud::Tuning untouched;
    require(cloud::tuning_text(untouched).empty(),
            "an untuned voice spells as nothing, so it keeps the cache file it already had");
    require(cloud::tuning_from_text("").speaker == -1 &&
                cloud::tuning_from_text("default").variation == untouched.variation,
            "an empty voice and the table's \"default\" are both the model's own settings");

    cloud::Tuning tuned;
    tuned.speaker = 2;
    tuned.variation = 0.4;
    tuned.timbre = 1.25;
    tuned.speed = 1.5;
    const auto spelled = cloud::tuning_text(tuned);
    require(spelled == "speaker=2;variation=0.400;timbre=1.250;speed=1.500",
            "the canonical spelling is all four fields, three decimals, in one order: " + spelled);
    const auto back = cloud::tuning_from_text(spelled);
    require(back.speaker == 2 && back.variation == 0.4 && back.timbre == 1.25 &&
                back.speed == 1.5,
            "the canonical spelling reads back as the numbers that made it");
    // Two spellings of one voice are one cache entry, not two files of
    // identical audio. This is what the tool canonicalising params.voice buys.
    require(cloud::tuning_text(cloud::tuning_from_text("speaker=2;variation=0.4;timbre=1.25;"
                                                       "speed=1.5")) == spelled,
            "a hand-written tuning canonicalises to the same text");

    /*
     * Each field separately, and each one carried through `tuning_text()`
     * rather than hand-spelled.
     *
     * Hand-spelling the four strings would have tested that `cache_file_name()`
     * reads `voice`, which it plainly does and which nothing here is about. Put
     * through the spelling, a field *dropped* from the canonical text collapses
     * into the untuned string, two of these names become one, and the count
     * fails — which is the mechanism: the tuning reaches the cache key by being
     * spelled into the voice, so a field the spelling forgets is a field the
     * cache forgets.
     *
     * The provider row is a local one, built the way local_cli.cpp builds it.
     */
    cloud::Provider local = *cloud::find("openai");
    local.id = "local-melo";
    local.on_this_machine = true;
    local.default_voice = "default";
    auto params = sample("local-melo");
    params.voice = cloud::tuning_text(untouched);
    std::vector<cloud::Tuning> each(4);
    each[0].speaker = 0;          // not -1, which is "leave the model's own"
    each[1].variation = 0.5;
    each[2].timbre = 0.5;
    each[3].speed = 1.2;
    std::set<std::string> names{cloud::cache_file_name(local, params)};
    for (const auto& one : each) {
        auto changed = params;
        changed.voice = cloud::tuning_text(one);
        names.insert(cloud::cache_file_name(local, changed));
    }
    require(names.size() == 1u + each.size(),
            "every field of the tuning changes the cache file name, or the old audio comes "
            "back under the new setting (" + std::to_string(names.size()) + " names)");

    // And what cannot be read is refused by name rather than guessed past. A
    // setting silently dropped is a voice the user did not ask for, reported as
    // success.
    const char* const refusals[] = {
        "speaker=1.5",              // not a whole number
        "speaker=256",              // outside the range
        "variation=3",              // outside 0..2
        "speed=0",                  // outside 0.25..4
        "speed=nan",                // strtod reads it; the range must not
        "speed=1.0x",               // trailing junk
        "wobble=1",                 // a name this tool does not know
        "speaker",                  // not name=value
    };
    for (const char* const bad : refusals) {
        bool refused = false;
        std::string said;
        try { cloud::tuning_from_text(bad); }
        catch (const std::exception& error) { refused = true; said = error.what(); }
        require(refused, std::string("\"") + bad + "\" is refused rather than guessed past");
        require(contains(said, "speaker") || contains(said, "variation") ||
                    contains(said, "timbre") || contains(said, "speed") ||
                    contains(said, "wobble"),
                std::string("the refusal of \"") + bad + "\" says which setting: " + said);
    }
}

}  // namespace

int main() {
    test_table();
    test_requests();
    test_missing_settings_are_named();
    test_escaping();
    test_header_injection_is_refused();
    test_key_has_no_command_line_form();
    test_hex_round_trip();
    test_sha256();
    test_cache_key();
    test_reply_handling();
    test_errors_are_the_providers_own_words();
    test_network_failures_are_distinguished();
    test_broken_replies_are_refused_by_name();
    test_local_sources_are_representable();
    test_local_tuning();

    if (failures) {
        std::cerr << failures << " cloud test(s) failed\n";
        return 1;
    }
    std::cout << "cloud tests passed\n";
    return 0;
}

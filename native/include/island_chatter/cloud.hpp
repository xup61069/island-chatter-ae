// Island Chatter — a voice that comes back from somebody else's model.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace island_chatter::cloud {

/*
 * What this is and, more importantly, what it is not.
 *
 * It is not a synthesizer and it is not an effect. Nothing here runs on an
 * audio thread, nothing here is deterministic, and nothing here is allowed
 * anywhere near `PF_Cmd_AUDIO_RENDER`. A network round trip is tens to
 * thousands of milliseconds with no upper bound anyone controls, and an audio
 * callback that waits on one is a hung After Effects. Invariant 8 says the
 * engine is deterministic; this is the reason that invariant is not weakened to
 * accommodate a cloud voice.
 *
 * So it is a *file producer*, on the same footing as `island_chatter_bake`:
 * press a button, get a WAV, import it. From the WAV onwards it is 2.3.0's
 * problem — the analyser reads it and prints the same plan the engine prints,
 * so the mouth moves without anything downstream knowing where the sound came
 * from.
 *
 * The transport lives in tools/voice_cli.cpp because it is WinHTTP and cannot
 * be tested without a network. Everything that decides *what* to send, *how* to
 * name it and *what a failure means* lives here, where a test can reach it.
 */

// How the provider hands the audio back. Only formats that need no decoder are
// offered: a WAV or raw little-endian 16-bit PCM. Shipping an mp3 decoder to
// save a few hundred kilobytes of transfer would be the largest and riskiest
// piece of code in the product, for a file that is deleted after import.
enum class Reply { Wav, RawPcm16 };

// Which escaping the body template needs. A template is entirely one or the
// other, so this belongs to the provider rather than to each placeholder.
enum class Escape { Json, Xml };

/*
 * One row per provider, and adding a provider is meant to be adding a row.
 *
 * Everything that differs between vendors is a string here: the host, the path,
 * the headers including whatever they call their key, the request body and the
 * shape of the reply. Nothing in the transport branches on which provider it is
 * holding. That is the whole point of the table — the first version of this had
 * an `if (provider == "openai")` in four places and the fourth one was already
 * wrong.
 *
 * The templates carry $NAME placeholders, expanded by expand_*() below. Each
 * expansion escapes for the place it lands in, which is why there are three
 * separate functions rather than one: a voice id goes into a URL path in one
 * provider and into a JSON string in another, and the two need different
 * treatment of the same character.
 */
struct Provider {
    const char* id;             // ASCII, stable, what gets stored in a project
    const char* label;          // what a person reads
    const char* host;           // template: $REGION
    const char* path;           // template: $VOICE, $MODEL
    const char* headers;        // newline-separated "Name: value" templates
    const char* body;           // template: $TEXT, $VOICE, $MODEL, $LANG
    Escape body_escape;
    Reply reply;
    // The rate the requested format comes back at. It is fixed per row because
    // it is part of the URL or the header that asks for the format: change one
    // and you must change the other, so they live together.
    std::uint32_t rate;
    const char* default_model;
    const char* default_voice;
    // Azure's endpoint is per-region, so the panel has to ask for one. Nobody
    // else does, and a required field nobody needs is a field everybody fills
    // in wrongly once.
    bool needs_region;
    /*
     * Does this source run on the user's own machine?
     *
     * False for all three today, and the field is here anyway, because the
     * agreed road puts an offline model in 3.0.0 and the expensive part of
     * adding one later is not the model — it is a panel that has assumed
     * everywhere that a voice source needs an API key, needs a network, and
     * needs to warn that the text is leaving the computer. None of those is
     * true of a local model, and each is a separate place to remember.
     *
     * So the panel asks the table rather than assuming: no key button, no
     * region, and a confirmation that does not claim the text goes anywhere.
     * Adding the row in 3.0.0 is then a row.
     */
    bool on_this_machine;
};

const std::vector<Provider>& providers();

// Null for an id that is not in the table, so the caller can say which one was
// asked for rather than reporting a generic failure.
const Provider* find(const std::string& id);

struct Params {
    std::string provider;
    std::string text;
    std::string voice;
    std::string model;
    std::string region;
    /*
     * Read from a file, never from argv.
     *
     * A command line is readable by every process on the machine — Task
     * Manager's command-line column shows it to anyone who turns the column on,
     * and it is in the WMI process table for as long as the process lives. A
     * TTS key is a billing credential. So the panel writes the key to a file in
     * the temp directory, passes the path, and this reads it and deletes the
     * file before the socket is opened.
     */
    std::string key;
};

enum class Mode {
    // Print the table, so the panel builds its menu from the one copy of it
    // that exists. A provider list in the panel as well would be a second copy
    // to keep in step, which is the mistake invariant 8b is about.
    Providers,
    // Print where the cache file for these parameters would be, and do nothing
    // else. This is what lets the whole flow be tested without spending money:
    // put a file at that path and the next Speak is a cache hit.
    CachePath,
    Speak
};

struct Command {
    Mode mode = Mode::Speak;
    Params params;
    std::string cache_dir;
    std::string key_file;
};

/*
 * Throws on anything it does not recognise, and specifically on --key.
 *
 * Refusing the flag rather than not implementing it is deliberate: "unknown
 * option" is what a future edit to the panel would get if somebody put the key
 * back on the command line, and a test can assert the refusal. Not implementing
 * it would let the same edit pass silently as an ignored argument.
 */
Command parse_arguments(const std::vector<std::string>& args);

struct Request {
    std::string host;
    std::string path;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
};

Request build_request(const Provider& provider, const Params& params);

// The three expansions, exposed because they are where the escaping bugs live
// and a test that can only see a finished request cannot tell which one broke.
std::string json_escape(const std::string& value);
std::string xml_escape(const std::string& value);
std::string url_escape(const std::string& value);

/*
 * A cache key over everything that changes the sound, and nothing else.
 *
 * This is the part that saves money: the same line, unchanged, must not be paid
 * for twice. Text, provider, model, voice, region and format all go in. The API
 * key does not — two people with different keys asking for the same sentence
 * should share a file, and a secret has no business in a file name.
 *
 * SHA-256 rather than a short hash, because a collision here is not a lost
 * cache entry: it is the wrong line's audio played under this line's subtitle,
 * silently, with no way for anyone to see why. 32 hex characters of it reach
 * the file name, which is 128 bits.
 */
std::string sha256_hex(const std::string& bytes);

/*
 * What gets hashed, exposed so the separators can be checked directly.
 *
 * A missing separator between two fields is the failure that matters here, and
 * it cannot be found from the outside: only some pairs of fields can be made to
 * collide through Params — the provider id and the format are not free to vary
 * — so a test written against cache_key() alone would cover two boundaries and
 * report that it had covered the mechanism. Counting the fields covers all of
 * them, including the ones a future provider adds.
 */
std::string cache_material(const Provider& provider, const Params& params);
constexpr std::size_t kCacheFields = 7;

std::string cache_key(const Provider& provider, const Params& params);
std::string cache_file_name(const Provider& provider, const Params& params);

/*
 * The bytes to write, from the bytes that arrived.
 *
 * Raw PCM is wrapped in a WAV header at the provider's rate. A WAV is checked
 * rather than trusted: a provider that ignores the format we asked for hands
 * back an mp3 with a 200 status, and writing that to a .wav produces a file
 * After Effects imports as silence. Anything that is not a WAV is named — "this
 * is an mp3" — because "the file did not work" is useless to whoever has to fix
 * it.
 */
std::vector<unsigned char> wav_from_reply(const Provider& provider,
                                          const std::vector<unsigned char>& body);

/*
 * Say what the provider said.
 *
 * Invariant 8k is about this exact failure: a real error wrapped in one
 * generic sentence costs hours, because the sentence names the wrong problem.
 * A wrong key, a rate limit, an exhausted quota and an unreachable network are
 * four different things to do next, and the provider already distinguishes
 * them. So the message that comes back out of here is the provider's own, with
 * the status in front of it, and only when there is nothing usable in the body
 * does it fall back to describing the status.
 */
std::string message_from_error(int status, const std::string& body);

// The plain-language part of that: what an HTTP status means for a TTS call,
// for the case where the provider sent no body worth reading.
std::string meaning_of_status(int status);

/*
 * And the same for a request that never got an answer at all.
 *
 * This lives here rather than beside the WinHTTP call for one reason: it is the
 * only part of a network failure that can be tested. The socket cannot — there
 * is no way to make a real request fail on demand without either a paid account
 * or an --endpoint override, and an endpoint override is precisely the hole
 * that disabling redirects exists to close, so the tool will not have one.
 *
 * What is left is the decision: does a name that will not resolve say something
 * different from a connection that is refused, from a timeout, from a TLS
 * failure? Four different things to do next, so four different sentences, and
 * cloud_tests.cpp pins that they stay four. The caller appends whatever
 * Windows itself said.
 *
 * Codes are WinHTTP's, given as numbers because this file does not include
 * windows.h: 12002 ERROR_WINHTTP_TIMEOUT, 12007 NAME_NOT_RESOLVED,
 * 12029 CANNOT_CONNECT, 12030 CONNECTION_ERROR, 12175 SECURE_FAILURE.
 */
std::string meaning_of_network_error(unsigned long code);

/*
 * An upper bound on what will be read back.
 *
 * A minute of 24 kHz 16-bit mono is under 3 MB, and a line of dialogue is a few
 * seconds, so 64 MB is far more than any legitimate reply. The bound is not
 * about legitimate replies: without one, an endpoint that streams without end —
 * broken, hostile, or simply the wrong URL — is read until the machine runs out
 * of memory, and the read loop has no other reason to stop.
 */
constexpr std::size_t kMaxReplyBytes = 64u * 1024u * 1024u;

// UTF-8 bytes as lower-case hex and back. Everything a person could read
// crosses the process boundary this way, for the reason bake_cli.cpp gives:
// stdout and the command line both go through the console code page, which
// turns anything outside it into '?'.
std::string as_hex(const std::string& bytes);
std::string from_hex(const std::string& hex);

}  // namespace island_chatter::cloud

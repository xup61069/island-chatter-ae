#include "island_chatter/dsp.hpp"
#include "generated/mandarin_readings.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace island_chatter {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kTwoPi = kPi * 2.0;

// Speed bounds. The panel's estimateSpeech() clamps to the same pair so its
// markers, rig and Fit Duration keep matching the rendered audio at the far
// ends of the range.
constexpr double kMinimumSpeed = 0.10;
constexpr double kMaximumSpeed = 12.0;

// The utterance is always synthesized at this Volume so that the cached audio
// is independent of the Volume control. It matches the parameter's default, so
// a project left at 78% renders exactly as it did before Volume became a gain.
constexpr double kReferenceVolume = 0.78;

// One Mandarin syllable slot: 0.188 s of voice plus the 0.012 s gap after it,
// before Speed is applied. Tempo lock quantises rests to this grid, and the
// panel derives Speed from a tempo with speed = BPM * syllables_per_beat / 300,
// which is 60 / (kSyllableStride * 300 / ...) expressed for whole beats.
constexpr double kSyllableStride = 0.200;

// Output level below which the Volume gain is applied untouched, and the
// ceiling the limiter approaches above it. Stopping short of full scale leaves
// headroom for the host's own resampling.
// Upper bound on the additive source. A low voice needs far more than the
// twelve this used to be to reach its third formant; see harmonic_count().
constexpr std::size_t kMaxHarmonics = 32;

constexpr double kSoftKnee = 0.80;
constexpr double kOutputCeiling = 0.98;

struct Vowel {
    char name;
    std::array<double, 3> formants;
    std::array<double, 3> bandwidths;
};

constexpr std::array<Vowel, 8> kVowels{{
    {'a', {800.0, 1150.0, 2900.0}, {100.0, 120.0, 180.0}},
    {'e', {500.0, 1900.0, 2600.0}, {85.0, 140.0, 180.0}},
    {'i', {300.0, 2300.0, 3000.0}, {70.0, 150.0, 200.0}},
    {'o', {500.0, 900.0, 2500.0}, {90.0, 110.0, 180.0}},
    {'u', {350.0, 800.0, 2200.0}, {75.0, 100.0, 170.0}},
    // Apical vowel used after z/c/s and zh/ch/sh/r.
    {'x', {420.0, 1250.0, 2350.0}, {90.0, 150.0, 190.0}},
    // Mandarin front rounded vowel, written v internally (pinyin ü).
    {'v', {300.0, 1750.0, 2350.0}, {75.0, 135.0, 180.0}},
    {'r', {480.0, 1350.0, 1750.0}, {95.0, 145.0, 170.0}},
}};

const std::vector<Voice> kVoices{
    {"Sunny", 1.00, 1.00, 0.035, 0.014, 0.00},
    {"Tiny", 1.42, 1.15, 0.025, 0.020, 0.00},
    {"Cozy", 0.72, 0.86, 0.045, 0.010, 0.00},
    {"Buzzy", 0.90, 1.04, 0.018, 0.007, 0.22},
    {"Chirpy", 1.20, 1.08, 0.026, 0.027, 0.02},
    {"Whisper", 0.96, 1.00, 0.105, 0.009, 0.00},
    {"Elder", 0.66, 0.82, 0.052, 0.024, 0.08},
    {"Droid", 0.88, 1.02, 0.012, 0.004, 0.38},
};

struct Consonant {
    ConsonantKind kind = ConsonantKind::none;
    double place = 0.5;
    bool aspirated = false;
    bool retroflex = false;
};

struct Event {
    std::size_t start = 0;
    std::size_t length = 0;
    std::size_t onset = 0;
    double frequency = 245.0;
    Consonant consonant;
    char vowel_name = 'a';
    std::array<double, 3> formants{};
    std::array<double, 3> end_formants{};
    std::array<double, kMaxHarmonics> harmonics{};
    std::array<double, kMaxHarmonics> end_harmonics{};
    // How many entries of the two arrays above are in use. Both profiles are
    // built at the same frequency, so one count covers them.
    std::size_t harmonic_count = 1;
    std::uint8_t tone = 5;
    std::uint8_t lexical_tone = 5;
    std::uint32_t source_codepoint = 0;
    std::vector<std::uint32_t> source_units;
    std::string reading;
    bool nasal_final = false;
    bool velar_nasal = false;
    bool mandarin = false;
    bool question_rise = false;
    bool emphatic = false;
    double phase = 0.0;
    std::uint32_t seed = 1;
    double noise_low = 0.0;
    double noise_input = 0.0;
    double noise_high = 0.0;

    // --- Singing -----------------------------------------------------------
    //
    // Every field below is inert unless the melody drove this event, and
    // `sustained` is the switch: false takes exactly the code paths the
    // speaking engine always took.
    bool sustained = false;
    // Where this segment sits inside its note, and how long the whole note is,
    // both in samples. A note longer than kSegmentSeconds is split into several
    // events so the lazy block renderer never has to produce seconds of audio
    // to serve one block; everything that has to stay continuous across the
    // seam — the phase, the vibrato, the vowel's own envelope — is computed
    // from note-global time rather than from the offset within the segment.
    std::size_t time_offset = 0;
    std::size_t note_length = 0;
    // describe() folds this event into the syllable before it. True for the
    // later segments of one note, and for a note a melisma held over from the
    // previous syllable: both are one thing the user sang, and a marker, a
    // mouth shape and a Type-On step are owed one each.
    bool continues_previous = false;
    // A seam inside one note: no attack, no release, no consonant. A melisma
    // sets neither, because a new pitch on a new note is articulated.
    bool seamless_start = false;
    bool seamless_end = false;
    // Where the pitch glides in from, and over how long. Copied in at plan time
    // from the previous note's frequency — a scalar, not a look at what the
    // neighbour rendered — so syllables stay independent and the lazy renderer
    // still matches a single eager pass (invariant 8d).
    double glide_from = 0.0;
    double glide_seconds = 0.0;
    // How hard the note was struck, as a gain. One is the reference level every
    // spoken syllable renders at, so a melody carrying no velocity — and every
    // line the speaking engine produces — is unaffected.
    double level = 1.0;
};

// MIDI velocity as a gain.
//
// Zero means the file said nothing, so nothing changes. Otherwise the range
// stops well short of silence: a pianissimo note in a cartoon voice still has
// to be heard, and the curve reaching exactly one at 127 means a file whose
// velocities are all full sounds precisely as it did before dynamics existed.
double velocity_level(int velocity) {
    if (velocity <= 0) {
        return 1.0;
    }
    const double scaled = std::min(127, velocity) / 127.0;
    return 0.45 + 0.55 * std::pow(scaled, 1.2);
}

// How long one segment of a held note is allowed to be.
//
// The lazy renderer's unit of work is one event. A four-second note left whole
// would be rendered in full the moment any block touched any part of it —
// roughly 190,000 samples of up to thirty-two summed harmonics on the audio
// thread, which is the 60-135 ms stall Utterance exists to remove. A quarter of
// a second is the same order as the longest syllable the speaking engine has
// ever produced, so the worst case per block goes back to a cost that is
// already known to be survivable.
constexpr double kSegmentSeconds = 0.25;

// A trailing segment shorter than this is merged into the one before it rather
// than left as a runt, because several places downstream assume an event is
// long enough to hold an onset and a release.
constexpr double kShortestSegmentSeconds = 0.05;

class Random {
public:
    explicit Random(std::uint32_t seed) : state_(seed % 2147483647U) {
        if (state_ == 0) {
            state_ = 1;
        }
    }

    double next() {
        const std::uint64_t product = static_cast<std::uint64_t>(state_) * 16807ULL;
        state_ = static_cast<std::uint32_t>(product % 2147483647ULL);
        return static_cast<double>(state_ - 1U) / 2147483646.0;
    }

private:
    std::uint32_t state_;
};

template <typename T>
T clamp(T value, T minimum, T maximum) {
    return std::max(minimum, std::min(maximum, value));
}

std::vector<std::uint32_t> decode_utf8(const std::string& text) {
    std::vector<std::uint32_t> codepoints;
    std::size_t index = 0;
    while (index < text.size()) {
        const auto first = static_cast<unsigned char>(text[index]);
        std::uint32_t codepoint = 0xFFFDU;
        std::size_t count = 1;
        if (first < 0x80U) {
            codepoint = first;
        } else if ((first & 0xE0U) == 0xC0U && index + 1 < text.size()) {
            codepoint = first & 0x1FU;
            count = 2;
        } else if ((first & 0xF0U) == 0xE0U && index + 2 < text.size()) {
            codepoint = first & 0x0FU;
            count = 3;
        } else if ((first & 0xF8U) == 0xF0U && index + 3 < text.size()) {
            codepoint = first & 0x07U;
            count = 4;
        }
        bool valid = count > 1;
        for (std::size_t offset = 1; offset < count; ++offset) {
            const auto next = static_cast<unsigned char>(text[index + offset]);
            if ((next & 0xC0U) != 0x80U) {
                valid = false;
                count = 1;
                codepoint = 0xFFFDU;
                break;
            }
            codepoint = (codepoint << 6U) | (next & 0x3FU);
        }
        if (first < 0x80U || valid) {
            codepoints.push_back(codepoint);
        } else {
            codepoints.push_back(0xFFFDU);
        }
        index += count;
    }
    return codepoints;
}

// The inverse, for handing a run of characters back to the planner.
void append_utf8(std::string& text, std::uint32_t codepoint) {
    if (codepoint < 0x80U) {
        text.push_back(static_cast<char>(codepoint));
    } else if (codepoint < 0x800U) {
        text.push_back(static_cast<char>(0xC0U | (codepoint >> 6U)));
        text.push_back(static_cast<char>(0x80U | (codepoint & 0x3FU)));
    } else if (codepoint < 0x10000U) {
        text.push_back(static_cast<char>(0xE0U | (codepoint >> 12U)));
        text.push_back(static_cast<char>(0x80U | ((codepoint >> 6U) & 0x3FU)));
        text.push_back(static_cast<char>(0x80U | (codepoint & 0x3FU)));
    } else {
        text.push_back(static_cast<char>(0xF0U | (codepoint >> 18U)));
        text.push_back(static_cast<char>(0x80U | ((codepoint >> 12U) & 0x3FU)));
        text.push_back(static_cast<char>(0x80U | ((codepoint >> 6U) & 0x3FU)));
        text.push_back(static_cast<char>(0x80U | (codepoint & 0x3FU)));
    }
}

bool is_space(std::uint32_t codepoint) {
    return codepoint == 0x20U || codepoint == 0x09U || codepoint == 0x0AU ||
        codepoint == 0x0DU || codepoint == 0x3000U;
}

bool is_punctuation(std::uint32_t codepoint) {
    // U+3007 IDEOGRAPHIC NUMBER ZERO sits inside the CJK punctuation block but
    // is a spoken character in dates and numbers such as 二〇二六.
    if (codepoint == 0x3007U) {
        return false;
    }
    if (codepoint >= 0x3000U && codepoint <= 0x303FU) {
        return true;
    }
    switch (codepoint) {
        case '.': case ',': case '!': case '?': case ';': case ':': case '-':
        // punctuation_pause() has always scored these two; without them here
        // an ellipsis or em dash produced a chatter syllable instead of a rest.
        case 0x2014U: case 0x2026U:
        case 0xFF01U: case 0xFF0CU: case 0xFF0EU: case 0xFF1AU: case 0xFF1BU: case 0xFF1FU:
            return true;
        default:
            return false;
    }
}

char ascii_lower(std::uint32_t codepoint) {
    if (codepoint >= 'A' && codepoint <= 'Z') {
        return static_cast<char>(codepoint + ('a' - 'A'));
    }
    if (codepoint >= 'a' && codepoint <= 'z') {
        return static_cast<char>(codepoint);
    }
    return '\0';
}

int latin_vowel(std::uint32_t codepoint) {
    switch (ascii_lower(codepoint)) {
        case 'a': return 0;
        case 'e': return 1;
        case 'i': case 'y': return 2;
        case 'o': return 3;
        case 'u': return 4;
        default: return -1;
    }
}

Consonant consonant_for(std::uint32_t codepoint) {
    const char lower = ascii_lower(codepoint);
    switch (lower) {
        case 'p': return {ConsonantKind::stop, 0.18};
        case 't': case 'c': return {ConsonantKind::stop, 0.55};
        case 'k': case 'q': return {ConsonantKind::stop, 0.88};
        case 'b': return {ConsonantKind::voiced_stop, 0.18};
        case 'd': return {ConsonantKind::voiced_stop, 0.55};
        case 'g': return {ConsonantKind::voiced_stop, 0.88};
        case 'f': case 'v': return {ConsonantKind::fricative, 0.24};
        case 's': case 'z': return {ConsonantKind::sibilant, 0.72};
        case 'x': case 'j': return {ConsonantKind::sibilant, 0.90};
        case 'm': return {ConsonantKind::nasal, 0.22};
        case 'n': return {ConsonantKind::nasal, 0.58};
        case 'l': return {ConsonantKind::liquid, 0.42};
        case 'r': case 'w': case 'y': return {ConsonantKind::liquid, 0.68};
        case 'h': return {ConsonantKind::aspirate, 0.50};
        default: break;
    }
    constexpr std::array<Consonant, 7> invented{{
        {ConsonantKind::stop, 0.18},
        {ConsonantKind::voiced_stop, 0.22},
        {ConsonantKind::stop, 0.84},
        {ConsonantKind::sibilant, 0.72},
        {ConsonantKind::nasal, 0.55},
        {ConsonantKind::liquid, 0.62},
        {ConsonantKind::aspirate, 0.48},
    }};
    return invented[codepoint % invented.size()];
}

// Characters Unicode's kMandarin property does not cover. The generated table
// stays untouched; keep this list tiny and auditable.
std::string_view supplementary_reading(std::uint32_t codepoint) {
    switch (codepoint) {
        case 0x3007U: return "ling2";  // 〇
        default: return {};
    }
}

std::string_view mandarin_reading(std::uint32_t codepoint) {
    const auto& entries = generated::kMandarinReadings;
    const auto found = std::lower_bound(
        entries.begin(), entries.end(), codepoint,
        [](const generated::MandarinReadingEntry& entry, std::uint32_t value) {
            return entry.codepoint < value;
        });
    if (found == entries.end() || found->codepoint != codepoint) {
        return supplementary_reading(codepoint);
    }
    return generated::kMandarinSyllables[found->syllable_index];
}

bool begins_with(std::string_view value, std::string_view prefix) {
    return value.size() >= prefix.size() && value.substr(0, prefix.size()) == prefix;
}

int vowel_index(char vowel, bool apical_i = false) {
    switch (vowel) {
        case 'a': return 0;
        case 'e': return 1;
        case 'i': return apical_i ? 5 : 2;
        case 'o': return 3;
        case 'u': return 4;
        case 'v': return 6;
        case 'r': return 7;
        default: return 5;
    }
}

struct MandarinSyllable {
    Consonant consonant;
    int first_vowel = 5;
    int end_vowel = 5;
    std::uint8_t tone = 5;
    bool nasal_final = false;
    bool velar_nasal = false;
};

MandarinSyllable parse_mandarin(std::string_view reading) {
    MandarinSyllable syllable;
    if (!reading.empty() && reading.back() >= '1' && reading.back() <= '5') {
        syllable.tone = static_cast<std::uint8_t>(reading.back() - '0');
        reading.remove_suffix(1);
    }

    std::string_view initial;
    if (begins_with(reading, "zh") || begins_with(reading, "ch") || begins_with(reading, "sh")) {
        initial = reading.substr(0, 2);
        reading.remove_prefix(2);
    } else if (!reading.empty() && std::string_view("bpmfdtnlgkhjqxrzcs").find(reading.front()) !=
            std::string_view::npos) {
        initial = reading.substr(0, 1);
        reading.remove_prefix(1);
    }

    if (initial == "b") syllable.consonant = {ConsonantKind::stop, 0.16, false, false};
    else if (initial == "p") syllable.consonant = {ConsonantKind::stop, 0.16, true, false};
    else if (initial == "d") syllable.consonant = {ConsonantKind::stop, 0.52, false, false};
    else if (initial == "t") syllable.consonant = {ConsonantKind::stop, 0.52, true, false};
    else if (initial == "g") syllable.consonant = {ConsonantKind::stop, 0.88, false, false};
    else if (initial == "k") syllable.consonant = {ConsonantKind::stop, 0.88, true, false};
    else if (initial == "j") syllable.consonant = {ConsonantKind::affricate, 0.84, false, false};
    else if (initial == "q") syllable.consonant = {ConsonantKind::affricate, 0.84, true, false};
    else if (initial == "zh") syllable.consonant = {ConsonantKind::affricate, 0.44, false, true};
    else if (initial == "ch") syllable.consonant = {ConsonantKind::affricate, 0.44, true, true};
    else if (initial == "z") syllable.consonant = {ConsonantKind::affricate, 0.66, false, false};
    else if (initial == "c") syllable.consonant = {ConsonantKind::affricate, 0.66, true, false};
    else if (initial == "f") syllable.consonant = {ConsonantKind::fricative, 0.20, false, false};
    else if (initial == "h") syllable.consonant = {ConsonantKind::aspirate, 0.30, true, false};
    else if (initial == "x") syllable.consonant = {ConsonantKind::sibilant, 0.84, false, false};
    else if (initial == "sh") syllable.consonant = {ConsonantKind::sibilant, 0.44, false, true};
    else if (initial == "s") syllable.consonant = {ConsonantKind::sibilant, 0.68, false, false};
    else if (initial == "m") syllable.consonant = {ConsonantKind::nasal, 0.18, false, false};
    else if (initial == "n") syllable.consonant = {ConsonantKind::nasal, 0.54, false, false};
    else if (initial == "l") syllable.consonant = {ConsonantKind::liquid, 0.50, false, false};
    else if (initial == "r") syllable.consonant = {ConsonantKind::liquid, 0.42, false, true};

    std::string final(reading);
    // ASCII pinyin spells ü as "u:" or "v" (nu:3 / nv3, lu:4 / lv4). Both must
    // reach the front rounded vowel instead of falling back to plain u.
    for (std::size_t at = final.find("u:"); at != std::string::npos; at = final.find("u:", at)) {
        final.replace(at, 2, "v");
    }
    if (initial.empty() && !final.empty() && final.front() == 'y') {
        final.erase(0, 1);
        if (final.empty() || final == "i") final = "i";
        else if (final.front() == 'u') final.front() = 'v';
        else if (final.front() != 'i') final.insert(final.begin(), 'i');
    } else if (initial.empty() && !final.empty() && final.front() == 'w') {
        final.erase(0, 1);
        if (final.empty() || final == "u") final = "u";
        else if (final.front() != 'u') final.insert(final.begin(), 'u');
    }
    if ((initial == "j" || initial == "q" || initial == "x") && !final.empty() && final.front() == 'u') {
        final.front() = 'v';
    }
    if (final == "iu") final = "iou";
    if (final == "ui") final = "uei";
    if (final == "er") {
        syllable.first_vowel = syllable.end_vowel = 7;
        return syllable;
    }

    if (final.size() >= 2 && final.substr(final.size() - 2) == "ng") {
        syllable.nasal_final = true;
        syllable.velar_nasal = true;
        final.resize(final.size() - 2);
    } else if (!final.empty() && final.back() == 'n') {
        syllable.nasal_final = true;
        final.pop_back();
    }

    const bool apical = final == "i" &&
        (initial == "z" || initial == "c" || initial == "s" || initial == "zh" ||
         initial == "ch" || initial == "sh" || initial == "r");
    char first = final.empty() ? 'e' : final.front();
    char last = first;
    for (const char character : final) {
        if (std::string_view("aeiouv").find(character) != std::string_view::npos) {
            last = character;
        }
    }
    if (final == "ao" || final == "iao") last = 'u';
    syllable.first_vowel = vowel_index(first, apical);
    syllable.end_vowel = vowel_index(last, apical);
    return syllable;
}

/*
 * Japanese.
 *
 * Kana is a syllabary, so unlike Chinese there is no dictionary to consult: the
 * character is the pronunciation. That makes it the one language that can be
 * added without shipping a lookup table.
 *
 * Kanji is deliberately absent. The same character is read differently
 * depending on the word around it, which needs a dictionary and a
 * disambiguator, so unmarked kanji falls through to the Mandarin reading and
 * the panel says so. Write kana, or mark it: [今日|きょう].
 */

// Romaji for U+3041 to U+3094, in code order. Katakana is the same run shifted
// by 0x60 and shares this table. Two entries are markers rather than sounds:
// っ doubles the next consonant and ん is a mora of its own.
constexpr std::array<const char*, 84> kKanaRomaji{{
    "a", "a", "i", "i", "u", "u", "e", "e", "o", "o",
    "ka", "ga", "ki", "gi", "ku", "gu", "ke", "ge", "ko", "go",
    "sa", "za", "shi", "ji", "su", "zu", "se", "ze", "so", "zo",
    "ta", "da", "chi", "ji", "", "tsu", "zu", "te", "de", "to", "do",
    "na", "ni", "nu", "ne", "no",
    "ha", "ba", "pa", "hi", "bi", "pi", "fu", "bu", "pu",
    "he", "be", "pe", "ho", "bo", "po",
    "ma", "mi", "mu", "me", "mo",
    "ya", "ya", "yu", "yu", "yo", "yo",
    "ra", "ri", "ru", "re", "ro",
    "wa", "wa", "i", "e", "o", "n", "vu",
}};

constexpr std::uint32_t kHiraganaFirst = 0x3041U;
constexpr std::uint32_t kHiraganaLast = 0x3094U;
constexpr std::uint32_t kKatakanaOffset = 0x60U;
constexpr std::uint32_t kSmallTsuHiragana = 0x3063U;
constexpr std::uint32_t kNHiragana = 0x3093U;
constexpr std::uint32_t kProlongedMark = 0x30FCU;

// Katakana folded onto the hiragana it shares a sound with, or 0.
std::uint32_t kana_base(std::uint32_t codepoint) {
    if (codepoint >= kHiraganaFirst && codepoint <= kHiraganaLast) {
        return codepoint;
    }
    if (codepoint >= kHiraganaFirst + kKatakanaOffset &&
            codepoint <= kHiraganaLast + kKatakanaOffset) {
        return codepoint - kKatakanaOffset;
    }
    return 0;
}

bool is_kana(std::uint32_t codepoint) {
    return kana_base(codepoint) != 0 || codepoint == kProlongedMark;
}

std::string_view kana_romaji(std::uint32_t codepoint) {
    const auto base = kana_base(codepoint);
    if (base == 0) {
        return {};
    }
    return kKanaRomaji[base - kHiraganaFirst];
}

// The small kana: ぁぃぅぇぉ, ゃゅょ, ゎ. They never stand alone.
bool is_small_kana(std::uint32_t codepoint) {
    switch (kana_base(codepoint)) {
        case 0x3041U: case 0x3043U: case 0x3045U: case 0x3047U: case 0x3049U:
        case 0x3083U: case 0x3085U: case 0x3087U: case 0x308EU:
            return true;
        default:
            return false;
    }
}

// きゃ, しゅ, ふぉ: a small kana replaces the vowel of the one before it, and
// after an -i syllable it leaves a palatal on-glide behind. Returns an empty
// string when the pair is not one of those, so the caller can fall back.
std::string combine_small_kana(std::string_view base, std::uint32_t small) {
    const auto tail = kana_romaji(small);
    if (base.empty() || tail.empty()) {
        return {};
    }
    const char vowel = tail.back();
    if (std::string_view("aiueo").find(vowel) == std::string_view::npos) {
        return {};
    }
    // し/ち/じ keep their own palatal shape: しゃ is sha, not shya.
    if (base == "shi" || base == "chi" || base == "ji") {
        return std::string(base.substr(0, base.size() - 1)) + vowel;
    }
    if (base.size() > 1 && base.back() == 'i') {
        // ki + ゃ becomes kya. The y is what carries the palatal glide.
        return std::string(base.substr(0, base.size() - 1)) + "y" + vowel;
    }
    if (std::string_view("aiueo").find(base.back()) != std::string_view::npos) {
        // ふ + ぉ becomes fo, which is how loanwords are written.
        return std::string(base.substr(0, base.size() - 1)) + vowel;
    }
    return {};
}

/*
 * は and へ are read wa and e when they are grammatical particles, and ha and
 * he when they are part of a word. Telling those apart needs a morphological
 * analyser: こんにちは is wa, おはよう is ha, and nothing about the surrounding
 * characters separates them. Guessing would be wrong constantly in one
 * direction or the other, so the kana are read literally and only these fixed
 * greetings, where there is no ambiguity at all, are special-cased. Everything
 * else is marked by hand: きょう[は|わ]いいてんき.
 *
 * Deliberately tiny and auditable, exactly like kPhrasePronunciations.
 */
struct KanaPhrase {
    const char32_t* kana;
    const char* romaji;
};

constexpr std::array<KanaPhrase, 4> kKanaPhrases{{
    {U"こんにちは", "ko n ni chi wa"},
    {U"こんばんは", "ko n ba n wa"},
    {U"では", "de wa"},
    {U"それでは", "so re de wa"},
}};

struct JapaneseSyllable {
    Consonant consonant;
    int first_vowel = 0;
    int end_vowel = 0;
    bool nasal_final = false;
};

JapaneseSyllable parse_japanese(std::string_view romaji) {
    JapaneseSyllable syllable;
    // The moraic nasal ん is a whole mora on its own, not a coda.
    if (romaji == "n") {
        syllable.consonant = {ConsonantKind::nasal, 0.58, false, false};
        syllable.first_vowel = syllable.end_vowel = 4;  // a dark, closed colour
        syllable.nasal_final = true;
        return syllable;
    }

    std::string_view initial;
    for (const auto candidate : {"sh", "ch", "ts", "ky", "gy", "ny", "hy", "by", "py",
            "my", "ry"}) {
        if (begins_with(romaji, candidate)) {
            initial = candidate;
            romaji.remove_prefix(2);
            break;
        }
    }
    if (initial.empty() && !romaji.empty() &&
            std::string_view("kgsztdnhfbpmyrwvj").find(romaji.front()) != std::string_view::npos) {
        initial = romaji.substr(0, 1);
        romaji.remove_prefix(1);
    }

    // Japanese r is a flap, much closer to l than to the Mandarin retroflex.
    if (initial == "k") syllable.consonant = {ConsonantKind::stop, 0.88, true, false};
    else if (initial == "g") syllable.consonant = {ConsonantKind::stop, 0.88, false, false};
    else if (initial == "t") syllable.consonant = {ConsonantKind::stop, 0.52, true, false};
    else if (initial == "d") syllable.consonant = {ConsonantKind::stop, 0.52, false, false};
    else if (initial == "p") syllable.consonant = {ConsonantKind::stop, 0.16, true, false};
    else if (initial == "b") syllable.consonant = {ConsonantKind::stop, 0.16, false, false};
    else if (initial == "s") syllable.consonant = {ConsonantKind::sibilant, 0.68, false, false};
    else if (initial == "z") syllable.consonant = {ConsonantKind::sibilant, 0.66, false, false};
    else if (initial == "sh") syllable.consonant = {ConsonantKind::sibilant, 0.84, false, false};
    else if (initial == "j") syllable.consonant = {ConsonantKind::affricate, 0.84, false, false};
    else if (initial == "ch") syllable.consonant = {ConsonantKind::affricate, 0.84, true, false};
    else if (initial == "ts") syllable.consonant = {ConsonantKind::affricate, 0.66, true, false};
    else if (initial == "h") syllable.consonant = {ConsonantKind::aspirate, 0.30, true, false};
    else if (initial == "f") syllable.consonant = {ConsonantKind::fricative, 0.20, false, false};
    else if (initial == "v") syllable.consonant = {ConsonantKind::fricative, 0.20, false, false};
    else if (initial == "n") syllable.consonant = {ConsonantKind::nasal, 0.54, false, false};
    else if (initial == "m") syllable.consonant = {ConsonantKind::nasal, 0.18, false, false};
    else if (initial == "y") syllable.consonant = {ConsonantKind::liquid, 0.68, false, false};
    else if (initial == "w") syllable.consonant = {ConsonantKind::liquid, 0.68, false, false};
    else if (initial == "r") syllable.consonant = {ConsonantKind::liquid, 0.50, false, false};
    else if (initial.size() == 2 && initial.back() == 'y') {
        // The palatalised series keeps the place of its plain counterpart.
        const char plain = initial.front();
        if (plain == 'k') syllable.consonant = {ConsonantKind::stop, 0.88, true, false};
        else if (plain == 'g') syllable.consonant = {ConsonantKind::stop, 0.88, false, false};
        else if (plain == 'n') syllable.consonant = {ConsonantKind::nasal, 0.54, false, false};
        else if (plain == 'h') syllable.consonant = {ConsonantKind::aspirate, 0.30, true, false};
        else if (plain == 'b') syllable.consonant = {ConsonantKind::stop, 0.16, false, false};
        else if (plain == 'p') syllable.consonant = {ConsonantKind::stop, 0.16, true, false};
        else if (plain == 'm') syllable.consonant = {ConsonantKind::nasal, 0.18, false, false};
        else if (plain == 'r') syllable.consonant = {ConsonantKind::liquid, 0.50, false, false};
    }

    const char vowel = romaji.empty() ? 'a' : romaji.back();
    const int target = vowel_index(vowel);
    // Palatalised syllables glide out of an i, which is exactly what makes
    // きゃ sound like kya rather than ka.
    const bool palatal = initial == "sh" || initial == "ch" || initial == "j" ||
        (initial.size() == 2 && initial.back() == 'y');
    syllable.first_vowel = palatal ? vowel_index('i') : target;
    syllable.end_vowel = target;
    return syllable;
}

/*
 * English.
 *
 * English spelling does not map onto sound one letter at a time — though / through
 * / tough share four letters and share nothing else — so the previous behaviour,
 * pairing each consonant with the vowel after it, produced a syllable count that
 * had little to do with the word. "strength" came out as four syllables.
 *
 * What follows is a small, testable rule set rather than a published one. The
 * classic NRL letter-to-sound rules would be the obvious choice, but there are
 * over three hundred of them and reproducing them from memory would introduce
 * errors nothing here could detect. This is deliberately narrower: enough to get
 * the syllable count, the vowel colour and the stress roughly right, which is
 * what a character voice needs. It is not a pronunciation dictionary and does
 * not pretend to be one.
 *
 * The part that matters most is stress. English reduces unstressed vowels to a
 * schwa and shortens them, and that alternation is most of what makes speech
 * sound like English rather than like a list of syllables.
 */

struct EnglishSyllable {
    Consonant consonant;
    int first_vowel = 0;
    int end_vowel = 0;
    bool stressed = false;
    std::string spelling;
    // Where this syllable sits in the word, in letters. The spans are
    // contiguous and cover it completely, so a marker can show hel|lo rather
    // than dropping every consonant that closes a syllable.
    std::size_t begin = 0;
    std::size_t end = 0;
};

bool is_english_vowel(char letter) {
    return std::string_view("aeiou").find(letter) != std::string_view::npos;
}

Consonant english_consonant(std::string_view onset) {
    if (onset.empty()) {
        return {};
    }
    if (begins_with(onset, "th")) return {ConsonantKind::fricative, 0.40, false, false};
    if (begins_with(onset, "sh")) return {ConsonantKind::sibilant, 0.90, false, false};
    if (begins_with(onset, "ch")) return {ConsonantKind::affricate, 0.88, true, false};
    if (begins_with(onset, "ph")) return {ConsonantKind::fricative, 0.24, false, false};
    if (begins_with(onset, "wh")) return {ConsonantKind::liquid, 0.70, false, false};
    if (begins_with(onset, "ck")) return {ConsonantKind::stop, 0.88, true, false};
    if (begins_with(onset, "ng")) return {ConsonantKind::nasal, 0.80, false, false};
    if (begins_with(onset, "qu")) return {ConsonantKind::stop, 0.88, true, false};
    // A soft c or g: cent, gem. Anywhere else they are the hard stops.
    const bool soft_follows = onset.size() > 1 &&
        std::string_view("eiy").find(onset[1]) != std::string_view::npos;
    switch (onset.front()) {
        case 'p': return {ConsonantKind::stop, 0.18, true, false};
        case 'b': return {ConsonantKind::voiced_stop, 0.18, false, false};
        case 't': return {ConsonantKind::stop, 0.55, true, false};
        case 'd': return {ConsonantKind::voiced_stop, 0.55, false, false};
        case 'k': case 'q': return {ConsonantKind::stop, 0.88, true, false};
        case 'c': return soft_follows ? Consonant{ConsonantKind::sibilant, 0.72, false, false}
                                      : Consonant{ConsonantKind::stop, 0.88, true, false};
        case 'g': return soft_follows ? Consonant{ConsonantKind::affricate, 0.86, false, false}
                                      : Consonant{ConsonantKind::voiced_stop, 0.88, false, false};
        case 'f': return {ConsonantKind::fricative, 0.24, false, false};
        case 'v': return {ConsonantKind::fricative, 0.26, false, false};
        case 's': return {ConsonantKind::sibilant, 0.72, false, false};
        case 'z': return {ConsonantKind::sibilant, 0.70, false, false};
        case 'x': return {ConsonantKind::sibilant, 0.75, false, false};
        case 'j': return {ConsonantKind::affricate, 0.86, false, false};
        case 'm': return {ConsonantKind::nasal, 0.22, false, false};
        case 'n': return {ConsonantKind::nasal, 0.58, false, false};
        case 'l': return {ConsonantKind::liquid, 0.42, false, false};
        case 'r': return {ConsonantKind::liquid, 0.62, false, false};
        case 'w': return {ConsonantKind::liquid, 0.70, false, false};
        case 'y': return {ConsonantKind::liquid, 0.68, false, false};
        case 'h': return {ConsonantKind::aspirate, 0.50, true, false};
        default: return {};
    }
}

// The engine's vowel slots: a=0 e=1 i=2 o=3 u=4, 5 is the mid-central colour
// that stands in for a schwa, and 7 is rhotic.
constexpr int kSchwaVowel = 5;
constexpr int kRhoticVowel = 7;

void english_vowel(std::string_view group, bool lengthened, int& first, int& end) {
    struct Digraph { const char* spelling; int first; int end; };
    static constexpr std::array<Digraph, 16> kDigraphs{{
        {"ee", 2, 2}, {"ea", 2, 2}, {"ie", 2, 2},
        {"oo", 4, 4}, {"ou", 0, 4}, {"ow", 0, 4},
        {"oi", 3, 2}, {"oy", 3, 2},
        {"ai", 1, 2}, {"ay", 1, 2}, {"ei", 1, 2}, {"ey", 1, 2},
        {"au", 3, 3}, {"aw", 3, 3},
        {"oa", 3, 4}, {"ue", 4, 4},
    }};
    for (const auto& digraph : kDigraphs) {
        if (group.size() >= 2 && group.substr(0, 2) == digraph.spelling) {
            first = digraph.first;
            end = digraph.end;
            return;
        }
    }
    const char letter = group.empty() ? 'e' : group.front();
    if (lengthened) {
        // The "silent e" and open-syllable readings: name, be, time, bone, cute.
        switch (letter) {
            case 'a': first = 1; end = 2; return;
            case 'e': first = 2; end = 2; return;
            case 'i': case 'y': first = 0; end = 2; return;
            case 'o': first = 3; end = 4; return;
            case 'u': first = 2; end = 4; return;
            default: break;
        }
    }
    switch (letter) {
        case 'a': first = end = 0; return;
        case 'e': first = end = 1; return;
        case 'i': case 'y': first = end = 2; return;
        case 'o': first = end = 3; return;
        // cut, not coot: the short u is nearer the mid-central colour.
        case 'u': first = end = kSchwaVowel; return;
        default: first = end = kSchwaVowel; return;
    }
}

std::vector<EnglishSyllable> english_syllables(std::string word) {
    for (auto& letter : word) {
        letter = ascii_lower(static_cast<std::uint32_t>(static_cast<unsigned char>(letter)));
    }
    word.erase(std::remove(word.begin(), word.end(), '\0'), word.end());
    if (word.empty()) {
        return {};
    }

    // A final e is usually silent and lengthens the vowel before it, but only
    // when there is another vowel to lengthen: "the" and "be" are not silent.
    bool silent_final_e = false;
    if (word.size() > 2 && word.back() == 'e' && !is_english_vowel(word[word.size() - 2])) {
        for (std::size_t index = 0; index + 1 < word.size(); ++index) {
            if (is_english_vowel(word[index])) { silent_final_e = true; break; }
        }
    }
    const std::size_t spoken = silent_final_e ? word.size() - 1 : word.size();

    // Vowel groups become nuclei; y counts as one unless it opens the word.
    struct Group { std::size_t begin; std::size_t end; bool syllabic; };
    std::vector<Group> nuclei;
    // w and y are consonants before a vowel and part of the vowel after one:
    // flower is flo-wer but brown is one syllable, player is pla-yer but day is
    // one. What separates them is whether a vowel follows.
    const auto vowel_before = [&word, spoken](std::size_t at) {
        return at + 1 < spoken && is_english_vowel(word[at + 1]);
    };
    for (std::size_t index = 0; index < spoken;) {
        const bool opens = is_english_vowel(word[index]) ||
            (word[index] == 'y' && index > 0 && !vowel_before(index));
        if (!opens) { ++index; continue; }
        const std::size_t begin = index;
        while (index < spoken) {
            if (is_english_vowel(word[index])) { ++index; continue; }
            const bool glide = (word[index] == 'w' || word[index] == 'y') &&
                index > begin && !vowel_before(index);
            if (!glide) { break; }
            ++index;
            break;  // a glide closes the group: "ow" is one nucleus, "owe" is not
        }
        if (index == begin) { ++index; }
        nuclei.push_back({begin, index, false});
    }
    // A word-final l, m or n with no vowel of its own is still a syllable:
    // rhythm and prism are two, little and simple are two. The consonant does
    // the work of the vowel, which comes out as a schwa.
    if (!nuclei.empty()) {
        const std::size_t tail_begin = nuclei.back().end;
        // "-le" after a consonant is the same pattern wearing a silent e.
        const std::size_t tail_end = silent_final_e && word.back() == 'e' &&
            word[word.size() - 2] == 'l' ? word.size() - 1 : spoken;
        if (tail_end > tail_begin + 1) {
            const char last = word[tail_end - 1];
            if (last == 'l' || last == 'm' || last == 'n') {
                nuclei.push_back({tail_end - 1, tail_end, true});
            }
        }
    }
    if (nuclei.empty()) {
        // A word with no vowel at all, like "hmm" or an initialism. One
        // syllable, coloured by the schwa, is closer than saying nothing.
        EnglishSyllable only;
        only.consonant = english_consonant(word);
        only.first_vowel = only.end_vowel = kSchwaVowel;
        only.stressed = true;
        only.spelling = word;
        return {only};
    }

    std::vector<EnglishSyllable> syllables(nuclei.size());
    for (std::size_t index = 0; index < nuclei.size(); ++index) {
        const std::size_t onset_begin = index == 0 ? 0 : nuclei[index - 1].end;
        std::size_t onset_start = onset_begin;
        const std::size_t run = nuclei[index].begin - onset_begin;
        // Two or more consonants between nuclei: the first closes the syllable
        // before, the rest open this one. Otherwise the whole run opens this
        // one, which is the usual English split (wa-ter, not wat-er).
        //
        // Except that a digraph is one sound and splitting it invents a
        // consonant that is not there: mother is mo-ther, never mot-her.
        const auto pair = std::string_view(word).substr(onset_begin, 2);
        const bool digraph = run == 2 && (pair == "th" || pair == "sh" || pair == "ch" ||
            pair == "ph" || pair == "ck" || pair == "ng" || pair == "wh" || pair == "gh");
        if (index > 0 && run >= 2 && !digraph) { onset_start = onset_begin + 1; }
        const auto onset = std::string_view(word).substr(
            onset_start, nuclei[index].begin - onset_start);
        auto& syllable = syllables[index];
        syllable.consonant = english_consonant(onset);

        if (nuclei[index].syllabic) {
            // The consonant is the nucleus, so it is not also the onset.
            syllable.first_vowel = syllable.end_vowel = kSchwaVowel;
            syllable.begin = onset_start;
            continue;
        }
        const auto group = std::string_view(word).substr(
            nuclei[index].begin, nuclei[index].end - nuclei[index].begin);
        const bool last = index + 1 == nuclei.size();
        const bool lengthened = (last && silent_final_e) ||
            // An open final syllable is long: go, hi, me.
            (last && nuclei[index].end == spoken && group.size() == 1 && spoken > 1 &&
             nuclei[index].begin > 0);
        english_vowel(group, lengthened, syllable.first_vowel, syllable.end_vowel);

        // A following r colours the vowel rather than standing on its own.
        const std::size_t after = nuclei[index].end;
        if (after < spoken && word[after] == 'r' &&
                (after + 1 >= spoken || !is_english_vowel(word[after + 1]))) {
            syllable.first_vowel = syllable.end_vowel = kRhoticVowel;
        }
        syllable.begin = onset_start;
    }
    // Each syllable runs to the start of the next, and the last one takes
    // everything that is left, including a silent final e.
    for (std::size_t index = 0; index < syllables.size(); ++index) {
        syllables[index].end = index + 1 < syllables.size()
            ? syllables[index + 1].begin : word.size();
        syllables[index].spelling =
            word.substr(syllables[index].begin, syllables[index].end - syllables[index].begin);
    }

    // Stress. First syllable by default, moved by the endings that reliably
    // pull it and by the unstressed prefixes that reliably push it.
    std::size_t stress = 0;
    const auto ends_with = [&word](std::string_view suffix) {
        return word.size() >= suffix.size() &&
            std::string_view(word).substr(word.size() - suffix.size()) == suffix;
    };
    if (syllables.size() >= 2) {
        if (ends_with("tion") || ends_with("sion") || ends_with("cian") || ends_with("ic") ||
                ends_with("ical") || ends_with("ially") || ends_with("ious")) {
            stress = syllables.size() - 2;
        } else if (syllables.size() >= 3 && (ends_with("ity") || ends_with("ety") ||
                ends_with("ogy") || ends_with("graphy"))) {
            stress = syllables.size() - 3;
        } else {
            for (const auto prefix : {"a", "be", "de", "re", "in", "en", "ex", "con",
                    "com", "pre", "pro", "sur", "to"}) {
                if (begins_with(word, prefix) && syllables[0].spelling.size() <= 3) {
                    stress = 1;
                    break;
                }
            }
        }
    }
    stress = std::min(stress, syllables.size() - 1);
    syllables[stress].stressed = true;

    // Unstressed short vowels reduce to a schwa. Diphthongs and rhotics keep
    // their colour, as they do in speech.
    for (std::size_t index = 0; index < syllables.size(); ++index) {
        auto& syllable = syllables[index];
        if (syllable.stressed) { continue; }
        if (syllable.first_vowel == syllable.end_vowel &&
                syllable.first_vowel != kRhoticVowel) {
            syllable.first_vowel = syllable.end_vowel = kSchwaVowel;
        }
    }
    return syllables;
}

double consonant_seconds(const Consonant& consonant) {
    switch (consonant.kind) {
        case ConsonantKind::stop: return consonant.aspirated ? 0.062 : 0.036;
        case ConsonantKind::voiced_stop: return 0.048;
        case ConsonantKind::affricate: return consonant.aspirated ? 0.080 : 0.054;
        case ConsonantKind::fricative: case ConsonantKind::sibilant: return 0.066;
        case ConsonantKind::nasal: return 0.058;
        case ConsonantKind::liquid: return 0.046;
        case ConsonantKind::aspirate: return 0.060;
        default: return 0.010;
    }
}

double gaussian(double distance, double width) {
    const double normalized = distance / width;
    return std::exp(-0.5 * normalized * normalized);
}

// The spectrum of the source before the formants shape it. Every type is
// normalised afterwards, so these only decide the relative weights.
double source_weight(SourceType source, double harmonic) {
    switch (source) {
        // A sawtooth slope: every harmonic, falling as 1/n. Brighter and
        // buzzier than a voice, which is the point.
        case SourceType::reed:
            return 1.0 / harmonic;
        // Odd harmonics only, which is what makes a square wave hollow.
        case SourceType::chip:
            return std::fmod(harmonic, 2.0) < 0.5 ? 0.0 : 1.0 / harmonic;
        default:
            return 1.0 / std::pow(harmonic, 0.72);
    }
}

// How many harmonics are worth summing.
//
// This used to be a flat twelve, which was not enough to reach the third
// formant on a low voice: Cozy sits at 176 Hz, so twelve harmonics stopped at
// 2117 Hz while its third formant is at 2494 Hz. The formant that was supposed
// to give the voice its character had nothing to resonate, which is why the
// deep presets sounded muffled and hard to tell apart. Elder was worse.
//
// Enough harmonics to cover the top formant with room to spare, bounded by
// Nyquist and by kMaxHarmonics so a very low pitch cannot make this unbounded.
std::size_t harmonic_count(double frequency, double top_formant, double sample_rate) {
    if (frequency <= 0.0) {
        return 1;
    }
    const double wanted = top_formant * 1.4 / frequency;
    const double affordable = sample_rate * 0.5 / frequency;
    const double count = std::min({wanted, affordable, static_cast<double>(kMaxHarmonics)});
    return static_cast<std::size_t>(clamp(count, 1.0, static_cast<double>(kMaxHarmonics)));
}

void build_vowel_profile(
    int vowel_index,
    const Voice& voice,
    SourceType source,
    double frequency,
    double sample_rate,
    std::array<double, 3>& formants,
    std::array<double, kMaxHarmonics>& harmonics,
    std::size_t& count) {
    const auto& vowel = kVowels[static_cast<std::size_t>(vowel_index)];
    std::array<double, 3> bandwidths{};
    for (std::size_t index = 0; index < 3; ++index) {
        formants[index] = vowel.formants[index] * voice.tract;
        bandwidths[index] = vowel.bandwidths[index] * voice.tract;
    }
    harmonics.fill(0.0);
    count = harmonic_count(frequency, formants[2], sample_rate);
    const double nyquist = sample_rate * 0.5;
    double total = 0.0;
    for (std::size_t index = 0; index < count; ++index) {
        const double harmonic = static_cast<double>(index + 1);
        const double harmonic_frequency = frequency * harmonic;
        // Drop harmonics above Nyquist instead of letting them fold back as
        // aliasing. harmonic_count() already bounds this; the check stays
        // because it is the one that must not be got wrong.
        if (harmonic_frequency >= nyquist) {
            harmonics[index] = 0.0;
            continue;
        }
        double resonance = 0.035;
        for (std::size_t formant = 0; formant < 3; ++formant) {
            resonance += gaussian(harmonic_frequency - formants[formant], bandwidths[formant]);
        }
        harmonics[index] = resonance * source_weight(source, harmonic);
        total += harmonics[index];
    }
    if (total <= std::numeric_limits<double>::epsilon()) {
        total = 1.0;
    }
    for (auto& amplitude : harmonics) {
        amplitude /= total;
    }
}

void build_vowel(
    Event& event, int first_vowel, int end_vowel, const Voice& voice, SourceType source,
    double sample_rate) {
    event.vowel_name = kVowels[static_cast<std::size_t>(first_vowel)].name;
    std::size_t first_count = 1;
    std::size_t end_count = 1;
    build_vowel_profile(first_vowel, voice, source, event.frequency, sample_rate,
        event.formants, event.harmonics, first_count);
    build_vowel_profile(end_vowel, voice, source, event.frequency, sample_rate,
        event.end_formants, event.end_harmonics, end_count);
    // The two vowels can want different counts when their third formants differ;
    // the morph in render_vowel() reads both, so take the wider.
    event.harmonic_count = std::max(first_count, end_count);
}

struct SpeechUnit {
    std::uint32_t codepoint = 0;
    std::string reading;
    double pause_seconds = 0.0;
    bool mandarin = false;
    bool question = false;
    bool emphatic = false;
    std::uint8_t lexical_tone = 5;
    // Kana. A Japanese mora is timed like a Mandarin syllable rather than like
    // a latin letter, and it is parsed by parse_japanese() instead of
    // parse_mandarin(), but everything else about it is the same.
    bool japanese = false;
    // Characters this unit speaks beyond its own codepoint: the small kana in
    // きゃ, or every character covered by an inline override.
    std::vector<std::uint32_t> extra_codepoints;
    // English is syllabified whole-word, so the phonetics are worked out once
    // in english_syllables() rather than re-derived from the spelling here.
    bool english = false;
    Consonant english_consonant;
    int english_first_vowel = 0;
    int english_end_vowel = 0;
    bool english_stressed = false;
    // A melisma: the previous syllable is held on through the next note instead
    // of a new one being sung. Only produced in melody mode, so a hyphen in
    // ordinary text keeps resting the way it always has.
    bool tie = false;
};

struct PhrasePronunciation {
    const char32_t* text;
    const char* readings;
};

// Phrase-level entries override Unihan's single-character kMandarin value.
// Keep this list deliberately compact and auditable; user overrides handle
// names and uncommon readings without requiring a full word segmenter.
constexpr std::array<PhrasePronunciation, 44> kPhrasePronunciations{{
    {U"音樂", "yin1 yue4"}, {U"音乐", "yin1 yue4"},
    {U"樂隊", "yue4 dui4"}, {U"乐队", "yue4 dui4"},
    {U"快樂", "kuai4 le4"}, {U"快乐", "kuai4 le4"},
    {U"銀行", "yin2 hang2"}, {U"银行", "yin2 hang2"},
    {U"行走", "xing2 zou3"}, {U"行為", "xing2 wei2"}, {U"行为", "xing2 wei2"},
    {U"重新", "chong2 xin1"}, {U"重複", "chong2 fu4"}, {U"重复", "chong2 fu4"},
    {U"重要", "zhong4 yao4"}, {U"重量", "zhong4 liang4"},
    {U"長大", "zhang3 da4"}, {U"长大", "zhang3 da4"},
    {U"長度", "chang2 du4"}, {U"长度", "chang2 du4"},
    {U"還書", "huan2 shu1"}, {U"还书", "huan2 shu1"},
    {U"還是", "hai2 shi4"}, {U"还是", "hai2 shi4"},
    // 過, 著, and 了 default to a neutral particle reading below. These are the
    // common full-tone words where that default would be wrong.
    {U"過去", "guo4 qu4"}, {U"过去", "guo4 qu4"},
    {U"經過", "jing1 guo4"}, {U"经过", "jing1 guo4"},
    {U"超過", "chao1 guo4"}, {U"超过", "chao1 guo4"},
    {U"難過", "nan2 guo4"}, {U"难过", "nan2 guo4"},
    {U"過來", "guo4 lai2"}, {U"过来", "guo4 lai2"},
    {U"過年", "guo4 nian2"}, {U"过年", "guo4 nian2"},
    {U"著名", "zhu4 ming2"},
    {U"著急", "zhao2 ji2"}, {U"着急", "zhao2 ji2"},
    {U"顯著", "xian3 zhu4"}, {U"显著", "xian3 zhu4"},
    {U"了解", "liao3 jie3"}, {U"瞭解", "liao3 jie3"},
    {U"明了", "ming2 liao3"},
}};

std::vector<std::string> split_readings(std::string_view value) {
    std::vector<std::string> output;
    std::string current;
    for (const char character : value) {
        if (character == ' ' || character == '\t' || character == ',') {
            if (!current.empty()) {
                output.push_back(current);
                current.clear();
            }
        } else {
            current.push_back(character);
        }
    }
    if (!current.empty()) output.push_back(current);
    return output;
}

bool matches_phrase(
    const std::vector<std::uint32_t>& codepoints,
    std::size_t offset,
    std::u32string_view phrase) {
    if (offset + phrase.size() > codepoints.size()) return false;
    for (std::size_t index = 0; index < phrase.size(); ++index) {
        if (codepoints[offset + index] != static_cast<std::uint32_t>(phrase[index])) return false;
    }
    return true;
}

std::uint8_t reading_tone(std::string_view reading) {
    if (!reading.empty() && reading.back() >= '1' && reading.back() <= '5') {
        return static_cast<std::uint8_t>(reading.back() - '0');
    }
    return 5;
}

void replace_reading_tone(std::string& reading, std::uint8_t tone) {
    if (!reading.empty() && reading.back() >= '1' && reading.back() <= '5') {
        reading.back() = static_cast<char>('0' + tone);
    } else {
        reading.push_back(static_cast<char>('0' + tone));
    }
}

bool is_number_character(std::uint32_t codepoint) {
    switch (codepoint) {
        case 0x3007U:  // 〇
        case U'零': case U'一': case U'二': case U'兩': case U'两': case U'三':
        case U'四': case U'五': case U'六': case U'七': case U'八': case U'九':
        case U'十': case U'百': case U'千': case U'萬': case U'万':
            return true;
        default:
            return codepoint >= '0' && codepoint <= '9';
    }
}

// 一 keeps its citation first tone as an ordinal, in dates, and inside a spoken
// digit sequence: 第一名, 星期一早上, 一月, 一號, 二〇一九. Everywhere else it
// takes the usual second/fourth-tone sandhi.
bool yi_keeps_citation_tone(std::uint32_t previous, std::uint32_t next) {
    switch (previous) {
        case U'第': case U'星': case U'期': case U'週': case U'周': case U'初':
            return true;
        default:
            break;
    }
    switch (next) {
        case U'月': case U'日': case U'號': case U'号':
            return true;
        default:
            break;
    }
    return is_number_character(previous);
}

bool is_neutral_particle(std::uint32_t codepoint) {
    switch (codepoint) {
        case U'的': case U'了': case U'嗎': case U'吗': case U'吧': case U'呢':
        case U'著': case U'着': case U'過': case U'过': case U'們': case U'们':
        case U'啊': case U'呀': case U'嘛': case U'喔': case U'哦':
            return true;
        default:
            return false;
    }
}

double punctuation_pause(std::uint32_t codepoint) {
    switch (codepoint) {
        case ',': case 0xFF0CU: case 0x3001U: return 0.105;
        case ';': case 0xFF1BU: return 0.190;
        case ':': case 0xFF1AU: return 0.155;
        case '?': case 0xFF1FU: return 0.215;
        case '!': case 0xFF01U: return 0.195;
        case '.': case 0xFF0EU: case 0x3002U: return 0.235;
        case 0x2026U: return 0.300;
        case '-': case 0x2014U: return 0.125;
        default: return 0.165;
    }
}

bool is_question_mark(std::uint32_t codepoint) {
    return codepoint == '?' || codepoint == 0xFF1FU;
}

bool is_exclamation_mark(std::uint32_t codepoint) {
    return codepoint == '!' || codepoint == 0xFF01U;
}

bool is_pinyin_character(std::uint32_t codepoint) {
    const char lower = ascii_lower(codepoint);
    return lower != '\0' || (codepoint >= '1' && codepoint <= '5') || codepoint == ':';
}

bool is_bopomofo(std::uint32_t codepoint) {
    return codepoint >= 0x3105U && codepoint <= 0x3129U;
}

std::uint8_t bopomofo_tone(std::uint32_t codepoint) {
    switch (codepoint) {
        case 0x02C9U: return 1;  // ˉ
        case 0x02CAU: return 2;  // ˊ
        case 0x02C7U: return 3;  // ˇ
        case 0x02CBU: return 4;  // ˋ
        case 0x02D9U: return 5;  // ˙
        default: return 0;
    }
}

std::string bopomofo_to_pinyin(
    const std::vector<std::uint32_t>& codepoints,
    std::size_t begin,
    std::size_t end,
    std::uint8_t tone) {
    std::string initial;
    std::string final;
    for (std::size_t index = begin; index < end; ++index) {
        switch (codepoints[index]) {
            case U'ㄅ': initial = "b"; break; case U'ㄆ': initial = "p"; break;
            case U'ㄇ': initial = "m"; break; case U'ㄈ': initial = "f"; break;
            case U'ㄉ': initial = "d"; break; case U'ㄊ': initial = "t"; break;
            case U'ㄋ': initial = "n"; break; case U'ㄌ': initial = "l"; break;
            case U'ㄍ': initial = "g"; break; case U'ㄎ': initial = "k"; break;
            case U'ㄏ': initial = "h"; break; case U'ㄐ': initial = "j"; break;
            case U'ㄑ': initial = "q"; break; case U'ㄒ': initial = "x"; break;
            case U'ㄓ': initial = "zh"; break; case U'ㄔ': initial = "ch"; break;
            case U'ㄕ': initial = "sh"; break; case U'ㄖ': initial = "r"; break;
            case U'ㄗ': initial = "z"; break; case U'ㄘ': initial = "c"; break;
            case U'ㄙ': initial = "s"; break;
            case U'ㄧ': final += "i"; break; case U'ㄨ': final += "u"; break;
            case U'ㄩ': final += "v"; break; case U'ㄚ': final += "a"; break;
            case U'ㄛ': final += "o"; break; case U'ㄜ': case U'ㄝ': final += "e"; break;
            case U'ㄞ': final += "ai"; break; case U'ㄟ': final += "ei"; break;
            case U'ㄠ': final += "ao"; break; case U'ㄡ': final += "ou"; break;
            case U'ㄢ': final += "an"; break; case U'ㄣ': final += "en"; break;
            case U'ㄤ': final += "ang"; break; case U'ㄥ': final += "eng"; break;
            case U'ㄦ': final += "er"; break;
            default: break;
        }
    }
    if (final.empty() &&
            (initial == "z" || initial == "c" || initial == "s" || initial == "zh" ||
             initial == "ch" || initial == "sh" || initial == "r")) {
        final = "i";
    }
    if (initial.empty() && final.empty()) return {};
    return initial + final + static_cast<char>('0' + (tone == 0 ? 1 : tone));
}

std::vector<SpeechUnit> build_speech_units(const std::string& text, bool melody_mode) {
    const auto codepoints = decode_utf8(text);
    std::vector<SpeechUnit> units;
    for (std::size_t index = 0; index < codepoints.size();) {
        const auto codepoint = codepoints[index];
        // A hyphen sings the previous syllable through the next note. It has to
        // be caught before is_punctuation(), which has always scored it as a
        // rest — and still does when there is no melody, so a hyphenated line
        // of dialogue is unchanged.
        if (melody_mode && (codepoint == '-' || codepoint == 0xFF0DU)) {
            SpeechUnit unit;
            unit.codepoint = codepoint;
            unit.tie = true;
            units.push_back(unit);
            ++index;
            continue;
        }
        if (is_space(codepoint)) {
            units.push_back({codepoint, {}, 0.055, false, false, false});
            ++index;
            continue;
        }
        if (is_punctuation(codepoint)) {
            units.push_back({codepoint, {}, punctuation_pause(codepoint), false,
                is_question_mark(codepoint), is_exclamation_mark(codepoint)});
            ++index;
            continue;
        }

        // Inline pronunciation: [重|chong2] or [音樂|yin1 yue4].
        if (codepoint == '[') {
            std::size_t bar = index + 1;
            while (bar < codepoints.size() && codepoints[bar] != '|' && codepoints[bar] != ']') ++bar;
            std::size_t close = bar + 1;
            while (close < codepoints.size() && codepoints[close] != ']') ++close;
            if (bar < close && close < codepoints.size() && codepoints[bar] == '|') {
                std::string override_text;
                bool ascii = true;
                for (std::size_t cursor = bar + 1; cursor < close; ++cursor) {
                    if (codepoints[cursor] > 0x7FU) { ascii = false; break; }
                    override_text.push_back(static_cast<char>(codepoints[cursor]));
                }
                const auto character_count = bar - index - 1;
                // Kana in the override: [今日|きょう]. Kanji has no reading the
                // engine can look up, so this is how Japanese gets written
                // without spelling the whole sentence in kana. The morae come
                // from the kana, and every covered character is attached to the
                // first of them so markers still label what is on screen.
                bool kana_override = character_count > 0;
                for (std::size_t cursor = bar + 1; cursor < close && kana_override; ++cursor) {
                    if (!is_kana(codepoints[cursor])) { kana_override = false; }
                }
                if (kana_override) {
                    std::string kana;
                    for (std::size_t cursor = bar + 1; cursor < close; ++cursor) {
                        append_utf8(kana, codepoints[cursor]);
                    }
                    auto morae = build_speech_units(kana, melody_mode);
                    if (!morae.empty()) {
                        std::size_t first_spoken = morae.size();
                        for (std::size_t at = 0; at < morae.size(); ++at) {
                            if (morae[at].pause_seconds <= 0.0) { first_spoken = at; break; }
                        }
                        if (first_spoken < morae.size()) {
                            // The characters on screen replace the kana that
                            // spelled them, rather than being added to them: a
                            // marker should read 今日, not 今日ょ.
                            auto& carrier = morae[first_spoken];
                            carrier.codepoint = codepoints[index + 1];
                            carrier.extra_codepoints.assign(
                                codepoints.begin() + static_cast<std::ptrdiff_t>(index + 2),
                                codepoints.begin() + static_cast<std::ptrdiff_t>(bar));
                            units.insert(units.end(), morae.begin(), morae.end());
                            index = close + 1;
                            continue;
                        }
                    }
                }
                const auto readings = split_readings(override_text);
                if (ascii && character_count > 0 && readings.size() == character_count) {
                    for (std::size_t cursor = 0; cursor < character_count; ++cursor) {
                        units.push_back({codepoints[index + 1 + cursor], readings[cursor], 0.0, true, false, false});
                    }
                    index = close + 1;
                    continue;
                }
            }
        }

        bool phrase_matched = false;
        for (const auto& entry : kPhrasePronunciations) {
            const std::u32string_view phrase(entry.text);
            if (!matches_phrase(codepoints, index, phrase)) continue;
            const auto readings = split_readings(entry.readings);
            if (readings.size() != phrase.size()) continue;
            for (std::size_t cursor = 0; cursor < phrase.size(); ++cursor) {
                units.push_back({codepoints[index + cursor], readings[cursor], 0.0, true, false, false});
            }
            index += phrase.size();
            phrase_matched = true;
            break;
        }
        if (phrase_matched) continue;

        // Kana. Unlike Chinese there is nothing to look up: the character is
        // the pronunciation, so this needs no table beyond the romaji above.
        if (is_kana(codepoint)) {
            // The handful of fixed greetings where は is unambiguously wa.
            // Matched on the hiragana each character folds to, so katakana
            // spellings hit the same entry.
            bool phrase_matched_kana = false;
            for (const auto& entry : kKanaPhrases) {
                const std::u32string_view phrase(entry.kana);
                if (index + phrase.size() > codepoints.size()) { continue; }
                bool same = true;
                for (std::size_t at = 0; at < phrase.size() && same; ++at) {
                    same = kana_base(codepoints[index + at]) ==
                        kana_base(static_cast<std::uint32_t>(phrase[at]));
                }
                if (!same) { continue; }
                const auto readings = split_readings(entry.romaji);
                if (readings.size() != phrase.size()) { continue; }
                for (std::size_t at = 0; at < phrase.size(); ++at) {
                    SpeechUnit mora;
                    mora.codepoint = codepoints[index + at];
                    mora.reading = readings[at];
                    mora.japanese = true;
                    units.push_back(mora);
                }
                index += phrase.size();
                phrase_matched_kana = true;
                break;
            }
            if (phrase_matched_kana) { continue; }
            // っ doubles the next consonant, which is heard as a stop rather
            // than as a sound. One mora of silence is what that amounts to.
            if (kana_base(codepoint) == kSmallTsuHiragana) {
                SpeechUnit stop;
                stop.codepoint = codepoint;
                stop.pause_seconds = kSyllableStride * 0.5;
                units.push_back(stop);
                ++index;
                continue;
            }
            // ー holds the vowel before it for another mora.
            if (codepoint == kProlongedMark) {
                if (!units.empty() && units.back().japanese && !units.back().reading.empty()) {
                    SpeechUnit held;
                    held.codepoint = codepoint;
                    held.reading = std::string(1, units.back().reading.back());
                    held.japanese = true;
                    units.push_back(held);
                    ++index;
                    continue;
                }
                ++index;
                continue;
            }
            SpeechUnit mora;
            mora.codepoint = codepoint;
            mora.reading = std::string(kana_romaji(codepoint));
            mora.japanese = true;
            // きゃ and ふぉ are one mora written with two characters.
            if (index + 1 < codepoints.size() && is_small_kana(codepoints[index + 1])) {
                const auto combined = combine_small_kana(mora.reading, codepoints[index + 1]);
                if (!combined.empty()) {
                    mora.reading = combined;
                    mora.extra_codepoints.push_back(codepoints[index + 1]);
                    ++index;
                }
            }
            if (!mora.reading.empty()) {
                units.push_back(mora);
            }
            ++index;
            continue;
        }

        // Space- or tone-mark-delimited Zhuyin: ㄋㄧˇ ㄏㄠˇ.
        if (is_bopomofo(codepoint) || bopomofo_tone(codepoint) == 5) {
            std::uint8_t tone = bopomofo_tone(codepoint);
            std::size_t begin = tone == 5 ? index + 1 : index;
            std::size_t end = begin;
            while (end < codepoints.size() && is_bopomofo(codepoints[end])) ++end;
            const std::size_t syllable_end = end;
            if (end < codepoints.size() && bopomofo_tone(codepoints[end]) != 0) {
                tone = bopomofo_tone(codepoints[end]);
                ++end;
            }
            const auto reading = bopomofo_to_pinyin(codepoints, begin, syllable_end, tone);
            if (!reading.empty()) {
                units.push_back({codepoint, reading, 0.0, true, false, false});
                index = end;
                continue;
            }
        }

        // Tone-number pinyin is treated as one Mandarin syllable instead of
        // English-style character chatter: "ni3 hao3".
        if (ascii_lower(codepoint) != '\0') {
            std::size_t end = index;
            std::string token;
            while (end < codepoints.size() && is_pinyin_character(codepoints[end])) {
                if (codepoints[end] < 0x80U) token.push_back(static_cast<char>(codepoints[end]));
                ++end;
            }
            if (!token.empty() && token.back() >= '1' && token.back() <= '5') {
                units.push_back({codepoint, token, 0.0, true, false, false});
                index = end;
                continue;
            }
        }

        // An English word, taken whole. Spelling only makes sense a word at a
        // time — though, through and tough share four letters and no sounds —
        // so the syllables are worked out here rather than letter by letter.
        if (ascii_lower(codepoint) != '\0') {
            std::size_t end = index;
            std::string word;
            while (end < codepoints.size() &&
                    (ascii_lower(codepoints[end]) != '\0' || codepoints[end] == '\'')) {
                word.push_back(static_cast<char>(codepoints[end]));
                ++end;
            }
            const auto syllables = english_syllables(word);
            if (!syllables.empty()) {
                for (std::size_t at = 0; at < syllables.size(); ++at) {
                    SpeechUnit spoken;
                    // Each syllable carries its own letters, so a marker reads
                    // hel then lo, the way a Chinese one carries its character.
                    spoken.codepoint = codepoints[index + syllables[at].begin];
                    for (std::size_t cursor = syllables[at].begin + 1;
                            cursor < syllables[at].end; ++cursor) {
                        spoken.extra_codepoints.push_back(codepoints[index + cursor]);
                    }
                    spoken.reading = syllables[at].spelling;
                    spoken.english = true;
                    spoken.english_consonant = syllables[at].consonant;
                    spoken.english_first_vowel = syllables[at].first_vowel;
                    spoken.english_end_vowel = syllables[at].end_vowel;
                    spoken.english_stressed = syllables[at].stressed;
                    units.push_back(spoken);
                }
                index = end;
                continue;
            }
        }

        const auto reading = mandarin_reading(codepoint);
        if (!reading.empty()) {
            std::string value(reading);
            if (is_neutral_particle(codepoint)) replace_reading_tone(value, 5);
            units.push_back({codepoint, value, 0.0, true, false, false});
        } else {
            units.push_back({codepoint, {}, 0.0, false, false, false});
        }
        ++index;
    }

    for (auto& unit : units) {
        if (unit.mandarin) unit.lexical_tone = reading_tone(unit.reading);
    }

    // Mandarin tone sandhi, applied within each uninterrupted phrase.
    for (std::size_t index = 0; index < units.size(); ++index) {
        if (!units[index].mandarin) continue;
        std::size_t next = index + 1;
        while (next < units.size() && !units[next].mandarin &&
                (units[next].pause_seconds <= 0.0 || is_space(units[next].codepoint))) {
            ++next;
        }
        if (next >= units.size() || !units[next].mandarin) continue;
        std::uint32_t previous = 0;
        for (std::size_t back = index; back > 0; --back) {
            if (units[back - 1].mandarin) { previous = units[back - 1].codepoint; break; }
            if (units[back - 1].pause_seconds > 0.0 && !is_space(units[back - 1].codepoint)) break;
        }
        const auto next_tone = reading_tone(units[next].reading);
        auto tone = reading_tone(units[index].reading);
        if (tone == 3 && next_tone == 3) {
            replace_reading_tone(units[index].reading, 2);
        } else if (units[index].codepoint == U'一') {
            if (!yi_keeps_citation_tone(previous, units[next].codepoint)) {
                replace_reading_tone(units[index].reading, next_tone == 4 ? 2 : 4);
            }
        } else if (units[index].codepoint == U'不' && next_tone == 4) {
            replace_reading_tone(units[index].reading, 2);
        }
    }
    return units;
}

void apply_character_style(Settings& settings, Voice& voice) {
    const double cuteness = clamp(settings.cuteness, 0.0, 1.0);
    switch (settings.character_size) {
        case CharacterSize::tiny:
            voice.pitch *= 1.30; voice.tract *= 1.12; settings.speed *= 1.08; break;
        case CharacterSize::young:
            voice.pitch *= 1.12; voice.tract *= 1.05; settings.speed *= 1.04; break;
        case CharacterSize::giant:
            voice.pitch *= 0.72; voice.tract *= 0.84; settings.speed *= 0.91; break;
        default:
            break;
    }
    voice.pitch *= 0.90 + cuteness * 0.28;
    voice.tract *= 0.96 + cuteness * 0.09;
    voice.wobble *= 0.72 + cuteness * 0.72;
    // Applied last so they scale whatever the preset, the character size and
    // cuteness have already decided. Both default to 1.0 and change nothing.
    voice.tract *= clamp(settings.formant, 0.25, 4.0);
    voice.wobble *= clamp(settings.vibrato_depth, 0.0, 4.0);

    switch (settings.emotion) {
        case Emotion::happy:
            settings.pitch *= 1.08; settings.speed *= 1.08; voice.wobble *= 1.30; break;
        case Emotion::angry:
            settings.pitch *= 0.95; settings.speed *= 1.12; settings.consonant *= 1.24;
            settings.volume *= 1.08; voice.breath *= 0.72; break;
        case Emotion::scared:
            settings.pitch *= 1.16; settings.speed *= 1.14; voice.wobble *= 1.85;
            voice.breath *= 1.45; break;
        case Emotion::questioning:
            settings.pitch *= 1.04; break;
        case Emotion::sleepy:
            settings.pitch *= 0.86; settings.speed *= 0.78; settings.consonant *= 0.80;
            voice.breath *= 1.32; voice.wobble *= 0.65; break;
        case Emotion::robot:
            settings.speed *= 0.96; voice.wobble = 0.0; voice.buzz = std::max(voice.buzz, 0.34);
            voice.breath *= 0.30; break;
        default:
            break;
    }
}

// Defined with the rendering code below, but the sung path needs its value at
// progress zero while it is planning: that is where a tone would have started,
// and it becomes the pitch the note is approached from.
double tone_multiplier(std::uint8_t tone, double progress);

// Pushes one note, split into segments if it is held long enough to matter.
//
// Everything that has to survive the seam is already a function of note-global
// time, so the pieces differ only in where they start. The breath noise does
// restart with each piece, which is why each gets its own seed: the same
// filtered noise repeating every quarter of a second would be a buzz.
void push_segmented(std::vector<Event>& events, const Event& whole, double sample_rate) {
    const auto limit = static_cast<std::size_t>(std::llround(kSegmentSeconds * sample_rate));
    const auto shortest =
        static_cast<std::size_t>(std::llround(kShortestSegmentSeconds * sample_rate));
    if (!whole.sustained || limit == 0U || whole.length <= limit + shortest) {
        events.push_back(whole);
        return;
    }
    std::size_t offset = 0;
    std::size_t piece_index = 0;
    while (offset < whole.length) {
        std::size_t take = std::min(limit, whole.length - offset);
        // Never leave a runt behind: several places downstream assume an event
        // has room for an onset and a release.
        if (whole.length - offset - take < shortest) {
            take = whole.length - offset;
        }
        Event piece = whole;
        piece.start = whole.start + offset;
        piece.length = take;
        piece.time_offset = offset;
        piece.note_length = whole.length;
        piece.seamless_start = offset > 0U;
        piece.seamless_end = offset + take < whole.length;
        piece.seed = whole.seed + static_cast<std::uint32_t>(piece_index * 7919U);
        if (offset > 0U) {
            piece.continues_previous = true;
            piece.onset = 0;
            piece.consonant = Consonant{};
            piece.source_units.clear();
        }
        events.push_back(piece);
        offset += take;
        ++piece_index;
    }
}

// What a melisma holds on to: the vowel the previous syllable ended on.
struct HeldSyllable {
    bool valid = false;
    int vowel = 0;
    bool nasal_final = false;
    bool velar_nasal = false;
};

std::pair<std::vector<Event>, std::size_t> build_events(const Settings& settings, const Voice& voice) {
    const auto units = build_speech_units(settings.text, settings.melody_mode);
    std::uint32_t seed = settings.seed == 0U ? 91673U : settings.seed;
    if (settings.seed == 0U) {
        for (std::size_t index = 0; index < units.size(); ++index) {
            seed = static_cast<std::uint32_t>(
                (seed + units[index].codepoint * (index + 17U)) % 2147483647U);
        }
    }
    Random random(seed);
    std::vector<Event> events;
    std::size_t cursor = 0;
    // Keep these bounds in step with the parameter ranges in
    // plugin/IslandChatterNative.cpp and with estimateSpeech() in the panel,
    // which has to reproduce this exact clamp to plan matching timings.
    const double speed = clamp(settings.speed, kMinimumSpeed, kMaximumSpeed);
    const auto sample_rate = static_cast<double>(settings.sample_rate);

    // --- Singing -----------------------------------------------------------
    //
    // With a melody the timing comes entirely from the notes: Speed and Tempo
    // Lock stop applying, punctuation stops resting, and the gaps in the tune
    // are the rests in the slot list. Without one, not a line below runs.
    const bool singing = settings.melody_mode && !settings.melody.empty();
    const double tick_seconds =
        60.0 / clamp(settings.melody_bpm, 20.0, 400.0) / kMelodyTicksPerBeat;
    const double portamento = clamp(settings.portamento_seconds, 0.0, 0.5);
    const double tone_blend = clamp(settings.tone_blend, 0.0, 1.0);
    std::size_t slot = 0;
    MelodyNote last_note{60, kMelodyTicksPerBeat};
    double previous_frequency = 0.0;
    HeldSyllable held;

    // Rests move the cursor; the next pitched note is what a syllable gets.
    // Once the melody runs out the last note repeats, so a lyric longer than
    // its tune is sung to the end on one pitch rather than cut off mid-word.
    const auto take_note = [&]() {
        while (slot < settings.melody.size()) {
            const auto note = settings.melody[slot++];
            if (note.pitch <= 0) {
                cursor += static_cast<std::size_t>(
                    std::llround(note.ticks * tick_seconds * sample_rate));
                // Nothing to glide from across a silence.
                previous_frequency = 0.0;
                continue;
            }
            last_note = note;
            return note;
        }
        return last_note;
    };
    const auto note_frequency = [&](const MelodyNote& note) {
        return 440.0 * std::pow(2.0, (clamp(note.pitch + settings.transpose, 1, 127) - 69) / 12.0);
    };
    const auto note_seconds = [&](const MelodyNote& note) {
        return std::max(0.03, note.ticks * tick_seconds);
    };

    for (std::size_t index = 0; index < units.size(); ++index) {
        const auto& unit = units[index];
        const auto codepoint = unit.codepoint;

        // A melisma. The syllable before it is held on through this note, so
        // there is no consonant and no new vowel — only a new pitch, glided
        // into, and one more entry that describe() folds back into the syllable
        // it belongs to.
        if (settings.melody_mode && unit.tie) {
            // With no melody to hold on to there is nothing to sing; the unit
            // still exists so that syllable_count() can see it, because a
            // melisma asks for a note of its own.
            if (!singing || !held.valid) { continue; }
            const auto note = take_note();
            const double duration = note_seconds(note);
            Event event;
            event.start = cursor;
            event.length = std::max<std::size_t>(
                64, static_cast<std::size_t>(std::llround(duration * sample_rate)));
            event.note_length = event.length;
            event.frequency = note_frequency(note);
            event.sustained = true;
            event.continues_previous = true;
            event.nasal_final = held.nasal_final;
            event.velar_nasal = held.velar_nasal;
            event.source_codepoint = codepoint;
            event.glide_from = previous_frequency > 0.0 ? previous_frequency : event.frequency;
            event.glide_seconds = std::min(portamento, duration * 0.5);
            event.level = velocity_level(note.velocity);
            event.phase = random.next() * kTwoPi;
            event.seed = static_cast<std::uint32_t>(random.next() * 2147483000.0) + 1U;
            // The vowel the syllable ended on is the one that carries on, which
            // is what "holding a note" means: 好 sung over three notes is one
            // ao, not three hao.
            build_vowel(event, held.vowel, held.vowel, voice, settings.source, sample_rate);
            previous_frequency = event.frequency;
            cursor = event.start + event.length;
            push_segmented(events, event, sample_rate);
            continue;
        }

        if (unit.pause_seconds > 0.0) {
            // The tune already says where the silences are. A comma in the
            // lyrics is punctuation on screen, not an extra beat of rest, and
            // adding one would push the rest of the line off its notes.
            if (singing) { continue; }
            if (!events.empty()) {
                events.back().question_rise = events.back().question_rise || unit.question;
                events.back().emphatic = events.back().emphatic || unit.emphatic;
            }
            // Under tempo lock a rest has to be a whole number of syllable
            // slots, otherwise punctuation would push everything after it off
            // the beat. Short marks round down to no extra time at all.
            const double pause = settings.tempo_lock
                ? std::round(unit.pause_seconds / kSyllableStride) * kSyllableStride
                : unit.pause_seconds;
            cursor += static_cast<std::size_t>(std::llround(pause / speed * sample_rate));
            continue;
        }

        int vowel_index = latin_vowel(codepoint);
        int end_vowel_index = vowel_index;
        // Which input characters this syllable ends up speaking. The panel
        // labels its markers from this, so it has to grow whenever a branch
        // below consumes more than the current character.
        std::vector<std::uint32_t> consumed{codepoint};
        consumed.insert(consumed.end(), unit.extra_codepoints.begin(), unit.extra_codepoints.end());
        Consonant consonant{};
        const bool latin = ascii_lower(codepoint) != '\0';
        MandarinSyllable mandarin;
        const std::string_view reading(unit.reading);
        const bool has_mandarin_reading = unit.mandarin && !reading.empty();
        const bool has_japanese_reading = unit.japanese && !reading.empty();
        const bool has_english_reading = unit.english;
        JapaneseSyllable japanese;
        if (has_english_reading) {
            consonant = unit.english_consonant;
            vowel_index = unit.english_first_vowel;
            end_vowel_index = unit.english_end_vowel;
        } else if (has_japanese_reading) {
            japanese = parse_japanese(reading);
            consonant = japanese.consonant;
            vowel_index = japanese.first_vowel;
            end_vowel_index = japanese.end_vowel;
        } else if (has_mandarin_reading) {
            mandarin = parse_mandarin(reading);
            consonant = mandarin.consonant;
            vowel_index = mandarin.first_vowel;
            end_vowel_index = mandarin.end_vowel;
        } else if (vowel_index < 0) {
            consonant = consonant_for(codepoint);
            if (latin && index + 1 < units.size() && latin_vowel(units[index + 1].codepoint) >= 0 &&
                    !units[index + 1].mandarin) {
                vowel_index = latin_vowel(units[index + 1].codepoint);
                end_vowel_index = vowel_index;
                consumed.push_back(units[index + 1].codepoint);
                ++index;
            } else {
                vowel_index = latin ? 5 : static_cast<int>(codepoint % 5U);
                end_vowel_index = vowel_index;
            }
        }

        // Taken before the event starts, because any rests in front of the note
        // are what move the cursor to where it begins.
        MelodyNote note{};
        if (singing) { note = take_note(); }

        Event event;
        event.start = cursor;
        const double clarity = clamp(settings.clarity, 0.0, 1.0);
        // random.next() is still consumed when locked, so the phase and per-event
        // seeds below are unchanged and the voice keeps its character.
        const double duration_variation =
            (settings.tempo_lock || singing) ? 0.0 : 0.025 + (1.0 - clarity) * 0.12;
        // A Japanese mora is timed like a Mandarin syllable, not like a latin
        // letter, which is what makes tempo lock land on the beat in Japanese.
        //
        // English is stress-timed rather than syllable-timed: an unstressed
        // syllable is roughly half the length of a stressed one, and that
        // alternation is most of what makes it sound like English. Tempo lock
        // flattens it, because a beat grid and a stress pattern cannot both be
        // satisfied and the grid is what the user asked for.
        double base = 0.148;
        if (has_mandarin_reading || has_japanese_reading) {
            base = 0.188;
        } else if (has_english_reading) {
            base = settings.tempo_lock ? 0.188 : (unit.english_stressed ? 0.181 : 0.104);
        }
        const double duration = singing
            ? note_seconds(note)
            : base / speed * (1.0 - duration_variation * 0.5 + random.next() * duration_variation);
        event.length = std::max<std::size_t>(64, static_cast<std::size_t>(std::llround(duration * sample_rate)));
        if (singing) {
            event.sustained = true;
            event.note_length = event.length;
            // Absolute pitch, deliberately not multiplied by voice.pitch. A
            // preset's own register runs from 0.66 to 1.42, so applying it here
            // would transpose the written melody by up to a fifth and put two
            // characters singing the same tune in different keys. What makes a
            // character sound like itself is the vocal tract and the timbre,
            // which is also how it works in people.
            event.frequency = note_frequency(note);
            // The tone contour becomes the approach to the note rather than a
            // shape drawn across it. A held syllable cannot both keep its tone
            // and stay on pitch, and the melody is what was asked for — but
            // starting the note from where the tone would have started keeps
            // the diction recognisably Chinese, which is what singers do.
            double origin = previous_frequency > 0.0 ? previous_frequency : event.frequency;
            if (has_mandarin_reading && tone_blend > 0.0) {
                origin *= 1.0 + (tone_multiplier(mandarin.tone, 0.0) - 1.0) * tone_blend;
            }
            event.glide_from = origin;
            event.glide_seconds = std::min(portamento, duration * 0.5);
            event.level = velocity_level(note.velocity);
            previous_frequency = event.frequency;
        } else {
            const int note_span = 2 + static_cast<int>(std::llround(
                clamp(settings.cuteness, 0.0, 1.0) * (6.0 - clarity * 2.0)));
            const int wander = static_cast<int>((codepoint * 5U + index * 3U) %
                static_cast<std::uint32_t>(note_span * 2 + 1)) - note_span;
            event.frequency = 245.0 * voice.pitch * clamp(settings.pitch, 0.10, 6.0) *
                std::pow(2.0, wander / 24.0);
            // Length alone does not read as stress; the pitch has to move with it.
            if (has_english_reading && !settings.tempo_lock) {
                event.frequency *= unit.english_stressed ? 1.055 : 0.965;
            }
        }
        event.consonant = consonant;
        event.mandarin = has_mandarin_reading;
        event.tone = has_mandarin_reading ? mandarin.tone : 5;
        event.lexical_tone = has_mandarin_reading ? unit.lexical_tone : 5;
        event.source_codepoint = codepoint;
        event.source_units = std::move(consumed);
        event.reading = has_mandarin_reading || has_japanese_reading || has_english_reading
            ? std::string(reading) : std::string{};
        event.nasal_final = (has_mandarin_reading && mandarin.nasal_final) ||
            (has_japanese_reading && japanese.nasal_final);
        event.velar_nasal = has_mandarin_reading && mandarin.velar_nasal;
        // Sung, the consonant is a fixed gesture at the front of the note
        // rather than a fraction of it: a two-beat note does not get a two-beat
        // "s". It is still capped against the note so a short one is not all
        // consonant.
        const double onset_seconds = singing
            ? std::min(consonant_seconds(consonant), duration * 0.4)
            : consonant_seconds(consonant) / speed;
        event.onset = std::min(
            event.length - 24U,
            static_cast<std::size_t>(std::llround(onset_seconds * sample_rate)));
        event.phase = random.next() * kTwoPi;
        event.seed = static_cast<std::uint32_t>(random.next() * 2147483000.0) + 1U;
        build_vowel(event, vowel_index, end_vowel_index, voice, settings.source, sample_rate);
        if (singing) {
            held.valid = true;
            held.vowel = end_vowel_index;
            held.nasal_final = event.nasal_final;
            held.velar_nasal = event.velar_nasal;
            cursor = event.start + event.length;
            push_segmented(events, event, sample_rate);
        } else {
            event.note_length = event.length;
            events.push_back(event);
            cursor += event.length + static_cast<std::size_t>(std::llround(0.012 / speed * sample_rate));
        }
    }
    if (!events.empty()) {
        if (settings.emotion == Emotion::questioning) events.back().question_rise = true;
        if (settings.emotion == Emotion::angry) {
            for (auto& event : events) event.emphatic = true;
        }
    }
    cursor += static_cast<std::size_t>(std::llround(0.10 * sample_rate));
    return {events, cursor};
}

double shaped_noise(Event& event, double white, double brightness) {
    event.noise_low += 0.12 * (white - event.noise_low);
    const double high = 0.92 * (event.noise_high + white - event.noise_input);
    event.noise_input = white;
    event.noise_high = high;
    return event.noise_low * (1.0 - brightness) + high * brightness;
}

double render_consonant(Event& event, std::size_t local, double phase, Random& random, double sample_rate) {
    if (event.consonant.kind == ConsonantKind::none || event.onset <= 1U) {
        return 0.0;
    }
    const double progress = clamp(static_cast<double>(local) / event.onset, 0.0, 1.0);
    const double white = random.next() * 2.0 - 1.0;
    const double envelope = std::sin(kPi * progress);
    double sample = 0.0;
    switch (event.consonant.kind) {
        case ConsonantKind::stop:
        case ConsonantKind::voiced_stop: {
            const double release = event.consonant.aspirated ? 0.34 : 0.60;
            if (event.consonant.kind == ConsonantKind::voiced_stop && progress < release) {
                sample += std::sin(phase) * 0.14 * std::sin(kPi * progress / release);
            }
            if (progress >= release) {
                const double burst_progress = (progress - release) / (1.0 - release);
                const double burst_envelope = std::exp(-9.0 * burst_progress);
                const double burst_tone = std::sin(
                    kTwoPi * (1100.0 + event.consonant.place * 3200.0) * local / sample_rate);
                sample += (shaped_noise(event, white, 0.36 + event.consonant.place * 0.42) * 0.76 +
                    burst_tone * 0.15) * burst_envelope;
                if (event.consonant.aspirated) {
                    const double aspiration = std::sin(kPi * burst_progress) * 0.42;
                    sample += shaped_noise(event, white, 0.24) * aspiration;
                }
            }
            break;
        }
        case ConsonantKind::affricate: {
            const double release = event.consonant.aspirated ? 0.22 : 0.32;
            if (progress >= release) {
                const double friction = (progress - release) / (1.0 - release);
                const double brightness = event.consonant.retroflex ? 0.56 :
                    (0.58 + event.consonant.place * 0.30);
                const double friction_envelope = std::sin(kPi * std::pow(friction, 0.72));
                const double aspiration = event.consonant.aspirated ? (0.72 + 0.28 * friction) : 0.72;
                sample = shaped_noise(event, white, brightness) * friction_envelope * aspiration;
                if (friction < 0.14) {
                    sample += shaped_noise(event, white, 0.40) * (1.0 - friction / 0.14) * 0.42;
                }
            }
            break;
        }
        case ConsonantKind::fricative:
            sample = shaped_noise(event, white, 0.48) * envelope * 0.72;
            break;
        case ConsonantKind::sibilant: {
            const double brightness = event.consonant.retroflex ? 0.56 :
                (0.58 + event.consonant.place * 0.34);
            sample = shaped_noise(event, white, brightness) * envelope *
                (event.consonant.retroflex ? 0.72 : 0.82);
            break;
        }
        case ConsonantKind::nasal: {
            // The murmur grows into the vowel and must then release. Without
            // this tail every other class fades out at progress 1.0 but the
            // nasal held full amplitude for the rest of the syllable.
            const double tail = local >= event.onset
                ? clamp(1.0 - static_cast<double>(local - event.onset) /
                    static_cast<double>(event.onset + 1U), 0.0, 1.0)
                : 1.0;
            sample = (std::sin(phase) * 0.62 + std::sin(phase * 2.0) * 0.16) *
                (0.45 + 0.55 * progress) * tail;
            break;
        }
        case ConsonantKind::liquid: {
            const double liquid_phase = phase * (0.72 + progress * 0.28);
            sample = (std::sin(liquid_phase) * 0.65 + std::sin(liquid_phase * 2.0) * 0.15) * envelope;
            break;
        }
        case ConsonantKind::aspirate:
            sample = shaped_noise(event, white, 0.22) * envelope * 0.52;
            break;
        default:
            break;
    }
    return sample;
}

// How long the vibrato takes to reach full depth once it starts.
constexpr double kVibratoRampSeconds = 0.35;

// How long a sung vowel takes to finish gliding to its closing formants.
constexpr double kSungGlideSeconds = 0.090;

// The integral of min(u / ramp, 1) * sin(omega * u) from 0 to tau.
//
// Written out rather than approximated because the approximation is not small:
// treating the ramp as constant over a cycle leaves a term proportional to how
// fast the depth is growing, which at these rates is several percent of the
// fundamental — more than a semitone of pitch error while the vibrato fades in.
double vibrato_integral(double tau, double omega, double ramp) {
    if (tau <= 0.0 || omega <= 0.0) {
        return 0.0;
    }
    const double span = std::max(ramp, 1e-6);
    const auto at = [&](double value) {
        return (std::sin(omega * value) / (omega * omega) -
            value * std::cos(omega * value) / omega) / span;
    };
    if (tau <= span) {
        return at(tau);
    }
    return at(span) + (std::cos(omega * span) - std::cos(omega * tau)) / omega;
}

// Radians accumulated by a sung note up to `seconds` after the note began.
//
// The speaking engine writes the phase as frequency times elapsed time, with
// the vibrato and the tone contour folded in as multipliers. That is a
// shorthand, not an integral, and it holds up only because a spoken syllable
// lasts a fifth of a second: multiply the whole elapsed time by a vibrato
// factor and the pitch swing grows in proportion to how long the note is held,
// so a two-second note would wander a long way out of tune.
//
// Both terms here are real integrals of the instantaneous frequency, which
// makes this a pure function of note-global time — and that is what lets a held
// note be cut into segments with nothing audible at the joins.
double sung_phase(const Event& event, double seconds, double depth, double rate, double delay) {
    double integral = 0.0;
    if (event.glide_seconds > 0.0 && event.glide_from > 0.0 &&
            std::abs(event.glide_from - event.frequency) > 1e-9) {
        // Exponential in frequency, which is linear in pitch — the shape a
        // portamento actually has, and the only one whose integral is
        // elementary.
        const double k = std::log(event.frequency / event.glide_from) / event.glide_seconds;
        const double span = std::min(seconds, event.glide_seconds);
        integral = event.glide_from * (std::exp(k * span) - 1.0) / k;
        if (seconds > event.glide_seconds) {
            integral += event.frequency * (seconds - event.glide_seconds);
        }
    } else {
        integral = event.frequency * seconds;
    }
    if (depth > 0.0 && rate > 0.0) {
        integral += event.frequency * depth *
            vibrato_integral(seconds - delay, kTwoPi * rate, kVibratoRampSeconds);
    }
    return kTwoPi * integral + event.phase;
}

double tone_multiplier(std::uint8_t tone, double progress) {
    progress = clamp(progress, 0.0, 1.0);
    switch (tone) {
        case 1: return 1.105;
        case 2: return 0.84 + 0.30 * std::pow(progress, 1.20);
        case 3:
            return progress < 0.58
                ? 0.94 - 0.22 * (progress / 0.58)
                : 0.72 + 0.25 * ((progress - 0.58) / 0.42);
        case 4: return 1.16 - 0.43 * std::pow(progress, 0.78);
        default: return 0.96 - 0.04 * progress;
    }
}

double render_vowel(Event& event, std::size_t local, double phase, const Voice& voice,
        SourceType source, Random& random, double sample_rate) {
    // Segments of one held note carry their offset inside it, so everything
    // below can be written against the note rather than against the piece. For
    // anything the speaking engine produces the offset is zero and these are
    // the same number.
    const std::size_t note_local = event.time_offset + local;
    const std::size_t note_length = std::max<std::size_t>(1, event.note_length);
    const auto vowel_length = std::max<std::size_t>(1, note_length - std::min(note_length, event.onset));
    const auto vowel_index = note_local > event.onset ? note_local - event.onset : 0U;
    const double progress = clamp(static_cast<double>(vowel_index) / vowel_length, 0.0, 1.0);
    double fade_in;
    double fade_out;
    double transition;
    double decay;
    if (event.sustained) {
        // A held vowel is held, not stretched. Spreading the closing formants
        // over the whole note turns a two-second "ai" into a two-second swoop;
        // real singing finishes the glide early and then sits on the vowel.
        const double glide = clamp(
            static_cast<double>(vowel_index) / (sample_rate * kSungGlideSeconds), 0.0, 1.0);
        transition = glide * glide * (3.0 - 2.0 * glide);
        fade_in = event.seamless_start ? 1.0 : clamp(
            (static_cast<double>(note_local) - event.onset + sample_rate * 0.009) /
                (sample_rate * 0.018), 0.0, 1.0);
        fade_out = event.seamless_end ? 1.0 : clamp(
            static_cast<double>(note_length - std::min(note_length, note_local)) /
                (sample_rate * 0.030), 0.0, 1.0);
        // Settles a little and then stays there, instead of fading away across
        // the note the way a spoken syllable does.
        decay = 1.0 - 0.08 * clamp(
            static_cast<double>(vowel_index) / (sample_rate * 0.5), 0.0, 1.0);
    } else {
        fade_in = clamp(
            (static_cast<double>(local) - event.onset + sample_rate * 0.009) / (sample_rate * 0.018), 0.0, 1.0);
        fade_out = clamp(
            static_cast<double>(event.length - local) / (sample_rate * 0.022), 0.0, 1.0);
        transition = progress * progress * (3.0 - 2.0 * progress);
        decay = 1.0 - progress * 0.16;
    }
    const double envelope = fade_in * fade_out * decay;
    double voiced = 0.0;
    for (std::size_t index = 0; index < event.harmonic_count; ++index) {
        const double amplitude = event.harmonics[index] * (1.0 - transition) +
            event.end_harmonics[index] * transition;
        voiced += std::sin(phase * static_cast<double>(index + 1)) * amplitude;
    }
    // Everything past this point is a pure function of the event and the sample
    // offset within it, so syllables stay independent and the lazy renderer
    // still matches a single eager pass exactly (invariant 8d). The offset used
    // is the one inside the note, so the fixed oscillators below do not restart
    // — and therefore do not click — where a held note is cut into segments.
    switch (source) {
        case SourceType::metallic: {
            // Ring modulation against a fixed inharmonic carrier. Unrelated to
            // the pitch on purpose: that is what makes it read as a machine
            // rather than as a singer.
            const double carrier = std::sin(kTwoPi * 173.0 * note_local / sample_rate);
            voiced = voiced * carrier * 1.55;
            break;
        }
        case SourceType::granular: {
            // A fast gate chops the vowel into grains. Squaring the window
            // keeps the openings narrow, which is what sounds broken up rather
            // than merely tremolo'd.
            const double window = 0.5 + 0.5 * std::cos(kTwoPi * 47.0 * note_local / sample_rate);
            voiced *= 0.18 + window * window * 1.45;
            break;
        }
        case SourceType::growl: {
            // An octave below the fundamental. Real growls are a subharmonic
            // the folds fall into, and it reads as size more than as pitch.
            voiced = voiced * 0.82 + std::sin(phase * 0.5) * 0.42;
            break;
        }
        default:
            break;
    }
    std::array<double, 3> formant{};
    for (std::size_t index = 0; index < formant.size(); ++index) {
        formant[index] = event.formants[index] * (1.0 - transition) +
            event.end_formants[index] * transition;
    }
    const double formants =
        std::sin(kTwoPi * formant[0] * note_local / sample_rate + 0.3) * 0.065 +
        std::sin(kTwoPi * formant[1] * note_local / sample_rate + 1.1) * 0.042 +
        std::sin(kTwoPi * formant[2] * note_local / sample_rate + 2.0) * 0.022;
    const double breath = shaped_noise(event, random.next() * 2.0 - 1.0, 0.35) * voice.breath;
    const double buzz = voice.buzz > 0.0 ? std::sin(phase * 2.01) * voice.buzz : 0.0;
    double nasal = 0.0;
    double oral_gain = 1.0;
    if (event.nasal_final) {
        const double nasal_mix = clamp((progress - 0.66) / 0.30, 0.0, 1.0);
        const double nasal_frequency = event.velar_nasal ? 245.0 : 285.0;
        nasal = (std::sin(kTwoPi * nasal_frequency * note_local / sample_rate) * 0.16 +
            std::sin(kTwoPi * nasal_frequency * 2.0 * note_local / sample_rate) * 0.055) * nasal_mix;
        oral_gain -= nasal_mix * 0.34;
    }
    return ((voiced * 1.85 + formants + breath + buzz) * oral_gain + nasal) * envelope;
}

// Renders one syllable into `destination`, which must have room for
// event.length samples. Every event carries its own seed and filter state, so
// an event renders identically whether or not its neighbours were rendered.
// That independence is what makes the lazy block renderer in Utterance produce
// output identical to a single eager synthesize() call.
void render_event(Event& event, const Settings& settings, const Voice& voice, float* destination) {
    Random random(event.seed);
    const double vibrato_rate = clamp(settings.vibrato_rate, 0.0, 30.0);
    const double vibrato_delay = clamp(settings.vibrato_delay, 0.0, 4.0);
    for (std::size_t local = 0; local < event.length; ++local) {
        const double time = static_cast<double>(local) / settings.sample_rate;
        double phase;
        double attack;
        double release;
        if (event.sustained) {
            // Written against the note rather than the segment, so a seam falls
            // in the middle of a continuous phase and a continuous envelope.
            const std::size_t note_local = event.time_offset + local;
            const double note_time = static_cast<double>(note_local) / settings.sample_rate;
            phase = sung_phase(event, note_time, voice.wobble, vibrato_rate, vibrato_delay);
            attack = event.seamless_start
                ? 1.0
                : std::min(1.0, note_local / (settings.sample_rate * 0.002));
            release = event.seamless_end
                ? 1.0
                : std::min(1.0, (event.note_length - note_local) / (settings.sample_rate * 0.010));
        } else {
            const double progress = static_cast<double>(local) / event.length;
            attack = std::min(1.0, local / (settings.sample_rate * 0.002));
            release = std::min(1.0, (event.length - local) / (settings.sample_rate * 0.010));
            const double wobble = 1.0 + voice.wobble * std::sin(kTwoPi * vibrato_rate * time);
            const double lexical_gesture = event.mandarin ? tone_multiplier(event.tone, progress) :
                (1.0 + 0.018 * (0.5 - progress));
            const double question = event.question_rise
                ? 1.0 + 0.20 * std::pow(clamp((progress - 0.52) / 0.48, 0.0, 1.0), 1.35)
                : 1.0;
            const double emphasis_pitch = event.emphatic ? 1.0 + 0.045 * std::sin(kPi * progress) : 1.0;
            double gesture = lexical_gesture * question * emphasis_pitch;
            if (settings.emotion == Emotion::robot) {
                gesture = std::pow(2.0, std::round(std::log2(std::max(gesture, 0.01)) * 12.0) / 12.0);
            }
            phase = kTwoPi * event.frequency * wobble * gesture * time + event.phase;
        }
        const double consonant = render_consonant(event, local, phase, random, settings.sample_rate);
        const double vowel = render_vowel(
            event, local, phase, voice, settings.source, random, settings.sample_rate);
        const double clarity = clamp(settings.clarity, 0.0, 1.0);
        const double cute_softening = 1.0 - clamp(settings.cuteness, 0.0, 1.0) * 0.12;
        const double consonant_gain = (event.mandarin ? 0.68 + clarity * 0.28 : 1.0) * cute_softening;
        const double emphasis_gain = event.emphatic ? 1.12 : 1.0;
        // Volume is deliberately absent here: the utterance is rendered once at
        // kReferenceVolume and Volume is applied afterwards as a gain, so moving
        // the slider no longer invalidates the cache.
        const double mixed = (consonant * clamp(settings.consonant, 0.0, 6.0) * consonant_gain + vowel) *
            attack * release * kReferenceVolume * emphasis_gain * event.level;
        destination[local] = static_cast<float>((2.0 / kPi) * std::atan(mixed) * 0.915);
    }
}

double output_gain(const Settings& settings) {
    return clamp(settings.volume, 0.0, 2.0) / kReferenceVolume;
}

// Transparent below kSoftKnee so the default Volume of 78% is bit-identical to
// the previous releases; above it the curve bends smoothly towards full scale
// instead of clipping.
float limited(float sample, double gain) {
    const double scaled = static_cast<double>(sample) * gain;
    const double magnitude = std::abs(scaled);
    if (magnitude <= kSoftKnee) {
        return static_cast<float>(scaled);
    }
    // Normalising by the same range the curve spans keeps the slope continuous
    // at the knee, so there is no audible corner where limiting begins.
    const double range = kOutputCeiling - kSoftKnee;
    const double shaped = kSoftKnee + range * std::tanh((magnitude - kSoftKnee) / range);
    return static_cast<float>(scaled < 0.0 ? -shaped : shaped);
}

Diagnostics describe(
    const std::vector<Event>& events, std::size_t sample_count, std::uint32_t sample_rate) {
    Diagnostics diagnostics;
    diagnostics.duration_seconds = static_cast<double>(sample_count) / sample_rate;
    for (const auto& event : events) {
        // A held note is several events and a melisma is one more, but the user
        // sang one syllable. Diagnostics is the only window the panel has, and
        // what it hands back becomes one marker, one mouth shape and one
        // Type-On step each — so a two-second note reported honestly as eight
        // segments would arrive as eight of all three.
        if (event.continues_previous && !diagnostics.start_samples.empty()) {
            diagnostics.length_samples.back() =
                event.start + event.length - diagnostics.start_samples.back();
            continue;
        }
        diagnostics.vowel_names.push_back(event.vowel_name);
        diagnostics.consonant_kinds.push_back(event.consonant.kind);
        diagnostics.readings.push_back(event.reading);
        diagnostics.source_codepoints.push_back(event.source_codepoint);
        diagnostics.source_units.push_back(event.source_units);
        diagnostics.start_samples.push_back(event.start);
        diagnostics.length_samples.push_back(event.length);
        diagnostics.lexical_tones.push_back(event.lexical_tone);
        diagnostics.tones.push_back(event.tone);
        diagnostics.frequencies.push_back(event.frequency);
        diagnostics.harmonic_counts.push_back(event.harmonic_count);
        diagnostics.top_formants.push_back(std::max(event.formants[2], event.end_formants[2]));
        if (event.mandarin) {
            ++diagnostics.mandarin_event_count;
        }
    }
    diagnostics.event_count = diagnostics.start_samples.size();
    return diagnostics;
}

void apply_output_gain(float* samples, std::size_t count, double gain) {
    if (gain == 1.0) {
        return;
    }
    for (std::size_t index = 0; index < count; ++index) {
        samples[index] = limited(samples[index], gain);
    }
}

}  // namespace

const std::vector<Voice>& voices() {
    return kVoices;
}

std::size_t syllable_count(const std::string& text, bool melody_mode) {
    Settings settings;
    settings.text = text;
    settings.melody_mode = melody_mode;
    Voice voice = kVoices[0];
    apply_character_style(settings, voice);
    // Planning is the cheap half — a few hundred microseconds — and nothing
    // here renders. The melody is deliberately left empty: the question is how
    // many notes this line wants, which is what the caller is about to decide.
    const auto planned = build_events(settings, voice);
    std::size_t syllables = 0;
    for (const auto& event : planned.first) {
        if (!event.continues_previous) {
            ++syllables;
        }
    }
    if (melody_mode) {
        // A melisma produces no event without a melody to hold on to, but it
        // does want a note, so it is counted here instead.
        for (const auto& unit : build_speech_units(text, true)) {
            if (unit.tie) {
                ++syllables;
            }
        }
    }
    return syllables;
}

Result synthesize(const Settings& requested) {
    Settings settings = requested;
    if (settings.sample_rate < 8000U || settings.sample_rate > 192000U) {
        throw std::invalid_argument("sample_rate must be between 8000 and 192000");
    }
    if (settings.text.size() > 10000U) {
        throw std::invalid_argument("text is too long");
    }
    Voice voice = kVoices[std::min(settings.voice_index, kVoices.size() - 1U)];
    apply_character_style(settings, voice);
    auto [events, sample_count] = build_events(settings, voice);
    if (sample_count > static_cast<std::size_t>(settings.sample_rate) * 600U) {
        throw std::invalid_argument("rendered audio exceeds 10 minutes");
    }

    Result result;
    result.samples.assign(sample_count, 0.0F);
    result.diagnostics = describe(events, sample_count, settings.sample_rate);

    for (auto& event : events) {
        render_event(event, settings, voice, result.samples.data() + event.start);
    }
    apply_output_gain(result.samples.data(), result.samples.size(), output_gain(settings));
    for (const float sample : result.samples) {
        result.diagnostics.peak = std::max(result.diagnostics.peak, std::abs(sample));
    }
    return result;
}

void copy_region(
    const Result& result,
    std::int64_t start_sample,
    float* destination,
    std::size_t frame_count,
    std::size_t channels) {
    if (destination == nullptr || channels == 0U) {
        return;
    }
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const std::int64_t source_index = start_sample + static_cast<std::int64_t>(frame);
        const float value = source_index >= 0 && static_cast<std::size_t>(source_index) < result.samples.size()
            ? result.samples[static_cast<std::size_t>(source_index)]
            : 0.0F;
        for (std::size_t channel = 0; channel < channels; ++channel) {
            destination[frame * channels + channel] = value;
        }
    }
}

struct Utterance::State {
    Settings settings;
    Voice voice{};
    std::vector<Event> events;
    std::size_t sample_count = 0;
    Diagnostics diagnostics;
    // Rendered at kReferenceVolume; Volume is applied when copying out.
    mutable std::vector<float> samples;
    mutable std::vector<char> rendered;
    mutable std::mutex mutex;
};

Utterance::Utterance(const Settings& requested) : state_(std::make_unique<State>()) {
    State& state = *state_;
    state.settings = requested;
    if (state.settings.sample_rate < 8000U || state.settings.sample_rate > 192000U) {
        throw std::invalid_argument("sample_rate must be between 8000 and 192000");
    }
    if (state.settings.text.size() > 10000U) {
        throw std::invalid_argument("text is too long");
    }
    state.voice = kVoices[std::min(state.settings.voice_index, kVoices.size() - 1U)];
    apply_character_style(state.settings, state.voice);
    auto [events, sample_count] = build_events(state.settings, state.voice);
    if (sample_count > static_cast<std::size_t>(state.settings.sample_rate) * 600U) {
        throw std::invalid_argument("rendered audio exceeds 10 minutes");
    }
    state.events = std::move(events);
    state.sample_count = sample_count;
    state.diagnostics = describe(state.events, sample_count, state.settings.sample_rate);
    state.samples.assign(sample_count, 0.0F);
    state.rendered.assign(state.events.size(), 0);
}

Utterance::~Utterance() = default;

std::size_t Utterance::sample_count() const {
    return state_->sample_count;
}

const Diagnostics& Utterance::diagnostics() const {
    return state_->diagnostics;
}

std::size_t Utterance::rendered_events() const {
    const std::lock_guard<std::mutex> lock(state_->mutex);
    std::size_t count = 0;
    for (const char flag : state_->rendered) {
        if (flag) ++count;
    }
    return count;
}

void Utterance::copy_region(
    std::int64_t start_sample,
    float* destination,
    std::size_t frame_count,
    std::size_t channels,
    double volume) const {
    if (destination == nullptr || channels == 0U) {
        return;
    }
    State& state = *state_;
    const std::int64_t last = start_sample + static_cast<std::int64_t>(frame_count);
    {
        // Render only the syllables this block actually touches, once each.
        const std::lock_guard<std::mutex> lock(state.mutex);
        for (std::size_t index = 0; index < state.events.size(); ++index) {
            if (state.rendered[index]) {
                continue;
            }
            Event& event = state.events[index];
            const auto event_start = static_cast<std::int64_t>(event.start);
            const auto event_end = event_start + static_cast<std::int64_t>(event.length);
            if (event_end <= start_sample || event_start >= last) {
                continue;
            }
            render_event(event, state.settings, state.voice, state.samples.data() + event.start);
            state.rendered[index] = 1;
        }
    }

    Settings scaled = state.settings;
    scaled.volume = volume;
    const double gain = output_gain(scaled);
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const std::int64_t source_index = start_sample + static_cast<std::int64_t>(frame);
        const float value =
            source_index >= 0 && static_cast<std::size_t>(source_index) < state.samples.size()
                ? limited(state.samples[static_cast<std::size_t>(source_index)], gain)
                : 0.0F;
        for (std::size_t channel = 0; channel < channels; ++channel) {
            destination[frame * channels + channel] = value;
        }
    }
}

}  // namespace island_chatter

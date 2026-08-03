#include "island_chatter/dsp.hpp"
#include "generated/mandarin_readings.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>

namespace island_chatter {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kTwoPi = kPi * 2.0;

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
    std::array<double, 12> harmonics{};
    std::array<double, 12> end_harmonics{};
    std::uint8_t tone = 5;
    std::uint8_t lexical_tone = 5;
    std::uint32_t source_codepoint = 0;
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
};

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

bool is_space(std::uint32_t codepoint) {
    return codepoint == 0x20U || codepoint == 0x09U || codepoint == 0x0AU ||
        codepoint == 0x0DU || codepoint == 0x3000U;
}

bool is_punctuation(std::uint32_t codepoint) {
    if (codepoint >= 0x3000U && codepoint <= 0x303FU) {
        return true;
    }
    switch (codepoint) {
        case '.': case ',': case '!': case '?': case ';': case ':': case '-':
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

std::string_view mandarin_reading(std::uint32_t codepoint) {
    const auto& entries = generated::kMandarinReadings;
    const auto found = std::lower_bound(
        entries.begin(), entries.end(), codepoint,
        [](const generated::MandarinReadingEntry& entry, std::uint32_t value) {
            return entry.codepoint < value;
        });
    if (found == entries.end() || found->codepoint != codepoint) {
        return {};
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

void build_vowel_profile(
    int vowel_index,
    const Voice& voice,
    double frequency,
    std::array<double, 3>& formants,
    std::array<double, 12>& harmonics) {
    const auto& vowel = kVowels[static_cast<std::size_t>(vowel_index)];
    std::array<double, 3> bandwidths{};
    for (std::size_t index = 0; index < 3; ++index) {
        formants[index] = vowel.formants[index] * voice.tract;
        bandwidths[index] = vowel.bandwidths[index] * voice.tract;
    }
    double total = 0.0;
    for (std::size_t index = 0; index < harmonics.size(); ++index) {
        const double harmonic = static_cast<double>(index + 1);
        const double harmonic_frequency = frequency * harmonic;
        double resonance = 0.035;
        for (std::size_t formant = 0; formant < 3; ++formant) {
            resonance += gaussian(harmonic_frequency - formants[formant], bandwidths[formant]);
        }
        harmonics[index] = resonance / std::pow(harmonic, 0.72);
        total += harmonics[index];
    }
    if (total <= std::numeric_limits<double>::epsilon()) {
        total = 1.0;
    }
    for (auto& amplitude : harmonics) {
        amplitude /= total;
    }
}

void build_vowel(Event& event, int first_vowel, int end_vowel, const Voice& voice) {
    event.vowel_name = kVowels[static_cast<std::size_t>(first_vowel)].name;
    build_vowel_profile(first_vowel, voice, event.frequency, event.formants, event.harmonics);
    build_vowel_profile(end_vowel, voice, event.frequency, event.end_formants, event.end_harmonics);
}

struct SpeechUnit {
    std::uint32_t codepoint = 0;
    std::string reading;
    double pause_seconds = 0.0;
    bool mandarin = false;
    bool question = false;
    bool emphatic = false;
    std::uint8_t lexical_tone = 5;
};

struct PhrasePronunciation {
    const char32_t* text;
    const char* readings;
};

// Phrase-level entries override Unihan's single-character kMandarin value.
// Keep this list deliberately compact and auditable; user overrides handle
// names and uncommon readings without requiring a full word segmenter.
constexpr std::array<PhrasePronunciation, 24> kPhrasePronunciations{{
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
            current.push_back(character == 'u' ? 'u' : character);
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

std::vector<SpeechUnit> build_speech_units(const std::string& text) {
    const auto codepoints = decode_utf8(text);
    std::vector<SpeechUnit> units;
    for (std::size_t index = 0; index < codepoints.size();) {
        const auto codepoint = codepoints[index];
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
                const auto readings = split_readings(override_text);
                const auto character_count = bar - index - 1;
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
        const auto next_tone = reading_tone(units[next].reading);
        auto tone = reading_tone(units[index].reading);
        if (tone == 3 && next_tone == 3) {
            replace_reading_tone(units[index].reading, 2);
        } else if (units[index].codepoint == U'一') {
            replace_reading_tone(units[index].reading, next_tone == 4 ? 2 : 4);
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

std::pair<std::vector<Event>, std::size_t> build_events(const Settings& settings, const Voice& voice) {
    const auto units = build_speech_units(settings.text);
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
    const double speed = clamp(settings.speed, 0.25, 4.0);
    const auto sample_rate = static_cast<double>(settings.sample_rate);

    for (std::size_t index = 0; index < units.size(); ++index) {
        const auto& unit = units[index];
        const auto codepoint = unit.codepoint;
        if (unit.pause_seconds > 0.0) {
            if (!events.empty()) {
                events.back().question_rise = events.back().question_rise || unit.question;
                events.back().emphatic = events.back().emphatic || unit.emphatic;
            }
            cursor += static_cast<std::size_t>(
                std::llround(unit.pause_seconds / speed * sample_rate));
            continue;
        }

        int vowel_index = latin_vowel(codepoint);
        int end_vowel_index = vowel_index;
        Consonant consonant{};
        const bool latin = ascii_lower(codepoint) != '\0';
        MandarinSyllable mandarin;
        const std::string_view reading(unit.reading);
        const bool has_mandarin_reading = unit.mandarin && !reading.empty();
        if (has_mandarin_reading) {
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
                ++index;
            } else {
                vowel_index = latin ? 5 : static_cast<int>(codepoint % 5U);
                end_vowel_index = vowel_index;
            }
        }

        Event event;
        event.start = cursor;
        const double clarity = clamp(settings.clarity, 0.0, 1.0);
        const double duration_variation = 0.025 + (1.0 - clarity) * 0.12;
        const double duration = (has_mandarin_reading ? 0.188 : 0.148) / speed *
            (1.0 - duration_variation * 0.5 + random.next() * duration_variation);
        event.length = std::max<std::size_t>(64, static_cast<std::size_t>(std::llround(duration * sample_rate)));
        const int note_span = 2 + static_cast<int>(std::llround(
            clamp(settings.cuteness, 0.0, 1.0) * (6.0 - clarity * 2.0)));
        const int note = static_cast<int>((codepoint * 5U + index * 3U) %
            static_cast<std::uint32_t>(note_span * 2 + 1)) - note_span;
        event.frequency = 245.0 * voice.pitch * clamp(settings.pitch, 0.25, 4.0) * std::pow(2.0, note / 24.0);
        event.consonant = consonant;
        event.mandarin = has_mandarin_reading;
        event.tone = has_mandarin_reading ? mandarin.tone : 5;
        event.lexical_tone = has_mandarin_reading ? unit.lexical_tone : 5;
        event.source_codepoint = codepoint;
        event.reading = has_mandarin_reading ? std::string(reading) : std::string{};
        event.nasal_final = has_mandarin_reading && mandarin.nasal_final;
        event.velar_nasal = has_mandarin_reading && mandarin.velar_nasal;
        event.onset = std::min(
            event.length - 24U,
            static_cast<std::size_t>(std::llround(consonant_seconds(consonant) / speed * sample_rate)));
        event.phase = random.next() * kTwoPi;
        event.seed = static_cast<std::uint32_t>(random.next() * 2147483000.0) + 1U;
        build_vowel(event, vowel_index, end_vowel_index, voice);
        events.push_back(event);
        cursor += event.length + static_cast<std::size_t>(std::llround(0.012 / speed * sample_rate));
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
        case ConsonantKind::nasal:
            sample = (std::sin(phase) * 0.62 + std::sin(phase * 2.0) * 0.16) * (0.45 + 0.55 * progress);
            break;
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

double render_vowel(Event& event, std::size_t local, double phase, const Voice& voice, Random& random, double sample_rate) {
    const auto vowel_length = std::max<std::size_t>(1, event.length - event.onset);
    const auto vowel_index = local > event.onset ? local - event.onset : 0U;
    const double progress = clamp(static_cast<double>(vowel_index) / vowel_length, 0.0, 1.0);
    const double fade_in = clamp(
        (static_cast<double>(local) - event.onset + sample_rate * 0.009) / (sample_rate * 0.018), 0.0, 1.0);
    const double fade_out = clamp(
        static_cast<double>(event.length - local) / (sample_rate * 0.022), 0.0, 1.0);
    const double envelope = fade_in * fade_out * (1.0 - progress * 0.16);
    const double transition = progress * progress * (3.0 - 2.0 * progress);
    double voiced = 0.0;
    for (std::size_t index = 0; index < event.harmonics.size(); ++index) {
        const double amplitude = event.harmonics[index] * (1.0 - transition) +
            event.end_harmonics[index] * transition;
        voiced += std::sin(phase * static_cast<double>(index + 1)) * amplitude;
    }
    std::array<double, 3> formant{};
    for (std::size_t index = 0; index < formant.size(); ++index) {
        formant[index] = event.formants[index] * (1.0 - transition) +
            event.end_formants[index] * transition;
    }
    const double formants =
        std::sin(kTwoPi * formant[0] * local / sample_rate + 0.3) * 0.065 +
        std::sin(kTwoPi * formant[1] * local / sample_rate + 1.1) * 0.042 +
        std::sin(kTwoPi * formant[2] * local / sample_rate + 2.0) * 0.022;
    const double breath = shaped_noise(event, random.next() * 2.0 - 1.0, 0.35) * voice.breath;
    const double buzz = voice.buzz > 0.0 ? std::sin(phase * 2.01) * voice.buzz : 0.0;
    double nasal = 0.0;
    double oral_gain = 1.0;
    if (event.nasal_final) {
        const double nasal_mix = clamp((progress - 0.66) / 0.30, 0.0, 1.0);
        const double nasal_frequency = event.velar_nasal ? 245.0 : 285.0;
        nasal = (std::sin(kTwoPi * nasal_frequency * local / sample_rate) * 0.16 +
            std::sin(kTwoPi * nasal_frequency * 2.0 * local / sample_rate) * 0.055) * nasal_mix;
        oral_gain -= nasal_mix * 0.34;
    }
    return ((voiced * 1.85 + formants + breath + buzz) * oral_gain + nasal) * envelope;
}

}  // namespace

const std::vector<Voice>& voices() {
    return kVoices;
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
    result.diagnostics.event_count = events.size();
    result.diagnostics.duration_seconds = static_cast<double>(sample_count) / settings.sample_rate;
    for (const auto& event : events) {
        result.diagnostics.vowel_names.push_back(event.vowel_name);
        result.diagnostics.consonant_kinds.push_back(event.consonant.kind);
        result.diagnostics.readings.push_back(event.reading);
        result.diagnostics.source_codepoints.push_back(event.source_codepoint);
        result.diagnostics.start_samples.push_back(event.start);
        result.diagnostics.length_samples.push_back(event.length);
        result.diagnostics.lexical_tones.push_back(event.lexical_tone);
        result.diagnostics.tones.push_back(event.tone);
        if (event.mandarin) {
            ++result.diagnostics.mandarin_event_count;
        }
    }

    for (auto& event : events) {
        Random random(event.seed);
        for (std::size_t local = 0; local < event.length; ++local) {
            const double time = static_cast<double>(local) / settings.sample_rate;
            const double progress = static_cast<double>(local) / event.length;
            const double attack = std::min(1.0, local / (settings.sample_rate * 0.002));
            const double release = std::min(1.0, (event.length - local) / (settings.sample_rate * 0.010));
            const double wobble = 1.0 + voice.wobble * std::sin(kTwoPi * 9.2 * time);
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
            const double phase = kTwoPi * event.frequency * wobble * gesture * time + event.phase;
            const double consonant = render_consonant(event, local, phase, random, settings.sample_rate);
            const double vowel = render_vowel(event, local, phase, voice, random, settings.sample_rate);
            const double clarity = clamp(settings.clarity, 0.0, 1.0);
            const double cute_softening = 1.0 - clamp(settings.cuteness, 0.0, 1.0) * 0.12;
            const double consonant_gain = (event.mandarin ? 0.68 + clarity * 0.28 : 1.0) * cute_softening;
            const double emphasis_gain = event.emphatic ? 1.12 : 1.0;
            const double mixed = (consonant * clamp(settings.consonant, 0.0, 4.0) * consonant_gain + vowel) *
                attack * release * clamp(settings.volume, 0.0, 1.0) * emphasis_gain;
            const float sample = static_cast<float>((2.0 / kPi) * std::atan(mixed) * 0.915);
            result.samples[event.start + local] = sample;
            result.diagnostics.peak = std::max(result.diagnostics.peak, std::abs(sample));
        }
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

}  // namespace island_chatter

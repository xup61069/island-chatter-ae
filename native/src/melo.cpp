// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
#include "island_chatter/melo.hpp"

#include "generated/melo_phonemes.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <sstream>
#include <string>

namespace island_chatter::melo {
namespace {

// --- UTF-8, one code point at a time -----------------------------------------

struct Character {
    std::uint32_t code = 0;
    std::size_t begin = 0;      // byte offset in the source
    std::size_t length = 1;
};

std::vector<Character> decode(const std::string& text) {
    std::vector<Character> out;
    std::size_t index = 0;
    while (index < text.size()) {
        const auto lead = static_cast<unsigned char>(text[index]);
        std::size_t length = 1;
        std::uint32_t code = lead;
        if ((lead & 0xE0U) == 0xC0U) { length = 2; code = lead & 0x1FU; }
        else if ((lead & 0xF0U) == 0xE0U) { length = 3; code = lead & 0x0FU; }
        else if ((lead & 0xF8U) == 0xF0U) { length = 4; code = lead & 0x07U; }
        if (index + length > text.size()) { length = 1; code = lead; }
        for (std::size_t step = 1; step < length; ++step) {
            const auto next = static_cast<unsigned char>(text[index + step]);
            if ((next & 0xC0U) != 0x80U) { length = 1; code = lead; break; }
            code = (code << 6) | (next & 0x3FU);
        }
        out.push_back(Character{code, index, length});
        index += length;
    }
    return out;
}

std::string encode(std::uint32_t code) {
    std::string out;
    if (code <= 0x7FU) { out.push_back(static_cast<char>(code)); }
    else if (code <= 0x7FFU) {
        out.push_back(static_cast<char>(0xC0U | (code >> 6)));
        out.push_back(static_cast<char>(0x80U | (code & 0x3FU)));
    } else if (code <= 0xFFFFU) {
        out.push_back(static_cast<char>(0xE0U | (code >> 12)));
        out.push_back(static_cast<char>(0x80U | ((code >> 6) & 0x3FU)));
        out.push_back(static_cast<char>(0x80U | (code & 0x3FU)));
    } else {
        out.push_back(static_cast<char>(0xF0U | (code >> 18)));
        out.push_back(static_cast<char>(0x80U | ((code >> 12) & 0x3FU)));
        out.push_back(static_cast<char>(0x80U | ((code >> 6) & 0x3FU)));
        out.push_back(static_cast<char>(0x80U | (code & 0x3FU)));
    }
    return out;
}

bool is_latin_letter(std::uint32_t code) {
    return (code >= 'a' && code <= 'z') || (code >= 'A' && code <= 'Z') || code == '\'';
}

bool is_digit(std::uint32_t code) { return code >= '0' && code <= '9'; }

// Everything the engine is the reader for: Han, the compatibility block, Zhuyin
// and 〇, which is a number rather than a Han character but is read as one.
bool is_engine_character(std::uint32_t code) {
    return (code >= 0x3400U && code <= 0x9FFFU) ||
           (code >= 0xF900U && code <= 0xFAFFU) ||
           (code >= 0x3105U && code <= 0x312FU) ||
           code == 0x3007U;
}

// --- numbers -----------------------------------------------------------------

const char* const kDigitNames[] = {"零", "一", "二", "三", "四", "五", "六",
                                   "七", "八", "九"};

std::string digit_by_digit(const std::string& digits) {
    std::string out;
    for (const char digit : digits) { out += kDigitNames[static_cast<std::size_t>(digit - '0')]; }
    return out;
}

/*
 * A number, read the way it is said rather than the way it is written.
 *
 * Grouped in four digits because Chinese groups in four: 萬 and 億 are the
 * places the units restart, which is why this is a loop over groups rather than
 * the three-digit one an English reader would write. Within a group, a zero
 * before any remaining non-zero digit becomes exactly one 零 however many there
 * were — 一千零五, not 一千零零五 — and 一十 shortens to 十 at the front of the
 * whole number, which is how 15 is said.
 */
std::string spell_group(const std::string& group, bool leading_group) {
    static const char* const kUnits[] = {"", "十", "百", "千"};
    std::string out;
    bool pending_zero = false;
    const std::size_t size = group.size();
    for (std::size_t index = 0; index < size; ++index) {
        const int digit = group[index] - '0';
        const std::size_t place = size - index - 1;
        if (digit == 0) { pending_zero = !out.empty(); continue; }
        if (pending_zero) { out += kDigitNames[0]; pending_zero = false; }
        // 十五 rather than 一十五, but only where nothing precedes it: 一百一十五
        // keeps its 一 because the 十 is not the first thing said.
        const bool bare_ten = leading_group && out.empty() && place == 1 && digit == 1;
        if (!bare_ten) { out += kDigitNames[static_cast<std::size_t>(digit)]; }
        out += kUnits[place];
    }
    return out;
}

std::string spell_number(const std::string& digits) {
    static const char* const kScales[] = {"", "萬", "億", "兆"};
    if (digits.empty()) { return {}; }
    if (digits.size() > 12 || (digits.size() > 1 && digits[0] == '0')) {
        // Longer than 兆 has no agreed reading, and a leading zero says this is
        // an identifier rather than a quantity. Both are read as digits.
        return digit_by_digit(digits);
    }
    if (digits == "0") { return kDigitNames[0]; }
    std::vector<std::string> groups;
    for (std::size_t end = digits.size(); end > 0;) {
        const std::size_t begin = end >= 4 ? end - 4 : 0;
        groups.push_back(digits.substr(begin, end - begin));
        end = begin;
    }
    std::string out;
    for (std::size_t index = groups.size(); index > 0; --index) {
        const std::string& group = groups[index - 1];
        const bool leading = index == groups.size();
        const std::string spelled = spell_group(group, leading);
        if (spelled.empty()) { continue; }
        // A group that starts with a zero needs the 零 that its own leading
        // zeros were dropped with: 一百萬零五.
        if (!out.empty() && group[0] == '0') { out += kDigitNames[0]; }
        out += spelled;
        out += kScales[index - 1];
    }
    return out;
}

}  // namespace

// --- the pieces the header exposes -------------------------------------------

std::string normalise_numbers(const std::string& utf8_text) {
    const auto characters = decode(utf8_text);
    std::string out;
    std::size_t index = 0;
    int bracket_depth = 0;
    while (index < characters.size()) {
        const auto& here = characters[index];
        if (here.code == '[') { bracket_depth += 1; }
        if (here.code == ']' && bracket_depth > 0) { bracket_depth -= 1; }
        if (bracket_depth > 0 || here.code == ']' || !is_digit(here.code)) {
            out += utf8_text.substr(here.begin, here.length);
            index += 1;
            continue;
        }
        std::string digits;
        while (index < characters.size() && is_digit(characters[index].code)) {
            digits.push_back(static_cast<char>(characters[index].code));
            index += 1;
        }
        // A thousands separator is part of the number, not a pause. Only when
        // it is followed by exactly three digits: 1,000 is a number and
        // "10,0000" is two of them with a comma between.
        for (;;) {
            if (index + 3 >= characters.size() || characters[index].code != ',') { break; }
            if (!is_digit(characters[index + 1].code) || !is_digit(characters[index + 2].code) ||
                !is_digit(characters[index + 3].code)) { break; }
            if (index + 4 < characters.size() && is_digit(characters[index + 4].code)) { break; }
            for (std::size_t step = 1; step <= 3; ++step) {
                digits.push_back(static_cast<char>(characters[index + step].code));
            }
            index += 4;
        }
        const bool before_year = index < characters.size() && characters[index].code == 0x5E74U;
        out += (digits.size() == 4 && before_year) ? digit_by_digit(digits) : spell_number(digits);
        // A decimal point is only a decimal point between two digits; at the
        // end of a sentence it is a full stop, and folding it onto 點 there
        // would put the word "point" in the middle of the pause.
        if (index + 1 < characters.size() && is_digit(characters[index + 1].code) &&
            (characters[index].code == '.' || characters[index].code == 0xFF0EU)) {
            out += "點";
            index += 1;
            std::string fraction;
            while (index < characters.size() && is_digit(characters[index].code)) {
                fraction.push_back(static_cast<char>(characters[index].code));
                index += 1;
            }
            out += digit_by_digit(fraction);
        }
    }
    return out;
}

const char* punctuation_token(std::uint32_t code) {
    switch (code) {
        // Everything that reads as a short pause folds onto the comma. The
        // model has seven punctuation tokens and nothing finer to fold onto.
        case 0xFF0CU: case 0x3001U: case 0xFF1BU: case 0xFF1AU:
        case ',': case ';': case ':':
        case 0xFF08U: case 0xFF09U: case '(': case ')':
        case 0x300AU: case 0x300BU: case 0x3010U: case 0x3011U:
            return ",";
        case 0x3002U: case 0xFF0EU: case '.':
            return ".";
        case 0xFF01U: case '!':
            return "!";
        case 0xFF1FU: case '?':
            return "?";
        case 0x2026U:
            return "…";
        case 0x2014U: case 0x2015U: case 0xFF0DU: case '-': case 0xFF5EU: case '~':
            return "-";
        case 0x201CU: case 0x201DU: case 0x2018U: case 0x2019U: case '"':
            return "'";
        default:
            return nullptr;
    }
}

std::pair<std::string_view, std::string_view> phones_for_pinyin(std::string_view syllable) {
    const auto& table = generated::kMeloSyllables;
    const auto found = std::lower_bound(
        table.begin(), table.end(), syllable,
        [](const generated::MeloSyllable& row, std::string_view value) {
            return row.pinyin < value;
        });
    if (found == table.end() || found->pinyin != syllable) { return {}; }
    return {found->initial, found->final_phone};
}

std::vector<std::int64_t> intersperse(const std::vector<std::int64_t>& values) {
    std::vector<std::int64_t> out(values.size() * 2 + 1, 0);
    for (std::size_t index = 0; index < values.size(); ++index) {
        out[index * 2 + 1] = values[index];
    }
    return out;
}

Tokens Tokens::parse(const std::string& text) {
    Tokens out;
    std::istringstream stream(text);
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') { line.pop_back(); }
        const auto gap = line.rfind(' ');
        if (gap == std::string::npos || gap + 1 >= line.size()) { continue; }
        try {
            out.ids_.emplace(line.substr(0, gap), std::stoi(line.substr(gap + 1)));
        } catch (const std::exception&) { /* a line that is not "phone id" */ }
    }
    return out;
}

int Tokens::id(std::string_view phone) const {
    const auto found = ids_.find(std::string(phone));
    return found == ids_.end() ? -1 : found->second;
}

Lexicon Lexicon::parse(const std::string& text, Language language) {
    Lexicon out;
    const bool keep_everything = language == Language::Japanese;
    /*
     * Scanned as views rather than read line by line into strings.
     *
     * This file is 6.8 MB and 195,828 lines, and 190,000 of them are Chinese
     * words the Latin half never asks about. Reading each into a std::string
     * and then splitting it with a stringstream costs 1.7 s — a quarter of what
     * a whole line of dialogue costs to render, spent deciding to throw the
     * line away. Looking at the first byte first, and allocating only for the
     * lines that survive it, costs 90 ms.
     */
    std::string_view remaining(text);
    while (!remaining.empty()) {
        const auto break_at = remaining.find('\n');
        std::string_view line = remaining.substr(0, break_at);
        remaining = break_at == std::string_view::npos ? std::string_view()
                                                       : remaining.substr(break_at + 1);
        if (!line.empty() && line.back() == '\r') { line.remove_suffix(1); }
        if (line.empty()) { continue; }
        if (!keep_everything && static_cast<unsigned char>(line[0]) > 0x7FU) { continue; }
        std::istringstream fields{std::string(line)};
        std::string word;
        if (!(fields >> word)) { continue; }
        std::vector<std::string> rest;
        std::string field;
        while (fields >> field) { rest.push_back(field); }
        // The line is a word, then n phones, then n tones. An odd count means
        // the halves cannot be what this claims, so the line is skipped rather
        // than split somewhere arbitrary.
        if (rest.size() < 2 || rest.size() % 2 != 0) { continue; }
        // From the Chinese model, only the Latin half is kept: the other
        // 190,000 keys are Simplified words this never asks about — the engine
        // reads Chinese — and holding them costs about 40 MB of hash table for
        // nothing. From the Japanese model everything is kept, because there
        // the lexicon *is* the reader.
        bool latin = !word.empty();
        for (const char letter : word) {
            const auto code = static_cast<unsigned char>(letter);
            if (code > 0x7FU) { latin = false; break; }
        }
        if (!latin && !keep_everything) { continue; }
        const std::size_t half = rest.size() / 2;
        Entry entry;
        entry.phones.assign(rest.begin(), rest.begin() + static_cast<std::ptrdiff_t>(half));
        for (std::size_t index = half; index < rest.size(); ++index) {
            try { entry.tones.push_back(std::stoi(rest[index])); }
            catch (const std::exception&) { entry.tones.clear(); break; }
        }
        if (entry.tones.size() != entry.phones.size()) { continue; }
        std::string key = word;
        if (latin) {
            for (char& letter : key) {
                letter = static_cast<char>(std::tolower(static_cast<unsigned char>(letter)));
            }
            out.longest_latin_ = std::max(out.longest_latin_, key.size());
        }
        // Code points, not bytes: the greedy match over Japanese walks
        // characters, and 日本 is two characters and six bytes. A bound in the
        // wrong unit is a bound that either does too much work or misses the
        // longest word in the file.
        out.longest_word_ = std::max(out.longest_word_, decode(key).size());
        out.words_.emplace(std::move(key), std::move(entry));
    }
    return out;
}

const Lexicon::Entry* Lexicon::find(const std::string& word) const {
    const auto found = words_.find(word);
    return found == words_.end() ? nullptr : &found->second;
}

namespace {

/*
 * One run of Chinese, read by the engine and translated syllable by syllable.
 *
 * `readings` is the same field the panel's markers are labelled from, so a
 * syllable that comes out here as `hang2` is the one the built-in voice says
 * and the one the marker shows. Tone is taken off the end of that string rather
 * than out of Diagnostics::tones, because the string is what carries sandhi —
 * 不 before a fourth tone is `bu2` there and the panel shows `bu2`.
 */
void append_chinese(const std::string& run, const Settings& base, const Tokens& tokens,
                    std::vector<std::int64_t>& out_tokens,
                    std::vector<std::int64_t>& out_tones,
                    std::string& unspoken, std::size_t& syllables) {
    if (run.empty()) { return; }
    Settings settings = base;
    settings.text = run;
    // A melody would make the engine plan notes, and this is not that renderer.
    settings.melody.clear();
    settings.melody_mode = false;
    const Utterance utterance(settings);
    const auto& diagnostics = utterance.diagnostics();
    for (std::size_t index = 0; index < diagnostics.readings.size(); ++index) {
        const std::string& reading = diagnostics.readings[index];
        std::string source;
        if (index < diagnostics.source_units.size()) {
            for (const std::uint32_t code : diagnostics.source_units[index]) {
                source += encode(code);
            }
        }
        const bool toned = reading.size() >= 2 && reading.back() >= '1' && reading.back() <= '5';
        if (!toned) { unspoken += source; continue; }
        const std::int64_t tone = reading.back() - '0';
        const auto [initial, final_phone] = phones_for_pinyin(reading.substr(0, reading.size() - 1));
        const int initial_id = initial.empty() ? -1 : tokens.id(initial);
        const int final_id = final_phone.empty() ? -1 : tokens.id(final_phone);
        if (initial_id < 0 || final_id < 0) { unspoken += source; continue; }
        out_tokens.push_back(initial_id);
        out_tokens.push_back(final_id);
        out_tones.push_back(tone);
        out_tones.push_back(tone);
        syllables += 1;
    }
}

/*
 * Japanese, read by the model's own lexicon rather than by the engine.
 *
 * This is the one place invariant 8ac's rule is deliberately the other way
 * round, and the reasons are specific to Japanese rather than a change of mind.
 * The engine reads kana and refuses kanji — 8h: a kanji's reading depends on
 * the word, and this product has no Japanese dictionary. The model brought one,
 * keyed by surface form: 今日 is `ky o`, 日本 is `n i q p o N`, 行く is `i k u`.
 * So here the lexicon can say something the engine cannot, and the argument for
 * the two voices agreeing does not apply — the built-in voice cannot say the
 * line at all.
 *
 * Greedy longest match over code points, longest key first, so 日本 is one word
 * before 日 is. A character with no entry is reported rather than guessed: a
 * wrong reading is worse than a named gap, which is the same choice 8h made.
 */
void append_japanese(const std::vector<Character>& characters, std::size_t begin,
                     std::size_t end, const std::string& source,
                     const Lexicon& lexicon, const Tokens& tokens,
                     std::vector<std::int64_t>& out_tokens,
                     std::vector<std::int64_t>& out_tones,
                     std::string& unspoken, std::size_t& syllables) {
    std::size_t index = begin;
    while (index < end) {
        const std::size_t remaining = end - index;
        std::size_t span = std::min(lexicon.longest_word(), remaining);
        const Lexicon::Entry* entry = nullptr;
        std::size_t matched = 0;
        for (; span > 0; --span) {
            const std::size_t from = characters[index].begin;
            const auto& last = characters[index + span - 1];
            entry = lexicon.find(source.substr(from, last.begin + last.length - from));
            if (entry) { matched = span; break; }
        }
        if (!entry) {
            unspoken += source.substr(characters[index].begin, characters[index].length);
            index += 1;
            continue;
        }
        for (std::size_t step = 0; step < entry->phones.size(); ++step) {
            const int id = tokens.id(entry->phones[step]);
            if (id < 0) { continue; }
            out_tokens.push_back(id);
            out_tones.push_back(entry->tones[step]);
        }
        // One word is one syllable for counting purposes, the same way an
        // English word is: the count exists to say whether anything was said.
        syllables += 1;
        index += matched;
    }
}

// One run of Latin, read by the model's own lexicon. Greedy longest match, so
// "island" is a word before "is" is.
void append_latin(const std::string& run, const Lexicon& lexicon, const Tokens& tokens,
                  std::vector<std::int64_t>& out_tokens,
                  std::vector<std::int64_t>& out_tones,
                  std::string& unspoken, std::size_t& syllables) {
    std::string lowered = run;
    for (char& letter : lowered) {
        letter = static_cast<char>(std::tolower(static_cast<unsigned char>(letter)));
    }
    std::size_t index = 0;
    while (index < lowered.size()) {
        const std::size_t remaining = lowered.size() - index;
        std::size_t span = std::min(lexicon.longest_latin(), remaining);
        const Lexicon::Entry* entry = nullptr;
        for (; span > 0; --span) {
            entry = lexicon.find(lowered.substr(index, span));
            if (entry) { break; }
        }
        if (!entry) {
            unspoken += run.substr(index, 1);
            index += 1;
            continue;
        }
        for (std::size_t step = 0; step < entry->phones.size(); ++step) {
            const int id = tokens.id(entry->phones[step]);
            if (id < 0) { continue; }
            out_tokens.push_back(id);
            out_tones.push_back(entry->tones[step]);
        }
        syllables += 1;
        index += span;
    }
}

}  // namespace

Plan plan(const std::string& utf8_text, const Settings& settings,
          const Lexicon& lexicon, const Tokens& tokens, Language language) {
    Plan out;
    /*
     * The Japanese model reads everything it is given, in one pass.
     *
     * No number spelling: its lexicon has 1, 10, 100 and the rest as keys of
     * their own, so the greedy match reads them itself and 二零二六 — which is
     * what normalise_numbers() would produce — is not Japanese. No engine, no
     * Latin split, no `[...]` overrides: an override carries pinyin, which is
     * not a reading of anything here.
     */
    if (language == Language::Japanese) {
        const auto characters = decode(utf8_text);
        std::size_t run = 0;
        for (std::size_t index = 0; index <= characters.size(); ++index) {
            const bool at_end = index == characters.size();
            const std::uint32_t code = at_end ? 0 : characters[index].code;
            const char* mark = at_end ? nullptr : punctuation_token(code);
            const bool space = !at_end && (code == ' ' || code == '\t' || code == '\n' ||
                                           code == '\r' || code == 0x3000U);
            if (!at_end && !mark && !space) { continue; }
            append_japanese(characters, run, index, utf8_text, lexicon, tokens,
                            out.tokens, out.tones, out.unspoken, out.syllables);
            run = index + 1;
            if (mark) {
                const int id = tokens.id(mark);
                if (id >= 0) {
                    out.tokens.push_back(id);
                    out.tones.push_back(0);
                }
            }
        }
        out.tokens = intersperse(out.tokens);
        out.tones = intersperse(out.tones);
        return out;
    }

    const std::string normalised = normalise_numbers(utf8_text);
    const auto characters = decode(normalised);

    std::string chinese;
    std::string latin;
    auto flush = [&]() {
        append_chinese(chinese, settings, tokens, out.tokens, out.tones,
                       out.unspoken, out.syllables);
        chinese.clear();
        append_latin(latin, lexicon, tokens, out.tokens, out.tones,
                     out.unspoken, out.syllables);
        latin.clear();
    };

    std::size_t index = 0;
    while (index < characters.size()) {
        const auto& here = characters[index];
        const std::string text = normalised.substr(here.begin, here.length);
        // A pronunciation override is one unit of Chinese however much Latin is
        // inside it: `[重|chong2]` is a reading, not a word followed by a digit,
        // and only the engine knows what to do with it.
        if (here.code == '[') {
            if (!latin.empty()) { flush(); }
            std::size_t end = index;
            while (end < characters.size() && characters[end].code != ']') { end += 1; }
            if (end < characters.size()) {
                const auto& closing = characters[end];
                chinese += normalised.substr(here.begin,
                                             closing.begin + closing.length - here.begin);
                index = end + 1;
                continue;
            }
        }
        if (is_engine_character(here.code)) {
            if (!latin.empty()) { flush(); }
            chinese += text;
            index += 1;
            continue;
        }
        if (is_latin_letter(here.code) || is_digit(here.code)) {
            if (!chinese.empty()) { flush(); }
            latin += text;
            index += 1;
            continue;
        }
        if (const char* mark = punctuation_token(here.code)) {
            flush();
            const int id = tokens.id(mark);
            if (id >= 0) {
                out.tokens.push_back(id);
                out.tones.push_back(0);
            }
            index += 1;
            continue;
        }
        // Whitespace separates words and says nothing. Anything else — kana,
        // an emoji, a symbol — is reported rather than dropped. Kana reaching
        // here means the Chinese model was asked to say it; the Japanese model
        // is a separate download and a separate row in the menu.
        flush();
        if (here.code != ' ' && here.code != '\t' && here.code != '\n' &&
            here.code != '\r' && here.code != 0x3000U) {
            out.unspoken += text;
        }
        index += 1;
    }
    flush();

    out.tokens = intersperse(out.tokens);
    out.tones = intersperse(out.tones);
    return out;
}

}  // namespace island_chatter::melo

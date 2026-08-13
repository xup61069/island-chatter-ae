// Island Chatter — turning a line of the panel's text into what a neural voice
// model on this machine expects to be handed.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#include "island_chatter/dsp.hpp"

namespace island_chatter::melo {

/*
 * What this is, and why it is not the model's own front end.
 *
 * The model wants two integer sequences — a phone per position and a tone per
 * position — and nothing else. Producing them means deciding how the text is
 * read, and *this product already has something that decides that*: the engine,
 * with its Unihan table, its phrase table, its tone sandhi, its Zhuyin and its
 * `[重|chong2]` overrides. Invariant 8b is the record of what happens when a
 * second reader appears beside it — the panel had one until 1.0.10 and the two
 * could not agree even in principle.
 *
 * So the Chinese here is read by `island_chatter::dsp`, exactly as the built-in
 * voice reads it, and this file only translates the answer: pinyin to the two
 * phones the model spells that syllable with. The same line therefore comes out
 * with the same readings whichever voice speaks it, and an override typed for
 * one works for the other.
 *
 * The model's own lexicon is still used, for two things it is the authority on:
 * English words, which it carries with ARPA phones the engine has no notion of,
 * and the phone spellings themselves, which is what
 * `native/tools/generate-melo-phonemes.js` derived the syllable table from.
 *
 * Nothing in here runs on an audio thread — the offline voice is a bake with a
 * different renderer (invariant 8ab), so it is a file producer and nothing else.
 */

// tokens.txt: the model's phone inventory, phone -> id.
class Tokens {
public:
    static Tokens parse(const std::string& text);

    // -1 for a phone this model does not have, so a caller can name it rather
    // than substituting silence for it.
    int id(std::string_view phone) const;
    std::size_t size() const { return ids_.size(); }

private:
    std::unordered_map<std::string, int> ids_;
};

/*
 * Which language the model in front of us speaks, which decides who reads the
 * text.
 *
 * Not a panel setting and not a guess about the characters: it is a property of
 * the model the user chose from the voice-source menu. Invariant 8i's rule that
 * the interface language never reaches the engine still holds — this is not the
 * interface language, it is which of two downloaded models is being driven.
 */
enum class Language { Mandarin, Japanese };

/*
 * lexicon.txt, and how much of it is kept depends on which model it belongs to.
 *
 * For the Chinese model, only the Latin entries: its 190,000 Chinese keys are
 * Simplified words, this product is Traditional-first, and the engine reads
 * Chinese without needing them. Keeping them would cost about 40 MB of hash
 * table to answer no questions.
 *
 * For the Japanese model, all of it, and that is the whole reading path. Its
 * 13,700 keys are kana *and* common kanji — 今日, 日本, 私, 行く — which is
 * something the engine cannot do at all: invariant 8h says unmarked kanji keeps
 * its Mandarin reading, because a kanji's reading depends on the word and this
 * product has no Japanese dictionary. The model brought one.
 */
class Lexicon {
public:
    struct Entry {
        std::vector<std::string> phones;
        std::vector<int> tones;         // 7-11 for English, 6 for Japanese
    };

    static Lexicon parse(const std::string& text, Language language = Language::Mandarin);

    const Entry* find(const std::string& word) const;
    std::size_t size() const { return words_.size(); }
    // In bytes, and ASCII-only by construction, because it bounds the greedy
    // match over Latin runs and those are compared byte for byte.
    std::size_t longest_latin() const { return longest_latin_; }
    // In code points, because a Japanese key is Japanese text and the greedy
    // match over it walks characters rather than bytes.
    std::size_t longest_word() const { return longest_word_; }

private:
    std::unordered_map<std::string, Entry> words_;
    std::size_t longest_latin_ = 1;
    std::size_t longest_word_ = 1;
};

struct Plan {
    // Already blank-interspersed: the model expects a `_` between every pair of
    // phones and at both ends, which is what the VITS alignment was trained on.
    std::vector<std::int64_t> tokens;
    std::vector<std::int64_t> tones;
    // Characters nothing could read, in the order they appeared. The tool prints
    // them: a line that came out missing a word should say which word, rather
    // than leaving somebody to compare the audio against the script by ear.
    std::string unspoken;
    std::size_t syllables = 0;
};

/*
 * The whole conversion, and the only function the tool needs.
 *
 * `settings` is the voice the panel is holding. Only the fields that change the
 * *reading* matter here — the text and anything the engine's planner consults —
 * because pitch and timbre belong to a synthesizer this line is not going
 * through. It is taken whole rather than as a string so that a future engine
 * option that changes readings cannot be forgotten here.
 */
Plan plan(const std::string& utf8_text, const Settings& settings,
          const Lexicon& lexicon, const Tokens& tokens,
          Language language = Language::Mandarin);

/*
 * Digits, spelled out in Chinese before anything else sees them.
 *
 * sherpa-onnx did this with three OpenFST rule files shipped beside the model.
 * Dropping sherpa drops those, and dropping those without replacing them means
 * `2026年` is read as `年` — the digits reach the engine, produce no syllable
 * and vanish, which is the quiet kind of wrong this project keeps a whole
 * section of CLAUDE.md about.
 *
 * The rule: a four-digit run immediately before 年 is read digit by digit, as a
 * year is; everything else is read as a number, with 十百千萬億, up to twelve
 * digits. A run longer than that, or one with a leading zero, goes digit by
 * digit as well — an account number is not a quantity.
 *
 * Text inside `[...]` is left exactly as it is. A pronunciation override ends
 * in a tone digit, and `[重|chong2]` normalised as a number becomes
 * `[重|chong二]`, which is not a reading of anything.
 */
std::string normalise_numbers(const std::string& utf8_text);

/*
 * Which of the model's seven punctuation tokens a character folds onto.
 *
 * Punctuation is not decoration here: it is what produces the pauses, and the
 * pauses are what close the mouth once the analyser reads the finished WAV back
 * (invariant 8x). A comma that folds to nothing is a line that never shuts its
 * mouth. Null for a character that is not punctuation.
 */
const char* punctuation_token(std::uint32_t codepoint);

/*
 * The two phones for one toneless pinyin syllable, or two empty views.
 *
 * Empty is not an error the caller can ignore: it means this model cannot say
 * that syllable, and the character has to be reported instead of dropped. Four
 * syllables in Unihan land here — the syllabic nasals, which no Chinese word
 * needs — and `melo_tests.cpp` pins that the list has not grown.
 */
std::pair<std::string_view, std::string_view> phones_for_pinyin(std::string_view syllable);

// A blank between every pair and at both ends. Exposed because getting it wrong
// produces audio that is subtly, unlistenably fast rather than an error.
std::vector<std::int64_t> intersperse(const std::vector<std::int64_t>& values);

}  // namespace island_chatter::melo

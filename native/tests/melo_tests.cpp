// Island Chatter — tests for the offline voice's front end.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
//
// What is here is everything that decides what the model is handed: which
// reader read the Chinese, what the digits became, which token a comma folds
// onto and which two phones a syllable is spelled with. What is not here is
// ONNX Runtime, which lives in tools/local_cli.cpp and needs a 170 MB model on
// disk — so the split is drawn exactly where the testable part ends, the same
// place cloud_tests.cpp draws it.
//
// The model's own tokens.txt and lexicon.txt are not needed either: both are
// parsed from strings here, which is what lets these tests run on a machine
// that has never downloaded the model.

#include "island_chatter/melo.hpp"

#include "generated/melo_phonemes.hpp"

#include <algorithm>
#include <iostream>
#include <set>
#include <string>
#include <vector>

namespace {

namespace melo = island_chatter::melo;

namespace generated = island_chatter::generated;

int failures = 0;

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        failures += 1;
    }
}

void note(const std::string& message) { std::cout << "  " << message << '\n'; }

/*
 * The model's tokens.txt, verbatim.
 *
 * All 112 lines rather than the dozen these tests use, and with the real ids,
 * because it is the second copy the generated table is checked against: every
 * phone in `kMeloSyllables` has to be a phone this model actually has. Made-up
 * ids would still pass against a front end that had stopped looking anything
 * up, and a shortened list would call a real syllable a hole.
 */
melo::Tokens sample_tokens() {
    return melo::Tokens::parse(
        "_ 0\nAA 1\nE 2\nEE 3\nEn 4\nN 5\nOO 6\nV 7\na 8\na: 9\naa 10\n"
        "ae 11\nah 12\nai 13\nan 14\nang 15\nao 16\naw 17\nay 18\nb 19\n"
        "by 20\nc 21\nch 22\nd 23\ndh 24\ndy 25\ne 26\ne: 27\neh 28\nei 29\n"
        "en 30\neng 31\ner 32\ney 33\nf 34\ng 35\ngy 36\nh 37\nhh 38\nhy 39\n"
        "i 40\ni0 41\ni: 42\nia 43\nian 44\niang 45\niao 46\nie 47\nih 48\n"
        "in 49\ning 50\niong 51\nir 52\niu 53\niy 54\nj 55\njh 56\nk 57\n"
        "ky 58\nl 59\nm 60\nmy 61\nn 62\nng 63\nny 64\no 65\no: 66\nong 67\n"
        "ou 68\now 69\noy 70\np 71\npy 72\nq 73\nr 74\nry 75\ns 76\nsh 77\n"
        "t 78\nth 79\nts 80\nty 81\nu 82\nu: 83\nua 84\nuai 85\nuan 86\n"
        "uang 87\nuh 88\nui 89\nun 90\nuo 91\nuw 92\nv 93\nvan 94\nve 95\n"
        "vn 96\nw 97\nx 98\ny 99\nz 100\nzh 101\nzy 102\n! 103\n? 104\n"
        "… 105\n, 106\n. 107\n' 108\n- 109\nSP 110\nUNK 111\n");
}

// The two English words these tests need, in lexicon.txt's own format: word,
// then n phones, then n tones. English tones are the model's 7-11 offset.
melo::Lexicon sample_lexicon() {
    return melo::Lexicon::parse(
        "hello hh ah l ow 7 8 7 9\n"
        "is i0 z 7 7\n"
        "island ah i0 l an d 8 7 7 7 7\n");
}

std::vector<std::int64_t> spoken(const std::vector<std::int64_t>& interspersed) {
    // Undo the blanks, so a test can talk about the phones it asked for.
    std::vector<std::int64_t> out;
    for (std::size_t index = 1; index < interspersed.size(); index += 2) {
        out.push_back(interspersed[index]);
    }
    return out;
}

melo::Plan plan_of(const std::string& text) {
    island_chatter::Settings settings;
    return melo::plan(text, settings, sample_lexicon(), sample_tokens());
}

// --- the generated table ------------------------------------------------------

void test_table_is_the_models_own_spelling() {
    // Spot values, every one of them read off the model's lexicon rather than
    // reasoned about. They are the six this model spells differently from the
    // way pinyin would suggest, which is why they are the ones pinned.
    const std::pair<const char*, std::pair<const char*, const char*>> expected[] = {
        {"yi", {"y", "i"}},       {"ya", {"y", "a"}},      {"ye", {"y", "E"}},
        {"yan", {"y", "En"}},     {"yu", {"y", "v"}},      {"yue", {"y", "ve"}},
        {"weng", {"w", "eng"}},   {"wei", {"w", "ei"}},    {"zhi", {"zh", "ir"}},
        {"si", {"s", "i0"}},      {"an", {"AA", "an"}},    {"en", {"EE", "en"}},
        {"ou", {"OO", "ou"}},     {"hang", {"h", "ang"}},  {"nian", {"n", "ian"}},
        {"kei", {"k", "ei"}},
    };
    for (const auto& [syllable, phones] : expected) {
        const auto [initial, final_phone] = melo::phones_for_pinyin(syllable);
        require(initial == phones.first && final_phone == phones.second,
                std::string("the table spells ") + syllable + " the way the model does");
    }

    // Sorted, because the lookup binary-searches it. An unsorted table does not
    // fail loudly: it finds most syllables and silently misses the rest.
    bool sorted = true;
    for (std::size_t index = 1; index < generated::kMeloSyllables.size(); ++index) {
        if (!(generated::kMeloSyllables[index - 1].pinyin <
              generated::kMeloSyllables[index].pinyin)) {
            sorted = false;
        }
    }
    require(sorted, "the syllable table is sorted, which is what the lookup assumes");

    // Every phone in the table has to exist in the model, or the syllable is a
    // hole that only shows up as a missing sound in a finished render.
    const auto tokens = sample_tokens();
    std::size_t unknown = 0;
    for (const auto& row : generated::kMeloSyllables) {
        if (tokens.id(row.initial) < 0 || tokens.id(row.final_phone) < 0) { unknown += 1; }
    }
    require(unknown == 0, "every phone in the table is one of the model's tokens");

    // The syllables this model cannot say. Four syllabic nasals no Chinese word
    // needs. The list is pinned so it cannot grow without somebody deciding to
    // let it: a syllable falling off the table is a character that goes silent.
    const std::set<std::string> unmapped(generated::kMeloUnmapped.begin(),
                                         generated::kMeloUnmapped.end());
    const std::set<std::string> known{"m", "n", "ng", "tunwa"};
    require(unmapped == known, "the unmapped syllables are still the four syllabic nasals");
    require(generated::kMeloSyllables.size() > 400,
            "the table covers the Mandarin syllabary rather than a corner of it");
    note("syllables " + std::to_string(generated::kMeloSyllables.size()) +
         ", unmapped " + std::to_string(unmapped.size()));
}

// --- numbers -----------------------------------------------------------------

void test_numbers_are_spelled_out() {
    const std::pair<const char*, const char*> cases[] = {
        {"2026年", "二零二六年"},          // a year is digits, not a quantity
        {"25個", "二十五個"},
        {"15個", "十五個"},
        {"115", "一百一十五"},
        {"105", "一百零五"},
        {"1000", "一千"},
        {"10000", "一萬"},
        {"100005", "十萬零五"},
        {"0", "零"},
        {"007", "零零七"},                  // a leading zero is an identifier
        {"1,250", "一千二百五十"},
        {"3.5", "三點五"},
        {"0.25", "零點二五"},
        {"2026", "二千零二十六"},          // the same digits without 年
    };
    for (const auto& [input, expected] : cases) {
        const std::string actual = melo::normalise_numbers(input);
        require(actual == expected,
                std::string("\"") + input + "\" reads as " + expected + ", got " + actual);
    }

    // A sentence-ending full stop is not a decimal point.
    require(melo::normalise_numbers("有5.") == "有五.",
            "a full stop after a number stays a full stop");
}

void test_an_override_is_not_a_number() {
    // The tone digit in a pronunciation override is part of a reading. Spelling
    // it out turns [重|chong2] into [重|chong二], which is not a reading of
    // anything, and the engine would take the whole bracket as literal text.
    const std::string kept = melo::normalise_numbers("[重|chong2]新開始");
    require(kept == "[重|chong2]新開始",
            "text inside brackets is left alone, got " + kept);
    require(melo::normalise_numbers("買了3個[重|chong2]的") == "買了三個[重|chong2]的",
            "digits outside the brackets are still spelled out");
}

// --- punctuation --------------------------------------------------------------

void test_punctuation_folds_onto_the_models_seven() {
    require(std::string(melo::punctuation_token(0xFF0CU)) == ",", "，is a comma");
    require(std::string(melo::punctuation_token(0x3002U)) == ".", "。is a full stop");
    require(std::string(melo::punctuation_token(0xFF01U)) == "!", "！is an exclamation");
    require(std::string(melo::punctuation_token(0xFF1FU)) == "?", "？is a question mark");
    require(std::string(melo::punctuation_token(0x2026U)) == "…", "… is itself");
    require(std::string(melo::punctuation_token(0x3001U)) == ",", "、is a comma");
    // A pause and a stop must not fold onto the same token: the length of the
    // silence is what the analyser turns into a closed mouth (invariant 8x).
    require(std::string(melo::punctuation_token(0xFF0CU)) !=
            std::string(melo::punctuation_token(0x3002U)),
            "a comma and a full stop stay different tokens");
    require(melo::punctuation_token(0x4E00U) == nullptr, "a Han character is not punctuation");
    require(melo::punctuation_token('a') == nullptr, "a letter is not punctuation");
}

// --- the plan -----------------------------------------------------------------

void test_blanks_are_interspersed() {
    const auto out = melo::intersperse({5, 6, 7});
    require(out.size() == 7, "a blank between every pair and at both ends");
    require(out[0] == 0 && out[2] == 0 && out[4] == 0 && out[6] == 0, "the blanks are blank");
    require(out[1] == 5 && out[3] == 6 && out[5] == 7, "the values keep their order");
}

void test_chinese_is_read_by_the_engine() {
    /*
     * The load-bearing test in this file.
     *
     * 銀行 is hang2, not xing2, and only because the engine's phrase table says
     * so — the model's own lexicon has no Traditional entry for the word and
     * would read the two characters separately, which is where xing2 comes
     * from. So this fails the moment anybody replaces the reader, which is the
     * change invariant 8ac exists to stop.
     */
    const auto bank = plan_of("銀行");
    const auto phones = spoken(bank.tokens);
    const auto tokens = sample_tokens();
    require(phones.size() == 4, "two syllables, two phones each");
    require(phones.size() == 4 && phones[2] == tokens.id("h") && phones[3] == tokens.id("ang"),
            "銀行 is read hang2, which only the engine knows");
    const auto tones = spoken(bank.tones);
    require(tones.size() == 4 && tones[0] == 2 && tones[2] == 2, "both syllables are tone 2");
    require(bank.syllables == 2, "two syllables were counted");
    require(bank.unspoken.empty(), "nothing was dropped");
}

void test_an_override_reaches_the_model() {
    const auto plan = plan_of("[重|chong2]新");
    const auto phones = spoken(plan.tokens);
    const auto tokens = sample_tokens();
    require(phones.size() == 4, "an override is one syllable and 新 is the other");
    require(phones.size() == 4 && phones[0] == tokens.id("ch") && phones[1] == tokens.id("ong"),
            "the override is spoken as chong, not as the default reading");
    require(plan.unspoken.empty(), "the brackets themselves are not reported as unspoken");
}

void test_punctuation_reaches_the_model() {
    const auto plan = plan_of("好，好");
    const auto phones = spoken(plan.tokens);
    const auto tokens = sample_tokens();
    require(phones.size() == 5, "two syllables and one comma");
    require(phones.size() == 5 && phones[2] == tokens.id(","),
            "the comma is between them, which is what makes the pause");
    const auto tones = spoken(plan.tones);
    require(tones.size() == 5 && tones[2] == 0, "punctuation carries no tone");
}

void test_english_comes_from_the_lexicon() {
    const auto plan = plan_of("hello");
    const auto phones = spoken(plan.tokens);
    const auto tokens = sample_tokens();
    require(phones.size() == 4, "hello is four phones");
    require(phones.size() == 4 && phones[0] == tokens.id("hh") && phones[3] == tokens.id("ow"),
            "the phones are the lexicon's ARPA ones, not the engine's syllables");
    const auto tones = spoken(plan.tones);
    require(tones.size() == 4 && tones[0] == 7, "English keeps the model's own tone offset");

    // Greedy: island is a word before is is.
    const auto longer = plan_of("island");
    require(spoken(longer.tokens).size() == 5, "the longest match wins");
}

void test_mixed_text_keeps_both_readers() {
    const auto plan = plan_of("你好 hello");
    require(plan.syllables == 3, "two Chinese syllables and one English word");
    require(plan.unspoken.empty(), "a space between them is not an unspoken character");
}

void test_what_cannot_be_said_is_reported() {
    // Kana is the honest case: the engine reads it, this model has no Japanese
    // installed, and a line that comes back missing a word has to say which.
    const auto plan = plan_of("こんにちは");
    require(!plan.unspoken.empty(), "kana is reported rather than silently dropped");
    // An emoji is not punctuation, not a letter and not a syllable.
    const auto emoji = plan_of("好\xF0\x9F\x99\x82");
    require(emoji.unspoken == "\xF0\x9F\x99\x82", "an emoji is reported, got " + emoji.unspoken);
    require(emoji.syllables == 1, "and the syllable beside it still speaks");

    /*
     * The syllable this model has no phones for, and the phone this model does
     * not have. Two different branches, and the kana above reaches neither —
     * deleting the report from the missing-phone branch left the whole suite
     * green until these two arrived, which is exactly the hollow guard
     * CLAUDE.md's "Writing a guard" describes.
     *
     * 嗯 is read ng4, one of the four syllabic nasals in kMeloUnmapped.
     */
    const auto nasal = plan_of("嗯");
    require(nasal.unspoken == "嗯", "a syllable with no phones is reported, got " + nasal.unspoken);
    require(nasal.syllables == 0, "and it is not counted as spoken");

    island_chatter::Settings settings;
    const auto thin = melo::plan("好", settings, sample_lexicon(),
                                 melo::Tokens::parse("_ 0\nao 16\n"));
    require(thin.unspoken == "好",
            "a phone missing from this model's tokens is reported, got " + thin.unspoken);
    require(thin.syllables == 0, "and that syllable is not counted either");
}

void test_a_plan_is_always_well_formed() {
    // Odd length and a blank at both ends: the model's alignment was trained on
    // that shape, and audio from a badly shaped one is fast and unlistenable
    // rather than wrong in a way that throws.
    for (const char* text : {"", "你好", "好，", "hello", "2026年"}) {
        const auto plan = plan_of(text);
        require(plan.tokens.size() % 2 == 1, "the token sequence has odd length");
        require(plan.tokens.size() == plan.tones.size(), "one tone per token");
        require(plan.tokens.empty() || (plan.tokens.front() == 0 && plan.tokens.back() == 0),
                "it begins and ends on a blank");
    }
}

// --- Japanese ------------------------------------------------------------------

/*
 * The Japanese model's lexicon, in its own format: kana, kanji words, and a
 * digit, all keyed by the surface form, with the model's Japanese tone 6.
 * These are real lines from it.
 */
melo::Lexicon japanese_lexicon() {
    return melo::Lexicon::parse(
        "こ k o 6 6\n"
        "ん N 6\n"
        "に n i 6 6\n"
        "ち ch i 6 6\n"
        "は h a 6 6\n"
        "こんにちは k o N n i ch i w a 6 6 6 6 6 6 6 6 6\n"
        "今日 ky o 6 6\n"
        "日本 n i q p o N 6 6 6 6 6 6\n"
        "日 n i ch i 6 6 6 6\n"
        "1 i ch i 6 6 6\n",
        melo::Language::Japanese);
}

melo::Plan japanese_plan(const std::string& text) {
    island_chatter::Settings settings;
    return melo::plan(text, settings, japanese_lexicon(), sample_tokens(),
                      melo::Language::Japanese);
}

void test_japanese_is_read_by_the_models_lexicon() {
    /*
     * The mirror of test_chinese_is_read_by_the_engine(), and deliberately the
     * other way round. The engine cannot read kanji at all — invariant 8h:
     * a kanji's reading depends on the word and this product has no Japanese
     * dictionary — so for Japanese the lexicon is the only reader that can say
     * anything, and 今日 is `ky o` rather than two Mandarin syllables.
     */
    const auto tokens = sample_tokens();
    const auto today = japanese_plan("今日");
    const auto phones = spoken(today.tokens);
    require(phones.size() == 2, "今日 is two phones, got " + std::to_string(phones.size()));
    require(phones.size() == 2 && phones[0] == tokens.id("ky") && phones[1] == tokens.id("o"),
            "今日 is read ky o, which only the model's lexicon knows");
    require(spoken(today.tones)[0] == 6, "and carries the model's Japanese tone");

    // Longest match: こんにちは is one word before こ is.
    const auto greeting = japanese_plan("こんにちは");
    require(greeting.syllables == 1, "こんにちは matched as one word");
    require(spoken(greeting.tokens).size() == 9, "and produced its nine phones");

    // 日本 wins over 日, which is the whole point of longest-first.
    const auto japan = japanese_plan("日本");
    require(spoken(japan.tokens).size() == 6, "日本 is the six-phone word, not 日 + 本");

    const auto unknown = japanese_plan("齷");
    require(unknown.unspoken == "齷", "a character with no entry is reported, got " +
            unknown.unspoken);
    require(unknown.syllables == 0, "and nothing was counted as spoken");
}

void test_japanese_leaves_digits_and_brackets_alone() {
    // The Japanese lexicon has its own digit entries, so spelling numbers out
    // in Chinese would replace a reading it has with characters it does not.
    const auto one = japanese_plan("1");
    require(spoken(one.tokens).size() == 3, "1 is read by the lexicon as i ch i");
    require(one.unspoken.empty(), "and nothing was reported unspoken");

    // A pronunciation override carries pinyin, which is not a reading here, so
    // the brackets are ordinary characters and are reported rather than obeyed.
    const auto override_text = japanese_plan("[今日|xyz]");
    require(!override_text.unspoken.empty(),
            "an override is not a Japanese reading and says so");
}

void test_japanese_punctuation_still_pauses() {
    const auto tokens = sample_tokens();
    const auto plan = japanese_plan("は、は");
    const auto phones = spoken(plan.tokens);
    require(phones.size() == 5, "two words and one comma, got " +
            std::to_string(phones.size()));
    require(phones.size() == 5 && phones[2] == tokens.id(","),
            "the comma is between them, which is what closes the mouth");
}

void test_the_lexicon_keeps_only_what_it_is_for() {
    // The Chinese half of lexicon.txt is 190,000 Simplified words this never
    // asks about. Keeping it costs about 40 MB of hash table to answer no
    // questions, and it must not creep back in as a second reader.
    const auto lexicon = melo::Lexicon::parse(
        "hello hh ah l ow 7 8 7 9\n"
        "你好 n i h ao 3 3 3 3\n");
    require(lexicon.size() == 1, "only the Latin entry was kept");
    require(lexicon.find("hello") != nullptr, "and it is the one that was asked for");
    require(lexicon.find("你好") == nullptr, "the Chinese entry is not there to be found");

    // The Japanese model is the opposite: there the lexicon is the reader, so
    // dropping its non-Latin keys would drop the whole language.
    const auto japanese = melo::Lexicon::parse(
        "hello hh ah l ow 7 8 7 9\n"
        "今日 ky o 6 6\n", melo::Language::Japanese);
    require(japanese.size() == 2, "the Japanese lexicon keeps its Japanese keys");
    require(japanese.find("今日") != nullptr, "and 今日 can be found in it");
    // Five, not six: "hello" is five code points and 今日 is two, while in
    // bytes 今日 is six and would win. The bound is what the greedy match
    // starts its span at, and a span counted in the wrong unit walks off the
    // end of the characters it is indexing.
    require(japanese.longest_word() == 5,
            "the longest key is measured in code points, not bytes; got " +
            std::to_string(japanese.longest_word()));
}

}  // namespace

int main() {
    test_table_is_the_models_own_spelling();
    test_numbers_are_spelled_out();
    test_an_override_is_not_a_number();
    test_punctuation_folds_onto_the_models_seven();
    test_blanks_are_interspersed();
    test_chinese_is_read_by_the_engine();
    test_an_override_reaches_the_model();
    test_punctuation_reaches_the_model();
    test_english_comes_from_the_lexicon();
    test_mixed_text_keeps_both_readers();
    test_what_cannot_be_said_is_reported();
    test_a_plan_is_always_well_formed();
    test_japanese_is_read_by_the_models_lexicon();
    test_japanese_leaves_digits_and_brackets_alone();
    test_japanese_punctuation_still_pauses();
    test_the_lexicon_keeps_only_what_it_is_for();

    if (failures) {
        std::cerr << failures << " melo test(s) failed\n";
        return 1;
    }
    std::cout << "melo tests passed\n";
    return 0;
}

#include "island_chatter/dsp.hpp"
#include "island_chatter/synthesis_cache.hpp"

#include <algorithm>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}

}  // namespace

int main() {
    island_chatter::Settings settings;
    settings.text = "你好，歡迎來到小島！今天一起聊天吧。月色如歌。";
    settings.consonant = 1.25;
    settings.volume = 0.82;
    const auto first = island_chatter::synthesize(settings);
    const auto second = island_chatter::synthesize(settings);

    require(!first.samples.empty(), "synthesis returned no audio");
    require(first.samples == second.samples, "synthesis is not deterministic");
    require(first.diagnostics.event_count == 19, "unexpected Mandarin syllable count");
    require(first.diagnostics.mandarin_event_count == 19, "Han characters did not use Mandarin readings");
    require(first.diagnostics.peak > 0.05F, "synthesis is silent");
    require(first.diagnostics.peak < 0.999F, "synthesis clips");

    std::vector<float> chunked(first.samples.size(), -1.0F);
    const std::size_t chunk_sizes[] = {1, 17, 511, 1500, 4096, 73};
    std::size_t cursor = 0;
    std::size_t chunk_index = 0;
    while (cursor < chunked.size()) {
        const auto count = std::min(chunk_sizes[chunk_index % 6], chunked.size() - cursor);
        island_chatter::copy_region(first, static_cast<std::int64_t>(cursor),
            chunked.data() + cursor, count, 1);
        cursor += count;
        ++chunk_index;
    }
    require(chunked == first.samples, "variable AE audio blocks introduced gaps or overlaps");

    island_chatter::SynthesisCache cache(4);
    std::vector<std::shared_ptr<const island_chatter::Utterance>> concurrent_results(12);
    std::mutex gate_mutex;
    std::condition_variable gate;
    bool start = false;
    std::vector<std::thread> workers;
    for (std::size_t index = 0; index < concurrent_results.size(); ++index) {
        workers.emplace_back([&, index] {
            {
                std::unique_lock<std::mutex> lock(gate_mutex);
                gate.wait(lock, [&start] { return start; });
            }
            concurrent_results[index] = cache.get(settings);
        });
    }
    {
        const std::lock_guard<std::mutex> lock(gate_mutex);
        start = true;
    }
    gate.notify_all();
    for (auto& worker : workers) worker.join();
    for (const auto& result : concurrent_results) {
        require(result == concurrent_results.front(),
            "concurrent AE blocks synthesized duplicate utterances on a cold cache");
    }
    for (std::uint32_t seed = 1; seed <= 8; ++seed) {
        auto cache_settings = settings;
        cache_settings.text = "ni3";
        cache_settings.seed = seed;
        cache.get(cache_settings);
    }
    require(cache.size() <= 4, "synthesis cache exceeded its configured bound");

    const std::set<char> vowels(
        first.diagnostics.vowel_names.begin(), first.diagnostics.vowel_names.end());
    const std::set<island_chatter::ConsonantKind> consonants(
        first.diagnostics.consonant_kinds.begin(), first.diagnostics.consonant_kinds.end());
    const std::set<std::uint8_t> tones(
        first.diagnostics.tones.begin(), first.diagnostics.tones.end());
    require(vowels.size() >= 5, "Mandarin finals are not distinct");
    require(consonants.size() >= 5, "consonant classes are not distinct");
    require(tones.size() >= 4, "Mandarin tone contours are not distinct");

    settings.text = "你好";
    const auto third_tone_sandhi = island_chatter::synthesize(settings);
    require(third_tone_sandhi.diagnostics.lexical_tones == std::vector<std::uint8_t>({3, 3}),
        "lexical third tones were not preserved");
    require(third_tone_sandhi.diagnostics.tones == std::vector<std::uint8_t>({2, 3}),
        "third-tone sandhi was not applied");

    settings.text = "不對，一樣";
    const auto yi_bu_sandhi = island_chatter::synthesize(settings);
    require(yi_bu_sandhi.diagnostics.readings.size() == 4, "yi/bu test syllable count changed");
    require(yi_bu_sandhi.diagnostics.readings[0] == "bu2", "bu sandhi before fourth tone failed");
    require(yi_bu_sandhi.diagnostics.readings[2] == "yi2", "yi sandhi before fourth tone failed");

    settings.text = "音樂銀行";
    const auto polyphones = island_chatter::synthesize(settings);
    require(polyphones.diagnostics.readings ==
        std::vector<std::string>({"yin1", "yue4", "yin2", "hang2"}),
        "phrase-level polyphone readings failed");

    settings.text = "[重|chong2]新";
    const auto override_reading = island_chatter::synthesize(settings);
    require(override_reading.diagnostics.readings == std::vector<std::string>({"chong2", "xin1"}),
        "inline pinyin override failed");

    settings.text = "ni3 hao3";
    const auto pinyin_input = island_chatter::synthesize(settings);
    require(pinyin_input.diagnostics.event_count == 2, "tone-number pinyin was not tokenized by syllable");
    require(pinyin_input.diagnostics.tones == std::vector<std::uint8_t>({2, 3}),
        "pinyin input did not receive tone sandhi");

    settings.text = "ㄋㄧˇ ㄏㄠˇ";
    const auto zhuyin_input = island_chatter::synthesize(settings);
    require(zhuyin_input.diagnostics.readings == std::vector<std::string>({"ni2", "hao3"}),
        "Zhuyin input was not converted or tone-sandhi adjusted");

    settings.text = "你好！";
    const auto exclamation = island_chatter::synthesize(settings);
    settings.text = "你好。";
    const auto full_stop = island_chatter::synthesize(settings);
    require(full_stop.samples.size() > exclamation.samples.size(),
        "punctuation-specific pause durations were not applied");

    settings.text = "角色情緒測試";
    settings.seed = 4242;
    settings.emotion = island_chatter::Emotion::happy;
    settings.character_size = island_chatter::CharacterSize::tiny;
    settings.clarity = 0.92;
    settings.cuteness = 0.88;
    const auto happy_tiny = island_chatter::synthesize(settings);
    const auto happy_tiny_repeat = island_chatter::synthesize(settings);
    require(happy_tiny.samples == happy_tiny_repeat.samples, "explicit seed is not deterministic");
    settings.emotion = island_chatter::Emotion::angry;
    settings.character_size = island_chatter::CharacterSize::giant;
    settings.clarity = 0.55;
    settings.cuteness = 0.15;
    const auto angry_giant = island_chatter::synthesize(settings);
    require(happy_tiny.samples != angry_giant.samples, "emotion and character size do not affect audio");

    settings.text = "八趴擠起";
    const auto aspiration_contrast = island_chatter::synthesize(settings);
    require(aspiration_contrast.diagnostics.event_count == 4, "aspiration test did not produce four syllables");
    require(aspiration_contrast.samples != first.samples, "aspiration contrast did not alter the output");

    std::vector<float> stereo(512 * 2, 1.0F);
    island_chatter::copy_region(first, 100, stereo.data(), 512, 2);
    for (std::size_t frame = 0; frame < 512; ++frame) {
        require(stereo[frame * 2] == stereo[frame * 2 + 1], "stereo channels differ");
        require(stereo[frame * 2] == first.samples[100 + frame], "random-access copy is incorrect");
    }

    std::vector<float> tail(64, 1.0F);
    island_chatter::copy_region(first, static_cast<std::int64_t>(first.samples.size()) + 20, tail.data(), 64, 1);
    require(std::all_of(tail.begin(), tail.end(), [](float value) { return value == 0.0F; }),
        "out-of-range audio is not silent");

    for (std::size_t voice = 0; voice < island_chatter::voices().size(); ++voice) {
        settings.voice_index = voice;
        settings.text = "你好，中文聲音測試";
        settings.emotion = static_cast<island_chatter::Emotion>(voice % 7);
        settings.character_size = static_cast<island_chatter::CharacterSize>(voice % 4);
        const auto rendered = island_chatter::synthesize(settings);
        require(rendered.diagnostics.peak < 0.999F, "voice clips at maximum settings");
    }

    // U+3007 〇 lives inside the CJK punctuation block but is a spoken digit.
    settings = island_chatter::Settings{};
    settings.text = "二〇一九";
    const auto ideographic_zero = island_chatter::synthesize(settings);
    require(ideographic_zero.diagnostics.readings ==
        std::vector<std::string>({"er4", "ling2", "yi1", "jiu3"}),
        "〇 was not read, or 一 lost its citation tone inside a digit sequence");

    // 一 keeps its first tone as an ordinal and in dates, but still takes
    // sandhi everywhere else.
    for (const auto& [text, expected] : std::vector<std::pair<std::string, std::string>>{
            {"第一名", "yi1"}, {"一月", "yi1"}, {"一號", "yi1"}, {"星期一早", "yi1"},
            {"一起", "yi4"}, {"一天", "yi4"}, {"一樣", "yi2"}}) {
        settings.text = text;
        const auto planned = island_chatter::synthesize(settings);
        bool found = false;
        for (const auto& reading : planned.diagnostics.readings) {
            if (reading.size() >= 2 && reading.compare(0, 2, "yi") == 0) {
                require(reading == expected, ("一 sandhi is wrong in " + text).c_str());
                found = true;
            }
        }
        require(found, ("no 一 syllable was planned for " + text).c_str());
    }

    // 過, 著, and 了 default to a neutral particle reading; these words must not.
    for (const auto& [text, expected] : std::vector<std::pair<std::string, std::string>>{
            {"過去", "guo4"}, {"經過", "guo4"}, {"難過", "guo4"}, {"過来", "guo5"},
            {"著名", "zhu4"}, {"顯著", "zhu4"}, {"我去過", "guo5"}}) {
        settings.text = text;
        const auto planned = island_chatter::synthesize(settings);
        bool found = false;
        for (const auto& reading : planned.diagnostics.readings) {
            if (reading == expected) found = true;
        }
        require(found, ("expected reading " + expected + " in " + text).c_str());
    }
    settings.text = "了解";
    require(island_chatter::synthesize(settings).diagnostics.lexical_tones ==
        std::vector<std::uint8_t>({3, 3}), "了解 did not use the liao3 reading");

    // punctuation_pause() scores — and … ; is_punctuation() must reach them.
    settings.text = "你好";
    const auto no_marks = island_chatter::synthesize(settings);
    for (const char* text : {"你…好", "你—好"}) {
        settings.text = text;
        const auto spaced = island_chatter::synthesize(settings);
        require(spaced.diagnostics.event_count == no_marks.diagnostics.event_count,
            "an ellipsis or em dash produced a chatter syllable instead of a rest");
        require(spaced.samples.size() > no_marks.samples.size(),
            "an ellipsis or em dash did not insert a pause");
    }

    // ASCII pinyin spells ü as either "v" or "u:".
    settings.text = "nv3";
    const auto v_spelling = island_chatter::synthesize(settings);
    settings.text = "nu:3";
    const auto colon_spelling = island_chatter::synthesize(settings);
    settings.text = "nu3";
    const auto plain_u = island_chatter::synthesize(settings);
    require(v_spelling.diagnostics.vowel_names == colon_spelling.diagnostics.vowel_names,
        "nu:3 did not reach the same front rounded vowel as nv3");
    require(v_spelling.diagnostics.vowel_names != plain_u.diagnostics.vowel_names,
        "ü and plain u are not distinguished");

    // The nasal murmur must release with the onset instead of running at full
    // amplitude for the rest of the syllable.
    const auto syllable_energy = [](const char* text) {
        island_chatter::Settings local;
        local.text = text;
        local.seed = 7;
        const auto rendered = island_chatter::synthesize(local);
        double energy = 0.0;
        for (const float value : rendered.samples) {
            energy += static_cast<double>(value) * static_cast<double>(value);
        }
        return std::sqrt(energy / static_cast<double>(std::max<std::size_t>(1, rendered.samples.size())));
    };
    const double stop_energy = syllable_energy("ba1");
    require(syllable_energy("ma1") < stop_energy * 1.15,
        "the nasal onset envelope does not terminate; ma1 is far louder than ba1");
    require(syllable_energy("na1") < stop_energy * 1.15,
        "the nasal onset envelope does not terminate; na1 is far louder than ba1");

    // The cache is bounded by memory, not just by entry count.
    {
        island_chatter::Settings bounded;
        bounded.text = "你好，島民";
        const auto single = island_chatter::Utterance(bounded).sample_count();
        island_chatter::SynthesisCache small(1024, single * 3);
        for (std::uint32_t seed = 1; seed <= 24; ++seed) {
            auto keyed = bounded;
            keyed.seed = seed;
            small.get(keyed);
        }
        require(small.resident_samples() <= single * 3,
            "the synthesis cache exceeded its configured memory bound");
        require(small.size() > 0, "the synthesis cache evicted everything");
    }

    // A failed synthesis must propagate and leave no poisoned entry behind.
    {
        island_chatter::SynthesisCache failing(8);
        island_chatter::Settings invalid;
        invalid.text = "你好";
        invalid.sample_rate = 1;
        bool threw = false;
        try {
            failing.get(invalid);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        require(threw, "an invalid sample rate did not propagate out of the cache");
        require(failing.size() == 0, "a failed synthesis left an entry in the cache");
        island_chatter::Settings valid = invalid;
        valid.sample_rate = 44100;
        require(failing.get(valid) != nullptr, "the cache did not recover after a failure");
    }

    // The widened parameter ranges must stay stable, silent-free and unclipped
    // at both extremes, and Speed must actually change the duration all the way
    // to the top of its range.
    {
        island_chatter::Settings extreme;
        extreme.text = "你好，島民！今天天氣真好。";
        double previous_duration = 0.0;
        for (const double speed : {0.10, 0.25, 1.0, 4.0, 10.0, 12.0, 40.0}) {
            extreme.speed = speed;
            const auto rendered = island_chatter::synthesize(extreme);
            require(!rendered.samples.empty(), "an extreme Speed produced no audio");
            require(rendered.diagnostics.peak < 0.999F, "an extreme Speed clipped");
            require(rendered.diagnostics.event_count == 10, "an extreme Speed dropped syllables");
            if (previous_duration > 0.0) {
                require(rendered.diagnostics.duration_seconds <= previous_duration,
                    "a higher Speed did not shorten the utterance");
            }
            previous_duration = rendered.diagnostics.duration_seconds;
        }
        // 40.0 is past the clamp, so it must land on the same result as 12.0.
        extreme.speed = 12.0;
        const auto at_bound = island_chatter::synthesize(extreme);
        extreme.speed = 40.0;
        require(island_chatter::synthesize(extreme).samples == at_bound.samples,
            "Speed is not clamped consistently above its maximum");

        extreme.speed = 1.0;
        for (const double pitch : {0.10, 1.0, 2.0, 4.0, 6.0}) {
            extreme.pitch = pitch;
            const auto rendered = island_chatter::synthesize(extreme);
            require(rendered.diagnostics.peak > 0.01F, "an extreme Pitch produced near-silence");
            require(rendered.diagnostics.peak < 0.999F, "an extreme Pitch clipped");
        }
        extreme.pitch = 1.0;
        for (const double volume : {0.0, 1.0, 2.0}) {
            extreme.volume = volume;
            const auto rendered = island_chatter::synthesize(extreme);
            require(rendered.diagnostics.peak < 0.999F, "an extreme Volume clipped");
        }
        extreme.volume = 2.0;
        const auto loud = island_chatter::synthesize(extreme);
        extreme.volume = 0.78;
        require(loud.diagnostics.peak > island_chatter::synthesize(extreme).diagnostics.peak,
            "Volume above 100% is not louder than the default");
        extreme.volume = 0.78;
        for (const double consonant : {0.0, 1.25, 6.0}) {
            extreme.consonant = consonant;
            require(island_chatter::synthesize(extreme).diagnostics.peak < 0.999F,
                "an extreme Consonant clipped");
        }
    }

    // Harmonics above Nyquist are dropped rather than folded back as aliasing.
    {
        island_chatter::Settings limited;
        limited.text = "米";
        limited.sample_rate = 8000;
        limited.pitch = 6.0;
        limited.voice_index = 1;
        limited.character_size = island_chatter::CharacterSize::tiny;
        const auto rendered = island_chatter::synthesize(limited);
        require(rendered.diagnostics.peak < 0.999F, "band-limited synthesis clipped");
        require(!rendered.samples.empty(), "band-limited synthesis produced no audio");
    }

    // Lazy block rendering must be indistinguishable from a single eager
    // synthesize(), whatever block sizes the host happens to ask for.
    {
        island_chatter::Settings lazy_settings;
        lazy_settings.text = "你好，島民！今天天氣真好。";
        lazy_settings.sample_rate = 48000;
        lazy_settings.seed = 4242;
        for (const double volume : {0.0, 0.3, 0.78, 1.0, 1.5, 2.0}) {
            lazy_settings.volume = volume;
            const auto eager = island_chatter::synthesize(lazy_settings);
            const island_chatter::Utterance lazy(lazy_settings);
            require(lazy.sample_count() == eager.samples.size(),
                "the lazy renderer planned a different length");
            require(lazy.diagnostics().readings == eager.diagnostics.readings,
                "the lazy renderer planned different syllables");
            std::vector<float> out(lazy.sample_count(), -7.0F);
            const std::size_t block_sizes[] = {1, 4096, 173, 20011, 999};
            std::size_t cursor = 0;
            std::size_t which = 0;
            while (cursor < out.size()) {
                const auto count = std::min(block_sizes[which++ % 5], out.size() - cursor);
                lazy.copy_region(static_cast<std::int64_t>(cursor), out.data() + cursor,
                    count, 1, volume);
                cursor += count;
            }
            require(out == eager.samples,
                "lazy block rendering does not match a single eager synthesis");
        }
    }

    // Only the syllables a block touches get rendered.
    {
        island_chatter::Settings partial;
        partial.text = "你好，島民！今天天氣真好。";
        partial.sample_rate = 48000;
        const island_chatter::Utterance utterance(partial);
        require(utterance.rendered_events() == 0, "planning should render no audio");
        std::vector<float> block(4800);
        utterance.copy_region(0, block.data(), block.size(), 1, 0.78);
        const auto after_first = utterance.rendered_events();
        require(after_first > 0, "the first block rendered nothing");
        require(after_first < utterance.diagnostics().event_count,
            "the first block rendered the entire utterance instead of its own syllables");
        utterance.copy_region(0, block.data(), block.size(), 1, 0.78);
        require(utterance.rendered_events() == after_first,
            "re-requesting the same block rendered syllables twice");
    }

    // Volume is a gain applied on the way out, so it must not change the plan
    // and must not be part of the cache key.
    {
        island_chatter::SynthesisCache volume_cache(8);
        island_chatter::Settings quiet;
        quiet.text = "你好，島民";
        quiet.volume = 0.2;
        auto loud = quiet;
        loud.volume = 1.9;
        const auto a = volume_cache.get(quiet);
        const auto b = volume_cache.get(loud);
        require(a == b, "changing Volume created a second cache entry");
        require(volume_cache.size() == 1, "Volume must not be part of the cache key");

        std::vector<float> soft(600), hard(600);
        a->copy_region(0, soft.data(), soft.size(), 1, 0.2);
        a->copy_region(0, hard.data(), hard.size(), 1, 1.9);
        double soft_peak = 0.0;
        double hard_peak = 0.0;
        for (std::size_t i = 0; i < soft.size(); ++i) {
            soft_peak = std::max(soft_peak, std::abs(static_cast<double>(soft[i])));
            hard_peak = std::max(hard_peak, std::abs(static_cast<double>(hard[i])));
        }
        require(hard_peak > soft_peak, "a higher Volume was not louder");
        require(hard_peak <= 0.99, "the output limiter let the signal reach full scale");
    }

    // The default Volume must stay transparent: gain of exactly one.
    {
        island_chatter::Settings reference;
        reference.text = "你好，島民";
        reference.volume = 0.78;
        const island_chatter::Utterance utterance(reference);
        const auto eager = island_chatter::synthesize(reference);
        std::vector<float> out(eager.samples.size());
        utterance.copy_region(0, out.data(), out.size(), 1, 0.78);
        require(out == eager.samples, "the default Volume is no longer transparent");
    }

    // Tempo lock: a Speed derived from a tempo must put every syllable exactly
    // on the beat, including across punctuation, without altering the voice.
    {
        const auto speed_for_tempo = [](double bpm, double per_beat) {
            return bpm * per_beat * 0.200 / 60.0;
        };
        for (const double bpm : {60.0, 90.0, 120.0, 174.0}) {
            for (const double per_beat : {1.0, 2.0, 4.0}) {
                island_chatter::Settings tempo;
                tempo.text = "你好島民你好島民";
                tempo.sample_rate = 48000;
                tempo.tempo_lock = true;
                tempo.speed = speed_for_tempo(bpm, per_beat);
                const auto rendered = island_chatter::synthesize(tempo);
                const double slot = 60.0 / bpm / per_beat;
                for (std::size_t index = 0; index < rendered.diagnostics.start_samples.size(); ++index) {
                    const double at =
                        static_cast<double>(rendered.diagnostics.start_samples[index]) / 48000.0;
                    require(std::abs(at - slot * static_cast<double>(index)) < 0.002,
                        "a tempo-locked syllable did not land on the beat");
                }
            }
        }

        island_chatter::Settings punctuated;
        punctuated.text = "你好，島民！今天";
        punctuated.sample_rate = 48000;
        punctuated.speed = speed_for_tempo(120.0, 2.0);
        punctuated.tempo_lock = true;
        const auto locked = island_chatter::synthesize(punctuated);
        const double slot = 60.0 / 120.0 / 2.0;
        for (const auto start : locked.diagnostics.start_samples) {
            const double at = static_cast<double>(start) / 48000.0;
            require(std::abs(at / slot - std::round(at / slot)) < 0.01,
                "punctuation pushed a tempo-locked syllable off the grid");
        }
        punctuated.tempo_lock = false;
        require(island_chatter::synthesize(punctuated).samples != locked.samples,
            "tempo lock made no difference");

        island_chatter::Settings plain;
        plain.text = "你好";
        plain.sample_rate = 48000;
        auto strict = plain;
        strict.tempo_lock = true;
        require(island_chatter::synthesize(plain).diagnostics.readings ==
                island_chatter::synthesize(strict).diagnostics.readings,
            "tempo lock changed the Mandarin planning");
        require(island_chatter::synthesize(strict).diagnostics.length_samples[0] ==
                static_cast<std::size_t>(std::llround(0.188 / strict.speed * 48000)),
            "a tempo-locked syllable is not exactly one slot long");
    }

    // The panel builds its marker text and Type-On labels from source_units, so
    // an event has to report every input character it speaks, not just the first.
    // A latin consonant swallows the vowel after it, which is the case a single
    // codepoint per event got wrong.
    {
        island_chatter::Settings labelled;
        labelled.text = "你好ba";
        labelled.sample_rate = 48000;
        const auto plan = island_chatter::synthesize(labelled).diagnostics;
        require(plan.source_units.size() == plan.event_count,
            "source_units is not reported for every event");
        require(plan.source_units[0] == std::vector<std::uint32_t>{U'你'} &&
                plan.source_units[1] == std::vector<std::uint32_t>{U'好'},
            "a Mandarin syllable should speak exactly its own character");
        require(plan.event_count == 3, "\"ba\" should fold into one syllable");
        require(plan.source_units[2] == (std::vector<std::uint32_t>{U'b', U'a'}),
            "a latin consonant that swallows the next vowel must report both characters");
        for (std::size_t index = 0; index < plan.event_count; ++index) {
            require(!plan.source_units[index].empty(), "an event speaks no character at all");
            require(plan.source_units[index][0] == plan.source_codepoints[index],
                "source_codepoints and source_units disagree about the first character");
        }
    }

    // Timbre, added in 1.1.0.
    {
        // The additive source has to reach the third formant, or that formant
        // has nothing to resonate and the voice sounds muffled. This used to be
        // a flat twelve harmonics, which at Cozy's 176 Hz fundamental stopped at
        // 2117 Hz while its third formant sits at 2494 Hz, so the formant that
        // gives the voice its character was simply absent. Elder was worse.
        //
        // Asserted on the plan rather than on the audio: a spectral measurement
        // of the output moves with the text and turned out not to separate the
        // two engines at all.
        for (const std::size_t voice : {0U, 1U, 2U, 6U}) {  // Sunny, Tiny, Cozy, Elder
            island_chatter::Settings deep;
            deep.text = "你好，島民！今天天氣真好。";
            deep.sample_rate = 48000;
            deep.voice_index = voice;
            const auto plan = island_chatter::synthesize(deep).diagnostics;
            require(plan.event_count > 0, "no events to inspect");
            for (std::size_t index = 0; index < plan.event_count; ++index) {
                const double reach = plan.harmonic_counts[index] * plan.frequencies[index];
                require(reach >= plan.top_formants[index],
                    "the harmonics stop below the third formant, so it cannot resonate");
            }
        }
        {
            // ...and the bound has to be real: at the lowest pitch this engine
            // allows, kMaxHarmonics is what stops the count, not the formant.
            island_chatter::Settings floor_case;
            floor_case.text = "你好";
            floor_case.sample_rate = 48000;
            floor_case.voice_index = 6;
            floor_case.pitch = 0.10;
            const auto plan = island_chatter::synthesize(floor_case).diagnostics;
            for (const auto count : plan.harmonic_counts) {
                require(count > 0 && count <= 32, "the harmonic count escaped its bounds");
            }
        }

        island_chatter::Settings timbre;
        timbre.text = "你好，我是動態島的居民！";
        timbre.sample_rate = 48000;
        timbre.seed = 4242;
        const auto plain = island_chatter::synthesize(timbre).samples;

        // Every source has to be audibly its own thing, and none may clip: the
        // limiter only catches Volume, not a source that is simply too hot.
        std::vector<std::vector<float>> rendered;
        for (const auto source : {island_chatter::SourceType::voice,
                island_chatter::SourceType::reed, island_chatter::SourceType::chip,
                island_chatter::SourceType::metallic, island_chatter::SourceType::granular,
                island_chatter::SourceType::growl}) {
            auto shaped = timbre;
            shaped.source = source;
            const auto result = island_chatter::synthesize(shaped);
            require(result.diagnostics.peak < 1.0F, "a timbre clips at the default Volume");
            require(result.diagnostics.peak > 0.05F, "a timbre is nearly silent");
            require(result.samples.size() == plain.size(), "a timbre changed the timing");
            for (const auto& earlier : rendered) {
                require(result.samples != earlier, "two timbres render identically");
            }
            rendered.push_back(result.samples);

            // Invariant 8d: syllables stay independent, so the lazy block
            // renderer must still match a single eager pass exactly. The
            // modulated sources are the ones that could break this by carrying
            // state across syllables.
            const island_chatter::Utterance lazy(shaped);
            std::vector<float> out(lazy.sample_count(), -7.0F);
            const std::size_t block_sizes[] = {1, 4096, 173, 20011, 999};
            std::size_t cursor = 0;
            std::size_t which = 0;
            while (cursor < out.size()) {
                const auto count = std::min(block_sizes[which++ % 5], out.size() - cursor);
                lazy.copy_region(static_cast<std::int64_t>(cursor), out.data() + cursor,
                    count, 1, shaped.volume);
                cursor += count;
            }
            require(out == result.samples, "a timbre renders differently block by block");
        }
        require(rendered[0] == plain, "SourceType::voice is not the untouched default");

        // Formant and vibrato default to leaving the voice preset alone.
        auto neutral = timbre;
        neutral.formant = 1.0;
        neutral.vibrato_depth = 1.0;
        neutral.vibrato_rate = 9.2;
        require(island_chatter::synthesize(neutral).samples == plain,
            "the timbre defaults do not reproduce the untouched voice");

        auto smaller = timbre;
        smaller.formant = 0.6;
        auto larger = timbre;
        larger.formant = 1.6;
        require(island_chatter::synthesize(smaller).samples != plain &&
                island_chatter::synthesize(larger).samples != plain &&
                island_chatter::synthesize(smaller).samples !=
                    island_chatter::synthesize(larger).samples,
            "Formant does not change the voice");
        // A larger vocal tract puts the formants higher, and the plan is where
        // that is unambiguous.
        require(island_chatter::synthesize(larger).diagnostics.top_formants[0] >
                island_chatter::synthesize(smaller).diagnostics.top_formants[0],
            "Formant does not scale the vocal tract in the direction it says");

        auto still = timbre;
        still.vibrato_depth = 0.0;
        auto shaky = timbre;
        shaky.vibrato_depth = 3.0;
        auto slow = timbre;
        slow.vibrato_rate = 2.0;
        require(island_chatter::synthesize(still).samples != plain &&
                island_chatter::synthesize(shaky).samples != plain &&
                island_chatter::synthesize(slow).samples != plain,
            "Vibrato depth or rate does not reach the render");
    }

    // Japanese, added in 1.2.0. Kana is a syllabary, so the character is the
    // pronunciation and there is no table to look up or keep synchronised.
    {
        const auto readings_of = [](const std::string& text) {
            island_chatter::Settings settings;
            settings.text = text;
            settings.sample_rate = 48000;
            const auto plan = island_chatter::synthesize(settings).diagnostics;
            std::string joined;
            for (const auto& reading : plan.readings) {
                if (!joined.empty()) { joined += " "; }
                joined += reading;
            }
            return joined;
        };
        for (const auto& [text, expected] : std::vector<std::pair<std::string, std::string>>{
            {"あいうえお", "a i u e o"},
            {"アイウエオ", "a i u e o"},           // katakana shares the table
            {"かきくけこ", "ka ki ku ke ko"},
            {"さしすせそ", "sa shi su se so"},
            {"たちつてと", "ta chi tsu te to"},
            {"ばびぶべぼ", "ba bi bu be bo"},
            {"きゃきゅきょ", "kya kyu kyo"},        // 拗音 is one mora, two characters
            {"しゃしゅしょ", "sha shu sho"},
            {"にゃんこ", "nya n ko"},              // ん is a mora of its own
            {"がっこう", "ga ko u"},                // っ is a rest, not a sound
            {"コーヒー", "ko o hi i"},              // ー holds the vowel before it
            {"ファイト", "fa i to"},                // a small vowel after a non-i kana
            {"ヴァイオリン", "va i o ri n"},
            {"こんにちは", "ko n ni chi wa"},       // the fixed greeting: は is wa
            {"コンニチハ", "ko n ni chi wa"},
            {"おはよう", "o ha yo u"},              // ...but word-internal は stays ha
            {"きょう[は|わ]いいてんき", "kyo u wa i i te n ki"},
            {"[今日|きょう]はいい[天気|てんき]", "kyo u ha i i te n ki"},
        }) {
            if (readings_of(text) != expected) {
                std::cout << "FAIL: " << text << " read as \"" << readings_of(text)
                          << "\", expected \"" << expected << "\"\n";
                return 1;
            }
        }

        // っ costs a rest rather than a sound, so it lengthens the utterance
        // without adding a mora. That is what makes it audible as a stop.
        island_chatter::Settings plain;
        plain.text = "がこう";
        plain.sample_rate = 48000;
        island_chatter::Settings geminate = plain;
        geminate.text = "がっこう";
        const auto without = island_chatter::synthesize(plain);
        const auto with = island_chatter::synthesize(geminate);
        require(without.diagnostics.event_count == with.diagnostics.event_count,
            "っ should not add a mora");
        require(with.samples.size() > without.samples.size(),
            "っ should hold the utterance open for a beat");

        // Morae are timed like Mandarin syllables, so tempo lock works in
        // Japanese too. Anything else and the Japanese would drift off the beat.
        island_chatter::Settings locked;
        locked.text = "あいうえおかきくけこ";
        locked.sample_rate = 48000;
        locked.tempo_lock = true;
        locked.speed = 0.8;
        const auto beat = island_chatter::synthesize(locked).diagnostics;
        const double slot = 0.200 / 0.8 * 48000.0;
        for (std::size_t index = 0; index < beat.event_count; ++index) {
            require(std::abs(static_cast<double>(beat.start_samples[index]) - index * slot) <= 1.0,
                "a tempo-locked mora is off the grid");
        }

        // A kana inline override speaks the kana but still reports the kanji, so
        // markers and Type-On label what is actually on screen.
        island_chatter::Settings marked;
        marked.text = "[今日|きょう]";
        marked.sample_rate = 48000;
        const auto labelled = island_chatter::synthesize(marked).diagnostics;
        require(labelled.event_count == 2, "きょう is two morae");
        // The first mora reports the kanji it stands for, not the kana that
        // spelled it, so a marker reads 今日 rather than き.
        require(labelled.source_units[0] == (std::vector<std::uint32_t>{U'今', U'日'}),
            "the override should carry the characters it stands for");
        require(labelled.source_units[1] == (std::vector<std::uint32_t>{U'う'}),
            "the morae after the first should stay as themselves");
    }

    // English, added in 1.3.0. Not a pronunciation dictionary: the goal is the
    // syllable count, the vowel colour and the stress, which is what a
    // character voice needs. Spelling only makes sense a word at a time.
    {
        const auto syllables_of = [](const std::string& text) {
            island_chatter::Settings settings;
            settings.text = text;
            settings.sample_rate = 48000;
            const auto plan = island_chatter::synthesize(settings).diagnostics;
            std::string joined;
            for (const auto& reading : plan.readings) {
                if (!joined.empty()) { joined += "|"; }
                joined += reading;
            }
            return joined;
        };
        for (const auto& [word, expected] : std::vector<std::pair<std::string, std::string>>{
            // The four letters that share nothing: -ough is one syllable each time.
            {"though", "though"},
            {"through", "through"},
            {"tough", "tough"},
            {"thought", "thought"},
            // A silent final e closes the syllable rather than opening a new one.
            {"make", "make"},
            {"name", "name"},
            {"time", "time"},
            {"bone", "bone"},
            // ...but only when there is another vowel to lengthen.
            {"be", "be"},
            {"the", "the"},
            // Two consonants between nuclei split; one goes to the next onset.
            {"hello", "hel|lo"},
            {"water", "wa|ter"},
            {"chatter", "chat|ter"},
            {"island", "is|land"},
            {"computer", "com|pu|ter"},
            {"beautiful", "beau|ti|ful"},
            {"animation", "a|ni|ma|tion"},
            {"strength", "strength"},
            // A word-final l, m or n with no vowel is still a syllable.
            {"rhythm", "rhy|thm"},
            {"prism", "pri|sm"},
            {"little", "lit|tle"},
            {"simple", "sim|ple"},
            {"table", "ta|ble"},
            {"button", "but|ton"},
            // A digraph is one sound; splitting it invents a consonant.
            {"mother", "mo|ther"},
            {"washing", "wa|shing"},
            // Whole sentences, where the words must not run together.
            {"the quick brown fox", "the|quick|brown|fox"},
            {"island chatter", "is|land|chat|ter"},
        }) {
            if (syllables_of(word) != expected) {
                std::cout << "FAIL: \"" << word << "\" split as " << syllables_of(word)
                          << ", expected " << expected << "\n";
                return 1;
            }
        }

        // Stress is what makes it sound like English rather than like a list of
        // syllables: the stressed one is longer, and the pitch moves with it.
        island_chatter::Settings english;
        english.text = "computer";
        english.sample_rate = 48000;
        const auto stressed_plan = island_chatter::synthesize(english).diagnostics;
        require(stressed_plan.event_count == 3, "computer is three syllables");
        require(stressed_plan.length_samples[1] > stressed_plan.length_samples[0] * 1.4,
            "the stressed syllable of computer should be much longer than the unstressed ones");
        require(stressed_plan.frequencies[1] > stressed_plan.frequencies[0],
            "the stressed syllable should also be higher");

        // A beat grid and a stress pattern cannot both be satisfied. Tempo lock
        // is the user asking for the grid, so English flattens under it.
        auto locked = english;
        locked.text = "island chatter today";
        locked.tempo_lock = true;
        locked.speed = 0.8;
        const auto grid = island_chatter::synthesize(locked).diagnostics;
        const double slot = 0.200 / 0.8 * 48000.0;
        for (std::size_t index = 0; index < grid.event_count; ++index) {
            require(std::abs(static_cast<double>(grid.start_samples[index]) - index * slot) <= 1.0,
                "a tempo-locked English syllable is off the grid");
        }

        // Each syllable reports its own letters, so markers can label them.
        island_chatter::Settings labelled;
        labelled.text = "hello";
        labelled.sample_rate = 48000;
        const auto letters = island_chatter::synthesize(labelled).diagnostics;
        require(letters.source_units[0] == (std::vector<std::uint32_t>{U'h', U'e', U'l'}) &&
                letters.source_units[1] == (std::vector<std::uint32_t>{U'l', U'o'}),
            "an English syllable should carry the letters it speaks");

        // Tone-number pinyin still wins over English: it is unambiguous, and it
        // is what the pronunciation field is documented to take. It goes through
        // Mandarin, sandhi and all, which is why the first tone here is a 2.
        require(syllables_of("ni3 hao3") == "ni2|hao3",
            "tone-number pinyin should not be read as English");
        require(syllables_of("wo3 shi4 ren2") == "wo3|shi4|ren2",
            "tone-number pinyin should not be read as English");
        // The glide letters, which decide whether a syllable ends or a new one
        // begins: flo-wer against brown, pla-yer against day.
        for (const auto& [word, expected] : std::vector<std::pair<std::string, std::string>>{
            {"brown", "brown"}, {"flower", "flo|wer"},
            {"day", "day"}, {"player", "pla|yer"},
            {"now", "now"}, {"yellow", "yel|low"},
            {"my", "my"}, {"yes", "yes"},
            {"crystal", "crys|tal"}, {"problem", "prob|lem"},
        }) {
            if (syllables_of(word) != expected) {
                std::cout << "FAIL: \"" << word << "\" split as " << syllables_of(word)
                          << ", expected " << expected << "\n";
                return 1;
            }
        }
    }

    // --- Singing -----------------------------------------------------------
    {
        const auto slot = [](int pitch, int ticks) {
            return island_chatter::decode_melody_slot(
                island_chatter::encode_melody_slot(pitch, ticks));
        };
        const int beat = island_chatter::kMelodyTicksPerBeat;

        island_chatter::Settings sung;
        sung.text = "一閃一閃亮";
        sung.sample_rate = 48000;
        sung.melody_bpm = 120.0;
        sung.melody_mode = true;
        sung.melody = {slot(60, beat), slot(62, beat), slot(0, beat),
                       slot(64, beat), slot(65, beat), slot(67, beat * 4)};

        // A melody switches nothing on by itself: melody_mode with no notes has
        // to leave the speaking engine exactly where it was, which is what
        // makes an older project safe when 1.7.0 opens it.
        {
            island_chatter::Settings spoken = sung;
            spoken.melody.clear();
            island_chatter::Settings plain = spoken;
            plain.melody_mode = false;
            require(island_chatter::synthesize(spoken).samples ==
                    island_chatter::synthesize(plain).samples,
                "melody_mode changed the audio without a melody to sing");
        }

        const auto result = island_chatter::synthesize(sung);
        const auto& plan = result.diagnostics;

        // Five syllables, however many events the engine needed to render them.
        require(plan.event_count == 5, "a sung line reported the wrong number of syllables");
        // One beat at 120 BPM is half a second; the third slot is a rest, so
        // the fourth syllable starts a beat later than the third one would.
        require(plan.start_samples[0] == 0, "the first note does not start at zero");
        require(plan.length_samples[0] == 24000, "a one-beat note is not half a second long");
        require(plan.start_samples[2] == 72000, "the rest did not move the note after it");
        require(plan.length_samples[4] == 96000, "the four-beat note is the wrong length");

        // Absolute pitch, and deliberately not the voice preset's register:
        // MIDI 60 is middle C at 261.626 Hz whichever character is singing.
        require(std::abs(plan.frequencies[0] - 261.6255653) < 0.001,
            "a sung note is not at its written pitch");
        for (std::size_t voice_index = 0; voice_index < island_chatter::voices().size();
                ++voice_index) {
            island_chatter::Settings other = sung;
            other.voice_index = voice_index;
            require(std::abs(island_chatter::synthesize(other).diagnostics.frequencies[0] -
                    plan.frequencies[0]) < 0.001,
                "a voice preset transposed the melody");
        }
        {
            island_chatter::Settings up = sung;
            up.transpose = 12;
            require(std::abs(island_chatter::synthesize(up).diagnostics.frequencies[0] -
                    plan.frequencies[0] * 2.0) < 0.001, "transpose did not move by an octave");
        }

        // The long note has to be split, or one block touching its tail would
        // render two seconds of audio on the audio thread.
        {
            island_chatter::Utterance utterance(sung);
            require(utterance.diagnostics().event_count == 5,
                "the segments of a held note leaked into the plan");
            utterance.copy_region(0, std::vector<float>(64).data(), 64, 1, 0.78);
            std::vector<float> tail(64);
            const auto last = static_cast<std::int64_t>(utterance.sample_count()) - 3000;
            utterance.copy_region(last, tail.data(), 64, 1, 0.78);
            // Two blocks, at opposite ends: without segmentation the second one
            // would have rendered the whole four-beat note.
            require(utterance.rendered_events() < 5,
                "a block at the end of a held note rendered more than it needed");
        }

        // Lazy and eager still agree, sample for sample, at awkward block sizes.
        {
            island_chatter::Utterance utterance(sung);
            std::vector<float> blocked(result.samples.size(), -1.0F);
            const std::size_t sizes[] = {1, 17, 4801, 12000, 12001, 331};
            std::size_t cursor = 0;
            std::size_t which = 0;
            while (cursor < blocked.size()) {
                const auto count = std::min(sizes[which % 6], blocked.size() - cursor);
                utterance.copy_region(static_cast<std::int64_t>(cursor),
                    blocked.data() + cursor, count, 1, sung.volume);
                cursor += count;
                ++which;
            }
            require(blocked == result.samples,
                "a segmented note renders differently one block at a time");
        }

        // A held note is held. Sampled across the four-beat note, the middle
        // must not have faded away the way a spoken syllable does.
        {
            const auto start = plan.start_samples[4];
            const auto length = plan.length_samples[4];
            const auto peak_between = [&](double from, double to) {
                float peak = 0.0F;
                for (auto at = start + static_cast<std::size_t>(length * from);
                        at < start + static_cast<std::size_t>(length * to); ++at) {
                    peak = std::max(peak, std::abs(result.samples[at]));
                }
                return peak;
            };
            const float early = peak_between(0.10, 0.20);
            const float late = peak_between(0.75, 0.85);
            require(early > 0.05F, "the held note is silent");
            require(late > early * 0.7F, "the held note faded away instead of sustaining");
        }

        // The seams between segments must be inaudible.
        //
        // This is the mechanism, not a symptom: the phase, the vibrato and the
        // fixed oscillators are all written against note-global time precisely
        // so that a seam falls in the middle of a continuous waveform. Take the
        // offset away and the step at each seam is what shows up here.
        {
            const auto start = plan.start_samples[4];
            const auto length = plan.length_samples[4];
            const auto segment = static_cast<std::size_t>(0.25 * sung.sample_rate);
            const auto is_seam = [&](std::size_t at) {
                const auto into = at - start;
                return into > 0U && into % segment == 0U;
            };
            // The largest step anywhere the seams are not. Measuring against
            // every step in the note would include the seams themselves, and
            // then the comparison can never fail however broken the joins are.
            float ordinary = 0.0F;
            for (std::size_t at = start + 1; at < start + length; ++at) {
                if (is_seam(at)) { continue; }
                ordinary = std::max(ordinary,
                    std::abs(result.samples[at] - result.samples[at - 1]));
            }
            std::size_t seams = 0;
            for (std::size_t at = start + segment; at + segment < start + length; at += segment) {
                ++seams;
                const auto step = std::abs(result.samples[at] - result.samples[at - 1]);
                require(step <= ordinary,
                    "a segment seam steps further than anything else in the note");
            }
            require(seams >= 3, "the held note was not split into segments at all");
        }

        // The rendered audio is actually at the written pitch.
        //
        // Checking diagnostics.frequencies only proves the planner wrote a
        // number down. What matters is what comes out, and between the two sit
        // the harmonic profile, the glide, the vibrato and the segment seams —
        // any of which could put the note somewhere else.
        {
            const auto pitch_of = [&](std::size_t from, std::size_t count) {
                const auto lowest = static_cast<std::size_t>(sung.sample_rate / 1000);
                const auto highest = static_cast<std::size_t>(sung.sample_rate / 80);
                std::vector<double> correlation(highest, 0.0);
                double best = -1.0;
                for (auto lag = lowest; lag < highest; ++lag) {
                    double product = 0.0;
                    double here = 0.0;
                    double there = 0.0;
                    for (std::size_t at = 0; at + lag < count; ++at) {
                        const double left = result.samples[from + at];
                        const double right = result.samples[from + at + lag];
                        product += left * right;
                        here += left * left;
                        there += right * right;
                    }
                    correlation[lag] = product / std::sqrt(here * there + 1e-12);
                    best = std::max(best, correlation[lag]);
                }
                // The shortest period that correlates nearly as well as the
                // best one. A periodic signal correlates almost as strongly at
                // two or three times its period, and picking the raw maximum
                // lets that win by a hair — which reads as the note being an
                // octave or a twelfth below where it actually is.
                for (auto lag = lowest; lag + 1 < highest; ++lag) {
                    if (correlation[lag] >= best * 0.90 &&
                            correlation[lag] >= correlation[lag + 1] &&
                            correlation[lag] >= correlation[lag - 1]) {
                        return static_cast<double>(sung.sample_rate) / static_cast<double>(lag);
                    }
                }
                return 0.0;
            };
            for (std::size_t index = 0; index < plan.event_count; ++index) {
                const auto from = plan.start_samples[index] +
                    static_cast<std::size_t>(plan.length_samples[index] * 0.45);
                const auto count = static_cast<std::size_t>(plan.length_samples[index] * 0.35);
                const double heard = pitch_of(from, count);
                const double cents = 1200.0 * std::log2(heard / plan.frequencies[index]);
                // Twenty cents is a fifth of a semitone: wide enough for the
                // vibrato and for one sample of autocorrelation resolution,
                // far tighter than a wrong note.
                require(std::abs(cents) < 20.0, "a sung note came out at the wrong pitch");
            }
        }

        // A melisma holds the syllable through the next note: one syllable, two
        // notes, and one marker for the panel to place.
        {
            island_chatter::Settings held;
            held.text = "啊-";
            held.sample_rate = 48000;
            held.melody_mode = true;
            held.melody_bpm = 120.0;
            held.melody = {slot(60, beat), slot(64, beat)};
            const auto sung_held = island_chatter::synthesize(held);
            require(sung_held.diagnostics.event_count == 1,
                "a melisma should be one syllable, not two");
            require(sung_held.diagnostics.length_samples[0] == 48000,
                "a melisma should cover both of its notes");
        }

        // The melody is part of what the cache is keyed on, or a layer would go
        // on singing the tune it had before.
        {
            island_chatter::SynthesisCache melodies(8);
            island_chatter::Settings other = sung;
            other.melody[0] = slot(72, beat);
            require(melodies.get(sung).get() != melodies.get(other).get(),
                "two different melodies shared one cache entry");
            island_chatter::Settings faster = sung;
            faster.melody_bpm = 90.0;
            require(melodies.get(sung).get() != melodies.get(faster).get(),
                "the melody tempo is missing from the cache key");
            require(melodies.get(sung).get() == melodies.get(sung).get(),
                "the same melody did not hit the cache");
        }
    }

    std::cout << "Native DSP tests passed: " << first.samples.size() << " samples, peak "
              << first.diagnostics.peak << '\n';
    return 0;
}

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

    std::cout << "Native DSP tests passed: " << first.samples.size() << " samples, peak "
              << first.diagnostics.peak << '\n';
    return 0;
}

#include "island_chatter/dsp.hpp"
#include "island_chatter/synthesis_cache.hpp"

#include <algorithm>
#include <cmath>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
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
    std::vector<std::shared_ptr<const island_chatter::Result>> concurrent_results(12);
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

    std::cout << "Native DSP tests passed: " << first.samples.size() << " samples, peak "
              << first.diagnostics.peak << '\n';
    return 0;
}

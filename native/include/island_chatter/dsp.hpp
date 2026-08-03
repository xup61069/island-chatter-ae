#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace island_chatter {

enum class ConsonantKind : std::uint8_t {
    none = 0,
    stop,
    voiced_stop,
    affricate,
    fricative,
    sibilant,
    nasal,
    liquid,
    aspirate,
};

enum class Emotion : std::uint8_t {
    neutral = 0,
    happy,
    angry,
    scared,
    questioning,
    sleepy,
    robot,
};

enum class CharacterSize : std::uint8_t {
    tiny = 0,
    young,
    adult,
    giant,
};

struct Voice {
    const char* name;
    double pitch;
    double tract;
    double breath;
    double wobble;
    double buzz;
};

struct Settings {
    std::string text = "你好，歡迎來到小島！";
    std::size_t voice_index = 0;
    double pitch = 1.0;
    double speed = 1.0;
    double volume = 0.78;
    double consonant = 1.25;
    Emotion emotion = Emotion::neutral;
    CharacterSize character_size = CharacterSize::adult;
    double clarity = 0.78;
    double cuteness = 0.55;
    // Zero derives a deterministic seed from the text. Any other value keeps
    // a character's micro-variation stable across text changes.
    std::uint32_t seed = 0;
    std::uint32_t sample_rate = 44100;
};

struct Diagnostics {
    std::size_t event_count = 0;
    std::size_t mandarin_event_count = 0;
    std::vector<char> vowel_names;
    std::vector<ConsonantKind> consonant_kinds;
    std::vector<std::string> readings;
    std::vector<std::uint32_t> source_codepoints;
    std::vector<std::size_t> start_samples;
    std::vector<std::size_t> length_samples;
    std::vector<std::uint8_t> lexical_tones;
    std::vector<std::uint8_t> tones;
    float peak = 0.0F;
    double duration_seconds = 0.0;
};

struct Result {
    std::vector<float> samples;
    Diagnostics diagnostics;
};

const std::vector<Voice>& voices();
Result synthesize(const Settings& settings);

// Copies a random-access region from a pre-rendered result. Samples outside
// the utterance are zero-filled, which matches AE's block-based audio calls.
void copy_region(
    const Result& result,
    std::int64_t start_sample,
    float* destination,
    std::size_t frame_count,
    std::size_t channels);

}  // namespace island_chatter

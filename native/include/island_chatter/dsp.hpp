#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
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
    // Removes the per-syllable length jitter and snaps punctuation rests to
    // whole syllable slots, so a Speed derived from a tempo lands on the beat.
    // Everything else about the voice is unchanged.
    bool tempo_lock = false;
};

struct Diagnostics {
    std::size_t event_count = 0;
    std::size_t mandarin_event_count = 0;
    std::vector<char> vowel_names;
    std::vector<ConsonantKind> consonant_kinds;
    std::vector<std::string> readings;
    std::vector<std::uint32_t> source_codepoints;
    // Every input character the event consumed, in order. Usually one, but a
    // latin consonant swallows the vowel after it, and the phrase table can map
    // several characters onto several syllables. The panel labels markers and
    // Type-On steps from this, so one codepoint per event is not enough.
    std::vector<std::vector<std::uint32_t>> source_units;
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

// Renders the whole utterance at once. Used by the tests, the preview renderer
// and the panel's bake command, where the complete buffer is the point.
Result synthesize(const Settings& settings);

// Copies a random-access region from a pre-rendered result. Samples outside
// the utterance are zero-filled, which matches AE's block-based audio calls.
void copy_region(
    const Result& result,
    std::int64_t start_sample,
    float* destination,
    std::size_t frame_count,
    std::size_t channels);

// A planned utterance that renders on demand.
//
// After Effects asks for audio one block at a time. Rendering the entire
// utterance to serve a one-second block wasted most of the work and produced a
// single 60-135 ms stall on the audio thread every time any voice parameter
// changed. Utterance plans the syllables up front, which is cheap, then renders
// only the syllables that overlap each requested block, once each.
//
// Syllables are independent, so the audio is identical to synthesize().
// Volume is applied as a gain at copy time and is therefore not part of the
// plan, which keeps the cache valid while the Volume slider moves.
class Utterance {
public:
    explicit Utterance(const Settings& settings);
    ~Utterance();

    Utterance(const Utterance&) = delete;
    Utterance& operator=(const Utterance&) = delete;

    std::size_t sample_count() const;
    const Diagnostics& diagnostics() const;

    // Thread-safe: concurrent AE audio threads may request different blocks.
    void copy_region(
        std::int64_t start_sample,
        float* destination,
        std::size_t frame_count,
        std::size_t channels,
        double volume) const;

    // Syllables rendered so far, for tests and diagnostics.
    std::size_t rendered_events() const;

private:
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace island_chatter

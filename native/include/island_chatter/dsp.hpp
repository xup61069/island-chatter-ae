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

// What the vocal folds are replaced with. The formant filtering is the same in
// every case; only the spectrum being filtered, and any modulation applied
// after it, differ. `voice` is the original and stays the default so existing
// projects keep their character.
enum class SourceType : std::uint8_t {
    voice = 0,   // Gently falling harmonic series.
    reed,        // Sawtooth slope: brighter and buzzier, like a double reed.
    chip,        // Odd harmonics only: hollow and square, 8-bit.
    metallic,    // Ring-modulated: inharmonic, robotic, insectile.
    granular,    // Chopped by a fast gate: garbled, bad signal.
    growl,       // A sub-octave partial underneath: monstrous.
};

struct Voice {
    const char* name;
    double pitch;
    double tract;
    double breath;
    double wobble;
    double buzz;
};

// One note of an imported melody.
//
// A slot crosses the After Effects parameter transport as a single number in
// the same 0-65535 range the text units use, because a melody has to be stored
// the same way text is: in appended, invisible parameters that an older project
// simply reads as zero. pitch * 512 + ticks fills those sixteen bits exactly.
//
// A tick is a ninety-sixth of a beat, which divides sixty-fourth notes (6
// ticks), thirty-second triplets (8) and everything coarser without a
// remainder. It does not fit in one slider beside the pitch, so a note is two:
//
//   melody slot : pitch * 512 + coarse        coarse in quarters of a tick unit
//   detail slot : velocity * 512 + extra      extra makes up the remainder
//
//   ticks = coarse * 4 + extra
//
// That split is what keeps 1.7.0 projects sounding the same. Their detail slots
// read as zero, so ticks = coarse * 4 — and since the tick unit is now four
// times finer, that is exactly the duration coarse meant when it was
// twenty-fourths. Velocity zero means the file said nothing about dynamics and
// the note is sung at the reference level, which is what those projects get.
inline constexpr std::size_t kMelodySlots = 64;
inline constexpr int kMelodyTicksPerBeat = 96;
// How many tick units one step of the coarse field is worth.
inline constexpr int kMelodyCoarseStride = 4;
inline constexpr int kMelodyMaxField = 511;
inline constexpr int kMelodySlotStride = 512;
// The longest note two fields can describe together.
inline constexpr int kMelodyMaxTicks =
    kMelodyMaxField * kMelodyCoarseStride + kMelodyMaxField;

struct MelodyNote {
    // MIDI note number, or zero for a rest. Losing note 0 costs nothing: it is
    // C-1 at 8.18 Hz, an octave below the bottom of a piano.
    int pitch = 0;
    int ticks = 0;
    // 1-127 as the file wrote it, or 0 for "no dynamics given".
    int velocity = 0;
};

struct MelodySlotPair {
    int melody = 0;
    int detail = 0;
};

inline constexpr int clamp_field(int value, int highest) {
    return value < 0 ? 0 : (value > highest ? highest : value);
}

inline constexpr MelodySlotPair encode_melody(int pitch, int ticks, int velocity) {
    const int held_ticks = clamp_field(ticks, kMelodyMaxTicks);
    const int coarse = clamp_field(held_ticks / kMelodyCoarseStride, kMelodyMaxField);
    const int extra = clamp_field(held_ticks - coarse * kMelodyCoarseStride, kMelodyMaxField);
    return MelodySlotPair{
        clamp_field(pitch, 127) * kMelodySlotStride + coarse,
        clamp_field(velocity, 127) * kMelodySlotStride + extra};
}

inline constexpr MelodyNote decode_melody(int melody_slot, int detail_slot) {
    const int melody = clamp_field(melody_slot, 65535);
    const int detail = clamp_field(detail_slot, 65535);
    return MelodyNote{
        melody / kMelodySlotStride,
        (melody % kMelodySlotStride) * kMelodyCoarseStride + (detail % kMelodySlotStride),
        detail / kMelodySlotStride};
}

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
    // Scales the vocal tract, and so every formant, without touching the pitch.
    // Below 1 is a smaller head, above 1 a larger one. 1.0 leaves each voice
    // preset exactly as it was.
    double formant = 1.0;
    SourceType source = SourceType::voice;
    // Multiplies the voice preset's own vibrato depth, so 1.0 changes nothing
    // and 0 removes the wobble entirely.
    double vibrato_depth = 1.0;
    double vibrato_rate = 9.2;

    // Singing.
    //
    // Every field here defaults to leaving the speaking engine exactly as it
    // was, and melody_mode false takes the same code paths it always took. That
    // is what stops a project saved before 1.7.0 changing how it sounds.
    //
    // melody_mode is separate from the melody being non-empty because the
    // importer has to ask how many syllables a lyric line has before it knows
    // which notes to give it, and the answer depends on the mode: a hyphen is a
    // held syllable when singing and an ordinary character when speaking.
    std::vector<MelodyNote> melody;
    bool melody_mode = false;
    double melody_bpm = 120.0;
    // Semitones added to every note, for a melody written outside the voice's
    // comfortable register.
    int transpose = 0;
    // How much of the Mandarin tone contour survives. A sung syllable holds its
    // note, so the full contour fights the melody; a little of it is what keeps
    // the diction sounding like Chinese.
    double tone_blend = 0.15;
    // Glide into each note from the one before it.
    double portamento_seconds = 0.040;
    // How long a note has to be held before the vibrato grows in. Vibrato from
    // the first sample reads as a wobble rather than as a singer.
    double vibrato_delay = 0.30;
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
    // The additive source, per event: its fundamental, how many harmonics are
    // summed, and the third formant they have to reach. count * frequency must
    // stay above top_formant or that formant has nothing to resonate, which is
    // what used to make the low voice presets sound muffled.
    std::vector<double> frequencies;
    std::vector<std::size_t> harmonic_counts;
    std::vector<double> top_formants;
    float peak = 0.0F;
    double duration_seconds = 0.0;
};

struct Result {
    std::vector<float> samples;
    Diagnostics diagnostics;
};

const std::vector<Voice>& voices();

// How many notes this text wants: one per syllable, plus one for each melisma.
//
// The song importer has to hand each lyric line the right number of notes, and
// only the engine knows how many that is. An English word is syllabified rather
// than spelled out, a phrase override can map several characters onto several
// readings, and in melody mode a hyphen asks for a note without being a
// syllable of its own. Counting characters in the panel would be the same
// mistake the timing plan already exists to prevent.
std::size_t syllable_count(const std::string& text, bool melody_mode);

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

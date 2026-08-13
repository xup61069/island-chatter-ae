#pragma once

#include <cstddef>

namespace island_chatter::ae {

// Parameter order is a persistent project-file contract. Keep this in sync
// with native/panel/IslandChatterNativePanel.jsx.
enum ParamIndex : int {
    kParamInput = 0,
    kParamVoice = 1,
    kParamPitch = 2,
    kParamSpeed = 3,
    kParamVolume = 4,
    kParamConsonant = 5,
    kParamTextLength = 6,
    kParamTextFirst = 7,
    kParamEmotion = kParamTextFirst + 64,
    kParamCharacterSize,
    kParamClarity,
    kParamCuteness,
    kParamSeed,
    // Appended in 1.0.3. Projects saved by 1.0.2 and earlier simply get its
    // default of off, which reproduces their existing timing exactly.
    kParamTempoLock,
    // Appended in 1.1.0. Their defaults reproduce the previous behaviour, so a
    // project saved by 1.0.x opens with the voice it had.
    kParamFormant,
    kParamSource,
    kParamVibratoDepth,
    kParamVibratoRate,
    // Appended in 1.3.0. Sixty-four UTF-16 units is a whole sentence in Chinese
    // but about ten words in English, so a second block doubles the transport.
    // It has to sit here rather than beside the first block, because the
    // indices in between are a saved-project contract.
    kParamTextSecondFirst,
    // Appended in 1.7.0, after the second text block, which is why the melody
    // begins at 145. A project saved before 1.7.0 reads every one of these as
    // its default, and a melody length of zero is what keeps it speaking.
    kParamMelodyLength = kParamTextSecondFirst + 64,
    kParamMelodyBpm,
    kParamMelodyTranspose,
    kParamToneBlend,
    kParamPortamento,
    kParamVibratoDelay,
    kParamMelodyFirst,
    // Appended in 1.8.0, one per melody slot: velocity and the fine part of the
    // note's length. A 1.7.0 project reads these as zero, which means no
    // dynamics and no extra length — and because the tick unit is now four
    // times finer, the coarse field alone still describes the same durations.
    kParamMelodyDetailFirst = kParamMelodyFirst + 64,
    /*
     * Appended in 3.2.0: a vowel space measured from the user's own voice.
     *
     * One flag and ten numbers — F1 and F2 for a, e, i, o, u, in Hz. They sit
     * after the melody's detail block for the same reason the melody sat after
     * the second text block: the indices below them are a saved-project
     * contract and may not move.
     *
     * A project saved before 3.2.0 reads the flag as zero and the ten as zero,
     * which is exactly "no measurement" — the engine's own table stands and the
     * line sounds the way it always did. That is what an appended parameter has
     * to be worth, and `dsp_tests.cpp` renders both cases and compares them
     * sample for sample.
     */
    kParamCustomTimbre = kParamMelodyDetailFirst + 64,
    kParamCustomVowelFirst,
};

// Units 0-63 live at kParamTextFirst, 64-127 at kParamTextSecondFirst.
inline constexpr std::size_t kTextUnitsPerBlock = 64;
inline constexpr std::size_t kMaxTextUnits = kTextUnitsPerBlock * 2;
// One slot per note, carrying pitch * 512 + ticks in the same 0-65535 range a
// text unit uses. Mirrors kMelodySlots in island_chatter/dsp.hpp; the plug-in
// static_asserts that the two agree.
inline constexpr std::size_t kMelodySlots = 64;
// Five vowels, two formants each, in the order a e i o u. Mirrors
// Settings::kCustomVowels in island_chatter/dsp.hpp; the plug-in
// static_asserts that the two agree.
inline constexpr std::size_t kCustomVowelValues = 10;
inline constexpr int kParamCount =
    kParamCustomVowelFirst + static_cast<int>(kCustomVowelValues);

static_assert(kParamSeed == 75, "Published parameter indices must never move");
static_assert(kParamTempoLock == 76, "Published parameter indices must never move");
static_assert(kParamTextSecondFirst == 81, "Published parameter indices must never move");
static_assert(kParamMelodyLength == 145, "Published parameter indices must never move");
static_assert(kParamMelodyFirst == 151, "Published parameter indices must never move");
static_assert(kParamMelodyDetailFirst == 215, "Published parameter indices must never move");
static_assert(kParamCustomTimbre == 279, "Published parameter indices must never move");
static_assert(kParamCustomVowelFirst == 280, "Published parameter indices must never move");
static_assert(kParamCount == 290, "Changing the parameter count breaks saved AE projects");

}  // namespace island_chatter::ae

// Island Chatter — driving the mouth from a recording instead of from text.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace island_chatter::analysis {

/*
 * What this is for.
 *
 * Everything downstream of the panel — markers, the rig, the mouth switch,
 * Fit Duration — is driven by a *plan*: a list of "at this sample, for this
 * long, with this mouth shape". The engine produces one from text. This
 * produces the same thing from a recording, so a real voice can drive the same
 * face, and so a voice that came from somewhere else entirely can too.
 *
 * The output format is deliberately identical, down to the byte, which is why
 * none of that downstream code changes.
 */

struct Audio {
    // Mono. However many channels the file had are averaged, because what is
    // being measured is when someone is speaking and how open their mouth is,
    // and neither is a property of one channel.
    std::vector<float> samples;
    std::uint32_t sample_rate = 0;
};

/*
 * Decode a WAV file held in memory.
 *
 * This is the one place in the project that reads a file the user chose, so it
 * is written the way midi.cpp is: every read is bounds checked against what is
 * actually there, every size in the file is treated as a claim rather than a
 * fact, and anything wrong comes back as a std::runtime_error carrying a
 * sentence a person can act on. It must never read past the buffer and must
 * never take a length from the file and trust it.
 *
 * Handles PCM 8/16/24/32-bit integer, 32/64-bit float, and
 * WAVE_FORMAT_EXTENSIBLE wrapping either. Compressed formats are refused by
 * name rather than by silence, because "nothing happened" is the worst possible
 * answer to someone who just picked an mp3.
 */
Audio read_wav(const std::vector<unsigned char>& bytes);

struct Settings {
    /*
     * How much of a peak has to be there before it counts as a syllable.
     *
     * 0 takes almost every bump, which is what a clean close-mic recording
     * wants; 1 takes only the obvious ones, which is what you need when there
     * is music underneath. It moves two thresholds together — how far the
     * energy must dip between two peaks, and how far above the file's own noise
     * floor a peak must sit — because tightening only one of them just trades
     * one kind of mistake for the other.
     */
    double sensitivity = 0.5;
    /*
     * Identify the vowel, or drive the mouth from loudness alone.
     *
     * Vowel identification is a guess and says so: on a clean voice it is
     * usually right, and on anything with music under it, it is not. Turning it
     * off gives every event the open shape, which with the rig's own
     * open-and-shut is the chatter look the product is named for and cannot be
     * wrong about anything.
     */
    bool identify_vowels = true;
};

/*
 * Times are seconds, not samples, and that is deliberate.
 *
 * Three different rates are in play — whatever the file was recorded at, the
 * 16 kHz the analysis runs at, and the 48 kHz the plan format counts in because
 * the panel divides by that constant rather than reading the RATE line. Seconds
 * is the only one of those that belongs in the answer; converting to the plan's
 * rate is the printer's job, and every test can then say what it means.
 */
struct Event {
    double start_seconds = 0.0;
    double length_seconds = 0.0;
    // 'a', 'i', 'u', 'e' or 'o'. The panel maps these to its six mouth shapes
    // through exactly the same path a spoken syllable's reading takes.
    char vowel = 'a';
    // False where the vowel could not be identified and the open shape was used
    // instead. Reported so the tests can measure how often that happens rather
    // than assume it.
    bool vowel_identified = false;
};

struct Result {
    std::vector<Event> events;
    // How long the recording is, which is what Fit Duration needs.
    double duration_seconds = 0.0;
    // How many events got a vowel rather than the fallback.
    std::size_t identified = 0;
};

Result analyse(const Audio& audio, const Settings& settings);

/*
 * The pieces, exposed because they are what the tests can actually pin.
 *
 * A test that only checks the finished plan can tell you it got worse but not
 * where, and the two halves fail for entirely different reasons: nuclei
 * detection fails on level and timing, vowel identification fails on spectrum.
 */
std::vector<float> resample(const std::vector<float>& samples,
                            std::uint32_t from_rate, std::uint32_t to_rate);

// F1 and F2 in Hz, from the peaks of the LPC spectral envelope. Either comes
// back as 0 where no peak was found in its range, which is the honest answer
// for silence and for a fricative.
struct Formants {
    double first = 0.0;
    double second = 0.0;
};
Formants formants_at(const std::vector<float>& samples, std::size_t centre,
                     std::uint32_t sample_rate);

// The analysis rate. Formants worth having all sit below 5 kHz, and the LPC
// order needed scales with the rate, so everything is done here rather than at
// whatever the file happened to be.
constexpr std::uint32_t kAnalysisRate = 16000;

}  // namespace island_chatter::analysis

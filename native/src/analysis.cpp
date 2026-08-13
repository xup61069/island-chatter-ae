// Island Chatter — driving the mouth from a recording instead of from text.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0

#include "island_chatter/analysis.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <stdexcept>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace island_chatter::analysis {
namespace {

/*
 * Reading a file somebody else chose.
 *
 * This and midi.cpp are the only two places in the project that parse bytes the
 * user handed over, and they are written the same way: nothing in the file is a
 * fact, every length is a claim to be checked against how many bytes are
 * actually there, and every failure comes back as a sentence rather than as a
 * crash inside After Effects. A WAV whose data chunk says it is four gigabytes
 * long is not unusual — it is what every truncated download looks like.
 */

std::uint32_t little32(const std::vector<unsigned char>& bytes, std::size_t at) {
    return static_cast<std::uint32_t>(bytes[at]) |
           (static_cast<std::uint32_t>(bytes[at + 1]) << 8U) |
           (static_cast<std::uint32_t>(bytes[at + 2]) << 16U) |
           (static_cast<std::uint32_t>(bytes[at + 3]) << 24U);
}

std::uint16_t little16(const std::vector<unsigned char>& bytes, std::size_t at) {
    return static_cast<std::uint16_t>(static_cast<std::uint32_t>(bytes[at]) |
                                      (static_cast<std::uint32_t>(bytes[at + 1]) << 8U));
}

std::uint32_t big32(const std::vector<unsigned char>& bytes, std::size_t at) {
    return (static_cast<std::uint32_t>(bytes[at]) << 24U) |
           (static_cast<std::uint32_t>(bytes[at + 1]) << 16U) |
           (static_cast<std::uint32_t>(bytes[at + 2]) << 8U) |
           static_cast<std::uint32_t>(bytes[at + 3]);
}

std::uint16_t big16(const std::vector<unsigned char>& bytes, std::size_t at) {
    return static_cast<std::uint16_t>((static_cast<std::uint32_t>(bytes[at]) << 8U) |
                                      static_cast<std::uint32_t>(bytes[at + 1]));
}

bool tag_is(const std::vector<unsigned char>& bytes, std::size_t at, const char* tag) {
    if (at + 4 > bytes.size()) { return false; }
    for (std::size_t index = 0; index < 4; ++index) {
        if (bytes[at + index] != static_cast<unsigned char>(tag[index])) { return false; }
    }
    return true;
}

/*
 * Name what they actually picked.
 *
 * "This is not a WAV file" is true of an mp3 and unhelpful about it. Someone
 * who has just chosen the only audio file on their desktop needs to be told
 * which thing they chose and what to do, because the fix — export it as a WAV —
 * is easy and completely invisible from the error.
 */
[[noreturn]] void refuse_unknown_container(const std::vector<unsigned char>& bytes) {
    if (bytes.size() >= 3 && bytes[0] == 'I' && bytes[1] == 'D' && bytes[2] == '3') {
        throw std::runtime_error("this is an MP3; export it as a WAV or AIFF first");
    }
    if (bytes.size() >= 2 && bytes[0] == 0xFFU && (bytes[1] & 0xE0U) == 0xE0U) {
        throw std::runtime_error("this is an MP3; export it as a WAV or AIFF first");
    }
    if (tag_is(bytes, 4, "ftyp")) {
        throw std::runtime_error("this is an MP4/M4A; export it as a WAV or AIFF first");
    }
    if (tag_is(bytes, 0, "OggS")) {
        throw std::runtime_error("this is an Ogg file; export it as a WAV or AIFF first");
    }
    if (tag_is(bytes, 0, "fLaC")) {
        throw std::runtime_error("this is a FLAC file; export it as a WAV or AIFF first");
    }
    throw std::runtime_error("this is not a WAV or AIFF file");
}

/*
 * How the bytes of one sample are to be read.
 *
 * Carried as a struct rather than as four loose booleans because two of them
 * disagree between the containers in a way that is easy to get backwards:
 * 8-bit WAV is unsigned and centred on 128, 8-bit AIFF is signed, and that has
 * nothing to do with the byte order the rest of the depths care about.
 */
struct SampleFormat {
    std::uint16_t bits = 16;
    bool is_float = false;
    bool big_endian = false;
    bool eight_bit_unsigned = false;
};

// One sample, from however many bytes and whatever the format said it was.
float decode_sample(const std::vector<unsigned char>& bytes, std::size_t at,
                    const SampleFormat& how) {
    const std::uint16_t bits = how.bits;
    const bool big_endian = how.big_endian;
    if (how.is_float) {
        if (bits == 32) {
            const std::uint32_t raw = big_endian ? big32(bytes, at) : little32(bytes, at);
            float out = 0.0F;
            std::memcpy(&out, &raw, sizeof(out));
            return std::isfinite(out) ? out : 0.0F;
        }
        // 64-bit doubles happen in files written by analysis tools.
        std::uint64_t raw = 0;
        for (std::size_t index = 0; index < 8; ++index) {
            const auto byte = static_cast<std::uint64_t>(bytes[at + index]);
            raw |= big_endian ? (byte << ((7 - index) * 8U)) : (byte << (index * 8U));
        }
        double out = 0.0;
        std::memcpy(&out, &raw, sizeof(out));
        return std::isfinite(out) ? static_cast<float>(out) : 0.0F;
    }
    switch (bits) {
        case 8:
            return how.eight_bit_unsigned
                ? (static_cast<float>(bytes[at]) - 128.0F) / 128.0F
                : static_cast<float>(static_cast<std::int8_t>(bytes[at])) / 128.0F;
        case 16: {
            const auto raw = static_cast<std::int16_t>(
                big_endian ? big16(bytes, at) : little16(bytes, at));
            return static_cast<float>(raw) / 32768.0F;
        }
        case 24: {
            std::int32_t raw = big_endian
                ? ((static_cast<std::int32_t>(bytes[at]) << 16) |
                   (static_cast<std::int32_t>(bytes[at + 1]) << 8) |
                   static_cast<std::int32_t>(bytes[at + 2]))
                : ((static_cast<std::int32_t>(bytes[at + 2]) << 16) |
                   (static_cast<std::int32_t>(bytes[at + 1]) << 8) |
                   static_cast<std::int32_t>(bytes[at]));
            // Sign-extend out of 24 bits.
            if (raw & 0x800000) { raw -= 0x1000000; }
            return static_cast<float>(raw) / 8388608.0F;
        }
        case 32: {
            const auto raw = static_cast<std::int32_t>(
                big_endian ? big32(bytes, at) : little32(bytes, at));
            return static_cast<float>(raw) / 2147483648.0F;
        }
        default:
            return 0.0F;
    }
}

// Fold however many channels there are down to one, and refuse politely rather
// than dividing by a channel count of zero.
Audio interleaved_to_mono(const std::vector<unsigned char>& bytes, std::size_t data_at,
                          std::size_t data_bytes, std::uint16_t channels,
                          const SampleFormat& how, std::uint32_t rate) {
    const std::size_t bytes_per_sample = how.bits / 8U;
    const std::size_t bytes_per_frame = bytes_per_sample * channels;
    if (bytes_per_frame == 0) {
        throw std::runtime_error("this file claims no channels or no bit depth");
    }
    const std::size_t frames = data_bytes / bytes_per_frame;
    Audio audio;
    audio.sample_rate = rate;
    audio.samples.resize(frames);
    for (std::size_t frame = 0; frame < frames; ++frame) {
        double sum = 0.0;
        for (std::uint16_t channel = 0; channel < channels; ++channel) {
            sum += decode_sample(bytes,
                                 data_at + (frame * bytes_per_frame) +
                                     (channel * bytes_per_sample),
                                 how);
        }
        audio.samples[frame] = static_cast<float>(sum / channels);
    }
    return audio;
}

Audio read_riff(const std::vector<unsigned char>& bytes) {
    std::uint16_t format = 0;
    std::uint16_t channels = 0;
    std::uint16_t bits = 0;
    std::uint32_t rate = 0;
    bool have_format = false;
    std::size_t data_at = 0;
    std::size_t data_bytes = 0;

    // Chunk walk. `cursor` only ever advances, and every step is bounded by
    // what is left, so a chunk claiming a size larger than the file stops the
    // walk instead of running off the end of it.
    std::size_t cursor = 12;
    while (cursor + 8 <= bytes.size()) {
        const std::size_t claimed = little32(bytes, cursor + 4);
        const std::size_t body = cursor + 8;
        const std::size_t available = bytes.size() - body;
        // A final chunk truncated by a failed download still has usable audio in
        // it, so the size is clamped rather than treated as fatal.
        const std::size_t size = std::min(claimed, available);
        if (tag_is(bytes, cursor, "fmt ")) {
            if (size < 16) { throw std::runtime_error("this WAV's format chunk is too short"); }
            format = little16(bytes, body);
            channels = little16(bytes, body + 2);
            rate = little32(bytes, body + 4);
            bits = little16(bytes, body + 14);
            // WAVE_FORMAT_EXTENSIBLE hides the real format in a GUID whose
            // first two bytes are the format tag it stands for.
            if (format == 0xFFFEU && size >= 40) {
                format = little16(bytes, body + 24);
            }
            have_format = true;
        } else if (tag_is(bytes, cursor, "data")) {
            data_at = body;
            data_bytes = size;
        }
        // Chunks are padded to an even length, and the pad byte is not counted.
        // Chunks are padded to an even length and the pad byte is not counted.
        // cursor gains at least 8 every time round, so the walk terminates even
        // on a file that is nothing but empty chunks.
        cursor = body + size + (size & 1U);
    }
    if (!have_format) { throw std::runtime_error("this WAV has no format chunk"); }
    if (data_bytes == 0) { throw std::runtime_error("this WAV has no audio in it"); }
    if (format != 1 && format != 3) {
        throw std::runtime_error(
            "this WAV is compressed; save it as uncompressed PCM and try again");
    }
    const bool is_float = format == 3;
    if (is_float ? (bits != 32 && bits != 64)
                 : (bits != 8 && bits != 16 && bits != 24 && bits != 32)) {
        throw std::runtime_error("this WAV's bit depth is not one this can read");
    }
    if (channels == 0) { throw std::runtime_error("this WAV claims no channels"); }
    if (rate < 4000 || rate > 768000) {
        throw std::runtime_error("this WAV's sample rate is not a believable one");
    }
    SampleFormat how;
    how.bits = bits;
    how.is_float = is_float;
    how.big_endian = false;
    how.eight_bit_unsigned = true;   // which is what WAV means by 8-bit
    return interleaved_to_mono(bytes, data_at, data_bytes, channels, how, rate);
}

/*
 * AIFF, because that is what After Effects itself renders.
 *
 * A stock install has no WAV output template — the project's own audio test
 * uses "AIFF 48kHz" for exactly that reason — so refusing AIFF would refuse the
 * most obvious way a user has of getting audio out of the composition they are
 * working in.
 *
 * The sample rate is an 80-bit extended float, which is the one genuinely
 * awkward thing in the format. It is read by hand rather than by pretending it
 * is a double, because it is not one.
 */
double extended80(const std::vector<unsigned char>& bytes, std::size_t at) {
    const std::uint16_t exponent = big16(bytes, at);
    std::uint64_t mantissa = 0;
    for (std::size_t index = 0; index < 8; ++index) {
        mantissa = (mantissa << 8U) | bytes[at + 2 + index];
    }
    const int unbiased = static_cast<int>(exponent & 0x7FFFU) - 16383 - 63;
    if ((exponent & 0x7FFFU) == 0 && mantissa == 0) { return 0.0; }
    const double value = std::ldexp(static_cast<double>(mantissa), unbiased);
    return (exponent & 0x8000U) ? -value : value;
}

Audio read_aiff(const std::vector<unsigned char>& bytes) {
    const bool is_aifc = tag_is(bytes, 8, "AIFC");
    std::uint16_t channels = 0;
    std::uint16_t bits = 0;
    double rate = 0.0;
    bool have_common = false;
    bool is_float = false;
    // AIFF is big-endian; AIFC's "sowt" means the samples are little-endian
    // after all, which is what macOS writes more often than not.
    bool big_endian = true;
    std::size_t data_at = 0;
    std::size_t data_bytes = 0;

    std::size_t cursor = 12;
    while (cursor + 8 <= bytes.size()) {
        const std::size_t claimed = big32(bytes, cursor + 4);
        const std::size_t body = cursor + 8;
        const std::size_t size = std::min(claimed, bytes.size() - body);
        if (tag_is(bytes, cursor, "COMM")) {
            if (size < 18) { throw std::runtime_error("this AIFF's COMM chunk is too short"); }
            channels = big16(bytes, body);
            bits = big16(bytes, body + 6);
            rate = extended80(bytes, body + 8);
            if (is_aifc && size >= 22) {
                if (tag_is(bytes, body + 18, "sowt")) { big_endian = false; }
                else if (tag_is(bytes, body + 18, "fl32") || tag_is(bytes, body + 18, "FL32")) {
                    is_float = true;
                }
                else if (!tag_is(bytes, body + 18, "NONE")) {
                    throw std::runtime_error(
                        "this AIFF is compressed; save it as uncompressed PCM and try again");
                }
            }
            have_common = true;
        } else if (tag_is(bytes, cursor, "SSND")) {
            if (size < 8) { throw std::runtime_error("this AIFF's sound chunk is too short"); }
            // The first eight bytes are an offset and a block size, neither of
            // which anything writes as non-zero, but the offset is honoured
            // because ignoring it would shift every sample.
            const std::size_t offset = big32(bytes, body);
            if (offset + 8 > size) {
                throw std::runtime_error("this AIFF's sound chunk points outside itself");
            }
            data_at = body + 8 + offset;
            data_bytes = size - 8 - offset;
        }
        cursor = body + size + (size & 1U);
    }
    if (!have_common) { throw std::runtime_error("this AIFF has no COMM chunk"); }
    if (data_bytes == 0) { throw std::runtime_error("this AIFF has no audio in it"); }
    if (channels == 0) { throw std::runtime_error("this AIFF claims no channels"); }
    if (is_float ? bits != 32 : (bits != 8 && bits != 16 && bits != 24 && bits != 32)) {
        throw std::runtime_error("this AIFF's bit depth is not one this can read");
    }
    if (rate < 4000.0 || rate > 768000.0) {
        throw std::runtime_error("this AIFF's sample rate is not a believable one");
    }
    SampleFormat how;
    how.bits = bits;
    how.is_float = is_float;
    how.big_endian = big_endian;
    how.eight_bit_unsigned = false;  // AIFF's 8-bit is signed
    return interleaved_to_mono(bytes, data_at, data_bytes, channels, how,
                               static_cast<std::uint32_t>(std::lround(rate)));
}

}  // namespace

Audio read_wav(const std::vector<unsigned char>& bytes) {
    if (bytes.size() < 16) {
        throw std::runtime_error("this file is too short to be an audio file");
    }
    if (tag_is(bytes, 0, "RIFF") && tag_is(bytes, 8, "WAVE")) { return read_riff(bytes); }
    if (tag_is(bytes, 0, "FORM") && (tag_is(bytes, 8, "AIFF") || tag_is(bytes, 8, "AIFC"))) {
        return read_aiff(bytes);
    }
    refuse_unknown_container(bytes);
}

namespace {

/*
 * Decimating without filtering first folds everything above the new Nyquist
 * back down and lands it on top of the formants this whole file exists to
 * measure. A windowed sinc rather than anything cheaper, for the same reason:
 * the point of the resample is to leave the spectral peaks where they were.
 */
std::vector<float> low_pass(const std::vector<float>& in, std::uint32_t rate,
                            double cutoff_hz) {
    if (in.empty() || rate == 0) { return in; }
    const int half = 31;
    const double cutoff = std::min(0.49, cutoff_hz / static_cast<double>(rate));
    std::vector<double> kernel(static_cast<std::size_t>(2 * half + 1));
    double sum = 0.0;
    for (int tap = -half; tap <= half; ++tap) {
        const double sinc = tap == 0
            ? 2.0 * cutoff
            : std::sin(2.0 * M_PI * cutoff * tap) / (M_PI * tap);
        const double window =
            0.5 - 0.5 * std::cos(2.0 * M_PI * (tap + half) / (2.0 * half));
        kernel[static_cast<std::size_t>(tap + half)] = sinc * window;
        sum += sinc * window;
    }
    for (auto& tap : kernel) { tap /= sum; }

    std::vector<float> out(in.size());
    const auto last = static_cast<std::ptrdiff_t>(in.size()) - 1;
    for (std::size_t index = 0; index < in.size(); ++index) {
        double total = 0.0;
        for (int tap = -half; tap <= half; ++tap) {
            // Clamped at the edges rather than zero-padded: a recording that
            // starts mid-word would otherwise get a fade-in that the nuclei
            // detector reads as an onset that is not there.
            const auto at = std::clamp<std::ptrdiff_t>(
                static_cast<std::ptrdiff_t>(index) + tap, 0, last);
            total += kernel[static_cast<std::size_t>(tap + half)] *
                     in[static_cast<std::size_t>(at)];
        }
        out[index] = static_cast<float>(total);
    }
    return out;
}

// 10 ms between frames, 25 ms of audio in each: the standard pair, and short
// enough that the shortest syllable anyone speaks still spans several.
constexpr double kHopSeconds = 0.010;
constexpr double kWindowSeconds = 0.025;
// Two peaks closer together than this are one syllable measured twice. At the
// engine's default speed syllables land about 170 ms apart, and nobody speaks
// four times that fast.
constexpr double kClosestSyllableSeconds = 0.055;
// A mouth shape held for less than this reads as a flicker rather than as a
// shape, which is the same thing invariant 8x is about.
constexpr double kShortestEventSeconds = 0.060;

std::vector<double> energy_db(const std::vector<float>& mono, std::uint32_t rate) {
    const auto hop = static_cast<std::size_t>(rate * kHopSeconds);
    const auto window = static_cast<std::size_t>(rate * kWindowSeconds);
    std::vector<double> frames;
    if (hop == 0 || window == 0 || mono.size() < window) { return frames; }
    frames.reserve((mono.size() - window) / hop + 1);
    for (std::size_t at = 0; at + window <= mono.size(); at += hop) {
        double total = 0.0;
        for (std::size_t index = 0; index < window; ++index) {
            const double weight =
                0.5 - 0.5 * std::cos(2.0 * M_PI * index / (window - 1));
            const double value = mono[at + index] * weight;
            total += value * value;
        }
        const double rms = std::sqrt(total / window);
        // Floored well below anything audible so silence is a number rather
        // than negative infinity.
        frames.push_back(20.0 * std::log10(std::max(rms, 1e-7)));
    }
    return frames;
}

/*
 * Interpolated, not the nearest sample below.
 *
 * Truncating the index looks harmless and is not: with four values the 90th
 * percentile lands on the third of them and the largest is thrown away
 * entirely. That is exactly the case here — a short line has a handful of
 * vowels in it — and it made the measured range look too narrow, which tripped
 * the widening below, which moved every vowel off its prototype. The five
 * textbook vowels came back as a, e, o, e, a.
 */
double percentile(std::vector<double> values, double fraction) {
    if (values.empty()) { return 0.0; }
    std::sort(values.begin(), values.end());
    if (values.size() == 1) { return values[0]; }
    const double at =
        std::clamp(fraction, 0.0, 1.0) * static_cast<double>(values.size() - 1);
    const auto below = static_cast<std::size_t>(at);
    const auto above = std::min(below + 1, values.size() - 1);
    return values[below] + ((values[above] - values[below]) * (at - below));
}

struct Nucleus {
    std::size_t peak = 0;
    std::size_t from = 0;
    std::size_t to = 0;
};

/*
 * Where the syllables are.
 *
 * A syllable is a peak in loudness with a dip on either side — which is the
 * oldest trick in the book and the reason it is used here is that it needs no
 * dictionary and no training data, so it works the same on Mandarin, Japanese
 * and English. What it cannot do is tell a syllable from a drum hit, which is
 * what the sensitivity control is for.
 *
 * Sensitivity moves two thresholds together. Tightening only the dip lets
 * quiet noise through; tightening only the floor merges real syllables that
 * happen to be loud. Neither alone behaves the way "be stricter" ought to.
 */
std::vector<Nucleus> find_nuclei(const std::vector<double>& db, double sensitivity) {
    std::vector<Nucleus> found;
    if (db.size() < 3) { return found; }
    const double floor_db = percentile(db, 0.05);
    const double loud_db = percentile(db, 0.95);
    // Either silence, or something with no dynamics at all such as a held tone
    // or a hum. Reporting no syllables is the honest answer to both.
    if (loud_db - floor_db < 6.0) { return found; }

    const double reach = loud_db - floor_db;
    /*
     * Two different questions, and the second one is what actually separates a
     * syllable from clutter.
     *
     * "Is this above the noise floor" is the obvious threshold and it is not
     * enough: a chair creaking in the gap between two words is well above the
     * floor of the room it was recorded in, and passes. What tells it apart
     * from speech is that it is far quieter than the speech — so a peak also
     * has to sit within a certain range of the loudest thing in the file. At
     * the strict end that range is 15 dB, which is roughly "as loud as
     * talking"; at the loose end it is 35 dB, which takes almost anything.
     *
     * The floor rule alone was tried first and let a bump at a twelfth of the
     * amplitude of a real syllable through at every sensitivity, which made the
     * control look like it did nothing.
     */
    const double silence = std::max(floor_db + reach * (0.10 + 0.30 * sensitivity),
                                    loud_db - (35.0 - (20.0 * sensitivity)));
    const double dip = 2.0 + 6.0 * sensitivity;
    const auto closest =
        static_cast<std::size_t>(kClosestSyllableSeconds / kHopSeconds);

    std::vector<std::size_t> peaks;
    for (std::size_t at = 1; at + 1 < db.size(); ++at) {
        if (db[at] < silence) { continue; }
        if (db[at] < db[at - 1] || db[at] < db[at + 1]) { continue; }
        if (peaks.empty()) { peaks.push_back(at); continue; }
        const std::size_t previous = peaks.back();
        double lowest = db[previous];
        for (std::size_t between = previous; between <= at; ++between) {
            lowest = std::min(lowest, db[between]);
        }
        const bool separated = std::min(db[previous], db[at]) - lowest >= dip &&
                               at - previous >= closest;
        if (separated) {
            peaks.push_back(at);
        } else if (db[at] > db[previous]) {
            // Same syllable, measured twice. Keep the louder frame as its peak
            // so the formant window lands on the steadiest part of the vowel.
            peaks.back() = at;
        }
    }

    for (std::size_t index = 0; index < peaks.size(); ++index) {
        Nucleus nucleus;
        nucleus.peak = peaks[index];
        // Where one syllable ends and the next begins is the quietest frame
        // between them; the ends of the whole utterance are wherever the sound
        // drops below the floor, which is what leaves silence uncovered — and
        // silence uncovered is what closes the mouth, for free, through the
        // rule the rig already has.
        std::size_t left_limit = 0;
        if (index > 0) {
            left_limit = peaks[index - 1];
            for (std::size_t at = peaks[index - 1]; at <= peaks[index]; ++at) {
                if (db[at] < db[left_limit]) { left_limit = at; }
            }
        }
        std::size_t right_limit = db.size() - 1;
        if (index + 1 < peaks.size()) {
            right_limit = peaks[index];
            for (std::size_t at = peaks[index]; at <= peaks[index + 1]; ++at) {
                if (db[at] < db[right_limit]) { right_limit = at; }
            }
        }
        nucleus.from = nucleus.peak;
        while (nucleus.from > left_limit && db[nucleus.from - 1] >= silence) {
            nucleus.from -= 1;
        }
        nucleus.to = nucleus.peak;
        while (nucleus.to < right_limit && db[nucleus.to + 1] >= silence) {
            nucleus.to += 1;
        }
        found.push_back(nucleus);
    }
    return found;
}

/*
 * Where a vowel sits, once the speaker is accounted for.
 *
 * F1 tracks how open the mouth is and F2 how far forward the tongue is, which
 * is exactly the two things a mouth shape shows — but both scale with the
 * length of the speaker's vocal tract, so a child's /a/ has formants where an
 * adult's /e/ has them. Absolute thresholds therefore cannot work on a product
 * that has no idea whose voice it is being given.
 *
 * So the file is measured against itself: the range this speaker actually used
 * becomes the axes. The failure case is a file that contains only one vowel,
 * where stretching a narrow range to full width would invent an /i/ and a /u/
 * that were never said — so a range that is too narrow to be a real spread is
 * widened to a typical one, centred where this speaker sits.
 */
struct VowelSpace {
    double first_low = 280.0;
    double first_high = 900.0;
    double second_low = 850.0;
    double second_high = 2400.0;
};

VowelSpace measure_space(const std::vector<Formants>& seen) {
    VowelSpace space;
    std::vector<double> firsts;
    std::vector<double> seconds;
    for (const auto& one : seen) {
        if (one.first > 0.0 && one.second > 0.0) {
            firsts.push_back(one.first);
            seconds.push_back(one.second);
        }
    }
    if (firsts.size() < 4) { return space; }
    const double default_first = space.first_high - space.first_low;
    const double default_second = space.second_high - space.second_low;
    double first_low = percentile(firsts, 0.10);
    double first_high = percentile(firsts, 0.90);
    double second_low = percentile(seconds, 0.10);
    double second_high = percentile(seconds, 0.90);
    if (first_high - first_low < default_first * 0.5) {
        const double centre = (first_high + first_low) * 0.5;
        first_low = centre - default_first * 0.5;
        first_high = centre + default_first * 0.5;
    }
    if (second_high - second_low < default_second * 0.5) {
        const double centre = (second_high + second_low) * 0.5;
        second_low = centre - default_second * 0.5;
        second_high = centre + default_second * 0.5;
    }
    space.first_low = first_low;
    space.first_high = first_high;
    space.second_low = second_low;
    space.second_high = second_high;
    return space;
}

// Openness and frontness, both 0 to 1, and where each of the five vowels lives
// in those terms. The numbers are the ordinary vowel chart; what makes them
// usable is that the axes came from this speaker.
char nearest_vowel(const Formants& one, const VowelSpace& space) {
    const double openness = std::clamp(
        (one.first - space.first_low) / (space.first_high - space.first_low), 0.0, 1.0);
    const double frontness = std::clamp(
        (one.second - space.second_low) / (space.second_high - space.second_low), 0.0, 1.0);
    struct Prototype { char vowel; double openness; double frontness; };
    static const Prototype prototypes[] = {
        { 'i', 0.05, 0.95 },
        { 'e', 0.40, 0.78 },
        { 'a', 0.95, 0.42 },
        { 'o', 0.45, 0.18 },
        { 'u', 0.08, 0.05 },
    };
    char best = 'a';
    double closest = 1e9;
    for (const auto& prototype : prototypes) {
        const double first = openness - prototype.openness;
        const double second = frontness - prototype.frontness;
        const double distance = (first * first) + (second * second);
        if (distance < closest) { closest = distance; best = prototype.vowel; }
    }
    return best;
}

}  // namespace

std::vector<float> resample(const std::vector<float>& samples,
                            std::uint32_t from_rate, std::uint32_t to_rate) {
    if (samples.empty() || from_rate == 0 || to_rate == 0) { return {}; }
    if (from_rate == to_rate) { return samples; }
    const std::vector<float> filtered =
        to_rate < from_rate
            ? low_pass(samples, from_rate, 0.45 * static_cast<double>(to_rate))
            : samples;
    const double step = static_cast<double>(from_rate) / static_cast<double>(to_rate);
    const auto count = static_cast<std::size_t>(
        static_cast<double>(samples.size()) / step);
    std::vector<float> out(count);
    const std::size_t last = filtered.empty() ? 0 : filtered.size() - 1;
    for (std::size_t index = 0; index < count; ++index) {
        const double at = static_cast<double>(index) * step;
        const auto whole = static_cast<std::size_t>(at);
        const double fraction = at - static_cast<double>(whole);
        const float left = filtered[std::min(whole, last)];
        const float right = filtered[std::min(whole + 1, last)];
        out[index] = static_cast<float>(left + ((right - left) * fraction));
    }
    return out;
}

/*
 * F1 and F2, from the peaks of the LPC spectral envelope.
 *
 * The textbook route is to root the prediction polynomial, which for order 20
 * means a root finder and its convergence failures. Evaluating the envelope on
 * a frequency grid and taking its first two peaks needs neither, and answers
 * the only question being asked — *where* are the two lowest resonances — to
 * far better than the accuracy the five-way classification downstream can use.
 */
Formants formants_at(const std::vector<float>& samples, std::size_t centre,
                     std::uint32_t sample_rate) {
    Formants formants;
    const auto window = static_cast<std::size_t>(sample_rate * 0.030);
    if (window < 64 || samples.size() < window) { return formants; }
    std::size_t from = centre > window / 2 ? centre - (window / 2) : 0;
    if (from + window > samples.size()) { from = samples.size() - window; }

    // Pre-emphasis lifts the higher formants back up out of the -6 dB/octave
    // tilt of the glottal source, without which F2 hides under F1's skirt.
    std::vector<double> frame(window);
    for (std::size_t index = 0; index < window; ++index) {
        const double now = samples[from + index];
        const double before = (from + index) == 0 ? 0.0 : samples[from + index - 1];
        const double weight = 0.5 - 0.5 * std::cos(2.0 * M_PI * index / (window - 1));
        frame[index] = (now - (0.97 * before)) * weight;
    }

    const std::size_t order = (sample_rate / 1000) + 4;
    std::vector<double> correlation(order + 1, 0.0);
    for (std::size_t lag = 0; lag <= order; ++lag) {
        double total = 0.0;
        for (std::size_t index = lag; index < window; ++index) {
            total += frame[index] * frame[index - lag];
        }
        correlation[lag] = total;
    }
    if (correlation[0] <= 1e-12) { return formants; }

    // Levinson-Durbin, in the convention where A(z) = 1 - sum a_k z^-k.
    std::vector<double> a(order + 1, 0.0);
    std::vector<double> previous(order + 1, 0.0);
    double error = correlation[0];
    for (std::size_t step = 1; step <= order; ++step) {
        double accumulated = correlation[step];
        for (std::size_t index = 1; index < step; ++index) {
            accumulated -= a[index] * correlation[step - index];
        }
        const double reflection = accumulated / error;
        if (!std::isfinite(reflection)) { return formants; }
        previous = a;
        for (std::size_t index = 1; index < step; ++index) {
            a[index] = previous[index] - (reflection * previous[step - index]);
        }
        a[step] = reflection;
        error *= 1.0 - (reflection * reflection);
        // A perfectly predictable frame — a pure tone, or digital silence that
        // survived the energy check. There are no formants to report.
        if (error <= 1e-12) { return formants; }
    }

    const double top = std::min(5000.0, sample_rate * 0.45);
    const std::size_t points = 512;
    std::vector<double> envelope(points, 0.0);
    std::vector<double> hertz(points, 0.0);
    for (std::size_t point = 0; point < points; ++point) {
        const double frequency =
            90.0 + ((top - 90.0) * static_cast<double>(point) / (points - 1));
        const double omega = 2.0 * M_PI * frequency / sample_rate;
        double real = 1.0;
        double imaginary = 0.0;
        for (std::size_t index = 1; index <= order; ++index) {
            real -= a[index] * std::cos(omega * index);
            imaginary += a[index] * std::sin(omega * index);
        }
        const double magnitude = std::sqrt((real * real) + (imaginary * imaginary));
        envelope[point] = magnitude > 1e-12 ? 1.0 / magnitude : 0.0;
        hertz[point] = frequency;
    }

    std::vector<double> peaks;
    for (std::size_t point = 1; point + 1 < points; ++point) {
        if (envelope[point] > envelope[point - 1] && envelope[point] > envelope[point + 1]) {
            peaks.push_back(hertz[point]);
        }
    }
    for (const double peak : peaks) {
        if (formants.first == 0.0) {
            if (peak >= 200.0 && peak <= 1100.0) { formants.first = peak; }
            continue;
        }
        // 150 Hz apart, not 250. A back rounded vowel puts F1 and F2 close
        // together on purpose — /o/ is around 570 and 840 — and demanding a
        // wider gap threw the whole vowel away rather than reading it as the
        // back vowel that gap is the signature of.
        if (peak >= std::max(600.0, formants.first + 150.0) && peak <= 3200.0) {
            formants.second = peak;
            break;
        }
    }
    /*
     * Two resonances close enough that the envelope shows one hump.
     *
     * That is not a failure to measure, it is what a back rounded vowel looks
     * like, and calling it unidentified throws away the clearest /o/ and /u/ in
     * the file. Reporting the peak as both formants puts it at the back of the
     * vowel space, which is where it belongs; the openness of the single peak
     * then decides between /o/ and /u/ on its own.
     */
    if (formants.first > 0.0 && formants.second == 0.0 && formants.first <= 800.0) {
        formants.second = formants.first;
    }
    if (formants.second == 0.0) { formants.first = 0.0; }
    return formants;
}

Result analyse(const Audio& audio, const Settings& settings) {
    Result result;
    if (audio.sample_rate == 0 || audio.samples.empty()) { return result; }
    result.duration_seconds =
        static_cast<double>(audio.samples.size()) / audio.sample_rate;

    const auto mono = resample(audio.samples, audio.sample_rate, kAnalysisRate);
    const auto db = energy_db(mono, kAnalysisRate);
    const auto nuclei =
        find_nuclei(db, std::clamp(settings.sensitivity, 0.0, 1.0));
    if (nuclei.empty()) { return result; }

    std::vector<Formants> measured(nuclei.size());
    if (settings.identify_vowels) {
        for (std::size_t index = 0; index < nuclei.size(); ++index) {
            const auto centre = static_cast<std::size_t>(
                nuclei[index].peak * kHopSeconds * kAnalysisRate);
            measured[index] = formants_at(mono, centre, kAnalysisRate);
        }
    }
    const VowelSpace space = measure_space(measured);

    result.events.reserve(nuclei.size());
    for (std::size_t index = 0; index < nuclei.size(); ++index) {
        Event event;
        event.start_seconds = nuclei[index].from * kHopSeconds;
        event.length_seconds =
            ((nuclei[index].to - nuclei[index].from) * kHopSeconds) + kWindowSeconds;
        event.length_seconds = std::max(event.length_seconds, kShortestEventSeconds);
        // Never past the end of the recording: Fit Duration would size the
        // layer to an event that describes audio nobody has.
        event.length_seconds = std::min(
            event.length_seconds,
            std::max(0.0, result.duration_seconds - event.start_seconds));
        if (measured[index].first > 0.0 && measured[index].second > 0.0) {
            event.vowel = nearest_vowel(measured[index], space);
            event.vowel_identified = true;
            result.identified += 1;
        } else {
            // Unvoiced, or too noisy to call. The open shape plus the rig's own
            // open-and-shut is the chatter look this product is named for, and
            // it cannot be wrong about a vowel it never claimed.
            event.vowel = 'a';
            event.vowel_identified = false;
        }
        result.events.push_back(event);
    }
    return result;
}

}  // namespace island_chatter::analysis

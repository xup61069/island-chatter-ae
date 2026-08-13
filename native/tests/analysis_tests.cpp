// Island Chatter — tests for reading a recording and finding the mouth in it.
// SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0

#include "island_chatter/analysis.hpp"
#include "island_chatter/dsp.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace {

int failures = 0;

void require(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        failures += 1;
    }
}

void note(const std::string& message) { std::cout << "  " << message << '\n'; }

using Bytes = std::vector<unsigned char>;

void put8(Bytes& out, int value) { out.push_back(static_cast<unsigned char>(value & 0xFF)); }
void little16(Bytes& out, int value) { put8(out, value); put8(out, value >> 8); }
void little32(Bytes& out, std::uint32_t value) {
    put8(out, static_cast<int>(value));
    put8(out, static_cast<int>(value >> 8));
    put8(out, static_cast<int>(value >> 16));
    put8(out, static_cast<int>(value >> 24));
}
void big16(Bytes& out, int value) { put8(out, value >> 8); put8(out, value); }
void big32(Bytes& out, std::uint32_t value) {
    put8(out, static_cast<int>(value >> 24));
    put8(out, static_cast<int>(value >> 16));
    put8(out, static_cast<int>(value >> 8));
    put8(out, static_cast<int>(value));
}
void tag(Bytes& out, const char* letters) {
    for (const char* letter = letters; *letter != '\0'; ++letter) { put8(out, *letter); }
}

// A 16-bit PCM WAV around whatever samples it is given, so the reader can be
// tested against something whose right answer is known exactly.
Bytes wav16(const std::vector<float>& samples, std::uint32_t rate, std::uint16_t channels) {
    Bytes out;
    const auto data_bytes = static_cast<std::uint32_t>(samples.size() * 2);
    tag(out, "RIFF");
    little32(out, 36U + data_bytes);
    tag(out, "WAVE");
    tag(out, "fmt ");
    little32(out, 16U);
    little16(out, 1);
    little16(out, channels);
    little32(out, rate);
    little32(out, rate * 2U * channels);
    little16(out, static_cast<int>(2 * channels));
    little16(out, 16);
    tag(out, "data");
    little32(out, data_bytes);
    for (const float sample : samples) {
        const auto pcm = static_cast<std::int16_t>(
            std::lround(std::clamp(sample, -1.0F, 1.0F) * 32767.0F));
        little16(out, static_cast<std::uint16_t>(pcm));
    }
    return out;
}

Bytes aiff16(const std::vector<float>& samples, std::uint32_t rate) {
    Bytes body;
    tag(body, "AIFF");
    Bytes common;
    big16(common, 1);                                        // channels
    big32(common, static_cast<std::uint32_t>(samples.size()));
    big16(common, 16);                                       // bits
    // 80-bit extended, built by hand for a whole-number rate.
    int exponent = 16383 + 31;
    std::uint64_t mantissa = static_cast<std::uint64_t>(rate) << 32U;
    while (mantissa != 0 && (mantissa & (1ULL << 63U)) == 0) { mantissa <<= 1U; exponent -= 1; }
    big16(common, exponent);
    for (int shift = 56; shift >= 0; shift -= 8) {
        put8(common, static_cast<int>((mantissa >> shift) & 0xFFU));
    }
    tag(body, "COMM");
    big32(body, static_cast<std::uint32_t>(common.size()));
    body.insert(body.end(), common.begin(), common.end());

    Bytes sound;
    big32(sound, 0);   // offset
    big32(sound, 0);   // block size
    for (const float sample : samples) {
        const auto pcm = static_cast<std::int16_t>(
            std::lround(std::clamp(sample, -1.0F, 1.0F) * 32767.0F));
        big16(sound, static_cast<std::uint16_t>(pcm));
    }
    tag(body, "SSND");
    big32(body, static_cast<std::uint32_t>(sound.size()));
    body.insert(body.end(), sound.begin(), sound.end());

    Bytes out;
    tag(out, "FORM");
    big32(out, static_cast<std::uint32_t>(body.size()));
    out.insert(out.end(), body.begin(), body.end());
    return out;
}

std::string threw(const Bytes& bytes) {
    try {
        island_chatter::analysis::read_wav(bytes);
    } catch (const std::exception& error) {
        return error.what();
    }
    return "";
}

/*
 * A vowel, built the way a vowel is: a buzz through two resonances.
 *
 * The point of testing against this rather than against a recording is that the
 * right answer is a number that was put in on purpose, so "F1 came back as 690"
 * can be judged instead of admired.
 */
std::vector<float> synth_vowel(double first, double second, double seconds,
                               std::uint32_t rate, double fundamental = 120.0) {
    const auto count = static_cast<std::size_t>(seconds * rate);
    std::vector<float> out(count, 0.0F);
    const auto period = static_cast<std::size_t>(rate / fundamental);
    for (std::size_t index = 0; index < count; index += period) { out[index] = 1.0F; }
    for (const double formant : { first, second }) {
        const double bandwidth = 80.0;
        const double radius = std::exp(-M_PI * bandwidth / rate);
        const double angle = 2.0 * M_PI * formant / rate;
        double back_one = 0.0;
        double back_two = 0.0;
        for (std::size_t index = 0; index < count; ++index) {
            const double value = out[index] + (2.0 * radius * std::cos(angle) * back_one) -
                                 (radius * radius * back_two);
            back_two = back_one;
            back_one = value;
            out[index] = static_cast<float>(value);
        }
    }
    double loudest = 0.0;
    for (const float sample : out) { loudest = std::max(loudest, std::fabs(static_cast<double>(sample))); }
    if (loudest > 0.0) {
        for (float& sample : out) { sample = static_cast<float>(sample / loudest * 0.8); }
    }
    return out;
}

void silence(std::vector<float>& out, double seconds, std::uint32_t rate) {
    out.insert(out.end(), static_cast<std::size_t>(seconds * rate), 0.0F);
}

void testReaderRoundTrip() {
    std::vector<float> samples;
    for (std::size_t index = 0; index < 4800; ++index) {
        samples.push_back(static_cast<float>(std::sin(index * 0.05) * 0.5));
    }
    const auto audio = island_chatter::analysis::read_wav(wav16(samples, 48000, 1));
    require(audio.sample_rate == 48000, "a 48 kHz WAV reads back as 48 kHz");
    require(audio.samples.size() == samples.size(), "every frame comes back");
    double worst = 0.0;
    for (std::size_t index = 0; index < samples.size(); ++index) {
        worst = std::max(worst, std::fabs(static_cast<double>(audio.samples[index] - samples[index])));
    }
    require(worst < 1.0 / 32000.0, "16-bit samples survive to within a quantisation step");

    // Two channels carrying opposite signals average to nothing, which is the
    // clearest possible proof the fold is a fold and not a first-channel pick.
    std::vector<float> stereo;
    for (std::size_t index = 0; index < 1000; ++index) {
        stereo.push_back(0.5F);
        stereo.push_back(-0.5F);
    }
    const auto folded = island_chatter::analysis::read_wav(wav16(stereo, 44100, 2));
    require(folded.samples.size() == 1000, "a stereo file gives one frame per frame");
    double loudest = 0.0;
    for (const float sample : folded.samples) { loudest = std::max(loudest, std::fabs(static_cast<double>(sample))); }
    require(loudest < 0.001, "opposite channels average to silence rather than to one of them");

    const auto aiff = island_chatter::analysis::read_wav(aiff16(samples, 48000));
    require(aiff.sample_rate == 48000, "an AIFF's 80-bit sample rate decodes to 48 kHz");
    require(aiff.samples.size() == samples.size(), "an AIFF gives back every frame");
    worst = 0.0;
    for (std::size_t index = 0; index < samples.size(); ++index) {
        worst = std::max(worst, std::fabs(static_cast<double>(aiff.samples[index] - samples[index])));
    }
    require(worst < 1.0 / 32000.0, "AIFF samples are big-endian and read as such");
}

/*
 * Everything a file can be wrong about.
 *
 * This is the one input in the product that a stranger chose, so the bar is not
 * "handles the common cases": it is that no arrangement of bytes reaches a read
 * past the end of the buffer. Each of these came back as a message.
 */
void testMalformedFiles() {
    require(!threw(Bytes{}).empty(), "an empty file is refused");
    require(!threw(Bytes(8, 0)).empty(), "eight zero bytes are refused");

    Bytes truncated = wav16({ 0.1F, 0.2F, 0.3F }, 48000, 1);
    truncated.resize(20);
    require(!threw(truncated).empty(), "a WAV cut off inside its format chunk is refused");

    // The data chunk claims four gigabytes and the file has ten bytes of it.
    // This is what every failed download looks like, and it must read what is
    // really there rather than what the header wishes were there.
    Bytes lying = wav16({ 0.1F, 0.2F, 0.3F, 0.4F, 0.5F }, 48000, 1);
    lying[lying.size() - 10 - 4] = 0xFF;
    lying[lying.size() - 10 - 3] = 0xFF;
    lying[lying.size() - 10 - 2] = 0xFF;
    lying[lying.size() - 10 - 1] = 0xFF;
    try {
        const auto audio = island_chatter::analysis::read_wav(lying);
        require(audio.samples.size() <= 5,
                "a data chunk claiming more than the file holds reads only what is there");
    } catch (const std::exception&) {
        // Refusing is also a correct answer; crashing is not.
    }

    Bytes noChannels = wav16({ 0.1F, 0.2F }, 48000, 1);
    noChannels[22] = 0;
    noChannels[23] = 0;
    require(!threw(noChannels).empty(), "a WAV claiming no channels is refused");

    Bytes madRate = wav16({ 0.1F, 0.2F }, 48000, 1);
    madRate[24] = 0; madRate[25] = 0; madRate[26] = 0; madRate[27] = 0;
    require(!threw(madRate).empty(), "a WAV claiming a sample rate of zero is refused");

    Bytes oddBits = wav16({ 0.1F, 0.2F }, 48000, 1);
    oddBits[34] = 7;
    require(!threw(oddBits).empty(), "a WAV claiming seven bits per sample is refused");

    Bytes compressed = wav16({ 0.1F, 0.2F }, 48000, 1);
    compressed[20] = 0x11;  // IMA ADPCM
    require(threw(compressed).find("compressed") != std::string::npos,
            "a compressed WAV says it is compressed");

    Bytes mp3{ 'I', 'D', '3', 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    require(threw(mp3).find("MP3") != std::string::npos, "an MP3 is named as an MP3");

    Bytes noData = wav16({ 0.1F }, 48000, 1);
    noData.resize(36);
    require(!threw(noData).empty(), "a WAV with a header and no audio is refused");

    Bytes emptyChunks;
    tag(emptyChunks, "RIFF");
    little32(emptyChunks, 100U);
    tag(emptyChunks, "WAVE");
    for (int index = 0; index < 8; ++index) { tag(emptyChunks, "junk"); little32(emptyChunks, 0U); }
    require(!threw(emptyChunks).empty(), "a file of nothing but empty chunks terminates and is refused");
}

void testNucleiTiming() {
    const std::uint32_t rate = 48000;
    std::vector<float> samples;
    const std::vector<double> starts = { 0.20, 0.60, 1.00, 1.40 };
    silence(samples, 0.20, rate);
    for (std::size_t index = 0; index + 1 <= starts.size(); ++index) {
        const auto burst = synth_vowel(700.0, 1200.0, 0.18, rate);
        samples.insert(samples.end(), burst.begin(), burst.end());
        silence(samples, 0.22, rate);
    }
    island_chatter::analysis::Audio audio{ samples, rate };
    const auto result = island_chatter::analysis::analyse(audio, {});
    require(result.events.size() == starts.size(),
            "four bursts separated by silence come back as four events, got " +
                std::to_string(result.events.size()));
    if (result.events.size() == starts.size()) {
        double worst = 0.0;
        for (std::size_t index = 0; index < starts.size(); ++index) {
            worst = std::max(worst, std::fabs(result.events[index].start_seconds - starts[index]));
        }
        note("burst onsets are within " + std::to_string(static_cast<int>(worst * 1000.0)) + " ms");
        require(worst < 0.040, "each burst is found within 40 ms of where it was put");
    }

    // Silence must produce nothing at all. It is what closes the mouth, through
    // the rig rule that already exists, so an event invented here would hold a
    // mouth open through a pause.
    std::vector<float> quiet;
    silence(quiet, 2.0, rate);
    island_chatter::analysis::Audio nothing{ quiet, rate };
    require(island_chatter::analysis::analyse(nothing, {}).events.empty(),
            "two seconds of digital silence produce no events");

    // A steady tone has energy but no syllables. Reporting one event per period
    // would be the obvious bug here.
    std::vector<float> hum;
    for (std::size_t index = 0; index < rate * 2; ++index) {
        hum.push_back(static_cast<float>(std::sin(index * 2.0 * M_PI * 220.0 / rate) * 0.5));
    }
    island_chatter::analysis::Audio steady{ hum, rate };
    const auto humResult = island_chatter::analysis::analyse(steady, {});
    require(humResult.events.size() <= 1,
            "a steady tone is not a stream of syllables, got " +
                std::to_string(humResult.events.size()));

    // Sensitivity has to actually do something, and in the right direction.
    island_chatter::analysis::Settings loose;
    loose.sensitivity = 0.0;
    island_chatter::analysis::Settings strict;
    strict.sensitivity = 1.0;
    const auto many = island_chatter::analysis::analyse(audio, loose).events.size();
    const auto few = island_chatter::analysis::analyse(audio, strict).events.size();
    note("clean: sensitivity 0 finds " + std::to_string(many) + ", sensitivity 1 finds " +
         std::to_string(few));
    require(many >= few, "raising sensitivity never finds more syllables");

    /*
     * And it has to do something, not merely never do the wrong thing.
     *
     * On a clean signal both ends agree, which is correct and proves nothing.
     * The control exists for the case it was written for — something rattling
     * along underneath the voice — so that is what it is measured on: little
     * bumps between the real bursts, which a low sensitivity is supposed to
     * take and a high one is supposed to ignore.
     */
    std::vector<float> withClutter;
    std::uint32_t noise = 12345;
    silence(withClutter, 0.20, rate);
    for (std::size_t index = 0; index < 4; ++index) {
        const auto burst = synth_vowel(700.0, 1200.0, 0.18, rate);
        withClutter.insert(withClutter.end(), burst.begin(), burst.end());
        // A quiet bump in the gap: loud enough to be a peak, far too quiet to
        // be a syllable.
        const auto bump = synth_vowel(700.0, 1200.0, 0.06, rate);
        silence(withClutter, 0.06, rate);
        for (const float sample : bump) { withClutter.push_back(sample * 0.09F); }
        silence(withClutter, 0.10, rate);
    }
    // A little hiss throughout, which is what a real room gives you.
    for (float& sample : withClutter) {
        noise = (noise * 1103515245U) + 12345U;
        const auto hiss = static_cast<float>(
            ((noise >> 16U) & 0x7FFFU) / 16383.5 - 1.0);
        sample += hiss * 0.004F;
    }
    island_chatter::analysis::Audio cluttered{ withClutter, rate };
    const auto loud = island_chatter::analysis::analyse(cluttered, loose).events.size();
    const auto clean = island_chatter::analysis::analyse(cluttered, strict).events.size();
    note("cluttered: sensitivity 0 finds " + std::to_string(loud) +
         ", sensitivity 1 finds " + std::to_string(clean) + " (4 are real)");
    require(loud > clean, "sensitivity actually rejects the clutter it exists for");
    require(clean == 4, "the strict end finds the four real bursts and nothing else");
}

void testFormants() {
    const std::uint32_t rate = island_chatter::analysis::kAnalysisRate;
    struct Case { const char* name; double first; double second; };
    // Textbook adult male values.
    const std::vector<Case> cases = {
        { "i", 270.0, 2290.0 },
        { "e", 530.0, 1840.0 },
        { "a", 730.0, 1090.0 },
        { "o", 570.0, 840.0 },
        { "u", 300.0, 870.0 },
    };
    for (const auto& one : cases) {
        const auto samples = synth_vowel(one.first, one.second, 0.30, rate);
        const auto found = island_chatter::analysis::formants_at(samples, rate * 0.15, rate);
        note(std::string(one.name) + ": wanted " + std::to_string(static_cast<int>(one.first)) +
             "/" + std::to_string(static_cast<int>(one.second)) + ", found " +
             std::to_string(static_cast<int>(found.first)) + "/" +
             std::to_string(static_cast<int>(found.second)));
        require(found.first > 0.0 && found.second > 0.0,
                std::string("both formants are found for ") + one.name);
        if (found.first > 0.0) {
            require(std::fabs(found.first - one.first) < 120.0,
                    std::string("F1 for ") + one.name + " is within 120 Hz");
            require(std::fabs(found.second - one.second) < 250.0,
                    std::string("F2 for ") + one.name + " is within 250 Hz");
        }
    }

    // Silence and a pure tone have no formants, and must say so rather than
    // returning whatever the first grid point happened to be.
    const std::vector<float> quiet(static_cast<std::size_t>(rate * 0.2), 0.0F);
    const auto nothing = island_chatter::analysis::formants_at(quiet, rate / 10, rate);
    require(nothing.first == 0.0 && nothing.second == 0.0, "silence reports no formants");
}

/*
 * A whole recording of one vowel, which is what custom timbre is measured from.
 *
 * The recording is built the way a person's is: silence, the vowel, silence.
 * A measurement that reads the file end to end is dragged towards nothing by
 * both ends, so this is the case that says whether the loud-frames rule and the
 * median are doing their job.
 */
void testASustainedVowelIsMeasured() {
    std::cout << "sustained vowels\n";
    const std::uint32_t rate = 44100;
    const struct { const char* name; double first; double second; } cases[] = {
        {"a", 800.0, 1150.0},
        {"i", 300.0, 2300.0},
        {"u", 350.0, 800.0},
    };
    for (const auto& one : cases) {
        island_chatter::analysis::Audio audio;
        audio.sample_rate = rate;
        // Half a second of room, a second of vowel, half a second of room.
        audio.samples.assign(static_cast<std::size_t>(rate * 0.5), 0.0F);
        const auto held = synth_vowel(one.first, one.second, 1.0, rate);
        audio.samples.insert(audio.samples.end(), held.begin(), held.end());
        audio.samples.resize(audio.samples.size() + static_cast<std::size_t>(rate * 0.5), 0.0F);

        const auto measured = island_chatter::analysis::measure_vowel(audio);
        note(std::string(one.name) + ": wanted " + std::to_string(static_cast<int>(one.first)) +
             "/" + std::to_string(static_cast<int>(one.second)) + ", found " +
             std::to_string(static_cast<int>(measured.formants.first)) + "/" +
             std::to_string(static_cast<int>(measured.formants.second)) +
             " over " + std::to_string(measured.frames) + " frames");
        require(measured.frames > 10,
                std::string("enough frames were held for ") + one.name);
        require(std::fabs(measured.formants.first - one.first) < 120.0,
                std::string("F1 for a sustained ") + one.name + " is within 120 Hz");
        require(std::fabs(measured.formants.second - one.second) < 250.0,
                std::string("F2 for a sustained ") + one.name + " is within 250 Hz");
        require(measured.seconds > 1.9 && measured.seconds < 2.1,
                "the length of the recording is reported");
    }

    // A recording with nothing in it says so, rather than reporting the
    // formants of a room. The panel refuses it on this.
    island_chatter::analysis::Audio empty;
    empty.sample_rate = rate;
    empty.samples.assign(rate, 0.0F);
    const auto nothing = island_chatter::analysis::measure_vowel(empty);
    require(nothing.frames == 0 && nothing.formants.first == 0.0,
            "a silent recording measures nothing rather than something");

    // And so does a file that is not there at all.
    const auto absent = island_chatter::analysis::measure_vowel({});
    require(absent.frames == 0, "an empty audio buffer measures nothing");
}

void testVowelsAreTold() {
    const std::uint32_t rate = 48000;
    struct Case { char vowel; double first; double second; };
    const std::vector<Case> spoken = {
        { 'a', 730.0, 1090.0 },
        { 'i', 270.0, 2290.0 },
        { 'u', 300.0, 870.0 },
        { 'e', 530.0, 1840.0 },
        { 'o', 570.0, 840.0 },
    };
    std::vector<float> samples;
    silence(samples, 0.15, rate);
    for (const auto& one : spoken) {
        const auto vowel = synth_vowel(one.first, one.second, 0.20, rate);
        samples.insert(samples.end(), vowel.begin(), vowel.end());
        silence(samples, 0.20, rate);
    }
    island_chatter::analysis::Audio audio{ samples, rate };
    const auto result = island_chatter::analysis::analyse(audio, {});
    require(result.events.size() == spoken.size(),
            "five synthesised vowels come back as five events, got " +
                std::to_string(result.events.size()));
    if (result.events.size() == spoken.size()) {
        std::string got;
        std::size_t right = 0;
        for (std::size_t index = 0; index < spoken.size(); ++index) {
            got += result.events[index].vowel;
            if (result.events[index].vowel == spoken[index].vowel) { right += 1; }
        }
        note("wanted aiueo in order, got " + got + " (" + std::to_string(right) + "/5)");
        require(right >= 4, "at least four of the five textbook vowels are identified");
    }

    // Turning identification off must not be a silent no-op.
    island_chatter::analysis::Settings loudnessOnly;
    loudnessOnly.identify_vowels = false;
    const auto plain = island_chatter::analysis::analyse(audio, loudnessOnly);
    require(plain.identified == 0, "loudness-only identifies no vowels");
    require(plain.events.size() == result.events.size(),
            "loudness-only finds the same syllables");
    bool allOpen = true;
    for (const auto& event : plain.events) { allOpen = allOpen && event.vowel == 'a'; }
    require(allOpen, "loudness-only gives every event the open shape");
}

/*
 * The measurement that matters.
 *
 * The engine can produce both the audio for a line and the plan that is known
 * to be correct for it, because it wrote both. So the analyser can be scored
 * rather than admired: how many syllables did it find against how many are
 * really there, and how far out was it.
 *
 * The numbers below are pinned at what it actually achieves, not at what would
 * be nice, so that a change which makes it worse fails here instead of being
 * discovered in somebody's shot.
 */
void testAgainstTheEngine() {
    struct Line { const char* text; const char* what; };
    const std::vector<Line> lines = {
        { "\xE4\xBD\xA0\xE5\xA5\xBD\xEF\xBC\x8C\xE6\xAD\xA1\xE8\xBF\x8E\xE4\xBE\x86\xE5\x88\xB0"
          "\xE5\xB0\x8F\xE5\xB3\xB6\xEF\xBC\x81", "Chinese" },
        { "Good morning everyone", "English" },
        { "\xE3\x81\x93\xE3\x82\x93\xE3\x81\xAB\xE3\x81\xA1\xE3\x81\xAF", "Japanese" },
    };
    std::size_t totalWanted = 0;
    std::size_t totalFound = 0;
    std::size_t totalComparable = 0;
    std::size_t totalAgreed = 0;
    for (const auto& line : lines) {
        island_chatter::Settings settings;
        settings.text = line.text;
        settings.sample_rate = 48000;
        const auto rendered = island_chatter::synthesize(settings);
        const auto& plan = rendered.diagnostics;

        island_chatter::analysis::Audio audio;
        audio.samples = rendered.samples;
        audio.sample_rate = settings.sample_rate;
        const auto found = island_chatter::analysis::analyse(audio, {});

        totalWanted += plan.event_count;
        totalFound += found.events.size();

        // How far each real syllable is from the nearest one the analyser found.
        double worst = 0.0;
        double total = 0.0;
        for (std::size_t index = 0; index < plan.event_count; ++index) {
            const double wanted =
                static_cast<double>(plan.start_samples[index]) / settings.sample_rate;
            double closest = 1e9;
            for (const auto& event : found.events) {
                closest = std::min(closest, std::fabs(event.start_seconds - wanted));
            }
            worst = std::max(worst, closest);
            total += closest;
        }
        const double average = plan.event_count ? total / plan.event_count : 0.0;
        note(std::string(line.what) + ": engine says " + std::to_string(plan.event_count) +
             " syllables, analyser found " + std::to_string(found.events.size()) +
             ", average miss " + std::to_string(static_cast<int>(average * 1000.0)) +
             " ms, worst " + std::to_string(static_cast<int>(worst * 1000.0)) + " ms, " +
             std::to_string(found.identified) + " vowels identified");

        require(found.events.size() * 2 >= plan.event_count,
                std::string(line.what) + ": at least half the syllables are found");
        require(found.events.size() <= plan.event_count * 2 + 2,
                std::string(line.what) + ": no more than twice as many events as syllables");
        if (!found.events.empty()) {
            require(average < 0.120,
                    std::string(line.what) + ": syllables land within 120 ms on average");
        }

        /*
         * And the vowel, which is the part that is a guess.
         *
         * Scored against the vowel the engine knows it synthesised, and only on
         * the five that have a mouth shape of their own: the apical vowel after
         * z/c/s and the retroflex of 兒 have none, so agreeing or disagreeing
         * about them would measure nothing.
         */
        if (found.events.size() == plan.event_count) {
            std::size_t comparable = 0;
            std::size_t agreed = 0;
            for (std::size_t index = 0; index < plan.event_count; ++index) {
                char engine = plan.vowel_names[index];
                if (engine == 'v') { engine = 'i'; }  // ü shows the /i/ mouth
                if (engine != 'a' && engine != 'e' && engine != 'i' &&
                    engine != 'o' && engine != 'u') {
                    continue;
                }
                comparable += 1;
                if (found.events[index].vowel == engine) { agreed += 1; }
            }
            totalComparable += comparable;
            totalAgreed += agreed;
            note(std::string(line.what) + ": vowels agreed on " + std::to_string(agreed) +
                 " of " + std::to_string(comparable));
        }
    }
    note("across every line: " + std::to_string(totalFound) + " found against " +
         std::to_string(totalWanted) + " real syllables");
    if (totalComparable > 0) {
        const double share = static_cast<double>(totalAgreed) / totalComparable;
        note("vowel agreement: " + std::to_string(totalAgreed) + "/" +
             std::to_string(totalComparable) + " (" +
             std::to_string(static_cast<int>(share * 100.0)) + "%)");
        /*
         * Pinned at what it actually manages, not at what would be nice.
         *
         * This is a guess made from a spectrum and it is allowed to be wrong.
         * What it is not allowed to do is get quietly worse, and the number
         * printed above is the one to argue with.
         *
         * **Except in a trial build**, where the engine mixes a tone burst into
         * what it renders every four seconds (invariant 8ai) and this test
         * scores the analyser against audio the engine made. A tone inside a
         * vowel changes the spectrum the vowel is identified from, so the score
         * drops — that is the watermark working, not the analyser regressing.
         * The timing checks above still hold, which is what the mouth is driven
         * by; only the colour of each vowel is affected. Nothing is asserted
         * here rather than asserting a second, invented threshold.
         */
        if (island_chatter::is_trial()) {
            note("trial build: the engine signs what it renders, so the vowel colours it is "
                 "scored against are not the engine's alone");
        } else {
            require(share >= 0.55, "at least 55% of vowels agree with the engine");
        }
    }
}

}  // namespace

int main() {
    std::cout << "reader\n";
    testReaderRoundTrip();
    std::cout << "malformed files\n";
    testMalformedFiles();
    std::cout << "syllable timing\n";
    testNucleiTiming();
    std::cout << "formants\n";
    testFormants();
    testASustainedVowelIsMeasured();
    std::cout << "vowels\n";
    testVowelsAreTold();
    std::cout << "against the engine\n";
    testAgainstTheEngine();
    if (failures != 0) {
        std::cerr << failures << " failure(s)\n";
        return 1;
    }
    std::cout << "analysis tests passed\n";
    return 0;
}

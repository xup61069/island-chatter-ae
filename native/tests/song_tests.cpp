#include "island_chatter/song.hpp"

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}

using Bytes = std::vector<unsigned char>;

void u8(Bytes& out, int value) { out.push_back(static_cast<unsigned char>(value & 0xFF)); }
void u16(Bytes& out, int value) { u8(out, value >> 8); u8(out, value); }

void u32(Bytes& out, std::uint32_t value) {
    u8(out, static_cast<int>(value >> 24)); u8(out, static_cast<int>(value >> 16));
    u8(out, static_cast<int>(value >> 8)); u8(out, static_cast<int>(value));
}

void vlq(Bytes& out, std::uint32_t value) {
    Bytes parts{static_cast<unsigned char>(value & 0x7FU)};
    value >>= 7U;
    while (value > 0U) {
        parts.insert(parts.begin(), static_cast<unsigned char>((value & 0x7FU) | 0x80U));
        value >>= 7U;
    }
    out.insert(out.end(), parts.begin(), parts.end());
}

void append(Bytes& out, const Bytes& more) { out.insert(out.end(), more.begin(), more.end()); }

Bytes chunk(const char* type, const Bytes& body) {
    Bytes out;
    for (const char* letter = type; *letter != '\0'; ++letter) { u8(out, *letter); }
    u32(out, static_cast<std::uint32_t>(body.size()));
    append(out, body);
    return out;
}

constexpr int kTicksPerQuarter = 480;

// One track of back-to-back notes, each `beats` long, at `bpm`, in `beats_per_bar`
// over four.
island_chatter::midi::File tune(
    const std::vector<std::pair<int, double>>& notes, double bpm, int beats_per_bar = 4) {
    const auto microseconds = static_cast<std::uint32_t>(std::llround(60000000.0 / bpm));
    Bytes track;
    vlq(track, 0); u8(track, 0xFF); u8(track, 0x51); u8(track, 3);
    u8(track, static_cast<int>(microseconds >> 16));
    u8(track, static_cast<int>(microseconds >> 8));
    u8(track, static_cast<int>(microseconds));
    vlq(track, 0); u8(track, 0xFF); u8(track, 0x58); u8(track, 4);
    u8(track, beats_per_bar); u8(track, 2); u8(track, 24); u8(track, 8);
    for (const auto& [pitch, beats] : notes) {
        const auto length = static_cast<std::uint32_t>(
            std::llround(beats * kTicksPerQuarter));
        vlq(track, 0);      u8(track, 0x90); u8(track, pitch); u8(track, 100);
        vlq(track, length); u8(track, 0x80); u8(track, pitch); u8(track, 0);
    }
    vlq(track, 0); u8(track, 0xFF); u8(track, 0x2F); u8(track, 0x00);

    Bytes body;
    u16(body, 0); u16(body, 1); u16(body, kTicksPerQuarter);
    Bytes file = chunk("MThd", body);
    append(file, chunk("MTrk", track));
    return island_chatter::midi::parse(file);
}

}  // namespace

int main() {
    using namespace island_chatter;

    // --- Splitting lyrics --------------------------------------------------
    {
        const auto lines = song::lyric_lines("  first \r\n\r\n  second\t\n");
        require(lines.size() == 2, "blank lines should not become lines");
        require(lines[0] == "first" && lines[1] == "second", "lines were not trimmed");
    }

    // --- Counting notes a line wants ---------------------------------------
    {
        require(syllable_count("一閃一閃", true) == 4, "four Han characters are four notes");
        // A melisma has no syllable of its own but does want a note.
        require(syllable_count("一閃-", true) == 3, "a melisma should ask for its own note");
        // Without a melody a hyphen is punctuation, exactly as it always was.
        require(syllable_count("一閃-", false) == 2, "a hyphen should still rest when speaking");
        require(syllable_count("你好，世界", true) == 4, "punctuation is not sung");
    }

    // --- One note per syllable, line by line -------------------------------
    {
        const auto file = tune({{60, 1}, {62, 1}, {64, 1}, {65, 1}, {67, 2}}, 120.0);
        const auto assignment = song::assign(file, 0, "一閃一閃\n亮");
        require(assignment.lines.size() == 2, "both lyric lines should be assigned");
        require(assignment.lines[0].notes == 4, "the first line should take four notes");
        require(assignment.lines[1].notes == 1, "the second line should take the fifth note");
        require(assignment.extra_notes == 0 && assignment.extra_syllables == 0,
            "nothing should have been left over");
        // The second line starts where its own first note does: four beats at
        // 120 BPM is two seconds.
        require(std::abs(assignment.lines[1].start_seconds - 2.0) < 1e-9,
            "a line does not begin at its first note");
        require(std::abs(assignment.lines[0].bpm - 120.0) < 1e-9, "the line's tempo is wrong");

        const auto first = decode_melody_slot(assignment.lines[0].slots.front());
        require(first.pitch == 60, "the first slot has the wrong pitch");
        require(first.ticks == kMelodyTicksPerBeat, "a one-beat note should be 24 ticks");
        const auto last = decode_melody_slot(assignment.lines[1].slots.back());
        require(last.ticks == kMelodyTicksPerBeat * 2, "a two-beat note should be 48 ticks");
    }

    // --- Rests between notes ------------------------------------------------
    {
        // Notes a beat long every two beats: a beat of rest between each.
        Bytes track;
        Bytes body;
        u16(body, 0); u16(body, 1); u16(body, kTicksPerQuarter);
        for (int index = 0; index < 3; ++index) {
            vlq(track, index == 0 ? 0 : kTicksPerQuarter);
            u8(track, 0x90); u8(track, 60 + index); u8(track, 100);
            vlq(track, kTicksPerQuarter); u8(track, 0x80); u8(track, 60 + index); u8(track, 0);
        }
        vlq(track, 0); u8(track, 0xFF); u8(track, 0x2F); u8(track, 0x00);
        Bytes file = chunk("MThd", body);
        append(file, chunk("MTrk", track));
        const auto parsed = midi::parse(file);
        const auto assignment = song::assign(parsed, 0, "一二三");
        const auto& slots = assignment.lines[0].slots;
        require(slots.size() == 5, "the gaps between the notes should be rests");
        require(decode_melody_slot(slots[1]).pitch == 0, "the second slot should be a rest");
        require(decode_melody_slot(slots[1]).ticks == kMelodyTicksPerBeat,
            "the rest is the wrong length");
    }

    // --- Rounding must not accumulate ---------------------------------------
    //
    // Every boundary is rounded once against the start of the line. Rounding
    // each note's own length and adding them up drifts by half a tick per note,
    // always the same way, which at this tempo walks a line steadily late.
    {
        std::vector<std::pair<int, double>> notes;
        for (int index = 0; index < 40; ++index) {
            // A length that is not a whole number of ticks at any sane tempo.
            notes.emplace_back(60 + (index % 5), 1.0 / 7.0);
        }
        const auto file = tune(notes, 137.0);
        std::string lyrics;
        for (int index = 0; index < 40; ++index) { lyrics += "啊"; }
        const auto assignment = song::assign(file, 0, lyrics);
        const auto& line = assignment.lines[0];
        require(line.notes == 40, "every note should have been taken");
        long long total = 0;
        for (const int slot : line.slots) { total += decode_melody_slot(slot).ticks; }
        const double ticks_per_second = line.bpm * kMelodyTicksPerBeat / 60.0;
        const double truth = (40.0 / 7.0) * (60.0 / 137.0) * ticks_per_second;
        require(std::abs(static_cast<double>(total) - truth) <= 1.0,
            "the encoded line drifted away from the melody it came from");
    }

    // --- More notes than lyrics, and more lyrics than notes -----------------
    {
        const auto file = tune({{60, 1}, {62, 1}, {64, 1}, {65, 1}}, 120.0);
        const auto few = song::assign(file, 0, "一二");
        require(few.extra_notes == 2, "the unsung notes were not reported");
        const auto many = song::assign(file, 0, "一二三四五六");
        require(many.extra_syllables == 2, "the unsung syllables were not reported");
        require(many.lines[0].notes == 4, "a line cannot take more notes than there are");
    }

    // --- A line longer than the transport is split, never truncated ----------
    {
        std::vector<std::pair<int, double>> notes;
        for (int index = 0; index < 80; ++index) { notes.emplace_back(60 + index % 5, 0.5); }
        const auto file = tune(notes, 120.0);
        std::string lyrics;
        for (int index = 0; index < 80; ++index) { lyrics += "啊"; }
        const auto assignment = song::assign(file, 0, lyrics);
        require(assignment.lines.size() > 1, "an over-long line was not split");
        require(assignment.split_lines > 0, "the split was not reported");
        std::size_t sung = 0;
        std::string rejoined;
        for (std::size_t index = 0; index < assignment.lines.size(); ++index) {
            const auto& line = assignment.lines[index];
            require(line.slots.size() <= kMelodySlots,
                "a line wrote more slots than the transport carries");
            require(index == 0 || line.continued,
                "a continuation line was not marked as one");
            sung += line.notes;
            rejoined += line.text;
        }
        // Nothing may be lost on the way: every syllable is sung by some layer,
        // and the layers put back together are the line that was typed.
        require(sung == 80, "notes went missing across the split");
        require(rejoined == lyrics, "text went missing across the split");
        require(assignment.extra_syllables == 0 && assignment.extra_notes == 0,
            "the split left something unsung");
    }

    // --- and it prefers to cut on a bar line ---------------------------------
    //
    // Five beats to the bar, so the point where the transport runs out is not
    // a multiple of the bar length: a cut left where it fell would land inside
    // bar thirteen, and backing up to the bar line is the whole point.
    {
        std::vector<std::pair<int, double>> notes;
        for (int index = 0; index < 90; ++index) { notes.emplace_back(60 + index % 7, 1.0); }
        const auto file = tune(notes, 120.0, 5);
        std::string lyrics;
        for (int index = 0; index < 90; ++index) { lyrics += "啊"; }
        const auto assignment = song::assign(file, 0, lyrics);
        require(assignment.lines.size() > 1, "the line was not split");
        require(assignment.lines[0].notes % 5 == 0,
            "the split did not land on a bar line");
        require(assignment.lines[0].notes == 60,
            "the split should have backed up from 64 notes to the bar line at 60");
    }

    // --- Singing the note names when there are no words ---------------------
    {
        require(std::string(song::solfege_name(60, 0)) == "do", "C should be do in C");
        require(std::string(song::solfege_name(71, 0)) == "si", "B should be si in C");
        // An accidental takes the name of the natural below it. The note still
        // sounds at its own pitch; only the label is approximate.
        require(std::string(song::solfege_name(61, 0)) == "do", "C sharp should be named do");
        require(std::string(song::solfege_name(66, 0)) == "fa", "F sharp should be named fa");
        // Movable do: against a G tonic, G is do and C is fa.
        require(std::string(song::solfege_name(67, 7)) == "do", "G should be do in G");
        require(std::string(song::solfege_name(60, 7)) == "fa", "C should be fa in G");
        // Two properties rather than hand-computed answers: a note below the
        // tonic must not produce a negative degree and walk off the table, and
        // a name must repeat every octave across the whole MIDI range.
        // C against a B tonic is a semitone above it, and a semitone takes the
        // name of the natural below — so "do". What matters here is that the
        // degree wrapped forward at all instead of indexing at minus eleven.
        require(std::string(song::solfege_name(0, 11)) == "do",
            "a pitch below the tonic wrapped the wrong way");
        for (int tonic = 0; tonic < 12; ++tonic) {
            for (int pitch = 0; pitch + 12 <= 127; ++pitch) {
                require(std::string(song::solfege_name(pitch, tonic)) ==
                        std::string(song::solfege_name(pitch + 12, tonic)),
                    "the same note an octave up got a different name");
            }
        }

        const auto file = tune({{60, 1}, {62, 1}, {64, 1}}, 120.0);
        const auto named = song::assign(file, 0, "", 0);
        require(named.lines.size() == 1, "a continuous melody is one line of note names");
        require(named.lines[0].text == "do re mi", "the note names are wrong");
        require(named.lines[0].notes == 3 && named.lines[0].syllables == 3,
            "every note should get a syllable of its own");
        require(named.extra_notes == 0 && named.extra_syllables == 0,
            "nothing should be left over when the words are generated");
        // The same melody named against G.
        require(song::assign(file, 0, "", 7).lines[0].text == "fa sol la",
            "the tonic did not move the note names");
        // Whitespace-only lyrics mean the same thing as none at all.
        require(song::assign(file, 0, "  \n \r\n ", 0).lines[0].text == "do re mi",
            "a blank lyric should still sing the note names");
    }

    // A breath breaks the line, so a long melody does not become one layer.
    {
        // Two three-note phrases with three beats of silence between them.
        Bytes track;
        Bytes body;
        u16(body, 0); u16(body, 1); u16(body, kTicksPerQuarter);
        const int gaps[] = {0, 0, 0, 3, 0, 0};
        const int notes[] = {60, 62, 64, 65, 67, 69};
        for (int index = 0; index < 6; ++index) {
            vlq(track, static_cast<std::uint32_t>(gaps[index] * kTicksPerQuarter));
            u8(track, 0x90); u8(track, notes[index]); u8(track, 100);
            vlq(track, kTicksPerQuarter); u8(track, 0x80); u8(track, notes[index]); u8(track, 0);
        }
        vlq(track, 0); u8(track, 0xFF); u8(track, 0x2F); u8(track, 0x00);
        Bytes file = chunk("MThd", body);
        append(file, chunk("MTrk", track));
        const auto assignment = song::assign(midi::parse(file), 0, "", 0);
        require(assignment.lines.size() == 2, "a long rest should start a new line");
        require(assignment.lines[0].text == "do re mi", "the first phrase is wrong");
        require(assignment.lines[1].text == "fa sol la", "the second phrase is wrong");
        // The rest belongs between the lines, not inside either of them.
        require(decode_melody_slot(assignment.lines[0].slots.back()).pitch != 0,
            "a line should not end on a rest");
        // Three one-beat notes end at 1.5s, then three beats of silence: the
        // fourth note is at 3.0s and that is where its layer belongs.
        require(std::abs(assignment.lines[0].start_seconds) < 1e-9,
            "the first phrase starts at zero");
        require(std::abs(assignment.lines[1].start_seconds - 3.0) < 0.02,
            "the second phrase starts at its own first note");
    }

    // --- A tempo the parameter cannot hold ----------------------------------
    //
    // A MIDI tempo is a free-running number and nothing stops it being 900.
    // After Effects refuses a setValue() outside 20-400 with a modal dialog, so
    // the clamp lives here — and because the slot lengths are derived with the
    // same clamped number that playback divides by, the notes still land in the
    // right places.
    {
        for (const double bpm : {8.0, 900.0}) {
            const auto file = tune({{60, 1}, {62, 1}}, bpm);
            const auto assignment = song::assign(file, 0, "一二");
            const auto& line = assignment.lines[0];
            require(line.bpm >= 20.0 && line.bpm <= 400.0,
                "the encoded tempo is outside what the parameter can hold");
            require(assignment.bpm >= 20.0 && assignment.bpm <= 400.0,
                "the reported tempo is outside what the parameter can hold");
            // One beat at the file's real tempo, still, once the ticks are read
            // back with the tempo they were written against.
            const double seconds = decode_melody_slot(line.slots.front()).ticks /
                (line.bpm * kMelodyTicksPerBeat / 60.0);
            require(std::abs(seconds - 60.0 / bpm) < 0.02,
                "clamping the tempo moved the notes");
        }
    }

    // --- Refusals -----------------------------------------------------------
    {
        const auto file = tune({{60, 1}}, 120.0);
        bool threw = false;
        try { song::assign(file, 9, "一"); } catch (const std::exception&) { threw = true; }
        require(threw, "a track index out of range should be refused");
        // An empty lyric used to be refused. It is now a request to sing the
        // note names, which is covered above; what is still refused is a track
        // with nothing on it to sing.
        threw = false;
        try {
            midi::File empty = tune({{60, 1}}, 120.0);
            empty.tracks[0].notes.clear();
            song::assign(empty, 0, "");
        } catch (const std::exception&) { threw = true; }
        require(threw, "a track with no notes should be refused");
    }

    std::cout << "song tests passed\n";
    return 0;
}

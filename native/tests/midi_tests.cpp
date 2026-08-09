#include "island_chatter/midi.hpp"

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}

bool near(double left, double right, double tolerance) {
    return std::abs(left - right) <= tolerance;
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

Bytes header(int format, int tracks, int division) {
    Bytes body;
    u16(body, format); u16(body, tracks); u16(body, division);
    return chunk("MThd", body);
}

Bytes end_of_track() {
    Bytes out;
    vlq(out, 0); u8(out, 0xFF); u8(out, 0x2F); u8(out, 0x00);
    return out;
}

// A file that parses, so each test only has to say what is different about it.
Bytes simple_file() {
    Bytes track;
    vlq(track, 0); u8(track, 0xFF); u8(track, 0x03); u8(track, 4);
    u8(track, 'S'); u8(track, 'o'); u8(track, 'n'); u8(track, 'g');
    vlq(track, 0);   u8(track, 0x90); u8(track, 60); u8(track, 100);
    vlq(track, 480); u8(track, 0x80); u8(track, 60); u8(track, 0);
    vlq(track, 0);   u8(track, 0x90); u8(track, 64); u8(track, 100);
    vlq(track, 240); u8(track, 0x80); u8(track, 64); u8(track, 0);
    append(track, end_of_track());
    Bytes file = header(0, 1, 480);
    append(file, chunk("MTrk", track));
    return file;
}

bool throws(const Bytes& bytes) {
    try {
        island_chatter::midi::parse(bytes);
    } catch (const std::exception&) {
        return true;
    }
    return false;
}

}  // namespace

int main() {
    using namespace island_chatter::midi;

    {
        const auto file = parse(simple_file());
        require(file.tracks.size() == 1, "a format 0 file has one track");
        require(file.tracks[0].name == "Song", "the track name was not read");
        require(file.tracks[0].notes.size() == 2, "both notes should be present");
        require(file.tracks[0].notes[0].pitch == 60 && file.tracks[0].notes[0].length_ticks == 480,
            "the first note has the wrong pitch or length");
        require(file.tracks[0].notes[1].start_tick == 480, "the second note starts in the wrong place");
        // 480 ticks per quarter at the default 120 BPM is half a second.
        require(near(file.seconds_at(480), 0.5, 1e-9), "the default tempo is not 120 BPM");
        require(near(file.bpm_at(0), 120.0, 1e-9), "bpm_at() disagrees with the default tempo");
    }

    // Running status: the note-off status byte is left out and inherited.
    {
        Bytes track;
        vlq(track, 0);   u8(track, 0x90); u8(track, 60); u8(track, 100);
        vlq(track, 240);                  u8(track, 60); u8(track, 0);
        vlq(track, 0);                    u8(track, 62); u8(track, 100);
        vlq(track, 240);                  u8(track, 62); u8(track, 0);
        append(track, end_of_track());
        Bytes file = header(0, 1, 480);
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        require(parsed.tracks[0].notes.size() == 2, "running status lost a note");
        require(parsed.tracks[0].notes[1].pitch == 62,
            "note-on with velocity 0 was not treated as a release");
    }

    // A tempo map in track 0 has to apply to the notes in track 1.
    {
        Bytes tempo;
        vlq(tempo, 0);   u8(tempo, 0xFF); u8(tempo, 0x51); u8(tempo, 3);
        u8(tempo, (500000 >> 16) & 0xFF); u8(tempo, (500000 >> 8) & 0xFF); u8(tempo, 500000 & 0xFF);
        vlq(tempo, 960); u8(tempo, 0xFF); u8(tempo, 0x51); u8(tempo, 3);
        u8(tempo, (250000 >> 16) & 0xFF); u8(tempo, (250000 >> 8) & 0xFF); u8(tempo, 250000 & 0xFF);
        append(tempo, end_of_track());
        Bytes notes;
        vlq(notes, 0);    u8(notes, 0x90); u8(notes, 72); u8(notes, 100);
        vlq(notes, 1920); u8(notes, 0x80); u8(notes, 72); u8(notes, 0);
        append(notes, end_of_track());
        Bytes file = header(1, 2, 480);
        append(file, chunk("MTrk", tempo));
        append(file, chunk("MTrk", notes));
        const auto parsed = parse(file);
        require(parsed.tempos.size() == 2, "the tempo map was not collected across tracks");
        // Two beats at 120, then two at 240: 1.0 s + 0.5 s.
        require(near(parsed.seconds_at(1920), 1.5, 1e-9), "the tempo change was not applied");
        require(near(parsed.bpm_at(1000), 240.0, 1e-9), "bpm_at() ignored the second tempo");
    }

    // A note the file never releases is closed where the track ends, rather
    // than disappearing.
    {
        Bytes track;
        vlq(track, 0);   u8(track, 0x90); u8(track, 60); u8(track, 100);
        vlq(track, 960); u8(track, 0xFF); u8(track, 0x2F); u8(track, 0x00);
        Bytes file = header(0, 1, 480);
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        require(parsed.tracks[0].notes.size() == 1, "an unreleased note was lost");
        require(parsed.tracks[0].notes[0].length_ticks == 960,
            "an unreleased note was not closed at the end of the track");
    }

    // Sysex and unknown meta events must be skipped by their declared length,
    // and must cancel running status rather than be inherited from.
    {
        Bytes track;
        vlq(track, 0); u8(track, 0xF0); vlq(track, 3); u8(track, 1); u8(track, 2); u8(track, 0xF7);
        vlq(track, 0); u8(track, 0xFF); u8(track, 0x7F); vlq(track, 2); u8(track, 9); u8(track, 9);
        vlq(track, 0);   u8(track, 0x90); u8(track, 65); u8(track, 100);
        vlq(track, 120); u8(track, 0x80); u8(track, 65); u8(track, 0);
        append(track, end_of_track());
        Bytes file = header(0, 1, 480);
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        require(parsed.tracks[0].notes.size() == 1, "a sysex or meta event swallowed the note");
        require(parsed.tracks[0].notes[0].pitch == 65, "the wrong note survived");
    }

    // A delta time large enough to need three bytes of VLQ.
    {
        Bytes track;
        vlq(track, 100000); u8(track, 0x90); u8(track, 60); u8(track, 100);
        vlq(track, 480);    u8(track, 0x80); u8(track, 60); u8(track, 0);
        append(track, end_of_track());
        Bytes file = header(0, 1, 480);
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        require(parsed.tracks[0].notes[0].start_tick == 100000, "a multi-byte delta time was misread");
    }

    // SMPTE division: ticks are absolute, so the tempo map does not apply.
    {
        Bytes file = header(0, 1, (0xE8 << 8) | 40);  // -24 frames, 40 ticks each
        Bytes track;
        vlq(track, 0);   u8(track, 0x90); u8(track, 60); u8(track, 100);
        vlq(track, 960); u8(track, 0x80); u8(track, 60); u8(track, 0);
        append(track, end_of_track());
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        require(parsed.ticks_per_quarter == 0, "an SMPTE file should not claim ticks per quarter");
        require(near(parsed.seconds_at(960), 1.0, 1e-9), "SMPTE ticks were not converted correctly");
    }

    // --- Bar lines -----------------------------------------------------------
    {
        // No time signature at all still means 4/4, which is what the format
        // says a file without one is.
        const auto plain = parse(simple_file());
        require(plain.bar_line_at(0) == 0, "the first bar starts at zero");
        require(plain.bar_line_at(1919) == 0, "a tick inside bar one is still bar one");
        require(plain.bar_line_at(1920) == 1920, "four quarters is one 4/4 bar");
        require(plain.bar_line_at(4000) == 3840, "the third bar line is at 3840");
        require(plain.starts_bar(1920, 30), "a note on the downbeat starts a bar");
        require(plain.starts_bar(1918, 30), "a note pushed slightly early still starts a bar");
        require(!plain.starts_bar(2400, 30), "a note in the middle of a bar does not");
    }
    {
        // Three four, then a change to five four halfway. A meter change starts
        // a bar of its own wherever it lands, which is what every notation
        // program does and what makes the bar count come out right afterwards.
        Bytes track;
        vlq(track, 0);    u8(track, 0xFF); u8(track, 0x58); u8(track, 4);
        u8(track, 3); u8(track, 2); u8(track, 24); u8(track, 8);
        vlq(track, 2880); u8(track, 0xFF); u8(track, 0x58); u8(track, 4);
        u8(track, 5); u8(track, 2); u8(track, 24); u8(track, 8);
        vlq(track, 0);   u8(track, 0x90); u8(track, 60); u8(track, 100);
        vlq(track, 240); u8(track, 0x80); u8(track, 60); u8(track, 0);
        append(track, end_of_track());
        Bytes file = header(0, 1, 480);
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        require(parsed.time_signatures.size() == 2, "both time signatures should be read");
        // 3/4 is 1440 ticks: bars at 0, 1440, 2880.
        require(parsed.bar_line_at(1440) == 1440, "a 3/4 bar is 1440 ticks");
        require(parsed.bar_line_at(2000) == 1440, "inside the second 3/4 bar");
        // From 2880 the grid restarts in 5/4, which is 2400 ticks.
        require(parsed.bar_line_at(2880) == 2880, "the meter change starts a bar");
        require(parsed.bar_line_at(5279) == 2880, "still inside the first 5/4 bar");
        require(parsed.bar_line_at(5280) == 5280, "the next 5/4 bar is 2400 ticks later");
    }

    // --- Chords and overlap ------------------------------------------------
    //
    // top_line() has to leave a strictly monophonic line, because two events on
    // the same samples would clobber each other and which one won would depend
    // on the order the lazy renderer reached them.
    {
        Bytes track;
        // A triad struck together, voiced from the bottom up a few ticks apart.
        vlq(track, 0);  u8(track, 0x90); u8(track, 60); u8(track, 100);
        vlq(track, 3);  u8(track, 0x90); u8(track, 64); u8(track, 100);
        vlq(track, 3);  u8(track, 0x90); u8(track, 67); u8(track, 100);
        vlq(track, 474); u8(track, 0x80); u8(track, 60); u8(track, 0);
        vlq(track, 0);  u8(track, 0x80); u8(track, 64); u8(track, 0);
        vlq(track, 0);  u8(track, 0x80); u8(track, 67); u8(track, 0);
        // A held bass note under a moving upper line.
        vlq(track, 0);   u8(track, 0x90); u8(track, 48); u8(track, 100);
        vlq(track, 960); u8(track, 0x80); u8(track, 48); u8(track, 0);
        append(track, end_of_track());
        Bytes file = header(0, 1, 480);
        append(file, chunk("MTrk", track));
        const auto parsed = parse(file);
        const auto line = top_line(parsed.tracks[0], parsed.ticks_per_quarter);
        require(line.notes.size() == 2, "the chord was not reduced to one note");
        require(line.dropped == 2, "the discarded chord notes were not reported");
        require(line.notes[0].pitch == 67, "the top of the chord should win");
        require(line.notes[0].start_tick == 0,
            "the kept note should start where the chord does, not where it was voiced");
        for (std::size_t index = 0; index + 1 < line.notes.size(); ++index) {
            const auto end = line.notes[index].start_tick + line.notes[index].length_ticks;
            require(end <= line.notes[index + 1].start_tick, "the top line still overlaps");
        }
    }

    // --- Malformed input ---------------------------------------------------
    //
    // Every one of these is a file somebody could pick in a file dialog. They
    // have to come back as an error, never as a crash inside After Effects.
    {
        require(throws({}), "an empty file should be rejected");
        require(throws(Bytes(8, 0)), "a file with no header should be rejected");
        {
            Bytes file = simple_file();
            file[0] = 'X';
            require(throws(file), "a file that is not MThd should be rejected");
        }
        {
            // A division of zero would divide by nothing when converting ticks.
            Bytes file = header(0, 1, 0);
            Bytes track;
            append(track, end_of_track());
            append(file, chunk("MTrk", track));
            require(throws(file), "a zero timing division should be rejected");
        }
        {
            // A VLQ that never terminates: a run of continuation bytes, which
            // is what a truncated or misaligned file reads as.
            Bytes track(12, 0x80);
            Bytes file = header(0, 1, 480);
            append(file, chunk("MTrk", track));
            require(throws(file), "a length field that never terminates should be rejected");
        }
        {
            // A data byte with no status to inherit.
            Bytes track;
            vlq(track, 0); u8(track, 60); u8(track, 100);
            Bytes file = header(0, 1, 480);
            append(file, chunk("MTrk", track));
            require(throws(file), "a data byte with no running status should be rejected");
        }
        {
            // A header truncated halfway through its own fields.
            Bytes file = simple_file();
            file.resize(10);
            require(throws(file), "a truncated header should be rejected");
        }
        {
            // A track chunk claiming far more bytes than the file holds. This
            // one is common in files written by something that crashed, so it
            // is read as far as it goes rather than refused.
            Bytes file = simple_file();
            file[14 + 4] = 0x7F;  // first byte of the MTrk length
            const auto parsed = parse(file);
            require(!parsed.tracks.empty(), "an over-long chunk length should be clamped, not fatal");
        }
        {
            // A file with a header and nothing else.
            require(throws(header(0, 1, 480)), "a file with no tracks should be rejected");
        }
    }

    std::cout << "midi tests passed\n";
    return 0;
}

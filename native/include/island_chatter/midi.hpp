#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace island_chatter::midi {

struct Note {
    std::uint32_t start_tick = 0;
    std::uint32_t length_ticks = 0;
    std::uint8_t pitch = 60;
    std::uint8_t velocity = 100;
    std::uint8_t channel = 0;
};

struct TempoChange {
    std::uint32_t tick = 0;
    // Microseconds per quarter note, which is what FF 51 actually stores. BPM
    // is the reciprocal and loses precision, so the file's own unit is kept.
    double microseconds_per_quarter = 500000.0;
};

struct TimeSignature {
    std::uint32_t tick = 0;
    int numerator = 4;
    // The denominator as written is a power of two: 2 means a quarter, 3 an
    // eighth. Stored the way the file stores it so nothing has to be undone.
    int denominator_power = 2;
};

struct Track {
    // The raw bytes of FF 03. Track names have no declared encoding, so this is
    // not necessarily UTF-8 and is only ever shown, never parsed.
    std::string name;
    std::vector<Note> notes;
};

struct File {
    std::uint16_t format = 0;
    // Ticks per quarter note. Zero when the file uses SMPTE timing, in which
    // case ticks are already absolute and smpte_ticks_per_second is set instead.
    std::uint16_t ticks_per_quarter = 480;
    double smpte_ticks_per_second = 0.0;
    std::vector<Track> tracks;
    // Merged across every track and sorted, because a format 1 file keeps its
    // tempo map in track 0 while the notes live in track 1 and up.
    std::vector<TempoChange> tempos;
    // Collected the same way, and for the same reason: a format 1 file keeps
    // its meter with its tempo in track 0.
    std::vector<TimeSignature> time_signatures;

    double seconds_at(std::uint32_t tick) const;
    double bpm_at(std::uint32_t tick) const;
    std::size_t total_notes() const;

    // The tick of the most recent bar line at or before `tick`.
    //
    // A meter change starts a new bar wherever it falls, which is what every
    // notation program does and what makes the count come out right when a
    // piece changes from 4/4 to 3/4 partway through.
    std::uint32_t bar_line_at(std::uint32_t tick) const;

    // Whether a note beginning here is on a downbeat, within a tolerance,
    // because a performance recorded from a keyboard is never exactly on it.
    bool starts_bar(std::uint32_t tick, std::uint32_t tolerance) const;
};

// Throws std::runtime_error on anything it cannot make sense of.
//
// The input is a file the user picked, so it is untrusted: every read is bounds
// checked, a variable-length quantity is capped at the four bytes the format
// allows, and a chunk claiming to be longer than the file is clamped rather
// than believed. A malformed file has to come back as a message, never as a
// crash inside After Effects.
File parse(const std::vector<unsigned char>& bytes);

struct TopLine {
    std::vector<Note> notes;
    // Notes discarded because something higher was sounding at the same time.
    // The panel reports this rather than silently dropping half a chord.
    std::size_t dropped = 0;
};

// One monophonic line: the highest note of each chord, with every note clipped
// at the start of the next.
//
// The clipping is not cosmetic. render_event() writes into the sample buffer by
// assignment rather than by accumulation, so two overlapping events would
// clobber each other, and which one won would depend on the order the lazy
// block renderer happened to reach them. Guaranteeing a monophonic line here is
// what keeps Utterance and synthesize() bit-identical (dsp.hpp invariant 8d).
TopLine top_line(const Track& track, std::uint16_t ticks_per_quarter);

}  // namespace island_chatter::midi

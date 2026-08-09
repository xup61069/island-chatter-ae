#pragma once

#include "island_chatter/dsp.hpp"
#include "island_chatter/midi.hpp"

#include <cstddef>
#include <string>
#include <vector>

namespace island_chatter::song {

struct Line {
    std::string text;
    // Where the layer goes on the After Effects timeline: the absolute time of
    // this line's first note. An imported song is not laid out on the panel's
    // beat grid — it belongs at the times the MIDI file says.
    double start_seconds = 0.0;
    // The tempo in force when the line starts. Slot durations are computed from
    // real seconds and converted with this, so a tempo change inside a line is
    // absorbed into the note lengths and the audio still lands correctly; only
    // the beat labelling becomes nominal.
    double bpm = 120.0;
    std::vector<int> slots;
    std::size_t syllables = 0;
    std::size_t notes = 0;
    // This line is the rest of the one before it. A lyric line, or a stretch of
    // note names, longer than the transport can carry becomes several layers
    // rather than being cut short — split on a bar line wherever one is near.
    bool continued = false;
};

struct Assignment {
    std::vector<Line> lines;
    double bpm = 120.0;
    // Notes left over once the lyrics ran out, and syllables left with no note.
    // Both are reported rather than swallowed: a lyric that does not fit its
    // melody is the single most likely thing to be wrong about an import, and
    // the user is the only one who can fix it.
    std::size_t extra_notes = 0;
    std::size_t extra_syllables = 0;
    std::size_t dropped_chord_notes = 0;
    // How many layers exist only because something was too long for one. Zero
    // means every line fitted; nothing is ever truncated to make it fit.
    std::size_t split_lines = 0;
};

// Splits a lyric into non-empty trimmed lines. Exposed so the panel and the
// importer cannot disagree about what counts as a line.
std::vector<std::string> lyric_lines(const std::string& lyrics);

// The solfège name of a pitch, against a tonic given as a pitch class where
// 0 is C. An accidental takes the name of the natural below it, so C sharp is
// sung "do": the note still sounds at its own pitch, and the syllable is only a
// label. Seven names rather than a chromatic set, because in Chinese practice
// the seventh is "si" and a chromatic set needs that syllable for a sharpened
// fifth.
const char* solfege_name(int pitch, int tonic);

// Hands each lyric line as many notes as it has syllables, in order.
//
// With no lyrics at all, the melody sings its own note names instead, one
// syllable per note, broken into lines at the long rests. That needs no new
// effect parameters: the names become the layer's real Source Text, so markers,
// mouth shapes and Type-On all follow without knowing anything about it.
//
// `tonic` is the pitch class "do" is fixed to. Zero is C, which makes fixed and
// movable solfège agree, and is the right default for someone who has not
// thought about it.
//
// Throws std::runtime_error if the track index is out of range or the chosen
// track has no notes.
Assignment assign(
    const midi::File& file,
    std::size_t track_index,
    const std::string& lyrics,
    int tonic = 0);

}  // namespace island_chatter::song

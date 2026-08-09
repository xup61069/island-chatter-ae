#include "island_chatter/song.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace island_chatter::song {
namespace {

std::string trimmed(const std::string& value) {
    std::size_t first = 0;
    while (first < value.size() &&
            (value[first] == ' ' || value[first] == '\t' || value[first] == '\r')) {
        ++first;
    }
    std::size_t last = value.size();
    while (last > first &&
            (value[last - 1] == ' ' || value[last - 1] == '\t' || value[last - 1] == '\r')) {
        --last;
    }
    return value.substr(first, last - first);
}

// A rest shorter than this is a gap between two notes of a legato phrase, not a
// silence anybody asked for. Spending a slot on it would cost a note the line
// could have used, and the transport only carries sixty-four.
constexpr int kSmallestRestTicks = 2;

// What the tempo parameter can hold. A MIDI file's tempo is a free-running
// microseconds-per-quarter and nothing stops it being 8 or 900, but After
// Effects refuses a setValue() outside a parameter's range with a modal dialog
// — so the clamp has to happen here rather than at the panel.
//
// Clamping costs no accuracy: the slot lengths below are derived from real
// seconds using this same number, and playback divides by it again, so a
// clamped tempo lands every note in the same place. All that changes is the
// nominal beat labelling and how much a single slot can hold.
constexpr double kSlowestBpm = 20.0;
constexpr double kFastestBpm = 400.0;

double usable_bpm(double bpm) {
    if (!(bpm > 0.0)) { return 120.0; }
    return std::max(kSlowestBpm, std::min(kFastestBpm, bpm));
}

// Where a melody with no words is cut into layers. Two beats of silence is a
// breath in almost any tempo, and it is where a lyricist would have started a
// new line too.
constexpr long long kPhraseBreakTicks = kMelodyTicksPerBeat * 2;

// A layer also carries at most this much text, so a line long enough to
// overflow the melody usually overflows this too.
constexpr std::size_t kMaxTextUnits = 128;

// How many UTF-16 units a UTF-8 string is, which is the limit the text
// transport actually counts in.
std::size_t utf16_length(const std::string& text) {
    std::size_t units = 0;
    for (std::size_t index = 0; index < text.size();) {
        const auto lead = static_cast<unsigned char>(text[index]);
        std::size_t width = 1;
        if ((lead & 0xE0U) == 0xC0U) { width = 2; }
        else if ((lead & 0xF0U) == 0xE0U) { width = 3; }
        else if ((lead & 0xF8U) == 0xF0U) { width = 4; }
        units += width == 4 ? 2 : 1;
        index += width;
    }
    return units;
}

// Moves a byte offset back to somewhere it is safe to cut.
//
// Never mid-character, and never inside a pronunciation override: half of
// "[重|chong2]" is broken on both sides of the break, which is the same rule
// splitForTransport() follows in the panel.
std::size_t safe_cut(const std::string& text, std::size_t at) {
    at = std::min(at, text.size());
    while (at > 0 && (static_cast<unsigned char>(text[at]) & 0xC0U) == 0x80U) {
        --at;
    }
    std::size_t open = std::string::npos;
    for (std::size_t index = 0; index < at; ++index) {
        if (text[index] == '[') { open = index; }
        else if (text[index] == ']') { open = std::string::npos; }
    }
    return open == std::string::npos ? at : open;
}

// The longest prefix of `text` that sings at most `syllables` syllables and
// fits the text transport.
//
// Found by asking the engine rather than by counting characters: how many
// syllables a stretch of text is depends on the readings, the phrase table and
// English syllabification, and the panel learned once already what happens when
// something else tries to work that out for itself.
std::string prefix_for_syllables(const std::string& text, std::size_t syllables) {
    if (syllables == 0) { return std::string(); }
    // Syllable count only grows as the prefix grows, so the boundary can be
    // found by halving rather than by trying every character.
    std::size_t low = 0;
    std::size_t high = text.size();
    while (low < high) {
        const std::size_t middle = safe_cut(text, low + (high - low + 1) / 2);
        if (middle <= low) { break; }
        const std::string candidate = text.substr(0, middle);
        if (syllable_count(candidate, true) <= syllables &&
                utf16_length(candidate) <= kMaxTextUnits) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return text.substr(0, low);
}

}  // namespace

const char* solfege_name(int pitch, int tonic) {
    static const char* names[12] = {
        "do", "do", "re", "re", "mi", "fa", "fa", "sol", "sol", "la", "la", "si"
    };
    int degree = (pitch - tonic) % 12;
    if (degree < 0) { degree += 12; }
    return names[degree];
}

std::vector<std::string> lyric_lines(const std::string& lyrics) {
    std::vector<std::string> lines;
    std::string current;
    for (const char letter : lyrics) {
        if (letter == '\n' || letter == '\r') {
            const auto line = trimmed(current);
            if (!line.empty()) {
                lines.push_back(line);
            }
            current.clear();
        } else {
            current.push_back(letter);
        }
    }
    const auto last = trimmed(current);
    if (!last.empty()) {
        lines.push_back(last);
    }
    return lines;
}

Assignment assign(
    const midi::File& file,
    std::size_t track_index,
    const std::string& lyrics,
    int tonic) {
    if (track_index >= file.tracks.size()) {
        throw std::runtime_error("song: that track is not in this file");
    }
    const auto melody = midi::top_line(file.tracks[track_index], file.ticks_per_quarter);
    if (melody.notes.empty()) {
        throw std::runtime_error("song: that track has no notes in it");
    }
    const auto line_texts = lyric_lines(lyrics);
    // No words at all is not an error any more: the melody sings its own note
    // names. One line per phrase, decided below by where the long rests are.
    const bool naming = line_texts.empty();

    Assignment assignment;
    assignment.bpm = usable_bpm(file.bpm_at(0));
    assignment.dropped_chord_notes = melody.dropped;

    std::size_t note_index = 0;
    std::size_t text_index = 0;
    // What is left of a lyric line that did not fit on one layer. Nothing is
    // ever dropped to make it fit: the remainder becomes the next layer.
    std::string carried;
    bool carrying = false;
    // The same idea for note names, where there is no text to carry: the next
    // layer is a continuation whenever this one stopped for want of room
    // rather than at a breath.
    bool naming_continues = false;

    while (note_index < melody.notes.size() ||
            (!naming && (carrying || text_index < line_texts.size()))) {
        Line line;
        std::size_t want = 0;
        if (naming) {
            // Bounded only by the transport and the next phrase break; the
            // loop below decides where it actually ends.
            want = kMelodySlots;
            line.continued = naming_continues;
        } else {
            if (carrying) {
                line.text = carried;
                line.continued = true;
                carrying = false;
            } else {
                if (text_index >= line_texts.size()) { break; }
                line.text = line_texts[text_index];
                ++text_index;
            }
            line.syllables = syllable_count(line.text, true);
            want = line.syllables;
            if (note_index >= melody.notes.size()) {
                assignment.extra_syllables += line.syllables;
                continue;
            }
        }
        if (note_index >= melody.notes.size()) { break; }

        const auto& first = melody.notes[note_index];
        line.start_seconds = file.seconds_at(first.start_tick);
        line.bpm = usable_bpm(file.bpm_at(first.start_tick));

        // Every boundary is rounded once, against the start of the line, and
        // the slot lengths are the differences between those rounded values.
        // Rounding each note's own length instead and adding them up walks the
        // melody steadily out of time — half a tick per note, in the same
        // direction, for as long as the line lasts.
        const double ticks_per_second = line.bpm * kMelodyTicksPerBeat / 60.0;
        const auto tick_at = [&](double seconds) {
            return static_cast<long long>(
                std::llround((seconds - line.start_seconds) * ticks_per_second));
        };

        // --- how many notes this layer gets ---------------------------------
        //
        // Decided before anything is encoded, so that running out of room can
        // back the cut up to a bar line instead of stopping wherever the
        // sixty-fourth slot happened to fall. A line cut mid-bar reads as a
        // mistake; one cut on the barline reads as a line.
        const std::uint32_t bar_tolerance =
            std::max<std::uint32_t>(1U, file.ticks_per_quarter / 16U);
        std::size_t take = 0;
        std::size_t bar_cut = 0;
        bool ran_out_of_room = false;
        {
            std::size_t slots = 0;
            // Note names are generated text, and they are wordy: "sol " is four
            // units, so sixty-four of them is around two hundred — well past
            // what the text transport carries. Counting only the melody slots
            // let a full layer of notes arrive with half its words missing,
            // because the panel then truncated the text and nothing said so.
            std::size_t units = utf16_length(line.text);
            long long dry_cursor = 0;
            std::size_t at = note_index;
            while (take < want && at < melody.notes.size()) {
                const auto& note = melody.notes[at];
                const long long on = tick_at(file.seconds_at(note.start_tick));
                const long long off = tick_at(
                    file.seconds_at(note.start_tick + note.length_ticks));
                const long long rest = on - dry_cursor;
                if (naming && take > 0 && rest >= kPhraseBreakTicks) { break; }
                // Recorded before the budget is checked, not after. bar_cut is
                // "stop here, so the next layer begins on this downbeat" — and
                // the note that does not fit is itself a candidate for that.
                // Checking afterwards throws away the best cut of all and backs
                // up to the bar before it.
                if (take > 0 && file.starts_bar(note.start_tick, bar_tolerance)) {
                    bar_cut = take;
                }
                const bool wants_rest = rest >= kSmallestRestTicks && take > 0;
                std::size_t wanted_units = 0;
                if (naming) {
                    wanted_units = std::strlen(solfege_name(note.pitch, tonic)) +
                        (units > 0 ? 1U : 0U);
                }
                if (slots + (wants_rest ? 2U : 1U) > kMelodySlots ||
                        units + wanted_units > kMaxTextUnits) {
                    ran_out_of_room = true;
                    break;
                }
                slots += wants_rest ? 2U : 1U;
                units += wanted_units;
                dry_cursor = on + std::max<long long>(1, off - on);
                ++take;
                ++at;
            }
            // Only back up to a bar line when the cut was forced. A line that
            // ended because its words ran out is already where it belongs.
            if (ran_out_of_room && bar_cut > 0) {
                take = bar_cut;
            }
        }
        if (take == 0) { break; }

        // --- and the text that goes with them --------------------------------
        if (!naming && take < line.syllables) {
            const std::string head = prefix_for_syllables(line.text, take);
            if (head.empty()) {
                // Nothing can be cut off the front — one override longer than
                // the whole transport. Sing what there is rather than loop.
                take = line.syllables;
            } else {
                carried = line.text.substr(head.size());
                carrying = !carried.empty();
                line.text = head;
                line.syllables = syllable_count(line.text, true);
                take = std::min(take, line.syllables);
                ++assignment.split_lines;
            }
        }

        long long cursor = 0;
        while (line.notes < take && note_index < melody.notes.size()) {
            const auto& note = melody.notes[note_index];
            const long long on = tick_at(file.seconds_at(note.start_tick));
            const long long off = tick_at(
                file.seconds_at(note.start_tick + note.length_ticks));
            const long long rest = on - cursor;
            const long long sounding = std::max<long long>(1, off - on);

            const bool wants_rest = rest >= kSmallestRestTicks && line.notes > 0;
            if (wants_rest) {
                const auto pair = encode_melody(
                    0, static_cast<int>(std::min<long long>(rest, kMelodyMaxTicks)), 0);
                line.slots.push_back(pair.melody);
                line.details.push_back(pair.detail);
            }
            const auto pair = encode_melody(
                std::min(127, std::max(1, static_cast<int>(note.pitch))),
                static_cast<int>(std::min<long long>(sounding, kMelodyMaxTicks)),
                note.velocity);
            line.slots.push_back(pair.melody);
            line.details.push_back(pair.detail);
            if (naming) {
                if (!line.text.empty()) { line.text.push_back(' '); }
                line.text += solfege_name(note.pitch, tonic);
            }
            cursor = on + sounding;
            ++line.notes;
            ++note_index;
        }

        if (naming) {
            line.syllables = line.notes;
            if (line.notes == 0) { break; }
            naming_continues = ran_out_of_room;
            if (ran_out_of_room) { ++assignment.split_lines; }
        } else if (line.notes < line.syllables) {
            assignment.extra_syllables += line.syllables - line.notes;
        }
        assignment.lines.push_back(std::move(line));
    }
    // Anything still carried had no notes left to sing it.
    if (carrying) {
        assignment.extra_syllables += syllable_count(carried, true);
    }

    assignment.extra_notes = melody.notes.size() - note_index;
    return assignment;
}

}  // namespace island_chatter::song

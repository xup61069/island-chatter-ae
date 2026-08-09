#include "island_chatter/midi.hpp"

#include <algorithm>
#include <cmath>
#include <map>
#include <stdexcept>
#include <utility>

namespace island_chatter::midi {
namespace {

// Every read goes through here. The file came from a file picker, so "the
// header says this chunk is 4 GB" is an input, not an impossibility.
class Reader {
public:
    Reader(const unsigned char* data, std::size_t size) : data_(data), size_(size) {}

    std::size_t remaining() const { return size_ - position_; }
    bool done() const { return position_ >= size_; }
    std::size_t position() const { return position_; }

    void seek(std::size_t position) {
        if (position > size_) {
            throw std::runtime_error("MIDI file: seek past the end of the data");
        }
        position_ = position;
    }

    std::uint8_t byte() {
        if (position_ >= size_) {
            throw std::runtime_error("MIDI file: ended in the middle of an event");
        }
        return data_[position_++];
    }

    std::uint8_t peek() const {
        if (position_ >= size_) {
            throw std::runtime_error("MIDI file: ended in the middle of an event");
        }
        return data_[position_];
    }

    std::uint16_t big_endian_16() {
        const std::uint32_t high = byte();
        return static_cast<std::uint16_t>((high << 8U) | byte());
    }

    std::uint32_t big_endian_32() {
        std::uint32_t value = 0;
        for (int index = 0; index < 4; ++index) {
            value = (value << 8U) | byte();
        }
        return value;
    }

    std::string text(std::size_t count) {
        if (count > remaining()) {
            throw std::runtime_error("MIDI file: a chunk claims more bytes than the file holds");
        }
        std::string value(reinterpret_cast<const char*>(data_ + position_), count);
        position_ += count;
        return value;
    }

    void skip(std::size_t count) {
        if (count > remaining()) {
            throw std::runtime_error("MIDI file: a chunk claims more bytes than the file holds");
        }
        position_ += count;
    }

    // A variable-length quantity is at most four bytes by definition. Without
    // the cap a run of 0x80 bytes — which is what a truncated or misaligned
    // file looks like — reads to the end of the file and then throws from
    // somewhere unrelated, or spins if the caller is lenient.
    std::uint32_t variable_length() {
        std::uint32_t value = 0;
        for (int index = 0; index < 4; ++index) {
            const std::uint8_t part = byte();
            value = (value << 7U) | (part & 0x7FU);
            if ((part & 0x80U) == 0U) {
                return value;
            }
        }
        throw std::runtime_error("MIDI file: a length field never terminates");
    }

private:
    const unsigned char* data_;
    std::size_t size_;
    std::size_t position_ = 0;
};

// Notes still sounding, keyed by channel and pitch. A file may legitimately
// start the same pitch twice before releasing it; the later start wins, which
// is what every sequencer does.
using Pending = std::map<std::pair<std::uint8_t, std::uint8_t>, std::pair<std::uint32_t, std::uint8_t>>;

void close_note(Track& track, Pending& pending, Pending::iterator entry, std::uint32_t tick) {
    Note note;
    note.channel = entry->first.first;
    note.pitch = entry->first.second;
    note.start_tick = entry->second.first;
    note.velocity = entry->second.second;
    note.length_ticks = tick > note.start_tick ? tick - note.start_tick : 0U;
    if (note.length_ticks > 0U) {
        track.notes.push_back(note);
    }
    pending.erase(entry);
}

void parse_track(Reader& reader, std::size_t end, File& file) {
    Track track;
    Pending pending;
    std::uint32_t tick = 0;
    std::uint8_t running_status = 0;

    while (reader.position() < end) {
        tick += reader.variable_length();
        if (reader.position() >= end) {
            break;
        }
        std::uint8_t status = reader.peek();
        if ((status & 0x80U) != 0U) {
            reader.byte();
        } else {
            // Running status: the status byte is omitted and the previous
            // channel message's applies. Meta and sysex events cancel it, so a
            // data byte arriving with nothing to inherit is a corrupt file.
            if (running_status == 0U) {
                throw std::runtime_error("MIDI file: a data byte with no status to inherit");
            }
            status = running_status;
        }

        if (status == 0xFFU) {
            running_status = 0;
            const std::uint8_t type = reader.byte();
            const std::uint32_t length = reader.variable_length();
            if (type == 0x51U && length == 3U) {
                TempoChange change;
                change.tick = tick;
                const std::uint32_t high = reader.byte();
                const std::uint32_t middle = reader.byte();
                const std::uint32_t low = reader.byte();
                const std::uint32_t microseconds = (high << 16U) | (middle << 8U) | low;
                // Zero would divide by nothing a few lines into seconds_at().
                change.microseconds_per_quarter =
                    microseconds > 0U ? static_cast<double>(microseconds) : 500000.0;
                file.tempos.push_back(change);
            } else if (type == 0x58U && length >= 2U) {
                TimeSignature signature;
                signature.tick = tick;
                signature.numerator = std::max<int>(1, reader.byte());
                signature.denominator_power = std::min<int>(6, reader.byte());
                reader.skip(length - 2U);
                file.time_signatures.push_back(signature);
            } else if (type == 0x03U && track.name.empty()) {
                track.name = reader.text(length);
            } else if (type == 0x2FU) {
                reader.skip(length);
                break;
            } else {
                reader.skip(length);
            }
            continue;
        }

        if (status == 0xF0U || status == 0xF7U) {
            running_status = 0;
            reader.skip(reader.variable_length());
            continue;
        }

        running_status = status;
        const std::uint8_t kind = status & 0xF0U;
        const auto channel = static_cast<std::uint8_t>(status & 0x0FU);
        if (kind == 0x90U || kind == 0x80U) {
            const std::uint8_t pitch = reader.byte() & 0x7FU;
            const std::uint8_t velocity = reader.byte() & 0x7FU;
            const auto key = std::make_pair(channel, pitch);
            // Note-on with velocity 0 is the release half of running status,
            // and it is far more common in real files than an explicit 0x8n.
            const bool starting = kind == 0x90U && velocity > 0U;
            const auto found = pending.find(key);
            if (found != pending.end()) {
                close_note(track, pending, found, tick);
            }
            if (starting) {
                pending.emplace(key, std::make_pair(tick, velocity));
            }
        } else if (kind == 0xC0U || kind == 0xD0U) {
            reader.byte();
        } else {
            reader.byte();
            reader.byte();
        }
    }

    // Anything still held when the track ends is closed there. A note left open
    // by a file that never released it would otherwise vanish, which reads as
    // "the importer lost my last note".
    while (!pending.empty()) {
        close_note(track, pending, pending.begin(), tick);
    }
    std::stable_sort(track.notes.begin(), track.notes.end(),
        [](const Note& left, const Note& right) { return left.start_tick < right.start_tick; });
    file.tracks.push_back(std::move(track));
    reader.seek(end);
}

}  // namespace

double File::seconds_at(std::uint32_t tick) const {
    if (smpte_ticks_per_second > 0.0) {
        return static_cast<double>(tick) / smpte_ticks_per_second;
    }
    const double per_quarter = ticks_per_quarter > 0U ? ticks_per_quarter : 480.0;
    double seconds = 0.0;
    std::uint32_t previous = 0;
    double microseconds = 500000.0;
    for (const auto& change : tempos) {
        if (change.tick >= tick) {
            break;
        }
        seconds += static_cast<double>(change.tick - previous) * microseconds / (1e6 * per_quarter);
        previous = change.tick;
        microseconds = change.microseconds_per_quarter;
    }
    seconds += static_cast<double>(tick - previous) * microseconds / (1e6 * per_quarter);
    return seconds;
}

double File::bpm_at(std::uint32_t tick) const {
    double microseconds = 500000.0;
    for (const auto& change : tempos) {
        if (change.tick > tick) {
            break;
        }
        microseconds = change.microseconds_per_quarter;
    }
    return 60000000.0 / microseconds;
}

std::uint32_t File::bar_line_at(std::uint32_t tick) const {
    const std::uint32_t per_quarter = ticks_per_quarter > 0U ? ticks_per_quarter : 480U;
    const auto bar_length = [&](const TimeSignature& signature) {
        // A bar is numerator notes of 1/2^denominator each, and a quarter is
        // 2^2, so the whole thing in quarters is numerator * 4 / 2^denominator.
        const double quarters = static_cast<double>(signature.numerator) * 4.0 /
            static_cast<double>(1U << signature.denominator_power);
        const auto ticks = static_cast<std::uint32_t>(
            std::llround(quarters * static_cast<double>(per_quarter)));
        return std::max<std::uint32_t>(1U, ticks);
    };

    TimeSignature current;
    std::uint32_t grid_start = 0;
    std::uint32_t line = 0;
    for (const auto& signature : time_signatures) {
        if (signature.tick > tick) {
            break;
        }
        // Every bar line between where the last grid started and this change.
        const std::uint32_t length = bar_length(current);
        if (signature.tick > grid_start) {
            line = grid_start + ((signature.tick - grid_start) / length) * length;
        }
        // A meter change starts a bar of its own wherever it lands.
        current = signature;
        grid_start = signature.tick;
        line = signature.tick;
    }
    const std::uint32_t length = bar_length(current);
    if (tick > grid_start) {
        line = grid_start + ((tick - grid_start) / length) * length;
    }
    return line;
}

bool File::starts_bar(std::uint32_t tick, std::uint32_t tolerance) const {
    const std::uint32_t line = bar_line_at(tick);
    if (tick - line <= tolerance) {
        return true;
    }
    // Also a downbeat if it sits just before the next one, which is what a
    // note pushed a couple of ticks early looks like.
    const std::uint32_t next = bar_line_at(tick + tolerance + 1U);
    return next > line && next - tick <= tolerance;
}

std::size_t File::total_notes() const {
    std::size_t count = 0;
    for (const auto& track : tracks) {
        count += track.notes.size();
    }
    return count;
}

File parse(const std::vector<unsigned char>& bytes) {
    Reader reader(bytes.data(), bytes.size());
    if (reader.remaining() < 14U || reader.text(4) != "MThd") {
        throw std::runtime_error("MIDI file: this is not a standard MIDI file");
    }
    const std::uint32_t header_length = reader.big_endian_32();
    if (header_length < 6U) {
        throw std::runtime_error("MIDI file: the header is too short to read");
    }
    File file;
    file.format = reader.big_endian_16();
    const std::uint16_t declared_tracks = reader.big_endian_16();
    const std::uint16_t division = reader.big_endian_16();
    if ((division & 0x8000U) != 0U) {
        // SMPTE division: the high byte is a negative frame rate and the low
        // byte is ticks per frame, so a tick is an absolute duration and the
        // tempo map does not apply to it.
        const auto frames = static_cast<double>(256U - ((division >> 8U) & 0xFFU));
        const auto per_frame = static_cast<double>(division & 0xFFU);
        if (frames <= 0.0 || per_frame <= 0.0) {
            throw std::runtime_error("MIDI file: the timing division makes no sense");
        }
        file.ticks_per_quarter = 0;
        // 29.97 drop-frame is written as 29 in this field, which is the usual
        // half-percent lie; nothing here is accurate enough to care.
        file.smpte_ticks_per_second = frames * per_frame;
    } else {
        if ((division & 0x7FFFU) == 0U) {
            throw std::runtime_error("MIDI file: the timing division makes no sense");
        }
        file.ticks_per_quarter = static_cast<std::uint16_t>(division & 0x7FFFU);
    }
    // Header chunks longer than six bytes are legal and reserved; skip the rest
    // rather than assuming the first track starts at offset 14.
    reader.skip(header_length - 6U);

    while (reader.remaining() >= 8U) {
        const std::string type = reader.text(4);
        const std::uint32_t length = reader.big_endian_32();
        // A last chunk whose declared length overruns the file is common in
        // files written by something that crashed. Read what is there.
        const std::size_t end = reader.position() +
            std::min<std::size_t>(length, reader.remaining());
        if (type == "MTrk") {
            parse_track(reader, end, file);
        } else {
            reader.seek(end);
        }
    }
    if (file.tracks.empty()) {
        throw std::runtime_error("MIDI file: there are no tracks in this file");
    }
    // Not an error: a file can declare more tracks than it carries, and the
    // note data is still usable. declared_tracks is read only to keep the
    // header parse honest about its own layout.
    static_cast<void>(declared_tracks);
    std::stable_sort(file.tempos.begin(), file.tempos.end(),
        [](const TempoChange& left, const TempoChange& right) { return left.tick < right.tick; });
    std::stable_sort(file.time_signatures.begin(), file.time_signatures.end(),
        [](const TimeSignature& left, const TimeSignature& right) { return left.tick < right.tick; });
    return file;
}

TopLine top_line(const Track& track, std::uint16_t ticks_per_quarter) {
    TopLine line;
    if (track.notes.empty()) {
        return line;
    }
    // Two notes struck together are a chord even when the file puts them a few
    // ticks apart, which is what a performance recorded from a keyboard looks
    // like. A sixty-fourth note is short enough that nothing melodic falls
    // inside it and long enough to catch human timing.
    const std::uint32_t window = std::max<std::uint32_t>(1U, ticks_per_quarter / 16U);
    std::size_t index = 0;
    while (index < track.notes.size()) {
        const std::uint32_t group_start = track.notes[index].start_tick;
        std::size_t best = index;
        std::size_t next = index;
        while (next < track.notes.size() &&
                track.notes[next].start_tick - group_start <= window) {
            if (track.notes[next].pitch > track.notes[best].pitch) {
                best = next;
            }
            ++next;
        }
        line.dropped += (next - index) - 1U;
        line.notes.push_back(track.notes[best]);
        // The kept note starts where the group does, so a chord voiced from the
        // bottom up does not shift the melody a few ticks late. Its end stays
        // where it was, or moving the start would also shorten the note.
        line.notes.back().length_ticks += track.notes[best].start_tick - group_start;
        line.notes.back().start_tick = group_start;
        index = next;
    }
    // Clip against the next note. Anything still overlapping after the chord
    // reduction is a held note underneath a moving line, and letting it run
    // would put two events on the same samples.
    for (std::size_t at = 0; at + 1 < line.notes.size(); ++at) {
        const std::uint32_t limit = line.notes[at + 1].start_tick;
        const std::uint32_t end = line.notes[at].start_tick + line.notes[at].length_ticks;
        if (end > limit) {
            line.notes[at].length_ticks = limit - line.notes[at].start_tick;
        }
    }
    return line;
}

}  // namespace island_chatter::midi

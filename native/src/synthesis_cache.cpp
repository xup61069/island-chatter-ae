#include "island_chatter/synthesis_cache.hpp"

#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <exception>
#include <limits>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace island_chatter {
namespace {

template <typename T>
void append_binary(std::string& key, const T& value) {
    const auto* bytes = reinterpret_cast<const char*>(&value);
    key.append(bytes, sizeof(T));
}

std::string settings_key(const Settings& settings) {
    std::string key = settings.text;
    key.push_back('\0');
    append_binary(key, settings.voice_index);
    append_binary(key, settings.pitch);
    append_binary(key, settings.speed);
    // settings.volume is absent on purpose; see SynthesisCache::get.
    append_binary(key, settings.consonant);
    append_binary(key, settings.emotion);
    append_binary(key, settings.character_size);
    append_binary(key, settings.clarity);
    append_binary(key, settings.cuteness);
    append_binary(key, settings.seed);
    append_binary(key, settings.sample_rate);
    append_binary(key, settings.tempo_lock);
    // Timbre changes the rendered samples, so it belongs in the key. Volume is
    // still deliberately absent: it is applied as a gain when copying out.
    append_binary(key, settings.formant);
    append_binary(key, settings.source);
    append_binary(key, settings.vibrato_depth);
    append_binary(key, settings.vibrato_rate);
    // The melody changes every sample of the result, so all of it belongs in
    // the key — the notes themselves and every control that decides how they
    // are sung. Volume is still the one deliberate omission.
    append_binary(key, settings.melody_mode);
    append_binary(key, settings.melody_bpm);
    append_binary(key, settings.transpose);
    append_binary(key, settings.tone_blend);
    append_binary(key, settings.portamento_seconds);
    append_binary(key, settings.vibrato_delay);
    append_binary(key, settings.melody.size());
    for (const auto& note : settings.melody) {
        append_binary(key, note.pitch);
        append_binary(key, note.ticks);
        append_binary(key, note.velocity);
    }
    return key;
}

}  // namespace

class SynthesisCache::Implementation {
public:
    Implementation(std::size_t maximum_entries, std::size_t maximum_samples)
        : maximum_entries_(std::max<std::size_t>(1, maximum_entries)),
          maximum_samples_(std::max<std::size_t>(1, maximum_samples)) {}

    std::shared_ptr<const Utterance> get(const Settings& settings) {
        const auto key = settings_key(settings);
        std::shared_ptr<Entry> entry;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            const auto found = entries_.find(key);
            if (found != entries_.end()) {
                entry = found->second;
                entry->last_use = ++clock_;
                entry->ready.wait(lock, [&entry] { return !entry->rendering; });
                if (entry->error) std::rethrow_exception(entry->error);
                return entry->result;
            }

            evict_ready_entries();
            entry = std::make_shared<Entry>();
            entry->last_use = ++clock_;
            entries_.emplace(key, entry);
        }

        try {
            auto rendered = std::make_shared<const Utterance>(settings);
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                entry->result = rendered;
                entry->rendering = false;
                resident_samples_ += rendered->sample_count();
                // The size of a render is only known now, so the bound has to
                // be reapplied here as well as on the miss path. This entry is
                // the most recently used, so eviction reaches it last.
                evict_ready_entries();
            }
            entry->ready.notify_all();
            return rendered;
        } catch (...) {
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                entry->error = std::current_exception();
                entry->rendering = false;
                const auto found = entries_.find(key);
                if (found != entries_.end() && found->second == entry) entries_.erase(found);
            }
            entry->ready.notify_all();
            throw;
        }
    }

    std::size_t size() const {
        const std::lock_guard<std::mutex> lock(mutex_);
        return entries_.size();
    }

private:
    struct Entry {
        bool rendering = true;
        std::uint64_t last_use = 0;
        std::shared_ptr<const Utterance> result;
        std::exception_ptr error;
        std::condition_variable ready;
    };

    void evict_ready_entries() {
        while (entries_.size() >= maximum_entries_ || resident_samples_ > maximum_samples_) {
            auto oldest = entries_.end();
            std::uint64_t oldest_use = std::numeric_limits<std::uint64_t>::max();
            for (auto candidate = entries_.begin(); candidate != entries_.end(); ++candidate) {
                if (!candidate->second->rendering && candidate->second->last_use < oldest_use) {
                    oldest = candidate;
                    oldest_use = candidate->second->last_use;
                }
            }
            // If every entry is currently rendering, temporarily exceed the
            // bound; deleting one would allow duplicate synthesis again.
            if (oldest == entries_.end()) return;
            if (oldest->second->result) {
                resident_samples_ -= oldest->second->result->sample_count();
            }
            entries_.erase(oldest);
        }
    }

    const std::size_t maximum_entries_;
    const std::size_t maximum_samples_;
    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::shared_ptr<Entry>> entries_;
    std::uint64_t clock_ = 0;
    std::size_t resident_samples_ = 0;

public:
    std::size_t resident_samples() const {
        const std::lock_guard<std::mutex> lock(mutex_);
        return resident_samples_;
    }
};

SynthesisCache::SynthesisCache(std::size_t maximum_entries, std::size_t maximum_samples)
    : implementation_(std::make_unique<Implementation>(maximum_entries, maximum_samples)) {}

SynthesisCache::~SynthesisCache() = default;

std::shared_ptr<const Utterance> SynthesisCache::get(const Settings& settings) {
    return implementation_->get(settings);
}

std::size_t SynthesisCache::size() const {
    return implementation_->size();
}

std::size_t SynthesisCache::resident_samples() const {
    return implementation_->resident_samples();
}

}  // namespace island_chatter

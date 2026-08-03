#include "island_chatter/synthesis_cache.hpp"

#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <exception>
#include <limits>
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
    append_binary(key, settings.volume);
    append_binary(key, settings.consonant);
    append_binary(key, settings.emotion);
    append_binary(key, settings.character_size);
    append_binary(key, settings.clarity);
    append_binary(key, settings.cuteness);
    append_binary(key, settings.seed);
    append_binary(key, settings.sample_rate);
    return key;
}

}  // namespace

class SynthesisCache::Implementation {
public:
    explicit Implementation(std::size_t maximum_entries)
        : maximum_entries_(std::max<std::size_t>(1, maximum_entries)) {}

    std::shared_ptr<const Result> get(const Settings& settings) {
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
            auto rendered = std::make_shared<const Result>(synthesize(settings));
            {
                const std::lock_guard<std::mutex> lock(mutex_);
                entry->result = rendered;
                entry->rendering = false;
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
        std::shared_ptr<const Result> result;
        std::exception_ptr error;
        std::condition_variable ready;
    };

    void evict_ready_entries() {
        while (entries_.size() >= maximum_entries_) {
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
            entries_.erase(oldest);
        }
    }

    const std::size_t maximum_entries_;
    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::shared_ptr<Entry>> entries_;
    std::uint64_t clock_ = 0;
};

SynthesisCache::SynthesisCache(std::size_t maximum_entries)
    : implementation_(std::make_unique<Implementation>(maximum_entries)) {}

SynthesisCache::~SynthesisCache() = default;

std::shared_ptr<const Result> SynthesisCache::get(const Settings& settings) {
    return implementation_->get(settings);
}

std::size_t SynthesisCache::size() const {
    return implementation_->size();
}

}  // namespace island_chatter

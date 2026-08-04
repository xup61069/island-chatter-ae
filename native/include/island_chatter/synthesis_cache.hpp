#pragma once

#include "island_chatter/dsp.hpp"

#include <cstddef>
#include <memory>

namespace island_chatter {

// A bounded, thread-safe cache for AE's block-based audio renderer. Concurrent
// misses for the same settings share one synthesis instead of rendering the
// whole utterance once per requested block.
//
// Entry count alone is not a useful bound: one 64-character utterance at 48 kHz
// is about 2.4 MB, so a keyframed voice parameter could otherwise leave 150 MB
// resident for the whole After Effects session. The sample bound caps that.
class SynthesisCache {
public:
    static constexpr std::size_t kDefaultMaximumEntries = 64;
    static constexpr std::size_t kDefaultMaximumSamples = 32U * 1024U * 1024U;  // 128 MB

    explicit SynthesisCache(
        std::size_t maximum_entries = kDefaultMaximumEntries,
        std::size_t maximum_samples = kDefaultMaximumSamples);
    ~SynthesisCache();

    SynthesisCache(const SynthesisCache&) = delete;
    SynthesisCache& operator=(const SynthesisCache&) = delete;

    // Volume is deliberately excluded from the cache key: it is applied as a
    // gain when samples are copied out, so moving the slider costs nothing.
    std::shared_ptr<const Utterance> get(const Settings& settings);
    std::size_t size() const;
    std::size_t resident_samples() const;

private:
    class Implementation;
    std::unique_ptr<Implementation> implementation_;
};

}  // namespace island_chatter

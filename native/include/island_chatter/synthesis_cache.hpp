#pragma once

#include "island_chatter/dsp.hpp"

#include <cstddef>
#include <memory>

namespace island_chatter {

// A bounded, thread-safe cache for AE's block-based audio renderer. Concurrent
// misses for the same settings share one synthesis instead of rendering the
// whole utterance once per requested block.
class SynthesisCache {
public:
    explicit SynthesisCache(std::size_t maximum_entries = 64);
    ~SynthesisCache();

    SynthesisCache(const SynthesisCache&) = delete;
    SynthesisCache& operator=(const SynthesisCache&) = delete;

    std::shared_ptr<const Result> get(const Settings& settings);
    std::size_t size() const;

private:
    class Implementation;
    std::unique_ptr<Implementation> implementation_;
};

}  // namespace island_chatter

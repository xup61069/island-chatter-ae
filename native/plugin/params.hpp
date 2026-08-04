#pragma once

#include <cstddef>

namespace island_chatter::ae {

// Parameter order is a persistent project-file contract. Keep this in sync
// with native/panel/IslandChatterNativePanel.jsx.
enum ParamIndex : int {
    kParamInput = 0,
    kParamVoice = 1,
    kParamPitch = 2,
    kParamSpeed = 3,
    kParamVolume = 4,
    kParamConsonant = 5,
    kParamTextLength = 6,
    kParamTextFirst = 7,
    kParamEmotion = kParamTextFirst + 64,
    kParamCharacterSize,
    kParamClarity,
    kParamCuteness,
    kParamSeed,
    // Appended in 1.0.3. Projects saved by 1.0.2 and earlier simply get its
    // default of off, which reproduces their existing timing exactly.
    kParamTempoLock,
};

inline constexpr std::size_t kMaxTextUnits = 64;
inline constexpr int kParamCount = kParamTempoLock + 1;

static_assert(kParamSeed == 75, "Published parameter indices must never move");
static_assert(kParamCount == 77, "Changing the parameter count breaks saved AE projects");

}  // namespace island_chatter::ae

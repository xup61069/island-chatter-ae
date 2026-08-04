#pragma once

#define ISLAND_CHATTER_VERSION_MAJOR 1
#define ISLAND_CHATTER_VERSION_MINOR 0
#define ISLAND_CHATTER_VERSION_BUG 6
// PF_Stage_RELEASE. A published build must not ship as PF_Stage_DEVELOP;
// After Effects compares the encoded stage when it resolves plug-in versions.
#define ISLAND_CHATTER_VERSION_STAGE 3
#define ISLAND_CHATTER_VERSION_BUILD 1

// PF_VERSION(1, 0, 6, PF_Stage_RELEASE, 1)
#define ISLAND_CHATTER_AE_VERSION 538113

#define ISLAND_CHATTER_STRINGIFY_IMPL(value) #value
#define ISLAND_CHATTER_STRINGIFY(value) ISLAND_CHATTER_STRINGIFY_IMPL(value)

// Single source for the human-readable version so the About box cannot drift
// away from the numbers above.
#define ISLAND_CHATTER_VERSION_TEXT \
    ISLAND_CHATTER_STRINGIFY(ISLAND_CHATTER_VERSION_MAJOR) "." \
    ISLAND_CHATTER_STRINGIFY(ISLAND_CHATTER_VERSION_MINOR) "." \
    ISLAND_CHATTER_STRINGIFY(ISLAND_CHATTER_VERSION_BUG)

// PF_OutFlag_AUDIO_FLOAT_ONLY | PF_OutFlag_AUDIO_EFFECT_ONLY.
// AE's built-in Tone effect supplies the source sound object on text layers.
#define ISLAND_CHATTER_OUT_FLAGS -2013265920
#define ISLAND_CHATTER_OUT_FLAGS_2 0

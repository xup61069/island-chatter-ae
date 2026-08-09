#include "params.hpp"
#include "IslandChatterVersion.h"

#include "island_chatter/dsp.hpp"
#include "island_chatter/synthesis_cache.hpp"

#include "AEConfig.h"
#ifdef AE_OS_WIN
#include <Windows.h>
#endif
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_Macros.h"
#include "Param_Utils.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace {

constexpr char kName[] = "Island Chatter Native";
constexpr char kMatchName[] = "Island Chatter Native";
constexpr char kCategory[] = "Island Chatter";
constexpr char kSupportUrl[] = "https://github.com/xup61069/island-chatter-ae";

void append_utf8(std::string& output, std::uint32_t codepoint) {
    if (codepoint <= 0x7FU) {
        output.push_back(static_cast<char>(codepoint));
    } else if (codepoint <= 0x7FFU) {
        output.push_back(static_cast<char>(0xC0U | (codepoint >> 6U)));
        output.push_back(static_cast<char>(0x80U | (codepoint & 0x3FU)));
    } else if (codepoint <= 0xFFFFU) {
        output.push_back(static_cast<char>(0xE0U | (codepoint >> 12U)));
        output.push_back(static_cast<char>(0x80U | ((codepoint >> 6U) & 0x3FU)));
        output.push_back(static_cast<char>(0x80U | (codepoint & 0x3FU)));
    } else {
        output.push_back(static_cast<char>(0xF0U | (codepoint >> 18U)));
        output.push_back(static_cast<char>(0x80U | ((codepoint >> 12U) & 0x3FU)));
        output.push_back(static_cast<char>(0x80U | ((codepoint >> 6U) & 0x3FU)));
        output.push_back(static_cast<char>(0x80U | (codepoint & 0x3FU)));
    }
}

std::string text_from_params(PF_ParamDef* params[]) {
    const auto requested = params[island_chatter::ae::kParamTextLength]->u.sd.value;
    const auto length = std::clamp<A_long>(requested, 0, static_cast<A_long>(island_chatter::ae::kMaxTextUnits));
    std::string output;
    output.reserve(static_cast<std::size_t>(length) * 3U);
    // The first sixty-four units sit where they always have; the rest are in the
    // block appended in 1.3.0, because the indices in between were already
    // published and cannot move.
    const auto unit_at = [&params](A_long index) {
        const auto slot = index < static_cast<A_long>(island_chatter::ae::kTextUnitsPerBlock)
            ? island_chatter::ae::kParamTextFirst + index
            : island_chatter::ae::kParamTextSecondFirst + index -
                static_cast<A_long>(island_chatter::ae::kTextUnitsPerBlock);
        return static_cast<std::uint32_t>(std::clamp<A_long>(
            params[slot]->u.sd.value, 0, 0xFFFF));
    };
    for (A_long index = 0; index < length; ++index) {
        std::uint32_t codepoint = unit_at(index);
        if (codepoint >= 0xD800U && codepoint <= 0xDBFFU && index + 1 < length) {
            const auto low = unit_at(index + 1);
            if (low >= 0xDC00U && low <= 0xDFFFU) {
                codepoint = 0x10000U + ((codepoint - 0xD800U) << 10U) + (low - 0xDC00U);
                ++index;
            }
        }
        // A surrogate still standing alone here was split by the 64-unit
        // transport limit. Encoding it would emit a CESU-8 noise syllable.
        if (codepoint >= 0xD800U && codepoint <= 0xDFFFU) continue;
        if (codepoint != 0U) append_utf8(output, codepoint);
    }
    return output;
}

static_assert(island_chatter::ae::kMelodySlots == island_chatter::kMelodySlots,
    "The melody transport and the engine must agree on how many notes a layer carries");

// The melody a layer is set to sing, or nothing at all.
//
// Length zero is the whole backwards-compatibility story: every slot in a
// project saved before 1.7.0 reads as its default, the length reads as zero,
// and the engine takes the speaking path it always took.
std::vector<island_chatter::MelodyNote> melody_from_params(PF_ParamDef* params[]) {
    const auto requested = params[island_chatter::ae::kParamMelodyLength]->u.sd.value;
    const auto length = std::clamp<A_long>(
        requested, 0, static_cast<A_long>(island_chatter::ae::kMelodySlots));
    std::vector<island_chatter::MelodyNote> melody;
    melody.reserve(static_cast<std::size_t>(length));
    for (A_long index = 0; index < length; ++index) {
        melody.push_back(island_chatter::decode_melody_slot(std::clamp<A_long>(
            params[island_chatter::ae::kParamMelodyFirst + index]->u.sd.value, 0, 65535)));
    }
    return melody;
}

// After Effects hands an audio effect one parameter snapshot per audio block.
// Every distinct value is a distinct cache key and therefore a full re-synthesis
// of the utterance, so snap the continuous values onto the same grid the slider
// already displays. Values typed or written by the panel are unchanged; only
// interpolated keyframe values in between are collapsed.
double quantize(double value, double step) {
    return std::round(value / step) * step;
}

island_chatter::Settings settings_from_params(PF_ParamDef* params[], std::uint32_t sample_rate) {
    island_chatter::Settings settings;
    settings.text = text_from_params(params);
    settings.voice_index = static_cast<std::size_t>(std::max<A_long>(1,
        params[island_chatter::ae::kParamVoice]->u.pd.value) - 1);
    settings.pitch = quantize(params[island_chatter::ae::kParamPitch]->u.fs_d.value, 0.01);
    settings.speed = quantize(params[island_chatter::ae::kParamSpeed]->u.fs_d.value, 0.01);
    settings.volume = quantize(params[island_chatter::ae::kParamVolume]->u.fs_d.value, 0.1) / 100.0;
    settings.consonant = quantize(params[island_chatter::ae::kParamConsonant]->u.fs_d.value, 0.01);
    settings.emotion = static_cast<island_chatter::Emotion>(std::clamp<A_long>(
        params[island_chatter::ae::kParamEmotion]->u.pd.value - 1, 0, 6));
    settings.character_size = static_cast<island_chatter::CharacterSize>(std::clamp<A_long>(
        params[island_chatter::ae::kParamCharacterSize]->u.pd.value - 1, 0, 3));
    settings.clarity = quantize(params[island_chatter::ae::kParamClarity]->u.fs_d.value, 0.1) / 100.0;
    settings.cuteness = quantize(params[island_chatter::ae::kParamCuteness]->u.fs_d.value, 0.1) / 100.0;
    settings.seed = static_cast<std::uint32_t>(std::max<A_long>(0,
        params[island_chatter::ae::kParamSeed]->u.sd.value));
    settings.tempo_lock = params[island_chatter::ae::kParamTempoLock]->u.bd.value != 0;
    settings.formant = quantize(params[island_chatter::ae::kParamFormant]->u.fs_d.value, 0.1) / 100.0;
    settings.source = static_cast<island_chatter::SourceType>(std::clamp<A_long>(
        params[island_chatter::ae::kParamSource]->u.pd.value - 1, 0, 5));
    settings.vibrato_depth =
        quantize(params[island_chatter::ae::kParamVibratoDepth]->u.fs_d.value, 0.1) / 100.0;
    settings.vibrato_rate =
        quantize(params[island_chatter::ae::kParamVibratoRate]->u.fs_d.value, 0.01);
    settings.melody = melody_from_params(params);
    settings.melody_mode = !settings.melody.empty();
    settings.melody_bpm = quantize(params[island_chatter::ae::kParamMelodyBpm]->u.fs_d.value, 0.01);
    settings.transpose = static_cast<int>(std::clamp<A_long>(
        params[island_chatter::ae::kParamMelodyTranspose]->u.sd.value, -48, 48));
    settings.tone_blend =
        quantize(params[island_chatter::ae::kParamToneBlend]->u.fs_d.value, 0.1) / 100.0;
    settings.portamento_seconds =
        quantize(params[island_chatter::ae::kParamPortamento]->u.fs_d.value, 0.1) / 1000.0;
    settings.vibrato_delay =
        quantize(params[island_chatter::ae::kParamVibratoDelay]->u.fs_d.value, 0.01);
    settings.sample_rate = sample_rate;
    return settings;
}

std::shared_ptr<const island_chatter::Utterance> cached_synthesis(
    const island_chatter::Settings& settings) {
    static island_chatter::SynthesisCache cache;
    return cache.get(settings);
}

PF_Err global_setup(PF_OutData* out_data) {
    constexpr auto code_version = PF_VERSION(
        ISLAND_CHATTER_VERSION_MAJOR,
        ISLAND_CHATTER_VERSION_MINOR,
        ISLAND_CHATTER_VERSION_BUG,
        ISLAND_CHATTER_VERSION_STAGE,
        ISLAND_CHATTER_VERSION_BUILD);
    static_assert(code_version == ISLAND_CHATTER_AE_VERSION,
        "PiPL and compiled effect versions must match");
    out_data->my_version = code_version;
    out_data->out_flags = PF_OutFlag_AUDIO_EFFECT_ONLY |
        PF_OutFlag_AUDIO_FLOAT_ONLY;
    static_assert(static_cast<PF_OutFlags>(ISLAND_CHATTER_OUT_FLAGS) ==
        (PF_OutFlag_AUDIO_EFFECT_ONLY | PF_OutFlag_AUDIO_FLOAT_ONLY),
        "PiPL and compiled effect flags must match");
    // Audio callbacks use a shared synthesis cache. Keep AE's threaded-render
    // opt-in disabled until host-level audio stress tests cover every path.
    out_data->out_flags2 = ISLAND_CHATTER_OUT_FLAGS_2;
    return PF_Err_NONE;
}

PF_Err params_setup(PF_InData* in_data, PF_OutData* out_data) {
    PF_ParamDef def;
    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUPX("Voice / 聲線", 8, 1,
        "Sunny|Tiny|Cozy|Buzzy|Chirpy|Whisper|Elder|Droid", PF_ParamFlag_NONE, 1);
    // Valid range is what can be typed in; slider range is the comfortable drag
    // range. Widening a valid range never invalidates a saved project, because
    // every previously storable value is still inside the new one.
    PF_ADD_FLOAT_SLIDERX("Pitch / 音高", 0.10, 4.00, 0.55, 2.00, 1.0,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 2);
    PF_ADD_FLOAT_SLIDERX("Speed / 速度", 0.10, 10.00, 0.55, 3.00, 1.0,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 3);
    PF_ADD_FLOAT_SLIDERX("Volume / 音量", 0.0, 200.0, 0.0, 100.0, 78.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE, 4);
    PF_ADD_FLOAT_SLIDERX("Initial / 聲母", 0.00, 6.00, 0.50, 2.50, 1.25,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 5);

    AEFX_CLR_STRUCT(def);
    def.ui_flags = PF_PUI_INVISIBLE;
    PF_ADD_SLIDER("Text length", 0, static_cast<A_long>(island_chatter::ae::kMaxTextUnits),
        0, static_cast<A_long>(island_chatter::ae::kMaxTextUnits), 0, 6);
    // kTextUnitsPerBlock, never kMaxTextUnits: this loop fills the first block
    // only, and its ids run 7-70. Using the total here overruns into the
    // creative controls and After Effects refuses the effect with "parameter
    // count mismatch".
    for (std::size_t index = 0; index < island_chatter::ae::kTextUnitsPerBlock; ++index) {
        AEFX_CLR_STRUCT(def);
        def.ui_flags = PF_PUI_INVISIBLE;
        PF_ADD_SLIDER("Text code unit", 0, 65535, 0, 65535, 0, static_cast<A_long>(7 + index));
    }

    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUPX("Emotion / 情緒", 7, 1,
        "Neutral|Happy|Angry|Scared|Question|Sleepy|Robot", PF_ParamFlag_NONE, 71);
    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUPX("Character / 體型", 4, 3,
        "Tiny|Young|Adult|Giant", PF_ParamFlag_NONE, 72);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Clarity / 清晰度", 0.0, 100.0, 0.0, 100.0, 78.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE, 73);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Cuteness / 可愛度", 0.0, 100.0, 0.0, 100.0, 55.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE, 74);
    AEFX_CLR_STRUCT(def);
    PF_ADD_SLIDER("Seed / 種子", 0, 999999, 0, 9999, 0, 75);
    AEFX_CLR_STRUCT(def);
    PF_ADD_CHECKBOXX("Tempo Lock / 節拍鎖定", 0, 0, 76);
    // Appended in 1.1.0. Every default reproduces 1.0.x exactly, so opening an
    // older project does not change how it sounds.
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Formant / 共鳴", 25.0, 400.0, 50.0, 200.0, 100.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE, 77);
    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUPX("Timbre / 音源", 6, 1,
        "Voice|Reed|Chip|Metallic|Granular|Growl", PF_ParamFlag_NONE, 78);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Vibrato / 顫音", 0.0, 400.0, 0.0, 200.0, 100.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE, 79);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Vibrato Rate / 顫音速率", 0.00, 30.00, 0.50, 20.00, 9.20,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 80);
    // The second half of the text transport, appended in 1.3.0. Widening the
    // length slider's valid range never invalidates a saved project, because
    // every value it could already hold is still inside the new range.
    for (std::size_t index = 0; index < island_chatter::ae::kTextUnitsPerBlock; ++index) {
        AEFX_CLR_STRUCT(def);
        def.ui_flags = PF_PUI_INVISIBLE;
        PF_ADD_SLIDER("Text code unit", 0, 65535, 0, 65535, 0,
            static_cast<A_long>(island_chatter::ae::kParamTextSecondFirst + index));
    }
    // The melody transport, appended in 1.7.0. Every default here reproduces
    // 1.6.x exactly: no notes, so nothing sings.
    AEFX_CLR_STRUCT(def);
    def.ui_flags = PF_PUI_INVISIBLE;
    PF_ADD_SLIDER("Melody length", 0, static_cast<A_long>(island_chatter::ae::kMelodySlots),
        0, static_cast<A_long>(island_chatter::ae::kMelodySlots), 0,
        island_chatter::ae::kParamMelodyLength);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Melody BPM / 旋律速度", 20.00, 400.00, 40.00, 200.00, 120.00,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, island_chatter::ae::kParamMelodyBpm);
    AEFX_CLR_STRUCT(def);
    PF_ADD_SLIDER("Transpose / 移調", -48, 48, -24, 24, 0,
        island_chatter::ae::kParamMelodyTranspose);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Tone Blend / 聲調比例", 0.0, 100.0, 0.0, 100.0, 15.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE,
        island_chatter::ae::kParamToneBlend);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Portamento / 滑音", 0.0, 200.0, 0.0, 120.0, 40.0,
        PF_Precision_TENTHS, 0, PF_ParamFlag_NONE, island_chatter::ae::kParamPortamento);
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Vibrato Delay / 顫音延遲", 0.00, 2.00, 0.00, 1.00, 0.30,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE,
        island_chatter::ae::kParamVibratoDelay);
    // kMelodySlots, never anything larger: this loop owns ids 151-214, and a
    // wrong bound walks its ids past num_params. After Effects then refuses the
    // effect with "parameter count mismatch", which reads as the plug-in not
    // being installed rather than as the mistake it is.
    for (std::size_t index = 0; index < island_chatter::ae::kMelodySlots; ++index) {
        AEFX_CLR_STRUCT(def);
        def.ui_flags = PF_PUI_INVISIBLE;
        PF_ADD_SLIDER("Melody note", 0, 65535, 0, 65535, 0,
            static_cast<A_long>(island_chatter::ae::kParamMelodyFirst + index));
    }
    out_data->num_params = island_chatter::ae::kParamCount;
    return PF_Err_NONE;
}

PF_Err audio_setup() {
    // Synthesized output uses the requested span unchanged. Adobe's contract
    // says to modify start_sampL/dur_sampL only when a different span is needed.
    return PF_Err_NONE;
}

PF_Err audio_render(PF_InData* in_data, PF_OutData* out_data, PF_ParamDef* params[]) {
    if (out_data->dest_snd.fi.format != PF_SIGNED_FLOAT ||
        out_data->dest_snd.fi.sample_size != PF_SSS_4 ||
        out_data->dest_snd.dataP == nullptr) {
        return PF_Err_UNRECOGNIZED_PARAM_TYPE;
    }
    const auto rate = static_cast<std::uint32_t>(std::lround(out_data->dest_snd.fi.rateF));
    const auto channels = static_cast<std::size_t>(out_data->dest_snd.fi.num_channels);
    const auto frames = static_cast<std::size_t>(std::max<A_long>(0, out_data->dest_snd.num_samples));
    if (rate < 8000U || rate > 192000U || (channels != 1U && channels != 2U)) {
        return PF_Err_UNRECOGNIZED_PARAM_TYPE;
    }
    const auto settings = settings_from_params(params, rate);
    const auto rendered = cached_synthesis(settings);
    if (!rendered) {
        return PF_Err_NONE;
    }
    // Only the syllables inside this block are synthesized, and Volume is
    // applied here rather than baked in, so neither a new block nor a Volume
    // change costs a re-render of the whole utterance.
    rendered->copy_region(
        static_cast<std::int64_t>(in_data->start_sampL),
        static_cast<float*>(out_data->dest_snd.dataP),
        frames,
        channels,
        settings.volume);
    return PF_Err_NONE;
}

}  // namespace

extern "C" DllExport PF_Err PluginDataEntryFunction2(
    PF_PluginDataPtr in_ptr,
    PF_PluginDataCB2 callback,
    SPBasicSuite*,
    const char*,
    const char*) {
    PF_Err result = PF_Err_INVALID_CALLBACK;
    PF_REGISTER_EFFECT_EXT2(
        in_ptr, callback, kName, kMatchName, kCategory, AE_RESERVED_INFO, "EffectMain", kSupportUrl);
    return result;
}

extern "C" DllExport PF_Err EffectMain(
    PF_Cmd cmd,
    PF_InData* in_data,
    PF_OutData* out_data,
    PF_ParamDef* params[],
    PF_LayerDef*,
    void*) {
    try {
        switch (cmd) {
            case PF_Cmd_ABOUT:
                PF_SPRINTF(out_data->return_msg,
                    "Island Chatter Native v" ISLAND_CHATTER_VERSION_TEXT
                    "\rMandarin character voices, timing, and animation controls.");
                return PF_Err_NONE;
            case PF_Cmd_GLOBAL_SETUP: return global_setup(out_data);
            case PF_Cmd_PARAMS_SETUP: return params_setup(in_data, out_data);
            case PF_Cmd_AUDIO_SETUP: return audio_setup();
            case PF_Cmd_AUDIO_RENDER: return audio_render(in_data, out_data, params);
            default: return PF_Err_NONE;
        }
    } catch (const std::bad_alloc&) {
        return PF_Err_OUT_OF_MEMORY;
    } catch (...) {
        return PF_Err_INTERNAL_STRUCT_DAMAGED;
    }
}

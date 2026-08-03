#include "params.hpp"
#include "IslandChatterVersion.h"

#include "island_chatter/dsp.hpp"

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
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

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
    for (A_long index = 0; index < length; ++index) {
        std::uint32_t codepoint = static_cast<std::uint32_t>(
            params[island_chatter::ae::kParamTextFirst + index]->u.sd.value);
        if (codepoint >= 0xD800U && codepoint <= 0xDBFFU && index + 1 < length) {
            const auto low = static_cast<std::uint32_t>(
                params[island_chatter::ae::kParamTextFirst + index + 1]->u.sd.value);
            if (low >= 0xDC00U && low <= 0xDFFFU) {
                codepoint = 0x10000U + ((codepoint - 0xD800U) << 10U) + (low - 0xDC00U);
                ++index;
            }
        }
        if (codepoint != 0U) append_utf8(output, codepoint);
    }
    return output;
}

island_chatter::Settings settings_from_params(PF_ParamDef* params[], std::uint32_t sample_rate) {
    island_chatter::Settings settings;
    settings.text = text_from_params(params);
    settings.voice_index = static_cast<std::size_t>(std::max<A_long>(1,
        params[island_chatter::ae::kParamVoice]->u.pd.value) - 1);
    settings.pitch = params[island_chatter::ae::kParamPitch]->u.fs_d.value;
    settings.speed = params[island_chatter::ae::kParamSpeed]->u.fs_d.value;
    settings.volume = params[island_chatter::ae::kParamVolume]->u.fs_d.value / 100.0;
    settings.consonant = params[island_chatter::ae::kParamConsonant]->u.fs_d.value;
    settings.emotion = static_cast<island_chatter::Emotion>(std::clamp<A_long>(
        params[island_chatter::ae::kParamEmotion]->u.pd.value - 1, 0, 6));
    settings.character_size = static_cast<island_chatter::CharacterSize>(std::clamp<A_long>(
        params[island_chatter::ae::kParamCharacterSize]->u.pd.value - 1, 0, 3));
    settings.clarity = params[island_chatter::ae::kParamClarity]->u.fs_d.value / 100.0;
    settings.cuteness = params[island_chatter::ae::kParamCuteness]->u.fs_d.value / 100.0;
    settings.seed = static_cast<std::uint32_t>(std::max<A_long>(0,
        params[island_chatter::ae::kParamSeed]->u.sd.value));
    settings.sample_rate = sample_rate;
    return settings;
}

std::string cache_key(const island_chatter::Settings& settings) {
    return settings.text + "\x1f" + std::to_string(settings.voice_index) + "\x1f" +
        std::to_string(settings.pitch) + "\x1f" + std::to_string(settings.speed) + "\x1f" +
        std::to_string(settings.volume) + "\x1f" + std::to_string(settings.consonant) + "\x1f" +
        std::to_string(static_cast<int>(settings.emotion)) + "\x1f" +
        std::to_string(static_cast<int>(settings.character_size)) + "\x1f" +
        std::to_string(settings.clarity) + "\x1f" + std::to_string(settings.cuteness) + "\x1f" +
        std::to_string(settings.seed) + "\x1f" +
        std::to_string(settings.sample_rate);
}

std::shared_ptr<const island_chatter::Result> cached_synthesis(const island_chatter::Settings& settings) {
    static std::mutex mutex;
    static std::unordered_map<std::string, std::shared_ptr<const island_chatter::Result>> cache;
    const auto key = cache_key(settings);
    {
        const std::lock_guard<std::mutex> lock(mutex);
        const auto found = cache.find(key);
        if (found != cache.end()) return found->second;
    }
    auto rendered = std::make_shared<const island_chatter::Result>(island_chatter::synthesize(settings));
    const std::lock_guard<std::mutex> lock(mutex);
    if (cache.size() >= 64U) cache.clear();
    cache.emplace(key, rendered);
    return rendered;
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
    PF_ADD_FLOAT_SLIDERX("Pitch / 音高", 0.55, 1.80, 0.55, 1.80, 1.0,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 2);
    PF_ADD_FLOAT_SLIDERX("Speed / 速度", 0.55, 2.20, 0.55, 2.20, 1.0,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 3);
    PF_ADD_FLOAT_SLIDERX("Volume / 音量", 0.0, 100.0, 0.0, 100.0, 78.0,
        PF_Precision_TENTHS, PF_ValueDisplayFlag_PERCENT, PF_ParamFlag_NONE, 4);
    PF_ADD_FLOAT_SLIDERX("Initial / 聲母", 0.50, 2.50, 0.50, 2.50, 1.25,
        PF_Precision_HUNDREDTHS, 0, PF_ParamFlag_NONE, 5);

    AEFX_CLR_STRUCT(def);
    def.ui_flags = PF_PUI_INVISIBLE;
    PF_ADD_SLIDER("Text length", 0, static_cast<A_long>(island_chatter::ae::kMaxTextUnits),
        0, static_cast<A_long>(island_chatter::ae::kMaxTextUnits), 0, 6);
    for (std::size_t index = 0; index < island_chatter::ae::kMaxTextUnits; ++index) {
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
    PF_ADD_SLIDER("Seed / 種子", 0, 9999, 0, 9999, 0, 75);
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
    island_chatter::copy_region(
        *rendered,
        static_cast<std::int64_t>(in_data->start_sampL),
        static_cast<float*>(out_data->dest_snd.dataP),
        frames,
        channels);
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
                    "Island Chatter Native v1.0\rMandarin character voices, timing, and animation controls.");
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

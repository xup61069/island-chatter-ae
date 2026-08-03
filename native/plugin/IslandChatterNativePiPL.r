#include "AEConfig.h"
#include "AE_EffectVers.h"
#include "IslandChatterVersion.h"

resource 'PiPL' (16000) {
    {
        Kind { AEEffect },
        Name { "Island Chatter Native" },
        Category { "Island Chatter" },
#ifdef AE_OS_WIN
    #if defined(AE_PROC_INTELx64)
        CodeWin64X86 { "EffectMain" },
    #elif defined(AE_PROC_ARM64)
        CodeWinARM64 { "EffectMain" },
    #endif
#endif
        AE_PiPL_Version { 2, 0 },
        AE_Effect_Spec_Version { PF_PLUG_IN_VERSION, PF_PLUG_IN_SUBVERS },
        AE_Effect_Version { ISLAND_CHATTER_AE_VERSION },
        AE_Effect_Info_Flags { 0 },
        AE_Effect_Global_OutFlags { ISLAND_CHATTER_OUT_FLAGS },
        AE_Effect_Global_OutFlags_2 { ISLAND_CHATTER_OUT_FLAGS_2 },
        AE_Effect_Match_Name { "Island Chatter Native" },
        AE_Reserved_Info { 0 },
        AE_Effect_Support_URL { "https://github.com/xup61069/island-chatter-ae" }
    }
};

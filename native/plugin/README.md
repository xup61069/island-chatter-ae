# After Effects adapter

This directory is the thin Adobe SDK adapter around `island_chatter_dsp`.

The adapter deliberately keeps the synthesis engine independent from After Effects. The native effect reads the five visible controls and hidden UTF-16 text parameters, synthesizes deterministic floating-point Mandarin-oriented audio, and copies only the sample range requested by `PF_Cmd_AUDIO_RENDER`. A bounded mutex-protected in-memory cache prevents repeated synthesis during AE's block-based rendering. Host threaded-render opt-in remains disabled until dedicated AE audio stress tests cover it.

## Stable parameter ABI

| Index | Parameter | UI |
|---:|---|---|
| 1 | Voice | visible popup |
| 2 | Pitch | visible slider |
| 3 | Speed | visible slider |
| 4 | Volume | visible slider |
| 5 | Consonant | visible slider |
| 6 | UTF-16 length | hidden |
| 7-70 | UTF-16 code units | hidden |

Do not reorder these parameters after a public build. After Effects serializes effect parameters by index in project files.

The implementation and PiPL resource are generated only against the current official SDK. Adobe's headers and PiPL tools are not vendored or redistributed.

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
| 71 | Emotion | visible popup |
| 72 | Character size | visible popup |
| 73 | Clarity | visible slider |
| 74 | Cuteness | visible slider |
| 75 | Seed | visible slider |

Index 0 is the implicit input, so `params.hpp` counts 76 slots in total.

Do not reorder these parameters after a public build. After Effects serializes effect parameters by index in project files.

Pitch, Speed, Volume and Consonant are keyframeable, but After Effects hands an audio effect one parameter snapshot per audio block. Changing them over time forces a fresh synthesis of the whole utterance per block, and animating Speed also shifts every syllable's start time, so block boundaries can step audibly. Set them once per layer and animate the layer's own Audio Levels for volume moves.

The implementation and PiPL resource are generated only against the current official SDK. Adobe's headers and PiPL tools are not vendored or redistributed.

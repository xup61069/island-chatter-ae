# Third-party notices

## Unicode Unihan data

`native/generated/mandarin_readings.hpp` is generated from the Unicode 18.0.0 Unihan `kMandarin` property.

UNICODE LICENSE V3

Copyright © 1991-2026 Unicode, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of data files and any associated documentation (the "Data Files") or software and any associated documentation (the "Software") to deal in the Data Files or Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, and/or sell copies of the Data Files or Software, and to permit persons to whom the Data Files or Software are furnished to do so, provided that either (a) this copyright and permission notice appear with all copies of the Data Files or Software, or (b) this copyright and permission notice appear in associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall not be used in advertising or otherwise to promote the sale, use or other dealings in these Data Files or Software without prior written authorization of the copyright holder.

Source: https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip

License: https://www.unicode.org/license.txt

## sherpa-onnx

`island_chatter_local.exe` links `sherpa-onnx-c-api.dll`, which ships beside it.
It is used only by the optional offline voice; nothing else in the product
depends on it, and it never runs unless that voice is chosen.

Copyright (c) 2022-2025 Xiaomi Corporation

Licensed under the Apache License, Version 2.0. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

Source: https://github.com/k2-fsa/sherpa-onnx

## ONNX Runtime

`onnxruntime.dll` ships beside `island_chatter_local.exe` and is what actually
evaluates the offline voice model.

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Source: https://github.com/microsoft/onnxruntime

## MeloTTS voice model

The offline voice model is **not** included in this package. It is downloaded
on request, by the user, into their own user folder, and this notice is here
because it is what they receive.

Copyright (c) 2024 MyShell.ai

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Source: https://github.com/myshell-ai/MeloTTS
Model: https://huggingface.co/myshell-ai/MeloTTS-Chinese

## eSpeak NG — **this is why the 3.0.0 build must not be published**

An earlier version of this file claimed the offline voice links neither Piper
nor eSpeak NG. **That was wrong**, and the error is worth writing down because
it is a classic one: it was checked against what the Chinese pipeline *executes*
rather than against what the shipped file *contains*.

`sherpa-onnx-c-api.dll` as published by the sherpa-onnx project statically links eSpeak NG.
It is therefore not in this package, and neither is `island_chatter_local.exe`. The evidence is in the binary — `CallPhonemizeEspeak`,
`ESPEAK_DATA_PATH`, `Software\eSpeak NG`, `Failed to initialize espeak-ng with
data dir`, a hundred eSpeak-bearing strings in all — and in the upstream build,
where `if(SHERPA_ONNX_ENABLE_TTS)` unconditionally pulls in espeak-ng with no
option to exclude it.

eSpeak NG is **GPL v3 or later**. The GPL attaches to the binary that is
distributed, not to the code paths that happen to run, so shipping that DLL in a
product whose compiled builds are sold and may not be redistributed is not
possible. This is the same reason Piper was rejected; it was simply missed one
level down.

Two ways out, neither taken yet: wait for sherpa-onnx 2.0.0, which removes
espeak-ng specifically to restore Apache-2.0 compatibility (their issue #3731),
or drop sherpa-onnx and drive the MeloTTS model directly with ONNX Runtime
(MIT), doing the lexicon lookup in this project's own code. The offline voice's
own source carries no GPL; the dependency does.

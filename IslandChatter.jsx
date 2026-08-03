#target aftereffects
#targetengine "islandChatter"

/*
 * Island Chatter for After Effects
 * Copyright (c) 2026 Island Chatter contributors
 * SPDX-License-Identifier: MIT
 *
 * Original procedural character-chatter synthesis. No game audio, samples,
 * code, characters, or other proprietary assets are included.
 */

(function islandChatter(thisObj) {
    var SCRIPT_NAME = "Island Chatter";
    var VERSION = "1.1.0";
    var SAMPLE_RATE = 44100;
    var TWO_PI = Math.PI * 2;
    var outputFolder = null;

    var VOICES = [
        { name: "Sunny / 明亮", pitch: 1.00, tract: 1.00, breath: 0.035, wobble: 0.014, buzz: 0.00 },
        { name: "Tiny / 迷你", pitch: 1.42, tract: 1.15, breath: 0.025, wobble: 0.020, buzz: 0.00 },
        { name: "Cozy / 溫厚", pitch: 0.72, tract: 0.86, breath: 0.045, wobble: 0.010, buzz: 0.00 },
        { name: "Buzzy / 電子", pitch: 0.90, tract: 1.04, breath: 0.018, wobble: 0.007, buzz: 0.22 }
    ];

    var VOWELS = [
        { name: "a", formants: [800, 1150, 2900], bandwidths: [100, 120, 180] },
        { name: "e", formants: [500, 1900, 2600], bandwidths: [85, 140, 180] },
        { name: "i", formants: [300, 2300, 3000], bandwidths: [70, 150, 200] },
        { name: "o", formants: [500, 900, 2500], bandwidths: [90, 110, 180] },
        { name: "u", formants: [350, 800, 2200], bandwidths: [75, 100, 170] },
        { name: "ə", formants: [520, 1450, 2450], bandwidths: [95, 130, 180] }
    ];

    var CONSONANT_NONE = 0;
    var CONSONANT_STOP = 1;
    var CONSONANT_VOICED_STOP = 2;
    var CONSONANT_FRICATIVE = 3;
    var CONSONANT_SIBILANT = 4;
    var CONSONANT_NASAL = 5;
    var CONSONANT_LIQUID = 6;
    var CONSONANT_ASPIRATE = 7;

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function trim(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function pad2(value) {
        return value < 10 ? "0" + value : String(value);
    }

    function timestamp() {
        var date = new Date();
        return date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
            "_" + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds());
    }

    function safeFilename(value) {
        var cleaned = trim(value).replace(/[\\\/:*?"<>|\r\n]+/g, "_").replace(/\s+/g, " ");
        if (!cleaned) {
            cleaned = "island-chatter";
        }
        return cleaned.substring(0, 48);
    }

    function isWhitespace(character) {
        return /\s/.test(character);
    }

    function isPunctuation(character) {
        return /[.,!?;:\-\u3000-\u303f\uff01\uff0c\uff0e\uff1a\uff1b\uff1f]/.test(character);
    }

    function getSelectedText() {
        var item = app.project ? app.project.activeItem : null;
        if (!(item && item instanceof CompItem) || item.selectedLayers.length === 0) {
            return null;
        }

        for (var index = 0; index < item.selectedLayers.length; index += 1) {
            var layer = item.selectedLayers[index];
            var textProperty = layer.property("ADBE Text Properties");
            if (textProperty) {
                var sourceText = textProperty.property("ADBE Text Document");
                if (sourceText) {
                    return String(sourceText.value.text);
                }
            }
        }
        return null;
    }

    function makeRandom(seed) {
        var state = seed % 2147483647;
        if (state <= 0) {
            state += 2147483646;
        }
        return function () {
            state = (state * 16807) % 2147483647;
            return (state - 1) / 2147483646;
        };
    }

    function latinVowelIndex(character) {
        var lower = character.toLowerCase();
        if (lower === "a") { return 0; }
        if (lower === "e") { return 1; }
        if (lower === "i" || lower === "y") { return 2; }
        if (lower === "o") { return 3; }
        if (lower === "u") { return 4; }
        return -1;
    }

    function consonantForCharacter(character, code) {
        var lower = character.toLowerCase();
        if (/[ptkcq]/.test(lower)) {
            return { kind: CONSONANT_STOP, place: lower === "p" ? 0.18 : (/[kgq]/.test(lower) ? 0.88 : 0.55) };
        }
        if (/[bdg]/.test(lower)) {
            return { kind: CONSONANT_VOICED_STOP, place: lower === "b" ? 0.18 : (lower === "g" ? 0.88 : 0.55) };
        }
        if (/[fv]/.test(lower)) {
            return { kind: CONSONANT_FRICATIVE, place: 0.24 };
        }
        if (/[szxj]/.test(lower)) {
            return { kind: CONSONANT_SIBILANT, place: lower === "s" || lower === "z" ? 0.72 : 0.90 };
        }
        if (/[mn]/.test(lower)) {
            return { kind: CONSONANT_NASAL, place: lower === "m" ? 0.22 : 0.58 };
        }
        if (/[lrwy]/.test(lower)) {
            return { kind: CONSONANT_LIQUID, place: lower === "l" ? 0.42 : 0.68 };
        }
        if (lower === "h") {
            return { kind: CONSONANT_ASPIRATE, place: 0.50 };
        }

        var invented = [
            { kind: CONSONANT_STOP, place: 0.18 },
            { kind: CONSONANT_VOICED_STOP, place: 0.22 },
            { kind: CONSONANT_STOP, place: 0.84 },
            { kind: CONSONANT_SIBILANT, place: 0.72 },
            { kind: CONSONANT_NASAL, place: 0.55 },
            { kind: CONSONANT_LIQUID, place: 0.62 },
            { kind: CONSONANT_ASPIRATE, place: 0.48 }
        ];
        return invented[code % invented.length];
    }

    function consonantDuration(kind, speed) {
        var seconds = 0.010;
        if (kind === CONSONANT_STOP || kind === CONSONANT_VOICED_STOP) { seconds = 0.034; }
        if (kind === CONSONANT_FRICATIVE || kind === CONSONANT_SIBILANT) { seconds = 0.048; }
        if (kind === CONSONANT_NASAL) { seconds = 0.040; }
        if (kind === CONSONANT_LIQUID) { seconds = 0.034; }
        if (kind === CONSONANT_ASPIRATE) { seconds = 0.044; }
        return Math.round(seconds * SAMPLE_RATE / speed);
    }

    function gaussian(distance, width) {
        var normalized = distance / width;
        return Math.exp(-0.5 * normalized * normalized);
    }

    function makeVowelProfile(vowelIndex, frequency, voice) {
        var source = VOWELS[vowelIndex];
        var formants = [];
        var bandwidths = [];
        var harmonicAmplitudes = [];
        var amplitudeTotal = 0;
        var formantIndex;
        var harmonic;

        for (formantIndex = 0; formantIndex < source.formants.length; formantIndex += 1) {
            formants[formantIndex] = source.formants[formantIndex] * voice.tract;
            bandwidths[formantIndex] = source.bandwidths[formantIndex] * voice.tract;
        }

        for (harmonic = 1; harmonic <= 12; harmonic += 1) {
            var harmonicFrequency = frequency * harmonic;
            var resonance = 0.035;
            for (formantIndex = 0; formantIndex < formants.length; formantIndex += 1) {
                resonance += gaussian(harmonicFrequency - formants[formantIndex], bandwidths[formantIndex]);
            }
            var amplitude = resonance / Math.pow(harmonic, 0.72);
            harmonicAmplitudes.push(amplitude);
            amplitudeTotal += amplitude;
        }

        if (amplitudeTotal <= 0) { amplitudeTotal = 1; }
        for (harmonic = 0; harmonic < harmonicAmplitudes.length; harmonic += 1) {
            harmonicAmplitudes[harmonic] /= amplitudeTotal;
        }
        return {
            name: source.name,
            formants: formants,
            harmonics: harmonicAmplitudes
        };
    }

    function buildEvents(text, speed, pitch, voice) {
        var events = [];
        var sampleCursor = 0;
        var unitSeconds = 0.132 / speed;
        var spaceSeconds = 0.060 / speed;
        var punctuationSeconds = 0.165 / speed;
        var codeTotal = 0;
        var i;

        for (i = 0; i < text.length; i += 1) {
            codeTotal = (codeTotal + text.charCodeAt(i) * (i + 17)) % 2147483647;
        }

        var random = makeRandom(codeTotal || 91673);
        for (i = 0; i < text.length; i += 1) {
            var character = text.charAt(i);
            if (isWhitespace(character)) {
                sampleCursor += Math.round(spaceSeconds * SAMPLE_RATE);
                continue;
            }
            if (isPunctuation(character)) {
                sampleCursor += Math.round(punctuationSeconds * SAMPLE_RATE);
                continue;
            }

            var code = text.charCodeAt(i);
            var vowelIndex = latinVowelIndex(character);
            var consonant = { kind: CONSONANT_NONE, place: 0.50 };
            var isLatinLetter = /[A-Za-z]/.test(character);
            if (vowelIndex < 0) {
                consonant = consonantForCharacter(character, code);
                if (isLatinLetter && i + 1 < text.length && latinVowelIndex(text.charAt(i + 1)) >= 0) {
                    vowelIndex = latinVowelIndex(text.charAt(i + 1));
                    i += 1;
                } else {
                    vowelIndex = isLatinLetter ? 5 : code % 5;
                }
            }

            var lengthVariation = 0.91 + random() * 0.18;
            var duration = unitSeconds * lengthVariation;
            var note = ((code * 5 + i * 3) % 9) - 4;
            var baseFrequency = 245 * voice.pitch * pitch * Math.pow(2, note / 24);
            var eventSamples = Math.max(64, Math.round(duration * SAMPLE_RATE));
            var onsetSamples = Math.min(eventSamples - 24, consonantDuration(consonant.kind, speed));
            var vowelProfile = makeVowelProfile(vowelIndex, baseFrequency, voice);
            events.push({
                start: sampleCursor,
                length: eventSamples,
                onset: onsetSamples,
                frequency: baseFrequency,
                consonant: consonant,
                vowel: vowelProfile,
                phase: random() * TWO_PI,
                seed: Math.floor(random() * 2147483000) + 1,
                noiseLow: 0,
                noiseInput: 0,
                noiseHigh: 0
            });
            sampleCursor += eventSamples;
            sampleCursor += Math.round(0.012 * SAMPLE_RATE / speed);
        }

        sampleCursor += Math.round(0.10 * SAMPLE_RATE);
        return { events: events, totalSamples: sampleCursor };
    }

    function u16(value) {
        return String.fromCharCode(value & 255, (value >> 8) & 255);
    }

    function u32(value) {
        return String.fromCharCode(
            value & 255,
            Math.floor(value / 256) & 255,
            Math.floor(value / 65536) & 255,
            Math.floor(value / 16777216) & 255
        );
    }

    function wavHeader(sampleCount) {
        var dataBytes = sampleCount * 2;
        return "RIFF" + u32(36 + dataBytes) + "WAVE" +
            "fmt " + u32(16) + u16(1) + u16(1) + u32(SAMPLE_RATE) +
            u32(SAMPLE_RATE * 2) + u16(2) + u16(16) +
            "data" + u32(dataBytes);
    }

    function shapedNoise(event, white, brightness) {
        event.noiseLow += 0.12 * (white - event.noiseLow);
        var high = 0.92 * (event.noiseHigh + white - event.noiseInput);
        event.noiseInput = white;
        event.noiseHigh = high;
        return event.noiseLow * (1 - brightness) + high * brightness;
    }

    function renderConsonant(event, localIndex, phase, random) {
        if (event.consonant.kind === CONSONANT_NONE || event.onset <= 1) {
            return 0;
        }
        var progress = clamp(localIndex / event.onset, 0, 1);
        var white = random() * 2 - 1;
        var place = event.consonant.place;
        var kind = event.consonant.kind;
        var consonantEnvelope = Math.sin(Math.PI * progress);
        var sample = 0;

        if (kind === CONSONANT_STOP || kind === CONSONANT_VOICED_STOP) {
            var releasePoint = 0.58;
            if (kind === CONSONANT_VOICED_STOP && progress < releasePoint) {
                sample += Math.sin(phase) * 0.24 * Math.sin(Math.PI * progress / releasePoint);
            }
            if (progress >= releasePoint) {
                var burstProgress = (progress - releasePoint) / (1 - releasePoint);
                var burstEnvelope = Math.exp(-7.5 * burstProgress);
                var burstTone = Math.sin(TWO_PI * (1100 + place * 3200) * localIndex / SAMPLE_RATE);
                sample += (shapedNoise(event, white, 0.42 + place * 0.48) * 0.82 + burstTone * 0.18) * burstEnvelope;
            }
        } else if (kind === CONSONANT_FRICATIVE) {
            sample = shapedNoise(event, white, 0.55) * consonantEnvelope * 0.72;
        } else if (kind === CONSONANT_SIBILANT) {
            sample = shapedNoise(event, white, 0.92) * consonantEnvelope * 0.88;
        } else if (kind === CONSONANT_NASAL) {
            var nasal = Math.sin(phase) * 0.62 + Math.sin(phase * 2) * 0.16;
            sample = nasal * (0.45 + 0.55 * progress) + event.noiseLow * 0.05;
        } else if (kind === CONSONANT_LIQUID) {
            var liquidPhase = phase * (0.72 + progress * 0.28);
            sample = (Math.sin(liquidPhase) * 0.65 + Math.sin(liquidPhase * 2) * 0.15) * consonantEnvelope;
        } else if (kind === CONSONANT_ASPIRATE) {
            sample = shapedNoise(event, white, 0.28) * consonantEnvelope * 0.62;
        }
        return sample;
    }

    function renderVowel(event, localIndex, phase, voice, random) {
        var vowelLength = Math.max(1, event.length - event.onset);
        var vowelIndex = Math.max(0, localIndex - event.onset);
        var progress = clamp(vowelIndex / vowelLength, 0, 1);
        var fadeIn = clamp((localIndex - event.onset + SAMPLE_RATE * 0.009) / (SAMPLE_RATE * 0.018), 0, 1);
        var fadeOut = clamp((event.length - localIndex) / (SAMPLE_RATE * 0.022), 0, 1);
        var envelope = fadeIn * fadeOut * (1 - progress * 0.16);
        var voiced = 0;
        var harmonic;

        for (harmonic = 1; harmonic <= event.vowel.harmonics.length; harmonic += 1) {
            voiced += Math.sin(phase * harmonic) * event.vowel.harmonics[harmonic - 1];
        }

        var formantDetail =
            Math.sin(TWO_PI * event.vowel.formants[0] * localIndex / SAMPLE_RATE + 0.3) * 0.065 +
            Math.sin(TWO_PI * event.vowel.formants[1] * localIndex / SAMPLE_RATE + 1.1) * 0.042 +
            Math.sin(TWO_PI * event.vowel.formants[2] * localIndex / SAMPLE_RATE + 2.0) * 0.022;
        var breath = shapedNoise(event, random() * 2 - 1, 0.35) * voice.breath;
        var buzz = voice.buzz > 0 ? Math.sin(phase * 2.01) * voice.buzz : 0;
        return (voiced * 1.85 + formantDetail + breath + buzz) * envelope;
    }

    function renderEventSample(event, localIndex, voice, volume, random) {
        var t = localIndex / SAMPLE_RATE;
        var progress = localIndex / event.length;
        var masterAttack = Math.min(1, localIndex / (SAMPLE_RATE * 0.002));
        var masterRelease = Math.min(1, (event.length - localIndex) / (SAMPLE_RATE * 0.010));
        var wobble = 1 + voice.wobble * Math.sin(TWO_PI * 9.2 * t);
        var pitchGesture = 1 + 0.018 * (0.5 - progress);
        var phase = TWO_PI * event.frequency * wobble * pitchGesture * t + event.phase;
        var consonant = renderConsonant(event, localIndex, phase, random);
        var vowel = renderVowel(event, localIndex, phase, voice, random);
        var sample = (consonant * 0.92 + vowel) * masterAttack * masterRelease * volume;
        var softened = (2 / Math.PI) * Math.atan(sample);
        return clamp(Math.round(softened * 30000), -32768, 32767);
    }

    function writeWav(file, text, settings) {
        var sequence = buildEvents(text, settings.speed, settings.pitch, settings.voice);
        var estimatedSeconds = sequence.totalSamples / SAMPLE_RATE;
        if (estimatedSeconds > 180) {
            throw new Error("Audio is longer than 3 minutes. Shorten the text or increase speed.\n音訊超過 3 分鐘，請縮短文字或提高速度。");
        }

        file.encoding = "BINARY";
        if (!file.open("w")) {
            throw new Error("Cannot write the WAV file. Enable file access in After Effects preferences.\n無法寫入 WAV，請在 AE 偏好設定允許指令碼寫入檔案。");
        }

        try {
            file.write(wavHeader(sequence.totalSamples));
            var eventIndex = 0;
            var currentEvent = sequence.events.length > 0 ? sequence.events[0] : null;
            var random = currentEvent ? makeRandom(currentEvent.seed) : makeRandom(1);
            var bytes = "";
            var sampleIndex;

            for (sampleIndex = 0; sampleIndex < sequence.totalSamples; sampleIndex += 1) {
                while (currentEvent && sampleIndex >= currentEvent.start + currentEvent.length) {
                    eventIndex += 1;
                    currentEvent = eventIndex < sequence.events.length ? sequence.events[eventIndex] : null;
                    random = currentEvent ? makeRandom(currentEvent.seed) : random;
                }

                var sample = 0;
                if (currentEvent && sampleIndex >= currentEvent.start) {
                    sample = renderEventSample(
                        currentEvent,
                        sampleIndex - currentEvent.start,
                        settings.voice,
                        settings.volume,
                        random
                    );
                }
                if (sample < 0) {
                    sample += 65536;
                }
                bytes += String.fromCharCode(sample & 255, (sample >> 8) & 255);
                if (bytes.length >= 32768) {
                    file.write(bytes);
                    bytes = "";
                }
            }
            if (bytes.length > 0) {
                file.write(bytes);
            }
        } finally {
            file.close();
        }
        return estimatedSeconds;
    }

    function importIntoAfterEffects(file, addToComp) {
        if (!app.project) {
            app.newProject();
        }
        var activeComp = app.project.activeItem;
        var footage = app.project.importFile(new ImportOptions(file));
        if (addToComp && activeComp && activeComp instanceof CompItem) {
            var layer = activeComp.layers.add(footage);
            layer.startTime = activeComp.time;
        }
        return footage;
    }

    function addLabeledSlider(parent, label, minimum, maximum, value, decimals) {
        var group = parent.add("group");
        group.orientation = "row";
        group.alignChildren = ["fill", "center"];
        var title = group.add("statictext", undefined, label);
        title.preferredSize.width = 112;
        var slider = group.add("slider", undefined, value, minimum, maximum);
        slider.preferredSize.width = 150;
        var field = group.add("edittext", undefined, value.toFixed(decimals));
        field.characters = 5;

        function syncFromSlider() {
            field.text = slider.value.toFixed(decimals);
        }
        function syncFromField() {
            var parsed = parseFloat(field.text);
            if (isNaN(parsed)) {
                parsed = value;
            }
            slider.value = clamp(parsed, minimum, maximum);
            syncFromSlider();
        }
        slider.onChanging = syncFromSlider;
        field.onChange = syncFromField;
        return slider;
    }

    function buildUI(host) {
        if (!outputFolder) {
            outputFolder = new Folder(Folder.myDocuments.fsName + "/Island Chatter");
        }
        var palette = host instanceof Panel ? host : new Window("palette", SCRIPT_NAME + " " + VERSION, undefined, { resizeable: true });
        palette.orientation = "column";
        palette.alignChildren = ["fill", "top"];
        palette.spacing = 8;
        palette.margins = 12;

        var intro = palette.add("statictext", undefined, "Original island-style character chatter / 原創島民式碎語");
        intro.alignment = ["fill", "top"];

        var textInput = palette.add("edittext", undefined, "Ba be bi bo bu! 你好，島民！", { multiline: true, scrolling: true });
        textInput.preferredSize = [390, 92];

        var selectedTextButton = palette.add("button", undefined, "Use selected text layer / 使用選取文字圖層");
        selectedTextButton.onClick = function () {
            var selectedText = getSelectedText();
            if (selectedText === null) {
                alert("Select at least one text layer in an active composition.\n請在目前合成中選取至少一個文字圖層。");
                return;
            }
            textInput.text = selectedText;
        };

        var voiceGroup = palette.add("group");
        voiceGroup.orientation = "row";
        voiceGroup.add("statictext", undefined, "Voice / 聲線");
        var voiceMenu = voiceGroup.add("dropdownlist", undefined, []);
        voiceMenu.alignment = ["fill", "center"];
        for (var voiceIndex = 0; voiceIndex < VOICES.length; voiceIndex += 1) {
            voiceMenu.add("item", VOICES[voiceIndex].name);
        }
        voiceMenu.selection = 0;

        var pitchSlider = addLabeledSlider(palette, "Pitch / 音高", 0.55, 1.80, 1.00, 2);
        var speedSlider = addLabeledSlider(palette, "Speed / 速度", 0.55, 2.20, 1.00, 2);
        var volumeSlider = addLabeledSlider(palette, "Volume / 音量", 0.10, 1.00, 0.78, 2);

        var optionsGroup = palette.add("group");
        optionsGroup.orientation = "column";
        optionsGroup.alignChildren = ["left", "center"];
        var importCheckbox = optionsGroup.add("checkbox", undefined, "Import into project / 匯入專案");
        importCheckbox.value = true;
        var compCheckbox = optionsGroup.add("checkbox", undefined, "Add at current comp time / 加到合成目前時間");
        compCheckbox.value = true;

        var folderPanel = palette.add("panel", undefined, "Output / 輸出");
        folderPanel.orientation = "column";
        folderPanel.alignChildren = ["fill", "top"];
        folderPanel.margins = 10;
        var folderPath = folderPanel.add("statictext", undefined, outputFolder.fsName, { truncate: "middle" });
        folderPath.helpTip = outputFolder.fsName;
        var chooseFolderButton = folderPanel.add("button", undefined, "Choose folder / 選擇資料夾");
        chooseFolderButton.onClick = function () {
            var chosen = Folder.selectDialog("Choose WAV output folder / 選擇 WAV 輸出資料夾", outputFolder);
            if (chosen) {
                outputFolder = chosen;
                folderPath.text = outputFolder.fsName;
                folderPath.helpTip = outputFolder.fsName;
                palette.layout.layout(true);
            }
        };

        var generateButton = palette.add("button", undefined, "Generate chatter / 產生碎語");
        generateButton.preferredSize.height = 34;
        var status = palette.add("statictext", undefined, "Ready / 就緒");

        generateButton.onClick = function () {
            var text = trim(textInput.text);
            if (!text) {
                alert("Enter some text first. / 請先輸入文字。");
                return;
            }
            if (text.length > 2500) {
                alert("Keep the text under 2,500 characters. / 文字請控制在 2,500 字元以內。");
                return;
            }
            if (!outputFolder.exists && !outputFolder.create()) {
                alert("Cannot create the output folder. / 無法建立輸出資料夾。");
                return;
            }

            var filename = safeFilename(text.substring(0, 24)) + "_" + timestamp() + ".wav";
            var outputFile = new File(outputFolder.fsName + "/" + filename);
            var settings = {
                voice: VOICES[voiceMenu.selection ? voiceMenu.selection.index : 0],
                pitch: pitchSlider.value,
                speed: speedSlider.value,
                volume: volumeSlider.value
            };

            generateButton.enabled = false;
            status.text = "Rendering… / 產生中…";
            palette.update();
            app.beginUndoGroup(SCRIPT_NAME + " - Generate");
            try {
                var duration = writeWav(outputFile, text, settings);
                if (importCheckbox.value) {
                    importIntoAfterEffects(outputFile, compCheckbox.value);
                }
                status.text = "Done: " + duration.toFixed(2) + "s / 完成";
                alert("Created / 已建立：\n" + outputFile.fsName);
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(SCRIPT_NAME + "\n" + error.toString());
            } finally {
                app.endUndoGroup();
                generateButton.enabled = true;
            }
        };

        palette.onResizing = palette.onResize = function () {
            this.layout.resize();
        };
        palette.layout.layout(true);
        palette.layout.resize();
        return palette;
    }

    if (typeof $ === "undefined" && typeof module !== "undefined" && module.exports) {
        module.exports = {
            version: VERSION,
            sampleRate: SAMPLE_RATE,
            voices: VOICES,
            vowels: VOWELS,
            buildEvents: buildEvents,
            writeWav: writeWav
        };
        return;
    }

    var panel = buildUI(thisObj);
    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }
}(this));

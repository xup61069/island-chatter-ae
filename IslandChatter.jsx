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
    var VERSION = "1.0.0";
    var SAMPLE_RATE = 44100;
    var TWO_PI = Math.PI * 2;
    var outputFolder = new Folder(Folder.myDocuments.fsName + "/Island Chatter");

    var VOICES = [
        { name: "Sunny / 明亮", pitch: 1.00, harmonic: 0.34, breath: 0.04, wobble: 0.018 },
        { name: "Tiny / 迷你", pitch: 1.48, harmonic: 0.28, breath: 0.025, wobble: 0.024 },
        { name: "Cozy / 溫厚", pitch: 0.72, harmonic: 0.42, breath: 0.055, wobble: 0.012 },
        { name: "Buzzy / 電子", pitch: 0.92, harmonic: 0.56, breath: 0.015, wobble: 0.008 }
    ];

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

    function buildEvents(text, speed, pitch, voice) {
        var events = [];
        var sampleCursor = 0;
        var unitSeconds = 0.094 / speed;
        var spaceSeconds = 0.052 / speed;
        var punctuationSeconds = 0.145 / speed;
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
            var lengthVariation = 0.82 + random() * 0.30;
            var duration = unitSeconds * lengthVariation;
            var note = ((code * 7 + i * 3) % 13) - 6;
            var baseFrequency = 560 * voice.pitch * pitch * Math.pow(2, note / 24);
            var vowel = code % 5;
            var formantRatio = [1.72, 1.93, 2.21, 2.48, 2.74][vowel];
            var eventSamples = Math.max(32, Math.round(duration * SAMPLE_RATE));
            events.push({
                start: sampleCursor,
                length: eventSamples,
                frequency: baseFrequency,
                formant: formantRatio,
                phase: random() * TWO_PI,
                seed: Math.floor(random() * 2147483000) + 1
            });
            sampleCursor += eventSamples;
            sampleCursor += Math.round(0.009 * SAMPLE_RATE / speed);
        }

        sampleCursor += Math.round(0.08 * SAMPLE_RATE);
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

    function renderEventSample(event, localIndex, voice, volume, random) {
        var t = localIndex / SAMPLE_RATE;
        var progress = localIndex / event.length;
        var attack = Math.min(1, localIndex / (SAMPLE_RATE * 0.004));
        var release = Math.min(1, (event.length - localIndex) / (SAMPLE_RATE * 0.018));
        var envelope = attack * release * Math.pow(1 - progress * 0.28, 1.5);
        var wobble = 1 + voice.wobble * Math.sin(TWO_PI * 10.5 * t);
        var chirp = 1 + 0.035 * progress;
        var phase = TWO_PI * event.frequency * wobble * chirp * t + event.phase;
        var fundamental = Math.sin(phase);
        var harmonic = Math.sin(phase * event.formant + 0.6) * voice.harmonic;
        var sparkle = Math.sin(phase * 3.01 + 1.2) * 0.11;
        var noise = (random() * 2 - 1) * voice.breath;
        var sample = (fundamental * 0.68 + harmonic + sparkle + noise) * envelope * volume;
        return clamp(Math.round(sample * 23500), -32768, 32767);
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
        var palette = host instanceof Panel ? host : new Window("palette", SCRIPT_NAME + " " + VERSION, undefined, { resizeable: true });
        palette.orientation = "column";
        palette.alignChildren = ["fill", "top"];
        palette.spacing = 8;
        palette.margins = 12;

        var intro = palette.add("statictext", undefined, "Original island-style character chatter / 原創島民式碎語");
        intro.alignment = ["fill", "top"];

        var textInput = palette.add("edittext", undefined, "Hello, island! 你好，島民！", { multiline: true, scrolling: true });
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

    var panel = buildUI(thisObj);
    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }
}(this));

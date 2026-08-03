#target aftereffects
#targetengine "islandChatterNativePanel"
#include "IslandChatterMandarinReadings.jsxinc"

/*
 * Island Chatter Native helper panel
 * SPDX-License-Identifier: MIT
 *
 * Applies the audio effect directly to text layers, batch-syncs Source Text,
 * and creates optional timing markers without generating audio files.
 */

(function islandChatterNativePanel(thisObj) {
    var SCRIPT_NAME = "Island Chatter Native";
    var EFFECT_NAME = "Island Chatter Native";
    var DISPLAY_NAME = "Island Chatter Voice";
    var TONE_MATCH_NAME = "ADBE Aud Tone";
    var TONE_DISPLAY_NAME = "Island Chatter Audio Bootstrap";
    var OLD_CONTROL_NAME = "Island Chatter Control";
    var OLD_SOURCE_CONTROL_NAME = "Island Chatter Source";
    var MAX_TEXT_UNITS = 64;
    var PARAM_VOICE = 1;
    var PARAM_PITCH = 2;
    var PARAM_SPEED = 3;
    var PARAM_VOLUME = 4;
    var PARAM_CONSONANT = 5;
    var PARAM_TEXT_LENGTH = 6;
    var PARAM_TEXT_FIRST = 7;
    var PARAM_EMOTION = 71;
    var PARAM_CHARACTER_SIZE = 72;
    var PARAM_CLARITY = 73;
    var PARAM_CUTENESS = 74;
    var PARAM_SEED = 75;

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function trim(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function isTextLayer(layer) {
        return !!(layer && layer.property("ADBE Text Properties"));
    }

    function selectedTextLayers(comp) {
        var output = [];
        var index;
        for (index = 0; index < comp.selectedLayers.length; index += 1) {
            if (isTextLayer(comp.selectedLayers[index])) {
                output.push(comp.selectedLayers[index]);
            }
        }
        return output;
    }

    function selectedTextLayer(comp) {
        var layers = selectedTextLayers(comp);
        return layers.length ? layers[0] : null;
    }

    function textFromLayer(layer) {
        var sourceText = layer.property("ADBE Text Properties").property("ADBE Text Document");
        return sourceText ? String(sourceText.value.text) : "";
    }

    function findEffect(layer, matchName, displayName) {
        var effects = layer ? layer.property("ADBE Effect Parade") : null;
        if (!effects) { return null; }
        var index;
        for (index = 1; index <= effects.numProperties; index += 1) {
            var effect = effects.property(index);
            if (effect.matchName === matchName || effect.name === displayName) {
                return effect;
            }
        }
        return null;
    }

    function findNativeEffect(layer) {
        return findEffect(layer, EFFECT_NAME, DISPLAY_NAME);
    }

    function valuesDiffer(current, next) {
        return Math.abs(Number(current) - Number(next)) > 0.000001;
    }

    function setPropertyValue(property, value, time) {
        if (property.numKeys > 0) {
            property.setValueAtTime(time, value);
        } else if (valuesDiffer(property.value, value)) {
            property.setValue(value);
        }
    }

    function setEffectParameters(effect, text, settings, time) {
        var units = Math.min(text.length, MAX_TEXT_UNITS);
        setPropertyValue(effect.property(PARAM_VOICE), settings.voice + 1, time);
        setPropertyValue(effect.property(PARAM_PITCH), settings.pitch, time);
        setPropertyValue(effect.property(PARAM_SPEED), settings.speed, time);
        setPropertyValue(effect.property(PARAM_VOLUME), settings.volume * 100, time);
        setPropertyValue(effect.property(PARAM_CONSONANT), settings.consonant, time);
        setPropertyValue(effect.property(PARAM_EMOTION), settings.emotion + 1, time);
        setPropertyValue(effect.property(PARAM_CHARACTER_SIZE), settings.characterSize + 1, time);
        setPropertyValue(effect.property(PARAM_CLARITY), settings.clarity * 100, time);
        setPropertyValue(effect.property(PARAM_CUTENESS), settings.cuteness * 100, time);
        setPropertyValue(effect.property(PARAM_SEED), Math.round(settings.seed), time);
        setPropertyValue(effect.property(PARAM_TEXT_LENGTH), units, time);
        var index;
        for (index = 0; index < MAX_TEXT_UNITS; index += 1) {
            setPropertyValue(effect.property(PARAM_TEXT_FIRST + index),
                index < units ? text.charCodeAt(index) : 0, time);
        }
    }

    function setEffectText(effect, text) {
        var units = Math.min(text.length, MAX_TEXT_UNITS);
        effect.property(PARAM_TEXT_LENGTH).setValue(units);
        var index;
        for (index = 0; index < MAX_TEXT_UNITS; index += 1) {
            effect.property(PARAM_TEXT_FIRST + index).setValue(index < units ? text.charCodeAt(index) : 0);
        }
    }

    function textFromEffect(effect) {
        var units = Math.min(Math.round(effect.property(PARAM_TEXT_LENGTH).value), MAX_TEXT_UNITS);
        var value = "";
        var index;
        for (index = 0; index < units; index += 1) {
            value += String.fromCharCode(Math.round(effect.property(PARAM_TEXT_FIRST + index).value));
        }
        return value;
    }

    function punctuationSeconds(character) {
        if (character === "," || character === "，" || character === "、") { return 0.105; }
        if (character === ";" || character === "；") { return 0.190; }
        if (character === ":" || character === "：") { return 0.155; }
        if (character === "?" || character === "？") { return 0.215; }
        if (character === "!" || character === "！") { return 0.195; }
        if (character === "." || character === "。") { return 0.235; }
        if (character === "…") { return 0.300; }
        return 0;
    }

    function mouthForReading(reading) {
        reading = String(reading || "").replace(/[1-5]/g, "");
        if (reading.indexOf("a") >= 0) { return 1; }
        if (reading.indexOf("i") >= 0 || reading.indexOf("v") >= 0) { return 2; }
        if (reading.indexOf("u") >= 0) { return 3; }
        if (reading.indexOf("e") >= 0) { return 4; }
        if (reading.indexOf("o") >= 0) { return 5; }
        return 1;
    }

    function toneFromReading(reading) {
        var match = String(reading || "").match(/([1-5])$/);
        return match ? parseInt(match[1], 10) : 5;
    }

    function readingForCharacter(character) {
        var codepoint = character.charCodeAt(0);
        var reading = typeof islandChatterMandarinReading === "function"
            ? islandChatterMandarinReading(codepoint) : "";
        if (reading) { return reading; }
        var lower = character.toLowerCase();
        if (/[aeiou]/.test(lower)) { return lower + "5"; }
        return "a5";
    }

    function estimateSpeech(text, speed) {
        var cursor = 0;
        var events = [];
        var index;
        speed = clamp(speed, 0.25, 4.0);
        for (index = 0; index < text.length; index += 1) {
            var character = text.charAt(index);
            if (/\s/.test(character)) { cursor += 0.055 / speed; continue; }
            var pause = punctuationSeconds(character);
            if (pause > 0) { cursor += pause / speed; continue; }
            var duration = 0.188 / speed;
            var reading = readingForCharacter(character);
            events.push({
                character: character,
                reading: reading,
                mouth: mouthForReading(reading),
                tone: toneFromReading(reading),
                time: cursor,
                duration: duration
            });
            cursor += duration + 0.012 / speed;
        }
        return { events: events, duration: cursor + 0.10 };
    }

    function updateTimingMarkers(layer, plan) {
        var markers = layer.property("ADBE Marker");
        var index;
        for (index = markers.numKeys; index >= 1; index -= 1) {
            if (String(markers.keyValue(index).comment).indexOf("IC:") === 0) {
                markers.removeKey(index);
            }
        }
        for (index = 0; index < plan.events.length; index += 1) {
            var event = plan.events[index];
            var marker = new MarkerValue("IC:" + event.character + "|" + event.reading + "|M" + event.mouth);
            marker.duration = event.duration;
            markers.setValueAtTime(layer.inPoint + event.time, marker);
        }
    }

    function findNamedEffect(layer, name) {
        var effects = layer.property("ADBE Effect Parade");
        var index;
        for (index = 1; index <= effects.numProperties; index += 1) {
            if (effects.property(index).name === name) { return effects.property(index); }
        }
        return null;
    }

    function ensureSlider(layer, name, defaultValue) {
        var effect = findNamedEffect(layer, name);
        if (!effect) {
            effect = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            effect.name = name;
        }
        var slider = effect.property(1);
        // Existing rig controls already contain the keys created below.
        // Calling setValue() on them makes AE abort every subsequent Apply.
        if (slider.numKeys === 0 && valuesDiffer(slider.value, defaultValue)) {
            slider.setValue(defaultValue);
        }
    }

    function clearKeys(property) {
        var index;
        for (index = property.numKeys; index >= 1; index -= 1) { property.removeKey(index); }
    }

    function setHoldKey(property, time, value) {
        property.setValueAtTime(time, value);
        try {
            property.setInterpolationTypeAtKey(property.nearestKeyIndex(time),
                KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
        } catch (error) { /* Older AE versions may reject the outgoing type. */ }
    }

    function tonePitch(tone) {
        if (tone === 1) { return 110; }
        if (tone === 2) { return 92; }
        if (tone === 3) { return 78; }
        if (tone === 4) { return 114; }
        return 96;
    }

    function updateAnimationControls(layer, plan) {
        var names = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce", "IC Blink"];
        var defaults = [0, 0, 100, 0, 0];
        var index;
        for (index = 0; index < names.length; index += 1) {
            ensureSlider(layer, names[index], defaults[index]);
        }
        var mouth = findNamedEffect(layer, names[0]).property(1);
        var volume = findNamedEffect(layer, names[1]).property(1);
        var pitch = findNamedEffect(layer, names[2]).property(1);
        var bounce = findNamedEffect(layer, names[3]).property(1);
        var blink = findNamedEffect(layer, names[4]).property(1);
        var controls = [mouth, volume, pitch, bounce, blink];
        for (index = 0; index < controls.length; index += 1) { clearKeys(controls[index]); }
        setHoldKey(mouth, layer.inPoint, 0);
        setHoldKey(volume, layer.inPoint, 0);
        setHoldKey(pitch, layer.inPoint, 100);
        setHoldKey(bounce, layer.inPoint, 0);
        setHoldKey(blink, layer.inPoint, 0);
        for (index = 0; index < plan.events.length; index += 1) {
            var event = plan.events[index];
            var start = layer.inPoint + event.time;
            var finish = start + event.duration * 0.82;
            setHoldKey(mouth, start, event.mouth);
            setHoldKey(mouth, finish, 0);
            setHoldKey(volume, start, 82);
            setHoldKey(volume, finish, 0);
            setHoldKey(pitch, start, tonePitch(event.tone));
            setHoldKey(pitch, finish, 100);
            setHoldKey(bounce, start, index % 2 ? -55 : 55);
            setHoldKey(bounce, start + event.duration * 0.38, 0);
            if (index > 0 && index % 5 === 0) {
                setHoldKey(blink, start, 100);
                setHoldKey(blink, start + 0.065, 0);
            }
        }
    }

    function findNamedProperty(group, name) {
        var index;
        for (index = 1; index <= group.numProperties; index += 1) {
            if (group.property(index).name === name) { return group.property(index); }
        }
        return null;
    }

    function updateTypeOn(layer, plan) {
        var textProperties = layer.property("ADBE Text Properties");
        var animators = textProperties.property("ADBE Text Animators");
        var animator = findNamedProperty(animators, "Island Chatter Type-On");
        if (!animator) {
            animator = animators.addProperty("ADBE Text Animator");
            animator.name = "Island Chatter Type-On";
        }
        var animatorProperties = animator.property("ADBE Text Animator Properties");
        if (!animatorProperties.property("ADBE Text Opacity")) {
            animatorProperties.addProperty("ADBE Text Opacity");
        }
        animator = findNamedProperty(animators, "Island Chatter Type-On");
        var selectors = animator.property("ADBE Text Selectors");
        var selector = findNamedProperty(selectors, "Island Chatter Reveal");
        if (!selector) {
            selector = selectors.addProperty("ADBE Text Selector");
            selector.name = "Island Chatter Reveal";
        }
        animator = findNamedProperty(animators, "Island Chatter Type-On");
        animator.property("ADBE Text Animator Properties").property("ADBE Text Opacity").setValue(0);
        selector = findNamedProperty(animator.property("ADBE Text Selectors"), "Island Chatter Reveal");
        var start = selector.property("ADBE Text Percent Start");
        var end = selector.property("ADBE Text Percent End");
        end.setValue(100);
        clearKeys(start);
        setHoldKey(start, layer.inPoint, 0);
        var index;
        for (index = 0; index < plan.events.length; index += 1) {
            var time = layer.inPoint + plan.events[index].time + plan.events[index].duration * 0.55;
            setHoldKey(start, time, (index + 1) / plan.events.length * 100);
        }
    }

    function removeLegacyBridge(comp, textLayer) {
        var oldControl = findEffect(textLayer, OLD_CONTROL_NAME, "Island Chatter Voice");
        if (oldControl && oldControl.matchName === OLD_CONTROL_NAME) {
            oldControl.remove();
        }
        var index;
        for (index = comp.numLayers; index >= 1; index -= 1) {
            var candidate = comp.layer(index);
            var sourceControl = findEffect(candidate, "ADBE Layer Control", OLD_SOURCE_CONTROL_NAME);
            if (sourceControl && sourceControl.property(1).value === textLayer.index && findNativeEffect(candidate)) {
                candidate.locked = false;
                candidate.remove();
            }
        }
    }

    function addNativeEffect(layer) {
        try {
            return layer.property("ADBE Effect Parade").addProperty(EFFECT_NAME);
        } catch (error) {
            throw new Error("Native effect is not installed: " + EFFECT_NAME +
                "\n尚未安裝原生效果：" + EFFECT_NAME);
        }
    }

    function ensureToneBootstrap(layer) {
        var tone = findEffect(layer, TONE_MATCH_NAME, TONE_DISPLAY_NAME);
        if (!tone) {
            try {
                tone = layer.property("ADBE Effect Parade").addProperty(TONE_MATCH_NAME);
            } catch (error) {
                throw new Error("The built-in Tone effect is unavailable.\n找不到 AE 內建的 Tone／音調效果。");
            }
        }
        tone.name = TONE_DISPLAY_NAME;
        // Tone's sixth parameter is Level. Zero keeps its private AE sound
        // source alive while Island Chatter replaces every output sample.
        var level = tone.property(6);
        if (level.numKeys > 0) { clearKeys(level); }
        if (valuesDiffer(level.value, 0)) { level.setValue(0); }
        return tone;
    }

    function applyToTextLayer(comp, textLayer, pronunciation, settings, options) {
        var text = textFromLayer(textLayer);
        var spokenText = trim(pronunciation) || text;

        removeLegacyBridge(comp, textLayer);
        ensureToneBootstrap(textLayer);
        var effect = findNativeEffect(textLayer);
        if (!effect) { effect = addNativeEffect(textLayer); }
        effect.name = trim(pronunciation) ? DISPLAY_NAME + " [Override]" : DISPLAY_NAME;

        // addProperty() invalidates previously obtained Property references in
        // AE scripting. Reacquire both effects before inspecting their order.
        var tone = findEffect(textLayer, TONE_MATCH_NAME, TONE_DISPLAY_NAME);
        effect = findNativeEffect(textLayer);
        if (tone.propertyIndex > effect.propertyIndex) {
            tone.moveTo(effect.propertyIndex);
            // moveTo() invalidates the references again.
            effect = findNativeEffect(textLayer);
        }
        setEffectParameters(effect, spokenText, settings, comp.time);

        var plan = estimateSpeech(text, settings.speed);
        if (options.fitDuration) {
            textLayer.outPoint = Math.min(comp.duration,
                Math.max(textLayer.inPoint + comp.frameDuration, textLayer.inPoint + plan.duration));
        }
        if (options.markers) { updateTimingMarkers(textLayer, plan); }
        if (options.controllers) { updateAnimationControls(textLayer, plan); }
        if (options.typeOn) { updateTypeOn(textLayer, plan); }
        return textLayer;
    }

    function createOrUpdate(text, pronunciation, settings, options) {
        if (!app.project) { app.newProject(); }
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            throw new Error("Open an active composition first. / 請先開啟合成。");
        }
        var layers = selectedTextLayers(comp);
        if (!layers.length) {
            var created = comp.layers.addText(text);
            created.name = text.substring(0, 32).replace(/[\r\n]+/g, " ");
            created.startTime = comp.time;
            layers.push(created);
        }
        var index;
        for (index = 0; index < layers.length; index += 1) {
            // One pronunciation override cannot safely describe several
            // different selected layers, so batch mode uses each Source Text.
            var layerPronunciation = layers.length === 1 ? pronunciation : "";
            applyToTextLayer(comp, layers[index], layerPronunciation, settings, options);
            layers[index].selected = true;
        }
        return layers.length;
    }

    function addSlider(parent, label, minimum, maximum, value) {
        var group = parent.add("group");
        group.orientation = "row";
        var title = group.add("statictext", undefined, label);
        title.preferredSize.width = 110;
        var slider = group.add("slider", undefined, value, minimum, maximum);
        slider.alignment = ["fill", "center"];
        var field = group.add("edittext", undefined, value.toFixed(2));
        field.characters = 5;
        slider.onChanging = function () { field.text = slider.value.toFixed(2); };
        field.onChange = function () {
            var parsed = parseFloat(field.text);
            slider.value = clamp(isNaN(parsed) ? value : parsed, minimum, maximum);
            field.text = slider.value.toFixed(2);
        };
        slider.valueField = field;
        return slider;
    }

    function setSliderValue(slider, value) {
        slider.value = value;
        if (slider.valueField) { slider.valueField.text = slider.value.toFixed(2); }
    }

    function buildUI(host) {
        var panel = host instanceof Panel ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.margins = 12;
        panel.spacing = 8;
        panel.add("statictext", undefined, "Direct text-layer voice / 文字圖層直接發聲");
        var textInput = panel.add("edittext", undefined, "你好，歡迎來到小島！", { multiline: true, scrolling: true });
        textInput.preferredSize = [390, 88];
        var selectedButton = panel.add("button", undefined, "Use selected text layer / 使用選取文字圖層");
        selectedButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            var layer = comp && comp instanceof CompItem ? selectedTextLayer(comp) : null;
            if (!layer) { alert("Select a text layer. / 請選取文字圖層。"); }
            else { textInput.text = textFromLayer(layer); }
        };
        panel.add("statictext", undefined,
            "Pronunciation override (optional) / 讀音覆寫（可留空）");
        var pronunciationInput = panel.add("edittext", undefined, "", { multiline: false });
        pronunciationInput.helpTip = "Examples: [重|chong2]新, ni3 hao3, ㄋㄧˇ ㄏㄠˇ";
        var voice = panel.add("dropdownlist", undefined, [
            "Sunny / 明亮", "Tiny / 迷你", "Cozy / 溫厚", "Buzzy / 電子",
            "Chirpy / 活潑", "Whisper / 耳語", "Elder / 年長", "Droid / 機器"
        ]);
        voice.selection = 0;
        var emotion = panel.add("dropdownlist", undefined, [
            "Neutral / 中性", "Happy / 開心", "Angry / 生氣", "Scared / 害怕",
            "Question / 疑問", "Sleepy / 疲倦", "Robot / 機器人"
        ]);
        emotion.selection = 0;
        var characterSize = panel.add("dropdownlist", undefined,
            ["Tiny / 迷你", "Young / 少年", "Adult / 成熟", "Giant / 巨大"]);
        characterSize.selection = 2;
        var pitch = addSlider(panel, "Pitch / 音高", 0.55, 1.80, 1.00);
        var speed = addSlider(panel, "Speed / 速度", 0.55, 2.20, 1.00);
        var volume = addSlider(panel, "Volume / 音量", 0.10, 1.00, 0.78);
        var consonant = addSlider(panel, "Consonant / 聲母", 0.50, 2.50, 1.25);
        var clarity = addSlider(panel, "Clarity / 清晰度", 0.00, 1.00, 0.78);
        var cuteness = addSlider(panel, "Cuteness / 可愛度", 0.00, 1.00, 0.55);
        var seed = addSlider(panel, "Seed / 種子", 0, 9999, 0);

        var characterRow = panel.add("group");
        var preset = characterRow.add("dropdownlist", undefined,
            ["Custom / 自訂", "Mimi / 咪咪", "Captain / 隊長", "Grandma / 奶奶", "Robot / 機器人"]);
        preset.selection = 0;
        var randomButton = characterRow.add("button", undefined, "Random / 隨機");
        var saveButton = characterRow.add("button", undefined, "Save / 儲存角色");
        var builtInPresets = [
            null,
            [1, 1, 0, 1.10, 1.12, 0.82, 0.82, 137],
            [0, 2, 2, 0.92, 1.04, 0.90, 0.35, 271],
            [6, 5, 2, 0.88, 0.82, 0.86, 0.28, 613],
            [7, 6, 2, 0.96, 0.96, 0.72, 0.42, 808]
        ];
        function applyPreset(values) {
            if (!values) { return; }
            voice.selection = values[0];
            emotion.selection = values[1];
            characterSize.selection = values[2];
            setSliderValue(pitch, values[3]);
            setSliderValue(speed, values[4]);
            setSliderValue(clarity, values[5]);
            setSliderValue(cuteness, values[6]);
            setSliderValue(seed, values[7]);
        }
        preset.onChange = function () {
            applyPreset(builtInPresets[preset.selection ? preset.selection.index : 0]);
        };
        randomButton.onClick = function () {
            voice.selection = Math.floor(Math.random() * voice.items.length);
            emotion.selection = Math.floor(Math.random() * emotion.items.length);
            characterSize.selection = Math.floor(Math.random() * characterSize.items.length);
            setSliderValue(pitch, 0.85 + Math.random() * 0.45);
            setSliderValue(speed, 0.82 + Math.random() * 0.48);
            setSliderValue(clarity, 0.58 + Math.random() * 0.40);
            setSliderValue(cuteness, 0.25 + Math.random() * 0.72);
            setSliderValue(seed, 1 + Math.floor(Math.random() * 9999));
            preset.selection = 0;
        };
        saveButton.onClick = function () {
            var values = [voice.selection.index, emotion.selection.index, characterSize.selection.index,
                pitch.value, speed.value, clarity.value, cuteness.value, Math.round(seed.value)];
            app.settings.saveSetting("IslandChatter", "characterPreset", values.join(","));
            alert("Character preset saved. / 角色預設已儲存。");
        };
        if (app.settings.haveSetting("IslandChatter", "characterPreset")) {
            var loadButton = characterRow.add("button", undefined, "Load / 載入");
            loadButton.onClick = function () {
                var parts = app.settings.getSetting("IslandChatter", "characterPreset").split(",");
                var values = [];
                var index;
                for (index = 0; index < parts.length; index += 1) { values.push(parseFloat(parts[index])); }
                applyPreset(values);
                preset.selection = 0;
            };
        }
        var workflowRow = panel.add("group");
        var markers = workflowRow.add("checkbox", undefined, "Markers / 逐字標記");
        markers.value = true;
        var fitDuration = workflowRow.add("checkbox", undefined, "Fit Duration / 配合長度");
        fitDuration.value = true;
        var animationRow = panel.add("group");
        var controllers = animationRow.add("checkbox", undefined, "Rig / 動畫控制");
        controllers.value = true;
        var typeOn = animationRow.add("checkbox", undefined, "Type-On / 逐字顯示");
        typeOn.value = false;

        var applyButton = panel.add("button", undefined,
            "Apply to selected text layers / 套用到選取文字圖層");
        applyButton.preferredSize.height = 34;
        var status = panel.add("statictext", undefined, "Edit text, then apply / 修改文字後按套用");
        applyButton.onClick = function () {
            var text = trim(textInput.text);
            if (!text) { alert("Enter text first. / 請先輸入文字。"); return; }
            if (text.length > MAX_TEXT_UNITS) {
                alert("Supports up to " + MAX_TEXT_UNITS + " UTF-16 units; extra text is truncated.\n最多支援 " +
                    MAX_TEXT_UNITS + " 個 UTF-16 字元，超出部分會截斷。");
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Apply");
            try {
                var applied = createOrUpdate(text, trim(pronunciationInput.text), {
                    voice: voice.selection ? voice.selection.index : 0,
                    pitch: pitch.value,
                    speed: speed.value,
                    volume: volume.value,
                    consonant: consonant.value,
                    emotion: emotion.selection ? emotion.selection.index : 0,
                    characterSize: characterSize.selection ? characterSize.selection.index : 2,
                    clarity: clarity.value,
                    cuteness: cuteness.value,
                    seed: seed.value
                }, {
                    markers: markers.value,
                    fitDuration: fitDuration.value,
                    controllers: controllers.value,
                    typeOn: typeOn.value
                });
                status.text = "Applied to " + applied + " layer(s) / 已套用 " + applied + " 個圖層";
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };
        panel.onResizing = panel.onResize = function () { this.layout.resize(); };
        panel.layout.layout(true);
        return panel;
    }

    var panel = buildUI(thisObj);
    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }
}(this));

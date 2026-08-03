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
    // Mirrors kMinimumSpeed / kMaximumSpeed in native/src/dsp.cpp.
    var MIN_SPEED = 0.10;
    var MAX_SPEED = 12.0;
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

    /*
     * Everything from here to estimateSpeech() mirrors native/src/dsp.cpp.
     * Markers, the animation rig, Type-On and Fit Duration all read the plan
     * these functions produce, so any divergence from the engine shows up as
     * mouth shapes and layer lengths that do not match what you hear.
     * tests/validate-script.js cross-checks the shared tables.
     */

    function codePointAt(text, index) {
        var high = text.charCodeAt(index);
        if (high >= 0xD800 && high <= 0xDBFF && index + 1 < text.length) {
            var low = text.charCodeAt(index + 1);
            if (low >= 0xDC00 && low <= 0xDFFF) {
                return 0x10000 + ((high - 0xD800) * 0x400) + (low - 0xDC00);
            }
        }
        return high;
    }

    function isSpaceCode(code) {
        return code === 0x20 || code === 0x09 || code === 0x0A || code === 0x0D || code === 0x3000;
    }

    function isPunctuationCode(code) {
        // U+3007 〇 sits inside the CJK punctuation block but is spoken.
        if (code === 0x3007) { return false; }
        if (code >= 0x3000 && code <= 0x303F) { return true; }
        switch (code) {
        case 0x2E: case 0x2C: case 0x21: case 0x3F: case 0x3B: case 0x3A: case 0x2D:
        case 0x2026: case 0x2014:
        case 0xFF01: case 0xFF0C: case 0xFF0E: case 0xFF1A: case 0xFF1B: case 0xFF1F:
            return true;
        default:
            return false;
        }
    }

    function punctuationSeconds(code) {
        switch (code) {
        case 0x2C: case 0xFF0C: case 0x3001: return 0.105;
        case 0x3B: case 0xFF1B: return 0.190;
        case 0x3A: case 0xFF1A: return 0.155;
        case 0x3F: case 0xFF1F: return 0.215;
        case 0x21: case 0xFF01: return 0.195;
        case 0x2E: case 0xFF0E: case 0x3002: return 0.235;
        case 0x2026: return 0.300;
        case 0x2D: case 0x2014: return 0.125;
        default: return 0.165;
        }
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

    function readingTone(reading) {
        var last = String(reading).charAt(String(reading).length - 1);
        return last >= "1" && last <= "5" ? parseInt(last, 10) : 5;
    }

    function replaceReadingTone(reading, tone) {
        var last = reading.charAt(reading.length - 1);
        if (last >= "1" && last <= "5") {
            return reading.substring(0, reading.length - 1) + tone;
        }
        return reading + tone;
    }

    // Mirrors kPhrasePronunciations in native/src/dsp.cpp.
    var IC_PHRASE_READINGS = [
        ["音樂", "yin1 yue4"], ["音乐", "yin1 yue4"],
        ["樂隊", "yue4 dui4"], ["乐队", "yue4 dui4"],
        ["快樂", "kuai4 le4"], ["快乐", "kuai4 le4"],
        ["銀行", "yin2 hang2"], ["银行", "yin2 hang2"],
        ["行走", "xing2 zou3"], ["行為", "xing2 wei2"], ["行为", "xing2 wei2"],
        ["重新", "chong2 xin1"], ["重複", "chong2 fu4"], ["重复", "chong2 fu4"],
        ["重要", "zhong4 yao4"], ["重量", "zhong4 liang4"],
        ["長大", "zhang3 da4"], ["长大", "zhang3 da4"],
        ["長度", "chang2 du4"], ["长度", "chang2 du4"],
        ["還書", "huan2 shu1"], ["还书", "huan2 shu1"],
        ["還是", "hai2 shi4"], ["还是", "hai2 shi4"],
        ["過去", "guo4 qu4"], ["过去", "guo4 qu4"],
        ["經過", "jing1 guo4"], ["经过", "jing1 guo4"],
        ["超過", "chao1 guo4"], ["超过", "chao1 guo4"],
        ["難過", "nan2 guo4"], ["难过", "nan2 guo4"],
        ["過來", "guo4 lai2"], ["过来", "guo4 lai2"],
        ["過年", "guo4 nian2"], ["过年", "guo4 nian2"],
        ["著名", "zhu4 ming2"],
        ["著急", "zhao2 ji2"], ["着急", "zhao2 ji2"],
        ["顯著", "xian3 zhu4"], ["显著", "xian3 zhu4"],
        ["了解", "liao3 jie3"], ["瞭解", "liao3 jie3"],
        ["明了", "ming2 liao3"]
    ];

    // Mirrors is_neutral_particle() in native/src/dsp.cpp.
    var IC_NEUTRAL_PARTICLES = "的了嗎吗吧呢著着過过們们啊呀嘛喔哦";

    function isNeutralParticle(code) {
        return code <= 0xFFFF && IC_NEUTRAL_PARTICLES.indexOf(String.fromCharCode(code)) >= 0;
    }

    function isNumberCode(code) {
        if (code >= 0x30 && code <= 0x39) { return true; }
        return code <= 0xFFFF && "〇零一二兩两三四五六七八九十百千萬万"
            .indexOf(String.fromCharCode(code)) >= 0;
    }

    // Mirrors yi_keeps_citation_tone() in native/src/dsp.cpp.
    function yiKeepsCitationTone(previous, next) {
        if (previous <= 0xFFFF && "第星期週周初".indexOf(String.fromCharCode(previous)) >= 0) {
            return true;
        }
        if (next <= 0xFFFF && "月日號号".indexOf(String.fromCharCode(next)) >= 0) { return true; }
        return isNumberCode(previous);
    }

    function readingForCodePoint(code) {
        // 〇 is absent from Unicode's kMandarin; the engine supplies it too.
        if (code === 0x3007) { return "ling2"; }
        var reading = typeof islandChatterMandarinReading === "function"
            ? islandChatterMandarinReading(code) : "";
        return reading ? String(reading) : "";
    }

    function isLatinLetter(code) {
        if (code > 0x7F) { return false; }
        var lower = String.fromCharCode(code).toLowerCase();
        return lower >= "a" && lower <= "z";
    }

    function isLatinVowel(code) {
        if (code > 0x7F) { return false; }
        return "aeiouy".indexOf(String.fromCharCode(code).toLowerCase()) >= 0;
    }

    function characterFromCode(code) {
        if (code > 0xFFFF) {
            var offset = code - 0x10000;
            return String.fromCharCode(0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF));
        }
        return String.fromCharCode(code);
    }

    function matchesPhrase(codes, offset, phrase) {
        if (offset + phrase.length > codes.length) { return false; }
        var index;
        for (index = 0; index < phrase.length; index += 1) {
            if (codes[offset + index] !== phrase.charCodeAt(index)) { return false; }
        }
        return true;
    }

    function applySandhi(units) {
        var index;
        for (index = 0; index < units.length; index += 1) {
            if (!units[index].reading) { continue; }
            var next = index + 1;
            while (next < units.length && !units[next].reading &&
                    (units[next].pause <= 0 || isSpaceCode(units[next].code))) {
                next += 1;
            }
            if (next >= units.length || !units[next].reading) { continue; }
            var previous = 0;
            var back;
            for (back = index; back > 0; back -= 1) {
                if (units[back - 1].reading) { previous = units[back - 1].code; break; }
                if (units[back - 1].pause > 0 && !isSpaceCode(units[back - 1].code)) { break; }
            }
            var nextTone = readingTone(units[next].reading);
            var tone = readingTone(units[index].reading);
            if (tone === 3 && nextTone === 3) {
                units[index].reading = replaceReadingTone(units[index].reading, 2);
            } else if (units[index].code === 0x4E00) {
                if (!yiKeepsCitationTone(previous, units[next].code)) {
                    units[index].reading = replaceReadingTone(
                        units[index].reading, nextTone === 4 ? 2 : 4);
                }
            } else if (units[index].code === 0x4E0D && nextTone === 4) {
                units[index].reading = replaceReadingTone(units[index].reading, 2);
            }
        }
    }

    // Mirrors build_speech_units() in native/src/dsp.cpp. Inline overrides,
    // Zhuyin and tone-number pinyin belong to the Pronunciation field, which
    // never reaches this planner, so they are deliberately not duplicated.
    function buildSpeechUnits(text) {
        var codes = [];
        var index = 0;
        while (index < text.length) {
            var code = codePointAt(text, index);
            codes.push(code);
            index += code > 0xFFFF ? 2 : 1;
        }
        var units = [];
        var cursor = 0;
        while (cursor < codes.length) {
            var current = codes[cursor];
            if (isSpaceCode(current)) {
                units.push({ code: current, reading: "", pause: 0.055 });
                cursor += 1;
                continue;
            }
            if (isPunctuationCode(current)) {
                units.push({ code: current, reading: "", pause: punctuationSeconds(current) });
                cursor += 1;
                continue;
            }
            var matched = false;
            var phrase;
            for (phrase = 0; phrase < IC_PHRASE_READINGS.length; phrase += 1) {
                if (!matchesPhrase(codes, cursor, IC_PHRASE_READINGS[phrase][0])) { continue; }
                var readings = IC_PHRASE_READINGS[phrase][1].split(" ");
                var offset;
                for (offset = 0; offset < readings.length; offset += 1) {
                    units.push({ code: codes[cursor + offset], reading: readings[offset], pause: 0 });
                }
                cursor += readings.length;
                matched = true;
                break;
            }
            if (matched) { continue; }
            var reading = readingForCodePoint(current);
            if (reading && isNeutralParticle(current)) { reading = replaceReadingTone(reading, 5); }
            units.push({ code: current, reading: reading, pause: 0 });
            cursor += 1;
        }
        applySandhi(units);
        return units;
    }

    function estimateSpeech(text, speed) {
        var units = buildSpeechUnits(text);
        var cursor = 0;
        var events = [];
        var index;
        // Must match kMinimumSpeed / kMaximumSpeed in native/src/dsp.cpp.
        speed = clamp(speed, MIN_SPEED, MAX_SPEED);
        for (index = 0; index < units.length; index += 1) {
            var unit = units[index];
            if (unit.pause > 0) { cursor += unit.pause / speed; continue; }
            var mandarin = unit.reading !== "";
            var reading = mandarin ? unit.reading : "a5";
            var character = characterFromCode(unit.code);
            // The engine folds a latin consonant and the vowel after it into one
            // syllable; keep the marker and mouth counts in step with that.
            if (!mandarin && isLatinLetter(unit.code) && !isLatinVowel(unit.code) &&
                    index + 1 < units.length && !units[index + 1].reading &&
                    isLatinVowel(units[index + 1].code)) {
                character += characterFromCode(units[index + 1].code);
                index += 1;
            }
            var duration = (mandarin ? 0.188 : 0.148) / speed;
            events.push({
                character: character,
                reading: reading,
                mouth: mouthForReading(reading),
                tone: readingTone(reading),
                time: cursor,
                duration: duration
            });
            cursor += duration + 0.012 / speed;
        }
        return { events: events, duration: cursor + 0.10 };
    }

    // Mirrors apply_character_style() in native/src/dsp.cpp. The engine scales
    // Speed again by emotion and character size, so every timing the panel
    // writes has to use the same effective value or Fit Duration, markers, the
    // rig and Type-On all drift away from what you hear.
    function effectiveSpeed(settings) {
        var speed = settings.speed;
        if (settings.characterSize === 0) { speed *= 1.08; }
        else if (settings.characterSize === 1) { speed *= 1.04; }
        else if (settings.characterSize === 3) { speed *= 0.91; }
        if (settings.emotion === 1) { speed *= 1.08; }
        else if (settings.emotion === 2) { speed *= 1.12; }
        else if (settings.emotion === 3) { speed *= 1.14; }
        else if (settings.emotion === 5) { speed *= 0.78; }
        else if (settings.emotion === 6) { speed *= 0.96; }
        return speed;
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
        // Cameras, lights and audio-only layers have no effect parade, and
        // removeLegacyBridge() walks every layer in the composition.
        var effects = layer ? layer.property("ADBE Effect Parade") : null;
        if (!effects) { return null; }
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

    // Safe for genuinely populated groups such as a Range Selector's children.
    // NOT usable as an existence test on "ADBE Text Animator Properties": see
    // the note in updateTypeOn().
    function findPropertyByMatchName(group, matchName) {
        var index;
        for (index = 1; index <= group.numProperties; index += 1) {
            if (group.property(index).matchName === matchName) { return group.property(index); }
        }
        return null;
    }

    function updateTypeOn(layer, plan, time) {
        // addProperty() invalidates every Property handle obtained before it,
        // so the animator group is reacquired from the text property each time
        // rather than being held across a mutation.
        function typeOnAnimator() {
            return findNamedProperty(
                layer.property("ADBE Text Properties").property("ADBE Text Animators"),
                "Island Chatter Type-On");
        }
        var animator = typeOnAnimator();
        if (!animator) {
            animator = layer.property("ADBE Text Properties")
                .property("ADBE Text Animators").addProperty("ADBE Text Animator");
            animator.name = "Island Chatter Type-On";
            animator = typeOnAnimator();
        }
        // "ADBE Text Animator Properties" always reports all 103 animator
        // properties as children, whether or not they have been added, and
        // canAddProperty() returns true either way. Nothing distinguishes an
        // added property from a placeholder, and writing to a placeholder fails
        // with "the property or a parent property is hidden". addProperty() is
        // idempotent here, so add unconditionally instead of testing first.
        // Verified against After Effects 26.0: numProperties stays 103 and no
        // duplicate Opacity appears.
        animator.property("ADBE Text Animator Properties").addProperty("ADBE Text Opacity");
        animator = typeOnAnimator();

        // The Selectors group, unlike Properties, really is empty until a
        // selector is added, so it can be tested honestly.
        if (!findNamedProperty(animator.property("ADBE Text Selectors"), "Island Chatter Reveal")) {
            var created = animator.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
            created.name = "Island Chatter Reveal";
            animator = typeOnAnimator();
        }
        var opacity = findPropertyByMatchName(
            animator.property("ADBE Text Animator Properties"), "ADBE Text Opacity");
        var selector = findNamedProperty(
            animator.property("ADBE Text Selectors"), "Island Chatter Reveal");
        if (!opacity || !selector) {
            throw new Error("Type-On could not build its text animator on this layer." +
                "\n無法在此圖層建立 Type-On 文字動畫器。");
        }
        // A Range Selector carries both percentage and index controls; only the
        // pair matching its Units setting is writable.
        var start = findPropertyByMatchName(selector, "ADBE Text Percent Start");
        var end = findPropertyByMatchName(selector, "ADBE Text Percent End");
        if (!start || !end) {
            throw new Error("The Type-On range selector has no percentage controls." +
                "\nType-On 的範圍選取器找不到百分比控制項。");
        }
        // Keyed properties reject setValue(); the user may have animated either
        // of these after a previous Apply.
        try {
            setPropertyValue(opacity, 0, time);
            setPropertyValue(end, 100, time);
        } catch (hidden) {
            throw new Error("Set the Island Chatter Reveal selector's Advanced > Units back to" +
                " Percentage, then apply again.\n請把 Island Chatter Reveal 選取器的" +
                " Advanced > Units 改回 Percentage 後再套用一次。\n(" + hidden.toString() + ")");
        }
        clearKeys(start);
        setHoldKey(start, layer.inPoint, 0);
        var index;
        for (index = 0; index < plan.events.length; index += 1) {
            // Named separately: a plain `time` here would shadow this function's
            // own time parameter.
            var revealTime = layer.inPoint + plan.events[index].time +
                plan.events[index].duration * 0.55;
            setHoldKey(start, revealTime, (index + 1) / plan.events.length * 100);
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
            // Both the match name and the panel's own name must agree before a
            // whole layer is deleted; findEffect() alone would match any Layer
            // Control the user happens to have.
            var sourceControl = findNamedEffect(candidate, OLD_SOURCE_CONTROL_NAME);
            if (sourceControl && sourceControl.matchName === "ADBE Layer Control" &&
                    sourceControl.property(1).value === textLayer.index &&
                    findNativeEffect(candidate)) {
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

    // Only a Tone this panel created and named is treated as the bootstrap. A
    // Tone the user added for their own sound must not be renamed, stripped of
    // its Level keyframes and silenced.
    function findToneBootstrap(layer) {
        var effects = layer ? layer.property("ADBE Effect Parade") : null;
        if (!effects) { return null; }
        var index;
        for (index = 1; index <= effects.numProperties; index += 1) {
            var effect = effects.property(index);
            if (effect.matchName === TONE_MATCH_NAME && effect.name === TONE_DISPLAY_NAME) {
                return effect;
            }
        }
        return null;
    }

    function ensureToneBootstrap(layer) {
        var tone = findToneBootstrap(layer);
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
        // The layer's own Source Text is what gets spoken, so the 64-unit limit
        // has to be measured against that and not against the panel's text box.
        var truncated = spokenText.length > MAX_TEXT_UNITS ? textLayer.name : "";

        removeLegacyBridge(comp, textLayer);
        ensureToneBootstrap(textLayer);
        var effect = findNativeEffect(textLayer);
        if (!effect) { effect = addNativeEffect(textLayer); }
        effect.name = trim(pronunciation) ? DISPLAY_NAME + " [Override]" : DISPLAY_NAME;

        // addProperty() invalidates previously obtained Property references in
        // AE scripting. Reacquire both effects before inspecting their order.
        var tone = findToneBootstrap(textLayer);
        effect = findNativeEffect(textLayer);
        if (tone.propertyIndex > effect.propertyIndex) {
            tone.moveTo(effect.propertyIndex);
            // moveTo() invalidates the references again.
            effect = findNativeEffect(textLayer);
        }
        setEffectParameters(effect, spokenText, settings, comp.time);

        var plan = estimateSpeech(text, effectiveSpeed(settings));
        if (options.fitDuration) {
            textLayer.outPoint = Math.min(comp.duration,
                Math.max(textLayer.inPoint + comp.frameDuration, textLayer.inPoint + plan.duration));
        }
        if (options.markers) { updateTimingMarkers(textLayer, plan); }
        if (options.controllers) { updateAnimationControls(textLayer, plan); }
        if (options.typeOn) { updateTypeOn(textLayer, plan, comp.time); }
        return truncated;
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
        var truncated = [];
        for (index = 0; index < layers.length; index += 1) {
            // One pronunciation override cannot safely describe several
            // different selected layers, so batch mode uses each Source Text.
            var layerPronunciation = layers.length === 1 ? pronunciation : "";
            var overflowed = applyToTextLayer(
                comp, layers[index], layerPronunciation, settings, options);
            if (overflowed) { truncated.push(overflowed); }
            layers[index].selected = true;
        }
        return { count: layers.length, truncated: truncated };
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
        // Ranges match the effect parameters in plugin/IslandChatterNative.cpp.
        var pitch = addSlider(panel, "Pitch / 音高", 0.10, 4.00, 1.00);
        var speed = addSlider(panel, "Speed / 速度", 0.10, 10.00, 1.00);
        var volume = addSlider(panel, "Volume / 音量", 0.00, 2.00, 0.78);
        var consonant = addSlider(panel, "Consonant / 聲母", 0.00, 6.00, 1.25);
        var clarity = addSlider(panel, "Clarity / 清晰度", 0.00, 1.00, 0.78);
        var cuteness = addSlider(panel, "Cuteness / 可愛度", 0.00, 1.00, 0.55);
        var seed = addSlider(panel, "Seed / 種子", 0, 999999, 0);

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
            var comp = app.project ? app.project.activeItem : null;
            var hasSelection = comp && comp instanceof CompItem && selectedTextLayers(comp).length > 0;
            // The text box only creates a layer when nothing is selected;
            // otherwise each layer's own Source Text is authoritative.
            if (!text && !hasSelection) {
                alert("Select a text layer or enter text first. / 請選取文字圖層或先輸入文字。");
                return;
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
                status.text = "Applied to " + applied.count + " layer(s) / 已套用 " +
                    applied.count + " 個圖層";
                if (applied.truncated.length) {
                    status.text = "Truncated / 已截斷: " + applied.truncated.join(", ");
                    alert("Only the first " + MAX_TEXT_UNITS +
                        " UTF-16 units are spoken; the rest of the Source Text was cut:\n" +
                        "只會唸出前 " + MAX_TEXT_UNITS + " 個 UTF-16 字元，超出的 Source Text 已截斷：\n\n" +
                        applied.truncated.join("\n"));
                }
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

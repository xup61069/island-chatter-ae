#target aftereffects
#targetengine "islandChatterNativePanel"
#include "IslandChatterMandarinReadings.jsxinc"

/*
 * Island Chatter Native helper panel
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
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
    var PARAM_TEMPO_LOCK = 76;
    // One syllable slot in seconds before Speed is applied, matching
    // kSyllableStride in native/src/dsp.cpp. Speed for a tempo is therefore
    // BPM * syllablesPerBeat / (60 / kSyllableStride) = BPM * perBeat / 300.
    var SYLLABLE_STRIDE = 0.200;

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
        setPropertyValue(effect.property(PARAM_TEMPO_LOCK), settings.tempoLock ? 1 : 0, time);
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

    // The inverse of setEffectParameters(): what the layer is actually set to,
    // which is not necessarily what the panel is showing.
    function settingsFromEffect(effect) {
        return {
            voice: Math.round(effect.property(PARAM_VOICE).value) - 1,
            pitch: effect.property(PARAM_PITCH).value,
            speed: effect.property(PARAM_SPEED).value,
            volume: effect.property(PARAM_VOLUME).value / 100,
            consonant: effect.property(PARAM_CONSONANT).value,
            emotion: Math.round(effect.property(PARAM_EMOTION).value) - 1,
            characterSize: Math.round(effect.property(PARAM_CHARACTER_SIZE).value) - 1,
            clarity: effect.property(PARAM_CLARITY).value / 100,
            cuteness: effect.property(PARAM_CUTENESS).value / 100,
            seed: Math.round(effect.property(PARAM_SEED).value),
            tempoLock: Math.round(effect.property(PARAM_TEMPO_LOCK).value) !== 0
        };
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

    function estimateSpeech(text, speed, tempoLock) {
        var units = buildSpeechUnits(text);
        var cursor = 0;
        var events = [];
        var index;
        // Must match kMinimumSpeed / kMaximumSpeed in native/src/dsp.cpp.
        speed = clamp(speed, MIN_SPEED, MAX_SPEED);
        for (index = 0; index < units.length; index += 1) {
            var unit = units[index];
            if (unit.pause > 0) {
                // Mirrors the tempo-lock rest quantisation in build_events().
                var pause = tempoLock
                    ? Math.round(unit.pause / SYLLABLE_STRIDE) * SYLLABLE_STRIDE
                    : unit.pause;
                cursor += pause / speed;
                continue;
            }
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
    // apply_character_style() in native/src/dsp.cpp scales Speed again by
    // emotion and character size before anything is timed. Every calculation
    // that has to agree with the audio must go through this.
    function styleSpeedMultiplier(emotion, characterSize) {
        var factor = 1.0;
        if (characterSize === 0) { factor *= 1.08; }
        else if (characterSize === 1) { factor *= 1.04; }
        else if (characterSize === 3) { factor *= 0.91; }
        if (emotion === 1) { factor *= 1.08; }
        else if (emotion === 2) { factor *= 1.12; }
        else if (emotion === 3) { factor *= 1.14; }
        else if (emotion === 5) { factor *= 0.78; }
        else if (emotion === 6) { factor *= 0.96; }
        return factor;
    }

    function effectiveSpeed(settings) {
        return settings.speed *
            styleSpeedMultiplier(settings.emotion, settings.characterSize);
    }

    // Speed that puts one syllable on each beat subdivision.
    //
    // The tempo fixes the *effective* speed, but the slider holds the value
    // before the style multiplier, so it has to be divided back out. Without
    // this the tempo drifts with the character: Sleepy ran 28% slow and
    // Scared with a Tiny character 19% fast, while Neutral/Adult looked exact
    // because both of their multipliers are 1.
    function speedForTempo(bpm, syllablesPerBeat, emotion, characterSize) {
        var target = clamp(bpm, 20, 400) * syllablesPerBeat * SYLLABLE_STRIDE / 60.0;
        return target / styleSpeedMultiplier(emotion, characterSize);
    }

    // The inverse, used when reading a tempo-locked layer back into the panel so
    // the BPM field reproduces the Speed the layer already has.
    function tempoForSpeed(speed, syllablesPerBeat, emotion, characterSize) {
        return speed * styleSpeedMultiplier(emotion, characterSize) * 60.0 /
            (SYLLABLE_STRIDE * syllablesPerBeat);
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

    /*
     * Easing curves for the recentring glide.
     *
     * After Effects describes a keyframe by the ease arriving at it and the ease
     * leaving it, and influence is what bends the curve: a high influence on the
     * incoming side decelerates into the key, a low one arrives at full speed.
     * So "fast to slow" is a low outgoing influence paired with a high incoming
     * one, which is the opposite of a symmetric ease and is why the first
     * version, using the same value on both sides, read as slow-fast-slow.
     *
     * Influence is clamped by the host to 0.1 - 100; 0.1 is as close to linear
     * as a Bezier key gets.
     */
    // After Effects clamps influence to this range; the low end is as close to
    // linear as a Bezier key gets.
    var MIN_INFLUENCE = 0.1;
    var MAX_INFLUENCE = 100;
    // Only the outgoing side is exposed. The incoming side is pinned to full
    // influence so motion always settles rather than arriving at speed, which
    // is the shape this effect wants and leaves one number to think about.
    var ARRIVE_INFLUENCE = 100;
    var DEFAULT_LEAVE_INFLUENCE = 0.1;

    function typeOnCurve(leaveInfluence) {
        return {
            outInfluence: clamp(
                leaveInfluence === undefined ? DEFAULT_LEAVE_INFLUENCE : leaveInfluence,
                MIN_INFLUENCE, MAX_INFLUENCE),
            inInfluence: ARRIVE_INFLUENCE
        };
    }

    // Smooth keyframe, used for the recentring glide. Hold keys would make the
    // text jump sideways on every character.
    function setEasedKey(property, time, value, curve) {
        property.setValueAtTime(time, value);
        curve = curve || typeOnCurve();
        try {
            var index = property.nearestKeyIndex(time);
            property.setInterpolationTypeAtKey(index,
                KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            // Two traps here, both of which fail silently inside this catch and
            // leave keys that look eased but carry no ease at all:
            //
            // Reading property.value on a text animator's Position throws
            // "invalid numeric result (divide by zero?)", so the dimension count
            // has to come from the value being written instead.
            //
            // And a spatial property -- which Position is, ThreeD_SPATIAL --
            // takes exactly one temporal ease, not one per dimension. Passing
            // three gives "Value array does not have 1 elements".
            var dimensions = property.isSpatial
                ? 1
                : ((value && value.length) ? value.length : 1);
            var incoming = [];
            var outgoing = [];
            var at;
            for (at = 0; at < dimensions; at += 1) {
                incoming.push(new KeyframeEase(0, curve.inInfluence));
                outgoing.push(new KeyframeEase(0, curve.outInfluence));
            }
            property.setTemporalEaseAtKey(index, incoming, outgoing);
        } catch (error) {
            // Older hosts may reject the ease; the motion still lands correctly.
        }
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

    // How softly each character crosses the selector edge. This only does
    // anything because the reveal keyframes interpolate: with the hold keys used
    // before, the edge jumped instantly and there was nothing to soften.
    var DEFAULT_SMOOTHNESS = 40;

    function setRevealSmoothness(selector, amount, time) {
        if (!selector) { return; }
        var advanced = findPropertyByMatchName(selector, "ADBE Text Range Advanced");
        if (!advanced) { return; }
        var smoothness = findPropertyByMatchName(advanced, "ADBE Text Selector Smoothness");
        if (!smoothness) { smoothness = findNamedProperty(advanced, "Smoothness"); }
        if (!smoothness) { return; }
        try {
            setPropertyValue(smoothness, clamp(amount, 0, 100), time);
        } catch (ignored) {
            // Older hosts may not expose it; the reveal still works.
        }
    }

    /*
     * Keeping the reveal centred.
     *
     * Type-On hides characters with an opacity animator, which does not reflow
     * the text: the full block stays laid out and the visible run grows out of
     * its left edge. On a centre-justified layer that reads as the text sliding
     * right rather than typing in place.
     *
     * Re-flowing would mean keyframing Source Text, which is off limits -- the
     * panel reads Source Text back as the authority on what to speak, and a
     * partial value would be written into the effect on the next Apply.
     *
     * Instead the width of each partial string is measured once, at Apply time,
     * and a second animator shifts every glyph right by half the missing width.
     * At the end the offset is zero, so the final frame is exactly the layout
     * After Effects would have produced anyway.
     */
    var CENTER_ANIMATOR_NAME = "Island Chatter Center";

    // Measured on a throwaway text layer built from the same TextDocument, so
    // the real Source Text is never written to and the real layer's effects are
    // not duplicated along with it.
    function measureRevealWidths(comp, layer, counts) {
        var source = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
        var full = String(source.text);
        var probe = comp.layers.addText(source);
        var widths = [];
        try {
            var document = probe.property("ADBE Text Properties").property("ADBE Text Document");
            // sourceRectAtTime returns an empty rect outside the layer's own
            // span, so measure somewhere the probe is definitely live.
            var at = probe.inPoint + Math.min(0.1, (probe.outPoint - probe.inPoint) / 2);
            var index;
            for (index = 0; index < counts.length; index += 1) {
                var value = document.value;
                value.text = full.substring(0, counts[index]);
                document.setValue(value);
                widths.push(probe.sourceRectAtTime(at, false).width);
            }
        } finally {
            try { probe.remove(); } catch (removeError) { /* already gone */ }
        }
        return widths;
    }

    function updateTypeOnCentering(comp, layer, plan, curve) {
        var text = textFromLayer(layer);
        var total = text.length;
        var steps = plan.events.length;
        if (total < 2 || steps < 1) { return; }

        // The range selector works in percent of characters, so each reveal step
        // exposes this many of them.
        var counts = [];
        var index;
        for (index = 0; index < steps; index += 1) {
            counts.push(Math.round((index + 1) / steps * total));
        }
        counts.push(total);
        var widths = measureRevealWidths(comp, layer, counts);
        var full = widths[widths.length - 1];
        // A zero width means the measurement did not work on this host; leaving
        // the offset alone is better than shifting the text by a wrong amount.
        if (!full) { return; }

        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        var animator = findNamedProperty(animators, CENTER_ANIMATOR_NAME);
        if (!animator) {
            animators.addProperty("ADBE Text Animator").name = CENTER_ANIMATOR_NAME;
            animator = findNamedProperty(
                layer.property("ADBE Text Properties").property("ADBE Text Animators"),
                CENTER_ANIMATOR_NAME);
        }
        // Adding is unconditional: every animator property is always listed as a
        // child whether or not it exists, so presence cannot be tested.
        animator.property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D");
        animator = findNamedProperty(
            layer.property("ADBE Text Properties").property("ADBE Text Animators"),
            CENTER_ANIMATOR_NAME);
        var offset = findPropertyByMatchName(
            animator.property("ADBE Text Animator Properties"), "ADBE Text Position 3D");
        if (!offset) { return; }

        clearKeys(offset);
        // Half the width still to come, so the visible run stays over the anchor.
        setEasedKey(offset, layer.inPoint, [(full - widths[0]) / 2, 0, 0], curve);
        for (index = 0; index < steps; index += 1) {
            var at = layer.inPoint + plan.events[index].time +
                plan.events[index].duration * 0.55;
            setEasedKey(offset, at, [(full - widths[index]) / 2, 0, 0], curve);
        }
    }

    function updateTypeOn(layer, plan, time, curve, smoothness) {
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
        setRevealSmoothness(
            findNamedProperty(animator.property("ADBE Text Selectors"), "Island Chatter Reveal"),
            smoothness === undefined ? DEFAULT_SMOOTHNESS : smoothness, time);
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
        setEasedKey(start, layer.inPoint, 0, curve);
        var index;
        for (index = 0; index < plan.events.length; index += 1) {
            // Named separately: a plain `time` here would shadow this function's
            // own time parameter.
            var revealTime = layer.inPoint + plan.events[index].time +
                plan.events[index].duration * 0.55;
            setEasedKey(start, revealTime, (index + 1) / plan.events.length * 100, curve);
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

        var plan = estimateSpeech(text, effectiveSpeed(settings), settings.tempoLock);
        if (options.fitDuration) {
            textLayer.outPoint = Math.min(comp.duration,
                Math.max(textLayer.inPoint + comp.frameDuration, textLayer.inPoint + plan.duration));
        }
        if (options.markers) { updateTimingMarkers(textLayer, plan); }
        if (options.controllers) { updateAnimationControls(textLayer, plan); }
        if (options.typeOn) {
            updateTypeOn(textLayer, plan, comp.time,
                typeOnCurve(options.typeOnLeave), options.typeOnSmoothness);
            if (options.typeOnCenter) {
                updateTypeOnCentering(comp, textLayer, plan,
                    typeOnCurve(options.typeOnLeave));
            }
        }
        return truncated;
    }

    // Everything the panel adds to a layer, so it can be taken off again in one
    // step instead of hunting through the effect stack.
    function removeFromLayer(layer) {
        var removed = 0;
        var names = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce", "IC Blink"];
        var effects = layer.property("ADBE Effect Parade");
        var index;
        // Downward: removing an effect renumbers everything above it.
        for (index = effects.numProperties; index >= 1; index -= 1) {
            var effect = effects.property(index);
            var mine = effect.matchName === EFFECT_NAME ||
                (effect.matchName === TONE_MATCH_NAME && effect.name === TONE_DISPLAY_NAME);
            var slot;
            for (slot = 0; slot < names.length; slot += 1) {
                if (effect.name === names[slot]) { mine = true; }
            }
            if (mine) { effect.remove(); removed += 1; }
        }
        var markers = layer.property("ADBE Marker");
        for (index = markers.numKeys; index >= 1; index -= 1) {
            if (String(markers.keyValue(index).comment).indexOf("IC:") === 0) {
                markers.removeKey(index);
                removed += 1;
            }
        }
        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        for (index = animators.numProperties; index >= 1; index -= 1) {
            var animatorName = animators.property(index).name;
            if (animatorName === "Island Chatter Type-On" ||
                    animatorName === CENTER_ANIMATOR_NAME) {
                animators.property(index).remove();
                removed += 1;
            }
        }
        return removed;
    }

    /*
     * Bake: write the voice to a WAV and bring it back as an audio layer, so
     * playback costs nothing and the project still plays for someone without
     * the plug-in.
     *
     * This does not use the After Effects render queue. Driving the queue meant
     * output-module templates that differ per install, muting every other layer,
     * moving the work area, and a blocking render window. island_chatter_bake
     * runs the same synthesis engine as the effect and writes the file directly,
     * so a bake is a few hundred milliseconds and touches nothing else in the
     * project.
     */
    var BAKE_FOLDER_NAME = "Island Chatter Audio";

    function bakeToolFile() {
        // Ships beside the .aex: Support Files/Plug-ins/Island Chatter/.
        var panelFile = new File($.fileName);
        var supportFiles = panelFile.parent.parent.parent;
        var tool = new File(supportFiles.fsName +
            "/Plug-ins/Island Chatter/island_chatter_bake.exe");
        return tool.exists ? tool : null;
    }

    // UTF-8 bytes as hex, so the text survives the command line whatever the
    // console code page is.
    function hexUtf8(text) {
        var hex = "";
        var index = 0;
        while (index < text.length) {
            var code = codePointAt(text, index);
            index += code > 0xFFFF ? 2 : 1;
            var bytes = [];
            if (code <= 0x7F) { bytes = [code]; }
            else if (code <= 0x7FF) { bytes = [0xC0 | (code >> 6), 0x80 | (code & 0x3F)]; }
            else if (code <= 0xFFFF) {
                bytes = [0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)];
            } else {
                bytes = [0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F),
                    0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)];
            }
            var at;
            for (at = 0; at < bytes.length; at += 1) {
                var pair = bytes[at].toString(16);
                hex += pair.length < 2 ? "0" + pair : pair;
            }
        }
        return hex;
    }

    // Beside the .aep, so baked audio travels with the project.
    function bakeFolder() {
        if (!app.project.file) {
            throw new Error("Save the project first so the audio can go beside it." +
                "\n請先儲存專案，音訊才能存在專案旁邊。");
        }
        var folder = new Folder(app.project.file.parent.fsName + "/" + BAKE_FOLDER_NAME);
        if (!folder.exists && !folder.create()) {
            throw new Error("Could not create " + folder.fsName +
                "\n無法建立資料夾：" + folder.fsName);
        }
        return folder;
    }

    function quoted(value) {
        return '"' + String(value) + '"';
    }

    // A text layer's name is its own text, so it can be a whole sentence with
    // punctuation. Keep the file name readable but short and legal on Windows.
    function bakeFileName(layer) {
        var name = String(layer.name)
            .replace(/[\\\/:*?"<>|]/g, "")
            .replace(/[\r\n\t]+/g, " ");
        name = trim(name);
        if (name.length > 40) { name = name.substring(0, 40); }
        name = trim(name);
        // Trailing dots and spaces are not addressable on Windows.
        name = name.replace(/[. ]+$/, "");
        return name ? name : ("Layer " + layer.index);
    }

    // Reads the values actually written to the layer, so a bake always matches
    // what the effect is playing rather than whatever the panel happens to show.
    function bakeLayer(layer, folder) {
        var tool = bakeToolFile();
        if (!tool) {
            throw new Error("island_chatter_bake.exe is missing. Reinstall Island Chatter." +
                "\n找不到 island_chatter_bake.exe，請重新安裝 Island Chatter。");
        }
        var effect = findNativeEffect(layer);
        if (!effect) {
            throw new Error("Apply Island Chatter to this layer first. / 請先對此圖層按 Apply。");
        }
        var target = new File(folder.fsName + "/" + bakeFileName(layer) + ".wav");
        if (target.exists) { target.remove(); }

        // The path goes over as hex UTF-8 for the same reason the text does:
        // system.callSystem() hands the command line to the console code page,
        // which turns anything it cannot represent into "?" before the tool
        // sees it. A Chinese layer name or project folder would fail outright.
        var command = quoted(tool.fsName) +
            " --out-hex " + hexUtf8(target.fsName) +
            " --text " + hexUtf8(textFromEffect(effect)) +
            " --voice " + (Math.round(effect.property(PARAM_VOICE).value) - 1) +
            " --emotion " + (Math.round(effect.property(PARAM_EMOTION).value) - 1) +
            " --size " + (Math.round(effect.property(PARAM_CHARACTER_SIZE).value) - 1) +
            " --seed " + Math.round(effect.property(PARAM_SEED).value) +
            " --rate 48000" +
            " --pitch " + effect.property(PARAM_PITCH).value +
            " --speed " + effect.property(PARAM_SPEED).value +
            " --volume " + (effect.property(PARAM_VOLUME).value / 100) +
            " --consonant " + effect.property(PARAM_CONSONANT).value +
            " --clarity " + (effect.property(PARAM_CLARITY).value / 100) +
            " --cuteness " + (effect.property(PARAM_CUTENESS).value / 100) +
            " --tempo-lock " + (Math.round(effect.property(PARAM_TEMPO_LOCK).value) ? 1 : 0);

        var reply = system.callSystem(command);
        if (String(reply).indexOf("OK ") !== 0 || !target.exists) {
            throw new Error("Bake failed for " + layer.name + "\n轉檔失敗：" + layer.name +
                "\n\n" + target.fsName + "\n" + reply);
        }
        return target;
    }

    function bakeToLayer(comp, layer, folder) {
        var file = bakeLayer(layer, folder);
        var imported = app.project.importFile(new ImportOptions(file));
        imported.name = layer.name + " (baked)";
        var audioLayer = comp.layers.add(imported);
        audioLayer.startTime = layer.inPoint;
        audioLayer.name = layer.name + " (baked)";
        audioLayer.moveAfter(layer);
        // Silence the live effect so the voice is not heard twice. It is left in
        // place so Apply still works and the bake can be redone.
        var effect = findNativeEffect(layer);
        if (effect) { effect.enabled = false; }
        var tone = findToneBootstrap(layer);
        if (tone) { tone.enabled = false; }
        return file;
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
        var selectedButton = panel.add("button", undefined,
            "Read selected layer / 讀取選取圖層");
        selectedButton.helpTip = "Load the layer's text and, if Island Chatter is already on" +
            " it, every voice setting back into this panel." +
            "\n把圖層的文字讀進來；若已套用過 Island Chatter，連語音設定一起讀回面板。";
        selectedButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            var layer = comp && comp instanceof CompItem ? selectedTextLayer(comp) : null;
            if (!layer) {
                alert("Select a text layer. / 請選取文字圖層。");
                return;
            }
            textInput.text = textFromLayer(layer);
            var effect = findNativeEffect(layer);
            if (!effect) {
                status.text = "Read text only / 只讀到文字（此圖層尚未套用）";
                return;
            }
            applySettingsToUI(settingsFromEffect(effect));
            status.text = "Read settings from / 已讀取設定：" + layer.name;
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

        // Tempo. Speed stays the underlying control; these just drive it.
        var tempoRow = panel.add("group");
        tempoRow.orientation = "row";
        var tempoOn = tempoRow.add("checkbox", undefined, "Tempo / 節拍");
        tempoOn.helpTip = "Derive Speed from a tempo instead of setting it by hand." +
            "\n用節拍速度推算語速，取代手動設定。";
        tempoRow.add("statictext", undefined, "BPM");
        var bpmField = tempoRow.add("edittext", undefined, "120");
        bpmField.characters = 5;
        var perBeat = tempoRow.add("dropdownlist", undefined,
            ["1 / beat", "2 / beat", "3 / beat", "4 / beat"]);
        perBeat.selection = 1;
        var perBeatValues = [1, 2, 3, 4];
        var tempoReadout = panel.add("statictext", undefined, "");
        tempoReadout.alignment = ["fill", "top"];

        // refreshTempo() writes the Speed slider itself. Guard against that write
        // being mistaken for the user dragging it, which would switch tempo mode
        // straight back off.
        var writingSpeed = false;

        function currentSyllablesPerBeat() {
            return perBeatValues[perBeat.selection ? perBeat.selection.index : 1];
        }
        function refreshTempo() {
            if (!tempoOn.value) {
                tempoReadout.text = "Speed set manually / 語速為手動設定";
                return;
            }
            var bpm = parseFloat(bpmField.text);
            if (isNaN(bpm)) { bpm = 120; bpmField.text = "120"; }
            var emotionIndex = emotion.selection ? emotion.selection.index : 0;
            var sizeIndex = characterSize.selection ? characterSize.selection.index : 2;
            var derived = speedForTempo(bpm, currentSyllablesPerBeat(), emotionIndex, sizeIndex);
            writingSpeed = true;
            setSliderValue(speed, clamp(derived, 0.10, 10.00));
            writingSpeed = false;
            var perSyllable = 60.0 / clamp(bpm, 20, 400) / currentSyllablesPerBeat();
            var style = styleSpeedMultiplier(emotionIndex, sizeIndex);
            tempoReadout.text = perSyllable.toFixed(3) + " s / 字   Speed " + derived.toFixed(3) +
                (valuesDiffer(style, 1.0) ? "  (x" + style.toFixed(2) + " 角色補償)" : "") +
                (derived > 10.0 || derived < 0.10 ? "   OUT OF RANGE / 超出範圍" : "");
        }
        // Loads a layer's stored settings back into the controls. A tempo-locked
        // layer only stores the resulting Speed, so the BPM is derived back from
        // it against the subdivision currently selected; feeding that BPM through
        // speedForTempo() returns the same Speed, so the round trip is stable.
        function applySettingsToUI(loaded) {
            voice.selection = loaded.voice;
            emotion.selection = loaded.emotion;
            characterSize.selection = loaded.characterSize;
            setSliderValue(pitch, clamp(loaded.pitch, 0.10, 4.00));
            setSliderValue(volume, clamp(loaded.volume, 0.00, 2.00));
            setSliderValue(consonant, clamp(loaded.consonant, 0.00, 6.00));
            setSliderValue(clarity, clamp(loaded.clarity, 0.00, 1.00));
            setSliderValue(cuteness, clamp(loaded.cuteness, 0.00, 1.00));
            setSliderValue(seed, clamp(loaded.seed, 0, 999999));
            preset.selection = 0;
            tempoOn.value = loaded.tempoLock;
            if (loaded.tempoLock) {
                var bpm = tempoForSpeed(loaded.speed, currentSyllablesPerBeat(),
                    loaded.emotion, loaded.characterSize);
                bpmField.text = String(Math.round(bpm * 100) / 100);
            }
            writingSpeed = true;
            setSliderValue(speed, clamp(loaded.speed, 0.10, 10.00));
            writingSpeed = false;
            refreshTempo();
        }

        tempoOn.onClick = refreshTempo;
        bpmField.onChange = refreshTempo;
        perBeat.onChange = refreshTempo;
        // Emotion and character size change the engine's speed multiplier, so
        // the derived Speed has to be recomputed when either of them moves.
        emotion.onChange = refreshTempo;
        characterSize.onChange = refreshTempo;
        speed.onChanging = function () {
            // Dragging Speed by hand means the tempo is no longer driving it.
            if (!writingSpeed && tempoOn.value) { tempoOn.value = false; refreshTempo(); }
            if (speed.valueField) { speed.valueField.text = speed.value.toFixed(2); }
        };
        refreshTempo();

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
            // A preset carries an emotion and a size, both of which move the
            // engine's speed multiplier, so a live tempo has to be recomputed.
            refreshTempo();
        }
        preset.onChange = function () {
            var at = preset.selection ? preset.selection.index : 0;
            if (at < builtInPresets.length) { applyPreset(builtInPresets[at]); return; }
            var saved = savedPresets[at - builtInPresets.length];
            if (saved) { applyPreset(saved.values); }
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
            refreshTempo();
        };
        // Saved characters live in one settings string as "name=v,v,v|name=...".
        // Previously there was a single unnamed slot, and its Load button was
        // only built when the panel opened, so a character saved during a
        // session stayed invisible until the panel was closed and reopened.
        function readSavedPresets() {
            var saved = [];
            if (!app.settings.haveSetting("IslandChatter", "characterPreset")) { return saved; }
            var raw = app.settings.getSetting("IslandChatter", "characterPreset");
            var chunks = raw.split("|");
            var index;
            for (index = 0; index < chunks.length; index += 1) {
                if (!chunks[index]) { continue; }
                var split = chunks[index].indexOf("=");
                // A 1.0.2 setting is a bare comma list with no name.
                var name = split < 0 ? "Saved / 已儲存" : chunks[index].substring(0, split);
                var body = split < 0 ? chunks[index] : chunks[index].substring(split + 1);
                var parts = body.split(",");
                var values = [];
                var part;
                for (part = 0; part < parts.length; part += 1) { values.push(parseFloat(parts[part])); }
                if (values.length >= 8) { saved.push({ name: name, values: values }); }
            }
            return saved;
        }

        function writeSavedPresets(saved) {
            var chunks = [];
            var index;
            for (index = 0; index < saved.length; index += 1) {
                chunks.push(saved[index].name + "=" + saved[index].values.join(","));
            }
            app.settings.saveSetting("IslandChatter", "characterPreset", chunks.join("|"));
        }

        function refreshPresetList() {
            var wanted = ["Custom / 自訂", "Mimi / 咪咪", "Captain / 隊長",
                "Grandma / 奶奶", "Robot / 機器人"];
            var saved = readSavedPresets();
            var index;
            for (index = 0; index < saved.length; index += 1) { wanted.push(saved[index].name); }
            while (preset.items.length > 0) { preset.remove(preset.items[preset.items.length - 1]); }
            for (index = 0; index < wanted.length; index += 1) { preset.add("item", wanted[index]); }
            preset.selection = 0;
            return saved;
        }

        var savedPresets = refreshPresetList();
        saveButton.onClick = function () {
            var name = prompt("Name this character / 幫這個角色取個名字",
                "Character " + (savedPresets.length + 1));
            if (!name) { return; }
            name = trim(name).replace(/[|=,]/g, " ");
            if (!name) { return; }
            var values = [voice.selection.index, emotion.selection.index, characterSize.selection.index,
                pitch.value, speed.value, clarity.value, cuteness.value, Math.round(seed.value)];
            var index;
            var replaced = false;
            for (index = 0; index < savedPresets.length; index += 1) {
                if (savedPresets[index].name === name) {
                    savedPresets[index].values = values;
                    replaced = true;
                }
            }
            if (!replaced) { savedPresets.push({ name: name, values: values }); }
            writeSavedPresets(savedPresets);
            savedPresets = refreshPresetList();
            status.text = "Saved / 已儲存: " + name;
        };
        var deleteButton = characterRow.add("button", undefined, "Delete / 刪除");
        deleteButton.onClick = function () {
            var at = (preset.selection ? preset.selection.index : 0) - builtInPresets.length;
            if (at < 0) {
                alert("Select a saved character first. / 請先選取自訂角色。");
                return;
            }
            savedPresets.splice(at, 1);
            writeSavedPresets(savedPresets);
            savedPresets = refreshPresetList();
        };
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
        var typeOnCenter = animationRow.add("checkbox", undefined, "Center / 維持置中");
        typeOnCenter.value = true;
        typeOnCenter.helpTip = "Keep the revealed text centred as it types on, gliding into" +
            " place instead of growing out of the left edge. For centre-justified text." +
            "\n讓已顯示的文字保持置中並平滑滑動，而不是從左邊長出來。適用於置中對齊的文字。";

        // One influence shapes both the reveal and the recentring glide; the
        // arriving side is always full, so motion settles rather than stopping
        // dead. Low leaves at full speed, which is the fast-to-slow default.
        var easeLeave = addSlider(panel, "Leave / 離開", MIN_INFLUENCE, MAX_INFLUENCE,
            DEFAULT_LEAVE_INFLUENCE);
        easeLeave.valueField.helpTip = easeLeave.helpTip =
            "How the reveal and the recentring leave each position. Low leaves at full" +
            " speed and settles slowly; high draws the whole move out." +
            "\n逐字顯示與置中滑動離開每個位置的方式。低值＝全速離開、慢慢停入；高值＝整段拉長。" +
            "\n產生的是一般關鍵影格，之後仍可在圖表編輯器裡自由調整。";
        var smoothness = addSlider(panel, "Smoothness / 平滑", 0, 100, DEFAULT_SMOOTHNESS);
        smoothness.valueField.helpTip = smoothness.helpTip =
            "How softly each character crosses the reveal edge. 0 makes characters pop," +
            " higher values fade them in." +
            "\n每個字跨過顯示邊界的柔和程度。0 是直接彈出，越高越像淡入。";

        var applyButton = panel.add("button", undefined,
            "Apply to selected text layers / 套用到選取文字圖層");
        applyButton.preferredSize.height = 34;

        var toolRow = panel.add("group");
        toolRow.orientation = "row";
        var bakeButton = toolRow.add("button", undefined, "Bake / 轉成音訊");
        bakeButton.helpTip = "Write the voice to " + BAKE_FOLDER_NAME + " beside the project" +
            " file and bring it back as an audio layer. No render queue, no dialogs." +
            "\n把語音寫進專案檔旁邊的「" + BAKE_FOLDER_NAME + "」資料夾並放回專案，不需要算圖佇列。";
        var removeButton = toolRow.add("button", undefined, "Remove / 移除");
        removeButton.helpTip = "Take Island Chatter off the selected layers: the effect, the" +
            " Tone bootstrap, the rig sliders, the IC: markers and the Type-On animator." +
            "\n把 Island Chatter 從選取圖層完全移除。";
        var status = panel.add("statictext", undefined, "Edit text, then apply / 修改文字後按套用");
        bakeButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            if (!(comp && comp instanceof CompItem)) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            var layers = selectedTextLayers(comp);
            if (!layers.length) {
                alert("Select a text layer. / 請選取文字圖層。");
                return;
            }
            var ready = [];
            var pick;
            for (pick = 0; pick < layers.length; pick += 1) {
                if (findNativeEffect(layers[pick])) { ready.push(layers[pick]); }
            }
            if (!ready.length) {
                alert("Apply Island Chatter first, then bake. / 請先按 Apply 再轉成音訊。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Bake");
            try {
                var folder = bakeFolder();
                var made = 0;
                var index;
                for (index = 0; index < ready.length; index += 1) {
                    bakeToLayer(comp, ready[index], folder);
                    made += 1;
                }
                status.text = "Baked / 已轉成音訊 " + made + " -> " + BAKE_FOLDER_NAME;
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };
        removeButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            if (!(comp && comp instanceof CompItem)) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            var layers = selectedTextLayers(comp);
            if (!layers.length) {
                alert("Select a text layer. / 請選取文字圖層。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Remove");
            try {
                var removed = 0;
                var index;
                for (index = 0; index < layers.length; index += 1) {
                    removed += removeFromLayer(layers[index]);
                }
                status.text = "Removed / 已移除 " + removed + " item(s) from " +
                    layers.length + " layer(s)";
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };
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
                    seed: seed.value,
                    // Locking the grid is only meaningful when a tempo drives Speed.
                    tempoLock: tempoOn.value
                }, {
                    markers: markers.value,
                    fitDuration: fitDuration.value,
                    controllers: controllers.value,
                    typeOn: typeOn.value,
                    typeOnCenter: typeOnCenter.value,
                    typeOnLeave: easeLeave.value,
                    typeOnSmoothness: smoothness.value
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

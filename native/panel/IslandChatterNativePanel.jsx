#target aftereffects
#targetengine "islandChatterNativePanel"

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
    // Units 0-63 live at PARAM_TEXT_FIRST, 64-127 in the block appended in
    // 1.3.0. The indices in between were already published and cannot move.
    var TEXT_UNITS_PER_BLOCK = 64;
    var MAX_TEXT_UNITS = TEXT_UNITS_PER_BLOCK * 2;
    // What the panel asks island_chatter_bake to work at, for both the timing
    // plan and Bake. Independent of the rate After Effects renders the effect
    // at: the plan is in seconds and the engine's timings scale with the rate.
    var ENGINE_SAMPLE_RATE = 48000;
    // Mirrors kMinimumSpeed / kMaximumSpeed in native/src/dsp.cpp.
    var PARAM_VOICE = 1;
    var PARAM_PITCH = 2;
    var PARAM_SPEED = 3;
    var PARAM_VOLUME = 4;
    var PARAM_CONSONANT = 5;
    var PARAM_TEXT_LENGTH = 6;
    var PARAM_TEXT_FIRST = 7;
    var PARAM_TEXT_SECOND_FIRST = 81;
    var PARAM_EMOTION = 71;
    var PARAM_CHARACTER_SIZE = 72;
    var PARAM_CLARITY = 73;
    var PARAM_CUTENESS = 74;
    var PARAM_SEED = 75;
    var PARAM_TEMPO_LOCK = 76;
    // Appended in 1.1.0. Defaults reproduce 1.0.x, so an older layer read back
    // into the panel keeps the voice it had.
    var PARAM_FORMANT = 77;
    var PARAM_SOURCE = 78;
    var PARAM_VIBRATO = 79;
    var PARAM_VIBRATO_RATE = 80;
    // Appended in 1.7.0, after the second text block. A melody length of zero
    // is what makes an older project keep speaking instead of trying to sing.
    var PARAM_MELODY_LENGTH = 145;
    var PARAM_MELODY_BPM = 146;
    var PARAM_MELODY_TRANSPOSE = 147;
    var PARAM_TONE_BLEND = 148;
    var PARAM_PORTAMENTO = 149;
    var PARAM_VIBRATO_DELAY = 150;
    var PARAM_MELODY_FIRST = 151;
    // One slot per note, holding pitch * 512 + ticks in the same 0-65535 range
    // a text unit uses. Mirrors kMelodySlots and kMelodySlotStride in
    // native/include/island_chatter/dsp.hpp.
    var MELODY_SLOTS = 64;
    var MELODY_SLOT_STRIDE = 512;
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

    // A settings object does not always carry every field: a rig comment holds
    // only the voice, and a preset written by an older version holds fewer
    // still. Writing undefined would land as zero, which for Tone Blend or
    // Vibrato Delay is a different sound rather than a missing one.
    function numberOr(value, fallback) {
        var number = Number(value);
        return (value === undefined || value === null || isNaN(number)) ? fallback : number;
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

    function textUnitProperty(effect, index) {
        return index < TEXT_UNITS_PER_BLOCK
            ? effect.property(PARAM_TEXT_FIRST + index)
            : effect.property(PARAM_TEXT_SECOND_FIRST + index - TEXT_UNITS_PER_BLOCK);
    }

    // The melody block starts at its own index, so nothing may reach a slot by
    // adding to some other base. Same rule, and same reason, as
    // textUnitProperty(): the arithmetic looks obvious and lands in the wrong
    // parameter.
    function melodySlotProperty(effect, index) {
        return effect.property(PARAM_MELODY_FIRST + index);
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
        setPropertyValue(effect.property(PARAM_FORMANT), settings.formant * 100, time);
        setPropertyValue(effect.property(PARAM_SOURCE), settings.source + 1, time);
        setPropertyValue(effect.property(PARAM_VIBRATO), settings.vibrato * 100, time);
        setPropertyValue(effect.property(PARAM_VIBRATO_RATE), settings.vibratoRate, time);
        setPropertyValue(effect.property(PARAM_TEXT_LENGTH), units, time);
        var index;
        for (index = 0; index < MAX_TEXT_UNITS; index += 1) {
            setPropertyValue(textUnitProperty(effect, index),
                index < units ? text.charCodeAt(index) : 0, time);
        }
        // Clamped to the parameter ranges, not merely defaulted. After Effects
        // refuses a setValue() outside a range with a modal dialog — "Value 4
        // out of range 0 to 2" — which aborts the whole Apply. The engine
        // clamps these again anyway, so the only thing lost is the dialog.
        setPropertyValue(effect.property(PARAM_MELODY_TRANSPOSE),
            clamp(Math.round(numberOr(settings.transpose, 0)), -48, 48), time);
        setPropertyValue(effect.property(PARAM_TONE_BLEND),
            clamp(numberOr(settings.toneBlend, 0.15) * 100, 0, 100), time);
        setPropertyValue(effect.property(PARAM_PORTAMENTO),
            clamp(numberOr(settings.portamento, 0.040) * 1000, 0, 200), time);
        setPropertyValue(effect.property(PARAM_VIBRATO_DELAY),
            clamp(numberOr(settings.vibratoDelay, 0.30), 0, 2), time);
        /*
         * A melody is not a panel setting.
         *
         * Everything above is: Apply repaints the layer with whatever the panel
         * is showing, which is the whole point of it. The melody is the other
         * kind of thing — it belongs to the line, like its text does, and the
         * panel has one only for as long as an import is in progress. So a
         * settings object that carries no melody at all leaves the layer's
         * alone, and pressing Apply on a line that is singing does not silently
         * turn it back into speech.
         *
         * An empty array is different from nothing: Import passes one for a
         * line it could find no notes for, and that does clear the layer.
         */
        if (settings.melody) {
            var notes = Math.min(settings.melody.length, MELODY_SLOTS);
            setPropertyValue(effect.property(PARAM_MELODY_LENGTH), notes, time);
            setPropertyValue(effect.property(PARAM_MELODY_BPM),
                clamp(numberOr(settings.melodyBpm, 120), 20, 400), time);
            for (index = 0; index < MELODY_SLOTS; index += 1) {
                setPropertyValue(melodySlotProperty(effect, index),
                    index < notes ? settings.melody[index] : 0, time);
            }
        }
    }

    function setEffectText(effect, text) {
        var units = Math.min(text.length, MAX_TEXT_UNITS);
        effect.property(PARAM_TEXT_LENGTH).setValue(units);
        var index;
        for (index = 0; index < MAX_TEXT_UNITS; index += 1) {
            textUnitProperty(effect, index).setValue(index < units ? text.charCodeAt(index) : 0);
        }
    }

    function melodyFromEffect(effect) {
        var notes = Math.min(Math.round(effect.property(PARAM_MELODY_LENGTH).value), MELODY_SLOTS);
        var melody = [];
        var index;
        for (index = 0; index < notes; index += 1) {
            melody.push(Math.round(melodySlotProperty(effect, index).value));
        }
        return melody;
    }

    // The inverse of setEffectParameters(): what the layer is actually set to,
    // which is not necessarily what the panel is showing. The melody comes back
    // with it, which is what lets Re-sync rewrite an edited line without the
    // panel having to know what tune it was singing.
    function settingsFromEffect(effect) {
        return {
            melody: melodyFromEffect(effect),
            melodyBpm: effect.property(PARAM_MELODY_BPM).value,
            transpose: Math.round(effect.property(PARAM_MELODY_TRANSPOSE).value),
            toneBlend: effect.property(PARAM_TONE_BLEND).value / 100,
            portamento: effect.property(PARAM_PORTAMENTO).value / 1000,
            vibratoDelay: effect.property(PARAM_VIBRATO_DELAY).value,
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
            tempoLock: Math.round(effect.property(PARAM_TEMPO_LOCK).value) !== 0,
            formant: effect.property(PARAM_FORMANT).value / 100,
            source: Math.round(effect.property(PARAM_SOURCE).value) - 1,
            vibrato: effect.property(PARAM_VIBRATO).value / 100,
            vibratoRate: effect.property(PARAM_VIBRATO_RATE).value
        };
    }

    function textFromEffect(effect) {
        var units = Math.min(Math.round(effect.property(PARAM_TEXT_LENGTH).value), MAX_TEXT_UNITS);
        var value = "";
        var index;
        for (index = 0; index < units; index += 1) {
            value += String.fromCharCode(Math.round(textUnitProperty(effect, index).value));
        }
        return value;
    }

    /*
     * Cutting a line down to what the transport can carry.
     *
     * A layer speaks at most MAX_TEXT_UNITS UTF-16 units, and Apply on an
     * over-long layer says so and truncates, because silently rewriting text a
     * user typed is worse than telling them. An imported script is different:
     * nobody typed those layers, so a paragraph of narration becomes as many
     * layers as it needs instead of losing its second half.
     *
     * Three things must not be cut through. A pronunciation override is one
     * token — half of "[重|chong2]新" is broken on both sides of the break. A
     * surrogate pair is one character. And a cut in the middle of a word reads
     * worse than one at the punctuation the engine was going to rest on anyway,
     * so the last rest before the limit wins when there is one.
     */
    var BREAK_AFTER = "。！？，、；：…」』）.!?,;: \t";

    function splitForTransport(text) {
        var chunks = [];
        var rest = String(text);
        while (rest.length > MAX_TEXT_UNITS) {
            var rested = -1;
            var safe = 0;
            var depth = 0;
            var index;
            for (index = 0; index < MAX_TEXT_UNITS; index += 1) {
                var code = rest.charCodeAt(index);
                if (code === 0x5B) { depth += 1; continue; }
                if (code === 0x5D) {
                    if (depth > 0) { depth -= 1; }
                    if (depth === 0) { safe = index + 1; }
                    continue;
                }
                if (depth > 0) { continue; }
                // Cutting between a high surrogate and its low half would leave
                // half a character on each side.
                if (code >= 0xD800 && code <= 0xDBFF) { continue; }
                safe = index + 1;
                if (BREAK_AFTER.indexOf(String.fromCharCode(code)) >= 0) { rested = index + 1; }
            }
            var at = rested > 0 ? rested : safe;
            if (at <= 0) {
                // One unbroken override longer than the whole transport. Both
                // halves are spoilt either way; not looping forever matters more.
                at = MAX_TEXT_UNITS;
                var last = rest.charCodeAt(at - 1);
                if (last >= 0xD800 && last <= 0xDBFF) { at -= 1; }
            }
            chunks.push(rest.substring(0, at));
            // Whatever separated the two halves has done its job; carrying it
            // over would open the next layer with a rest.
            rest = rest.substring(at).replace(/^\s+/, "");
        }
        if (rest.length) { chunks.push(rest); }
        return chunks;
    }

    // Helpers the engine's plan is decoded with. These derive from a reading
    // string the engine hands back; they do not decide what the readings are.

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

    function characterFromCode(code) {
        if (code > 0xFFFF) {
            var offset = code - 0x10000;
            return String.fromCharCode(0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF));
        }
        return String.fromCharCode(code);
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

    /*
     * The plan comes from the engine, not from a second implementation of it.
     *
     * Markers, the rig, Type-On and Fit Duration all need to know where each
     * syllable falls. The panel used to work that out itself, which meant a
     * duplicate of the readings table, the phrase table, tone sandhi, the
     * punctuation rests and the timing constants, written in ExtendScript. The
     * two copies could not agree even in principle: the engine varies each
     * syllable's length by a seeded random amount, so ordinary Chinese drifted
     * by up to 10 ms, and the copy knew nothing about inline overrides, Zhuyin,
     * tone-number pinyin or the 64-unit limit. "[重|chong2]新開始" planned twelve
     * syllables against the four that are spoken and sized the layer 1.28 s too
     * long; "ni3 hao3 ma5" planned seven against three.
     *
     * island_chatter_bake --plan reports the plan the engine will actually use.
     * The arguments are read off the effect rather than off the panel, so the
     * plan describes what will be rendered even if the two ever disagree.
     */
    // Read off the effect, never off the panel, so the plan and the bake both
    // describe the melody the layer will actually sing. An empty list adds no
    // flag at all, which keeps every spoken layer's command line unchanged.
    function melodyArguments(effect) {
        var melody = melodyFromEffect(effect);
        if (!melody.length) { return ""; }
        return " --melody " + melody.join(",") +
            " --melody-bpm " + effect.property(PARAM_MELODY_BPM).value +
            " --transpose " + Math.round(effect.property(PARAM_MELODY_TRANSPOSE).value) +
            " --tone-blend " + (effect.property(PARAM_TONE_BLEND).value / 100) +
            " --portamento " + (effect.property(PARAM_PORTAMENTO).value / 1000) +
            " --vibrato-delay " + effect.property(PARAM_VIBRATO_DELAY).value;
    }

    function engineVoiceArguments(effect) {
        return melodyArguments(effect) +
            " --text " + hexUtf8(textFromEffect(effect)) +
            " --voice " + (Math.round(effect.property(PARAM_VOICE).value) - 1) +
            " --emotion " + (Math.round(effect.property(PARAM_EMOTION).value) - 1) +
            " --size " + (Math.round(effect.property(PARAM_CHARACTER_SIZE).value) - 1) +
            " --seed " + Math.round(effect.property(PARAM_SEED).value) +
            " --rate " + ENGINE_SAMPLE_RATE +
            " --pitch " + effect.property(PARAM_PITCH).value +
            " --speed " + effect.property(PARAM_SPEED).value +
            " --volume " + (effect.property(PARAM_VOLUME).value / 100) +
            " --consonant " + effect.property(PARAM_CONSONANT).value +
            " --clarity " + (effect.property(PARAM_CLARITY).value / 100) +
            " --cuteness " + (effect.property(PARAM_CUTENESS).value / 100) +
            " --tempo-lock " + (Math.round(effect.property(PARAM_TEMPO_LOCK).value) ? 1 : 0) +
            " --formant " + (effect.property(PARAM_FORMANT).value / 100) +
            " --source " + (Math.round(effect.property(PARAM_SOURCE).value) - 1) +
            " --vibrato " + (effect.property(PARAM_VIBRATO).value / 100) +
            " --vibrato-rate " + effect.property(PARAM_VIBRATO_RATE).value;
    }

    function requireEngineTool() {
        var tool = bakeToolFile();
        if (!tool) {
            throw new Error("island_chatter_bake.exe is missing. Reinstall Island Chatter." +
                "\n找不到 island_chatter_bake.exe，請重新安裝 Island Chatter。");
        }
        return tool;
    }

    // Characters arrive as decimal codepoints because callSystem() hands stdout
    // back through the console code page, which would turn Chinese into "?".
    function parseEnginePlan(reply) {
        var lines = String(reply).split(/[\r\n]+/);
        var rate = 0;
        var samples = -1;
        var declared = -1;
        var events = [];
        var index;
        for (index = 0; index < lines.length; index += 1) {
            var fields = lines[index].split(" ");
            if (fields[0] === "RATE") { rate = parseInt(fields[1], 10); }
            else if (fields[0] === "SAMPLES") { samples = parseInt(fields[1], 10); }
            else if (fields[0] === "END") { declared = parseInt(fields[1], 10); }
            else if (fields[0] === "E") {
                // Anything the engine has no Mandarin syllable for reports "-".
                // "a5" keeps the marker text and mouth shape as they have always
                // been for latin and invented syllables.
                var reading = fields[3] === "-" ? "a5" : fields[3];
                var character = "";
                var unit;
                for (unit = 4; unit < fields.length; unit += 1) {
                    character += characterFromCode(parseInt(fields[unit], 10));
                }
                events.push({
                    character: character,
                    reading: reading,
                    mouth: mouthForReading(reading),
                    tone: readingTone(reading),
                    time: parseInt(fields[1], 10) / ENGINE_SAMPLE_RATE,
                    duration: parseInt(fields[2], 10) / ENGINE_SAMPLE_RATE
                });
            }
        }
        // callSystem() reports no exit status, so a tool that died halfway would
        // otherwise read as a short utterance and silently shorten the layer.
        if (!rate || samples < 0 || declared !== events.length) {
            throw new Error("Island Chatter could not read the timing plan." +
                "\n無法取得語音時間表。\n\n" + reply);
        }
        return { events: events, duration: samples / rate };
    }

    function planFromEngine(effect) {
        var tool = requireEngineTool();
        return parseEnginePlan(
            system.callSystem(quoted(tool.fsName) + " --plan" + engineVoiceArguments(effect)));
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

    /*
     * The animation rig.
     *
     * Five sliders describe what the face is doing: which mouth shape, how loud,
     * how high, which way the head is thrown, and whether the eyes are shut. A
     * shared rig adds two more, IC Speaking and IC Line, because a rig driven by
     * twenty lines needs to say which of them is talking and when nobody is.
     *
     * mergeRigTimeline() is where every one of those numbers is decided. It is
     * deliberately free of After Effects: it takes lines and gives back the keys
     * to write, so the same code produces a one-line rig and a twenty-line one,
     * and so it can be exercised in tests/validate-script.js without a host.
     * Everything downstream of it only knows how to write a hold key.
     */
    var RIG_TRACKS = ["mouth", "volume", "pitch", "bounce", "blink"];
    var RIG_TRACK_NAMES = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce", "IC Blink"];
    var RIG_TRACK_DEFAULTS = [0, 0, 100, 0, 0];
    // Only a shared rig carries these. A per-layer rig would answer "line 1" and
    // "speaking" for its whole length, which is not worth two more sliders on
    // every one of twenty layers.
    var SHARED_TRACKS = ["speaking", "lineIndex"];
    var SHARED_TRACK_NAMES = ["IC Speaking", "IC Line"];
    var SHARED_TRACK_DEFAULTS = [0, 0];

    /*
     * Merge lines into one set of hold keys.
     *
     * `lines` are { name, start, plan, order }, where start is the line's
     * position in the timeline the keys are being written on and plan is what
     * the engine reported. `baseline` is where the closed-mouth resting values
     * go: a layer's own in point for a per-layer rig, the rig layer's for a
     * shared one.
     *
     * Two things only a merged timeline has to decide:
     *
     * Blinks and head bounces count syllables, and the count runs across the
     * whole timeline rather than restarting each line. Restarting it would throw
     * the head the same way at the start of every line, which reads as a tic.
     *
     * Overlap. Two lines of one character talking at once is almost always a
     * mistake, but refusing to build the rig over it helps nobody. The line that
     * starts later wins from the moment it starts, the earlier one is cut there
     * rather than left to close the mouth in the middle of the later one, and
     * both names come back so the panel can say so.
     */
    function mergeRigTimeline(lines, baseline) {
        var tracks = {
            mouth: [], volume: [], pitch: [], bounce: [], blink: [],
            speaking: [], lineIndex: []
        };
        var overlaps = [];
        function key(track, time, value) { track.push({ time: time, value: value }); }
        key(tracks.mouth, baseline, 0);
        key(tracks.volume, baseline, 0);
        key(tracks.pitch, baseline, 100);
        key(tracks.bounce, baseline, 0);
        key(tracks.blink, baseline, 0);
        key(tracks.speaking, baseline, 0);
        key(tracks.lineIndex, baseline, 0);

        var ordered = [];
        var index;
        for (index = 0; index < lines.length; index += 1) { ordered.push(lines[index]); }
        // `order` makes the comparison total, so lines that begin at the same
        // moment keep the order they were given instead of an arbitrary one.
        ordered.sort(function (first, second) {
            return first.start - second.start || first.order - second.order;
        });

        var syllable = 0;
        for (index = 0; index < ordered.length; index += 1) {
            var line = ordered[index];
            var limit = line.start + line.plan.duration;
            if (index + 1 < ordered.length && ordered[index + 1].start < limit) {
                limit = ordered[index + 1].start;
                overlaps.push(line.name);
                overlaps.push(ordered[index + 1].name);
            }
            key(tracks.speaking, line.start, 100);
            key(tracks.lineIndex, line.start, index + 1);
            var at;
            for (at = 0; at < line.plan.events.length; at += 1) {
                var event = line.plan.events[at];
                var start = line.start + event.time;
                // Cut by a later line: the audio still plays, but the face
                // belongs to whoever is talking now.
                if (start >= limit) { continue; }
                var finish = Math.min(start + event.duration * 0.82, limit);
                key(tracks.mouth, start, event.mouth);
                key(tracks.mouth, finish, 0);
                key(tracks.volume, start, 82);
                key(tracks.volume, finish, 0);
                key(tracks.pitch, start, tonePitch(event.tone));
                key(tracks.pitch, finish, 100);
                key(tracks.bounce, start, syllable % 2 ? -55 : 55);
                key(tracks.bounce, Math.min(start + event.duration * 0.38, limit), 0);
                if (syllable > 0 && syllable % 5 === 0) {
                    key(tracks.blink, start, 100);
                    key(tracks.blink, Math.min(start + 0.065, limit), 0);
                }
                syllable += 1;
            }
            key(tracks.speaking, limit, 0);
            key(tracks.lineIndex, limit, 0);
        }
        return { tracks: tracks, overlaps: overlaps };
    }

    function writeRigTrack(slider, keys) {
        clearKeys(slider);
        var index;
        for (index = 0; index < keys.length; index += 1) {
            setHoldKey(slider, keys[index].time, keys[index].value);
        }
    }

    // Every slider is created before any of them is looked up, because
    // addProperty() invalidates Property handles obtained before it.
    function writeRigLayer(layer, tracks, shared) {
        var keys = RIG_TRACKS;
        var names = RIG_TRACK_NAMES;
        var defaults = RIG_TRACK_DEFAULTS;
        if (shared) {
            keys = keys.concat(SHARED_TRACKS);
            names = names.concat(SHARED_TRACK_NAMES);
            defaults = defaults.concat(SHARED_TRACK_DEFAULTS);
        }
        var index;
        for (index = 0; index < names.length; index += 1) {
            ensureSlider(layer, names[index], defaults[index]);
        }
        for (index = 0; index < names.length; index += 1) {
            writeRigTrack(findNamedEffect(layer, names[index]).property(1), tracks[keys[index]]);
        }
    }

    function updateAnimationControls(layer, plan) {
        var merged = mergeRigTimeline(
            [{ name: layer.name, start: layer.inPoint, plan: plan, order: 0 }], layer.inPoint);
        writeRigLayer(layer, merged.tracks, false);
    }

    function removePerLayerRig(layer) {
        var effects = layer.property("ADBE Effect Parade");
        var index;
        var slot;
        // Downward: removing an effect renumbers everything above it.
        for (index = effects.numProperties; index >= 1; index -= 1) {
            for (slot = 0; slot < RIG_TRACK_NAMES.length; slot += 1) {
                if (effects.property(index).name === RIG_TRACK_NAMES[slot]) {
                    effects.property(index).remove();
                    break;
                }
            }
        }
    }

    /*
     * A rig shared by every line one character speaks.
     *
     * The rig lives on a null layer of its own, and each line points at it with
     * a Layer Control. A Layer Control rather than a name, because names are the
     * user's to change and layers are theirs to reorder; the pointer survives
     * both, and After Effects reports it as "None" when the null is deleted,
     * which is exactly the signal needed to notice an orphan. The removed 1.0
     * carrier-layer bridge used the same mechanism.
     *
     * The rig's own keys are merged from every member and rewritten whole. That
     * makes them ordinary keyframes: nothing is evaluated at render time, the
     * project animates on a machine with no plug-in installed, and a rig with a
     * line deleted out from under it goes stale rather than turning into an
     * expression error. The price is that moving a line in time does not move
     * the rig with it, which is what Rebuild is for.
     */
    var RIG_LAYER_PREFIX = "IC Rig ";
    var RIG_TARGET_NAME = "IC Rig Target";
    // The marker that says a layer is a rig, and the head of its stored voice.
    // A layer comment is the only writable string After Effects gives a layer,
    // and keeping the character's voice there is what makes it travel with the
    // project instead of living in one machine's preferences.
    var RIG_COMMENT_PREFIX = "IC Rig:";
    var RIG_SETTING_KEYS = ["voice", "emotion", "characterSize", "pitch", "speed",
        "volume", "consonant", "clarity", "cuteness", "seed", "tempoLock",
        "formant", "source", "vibrato", "vibratoRate"];

    function isRigLayer(layer) {
        return !!layer && String(layer.comment).indexOf(RIG_COMMENT_PREFIX) === 0;
    }

    function rigCharacterName(layer) {
        var name = String(layer.name);
        return name.indexOf(RIG_LAYER_PREFIX) === 0
            ? name.substring(RIG_LAYER_PREFIX.length) : name;
    }

    function rigLayers(comp) {
        var output = [];
        var index;
        for (index = 1; index <= comp.numLayers; index += 1) {
            if (isRigLayer(comp.layer(index))) { output.push(comp.layer(index)); }
        }
        return output;
    }

    // The same layer can arrive from several directions in one selection; a rig
    // must only be rebuilt once per pass or the second rebuild reads keys the
    // first one has already replaced.
    function uniqueLayers(list) {
        var output = [];
        var index;
        var at;
        for (index = 0; index < list.length; index += 1) {
            var seen = false;
            for (at = 0; at < output.length; at += 1) {
                if (output[at].index === list[index].index) { seen = true; }
            }
            if (!seen) { output.push(list[index]); }
        }
        return output;
    }

    function findRigLayer(comp, name) {
        var found = rigLayers(comp);
        var index;
        for (index = 0; index < found.length; index += 1) {
            if (rigCharacterName(found[index]) === name) { return found[index]; }
        }
        return null;
    }

    function writeRigSettings(rigLayer, settings) {
        var parts = [];
        var index;
        for (index = 0; index < RIG_SETTING_KEYS.length; index += 1) {
            var value = settings[RIG_SETTING_KEYS[index]];
            parts.push(RIG_SETTING_KEYS[index] === "tempoLock" ? (value ? 1 : 0) : value);
        }
        rigLayer.comment = RIG_COMMENT_PREFIX + parts.join(",");
    }

    // Null when the comment carries no voice, which is every rig built before a
    // voice was ever applied to it. The caller keeps whatever the panel shows.
    function rigSettings(rigLayer) {
        var raw = String(rigLayer.comment);
        if (raw.indexOf(RIG_COMMENT_PREFIX) !== 0) { return null; }
        var parts = raw.substring(RIG_COMMENT_PREFIX.length).split(",");
        if (parts.length < RIG_SETTING_KEYS.length) { return null; }
        var loaded = {};
        var index;
        for (index = 0; index < RIG_SETTING_KEYS.length; index += 1) {
            var number = parseFloat(parts[index]);
            if (isNaN(number)) { return null; }
            loaded[RIG_SETTING_KEYS[index]] = number;
        }
        loaded.tempoLock = loaded.tempoLock !== 0;
        return loaded;
    }

    function ensureRigLayer(comp, name) {
        var existing = findRigLayer(comp, name);
        if (existing) { return existing; }
        var created = comp.layers.addNull(comp.duration);
        created.name = RIG_LAYER_PREFIX + name;
        created.comment = RIG_COMMENT_PREFIX;
        created.startTime = 0;
        // It carries values, not pixels. Keeping it out of the render means a
        // forgotten rig cannot put a white square in anyone's video.
        try { created.guideLayer = true; } catch (error) { /* Older hosts. */ }
        return created;
    }

    // The rig a layer is bound to, or null when it is bound to nothing, points
    // at a layer that has been deleted, or points at something that is not a rig.
    function rigTargetLayer(comp, layer) {
        var control = findNamedEffect(layer, RIG_TARGET_NAME);
        if (!control) { return null; }
        var at = Math.round(control.property(1).value);
        if (at < 1 || at > comp.numLayers) { return null; }
        var target = comp.layer(at);
        return isRigLayer(target) ? target : null;
    }

    function ensureRigTarget(layer, rigLayer) {
        var control = findNamedEffect(layer, RIG_TARGET_NAME);
        if (!control) {
            control = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
            control.name = RIG_TARGET_NAME;
        }
        var pointer = control.property(1);
        if (valuesDiffer(pointer.value, rigLayer.index)) { pointer.setValue(rigLayer.index); }
    }

    function rigMembers(comp, rigLayer) {
        var output = [];
        var index;
        for (index = 1; index <= comp.numLayers; index += 1) {
            var candidate = comp.layer(index);
            if (!isTextLayer(candidate)) { continue; }
            var target = rigTargetLayer(comp, candidate);
            if (target && target.index === rigLayer.index) { output.push(candidate); }
        }
        return output;
    }

    /*
     * Rewrite a shared rig from its members.
     *
     * `planned` is what the Apply that triggered this already asked the engine
     * for, as [{ layer: Layer, plan: plan }]. Without it a batch of twenty lines
     * would run the engine forty times: once each while applying, and once each
     * again here. Lookup is by live index rather than by identity, because
     * After Effects hands back a new Layer object each time and applying can
     * renumber the composition underneath us.
     */
    function rebuildSharedRig(comp, rigLayer, planned) {
        var members = rigMembers(comp, rigLayer);
        var lines = [];
        var index;
        var at;
        for (index = 0; index < members.length; index += 1) {
            var effect = findNativeEffect(members[index]);
            // A member whose voice was taken off contributes nothing, but stays
            // bound: taking Island Chatter off a line is what Remove is for.
            if (!effect) { continue; }
            var plan = null;
            for (at = 0; planned && at < planned.length; at += 1) {
                if (planned[at].layer.index === members[index].index) { plan = planned[at].plan; }
            }
            if (!plan) { plan = planFromEngine(effect); }
            lines.push({
                name: members[index].name,
                start: members[index].inPoint,
                plan: plan,
                order: index
            });
        }
        var merged = mergeRigTimeline(lines, rigLayer.inPoint);
        writeRigLayer(rigLayer, merged.tracks, true);
        return { lines: lines.length, overlaps: merged.overlaps };
    }

    /*
     * Driving a face from the rig.
     *
     * IC Mouth is 0 for closed and 1-5 for a, i, u, e and o, which is the whole
     * mapping and is written down nowhere the user can see it. This turns it
     * into something that moves: either one precomp of six frames driven by
     * Time Remap, or up to six layers switched by Opacity.
     *
     * The expression reaches the rig through the same Layer Control the lines
     * use, so renaming the character does not break the face, and it falls back
     * to a closed mouth rather than a yellow error banner if the rig is gone.
     */
    var MOUTH_EXPRESSION_TAG = "// Island Chatter mouth switch";
    var MOUTH_SHAPE_COUNT = 6;

    function mouthShapeSource() {
        return MOUTH_EXPRESSION_TAG + "\n" +
            "var shape = 0;\n" +
            "try { shape = effect(\"" + RIG_TARGET_NAME +
            "\")(\"Layer\").effect(\"" + RIG_TRACK_NAMES[0] + "\")(\"Slider\"); }\n" +
            "catch (noRig) { shape = 0; }\n";
    }

    function mouthOpacityExpression(shape) {
        return mouthShapeSource() + "Math.round(shape) == " + shape + " ? 100 : 0";
    }

    function mouthRemapExpression() {
        return mouthShapeSource() +
            "Math.max(0, Math.min(" + (MOUTH_SHAPE_COUNT - 1) +
            ", Math.round(shape))) * thisComp.frameDuration";
    }

    // The transform group's match name is "ADBE Transform Group". "ADBE
    // Transform" is not a match name at all: it finds nothing, returns null, and
    // reads as "this layer has no opacity", which is true of almost no layer.
    function opacityProperty(layer) {
        var transform = layer.property("ADBE Transform Group");
        return transform ? transform.property("ADBE Opacity") : null;
    }

    // Only expressions this panel wrote are touched, so a face the user has
    // since taken over by hand is left exactly as they left it.
    function unbindFromRig(layer) {
        var removed = 0;
        var opacity = opacityProperty(layer);
        if (opacity && String(opacity.expression).indexOf(MOUTH_EXPRESSION_TAG) === 0) {
            opacity.expression = "";
            removed += 1;
        }
        try {
            if (layer.timeRemapEnabled) {
                var remap = layer.property("ADBE Time Remapping");
                if (remap && String(remap.expression).indexOf(MOUTH_EXPRESSION_TAG) === 0) {
                    remap.expression = "";
                    removed += 1;
                }
            }
        } catch (error) { /* Not an AVLayer; it has no time remapping. */ }
        var control = findNamedEffect(layer, RIG_TARGET_NAME);
        if (control) { control.remove(); removed += 1; }
        return removed;
    }

    function buildMouthSwitch(comp, rigLayer, targets) {
        var index;
        if (!targets.length) {
            throw new Error("Select the mouth layers, or one mouth precomp." +
                "\n請先選取嘴型圖層，或一個嘴型合成。");
        }
        if (targets.length === 1 && targets[0].source && targets[0].source instanceof CompItem) {
            ensureRigTarget(targets[0], rigLayer);
            if (!targets[0].timeRemapEnabled) { targets[0].timeRemapEnabled = true; }
            targets[0].property("ADBE Time Remapping").expression = mouthRemapExpression();
            return { kind: "remap", count: 1 };
        }
        if (targets.length > MOUTH_SHAPE_COUNT) {
            throw new Error("A mouth has " + MOUTH_SHAPE_COUNT +
                " shapes: closed, a, i, u, e, o." +
                "\n嘴型只有 " + MOUTH_SHAPE_COUNT + " 種：閉嘴、a、i、u、e、o。");
        }
        // Topmost is shape 0. Some rule has to decide, and stacking order is the
        // one the user can see and change without leaving the timeline.
        var ordered = [];
        for (index = 0; index < targets.length; index += 1) { ordered.push(targets[index]); }
        ordered.sort(function (first, second) { return first.index - second.index; });
        for (index = 0; index < ordered.length; index += 1) {
            ensureRigTarget(ordered[index], rigLayer);
        }
        for (index = 0; index < ordered.length; index += 1) {
            var opacity = opacityProperty(ordered[index]);
            if (!opacity) {
                throw new Error(ordered[index].name + " has no Opacity to switch." +
                    "\n這個圖層沒有不透明度可以切換：" + ordered[index].name);
            }
            opacity.expression = mouthOpacityExpression(index);
        }
        return { kind: "opacity", count: ordered.length };
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

    function applyToTextLayer(comp, textLayer, pronunciation, settings, options, rigLayer) {
        // Read before anything is added or removed: the answer decides whether a
        // rig this line is leaving has to be rebuilt without it.
        var previousRig = rigTargetLayer(comp, textLayer);
        var text = textFromLayer(textLayer);
        var spokenText = trim(pronunciation) || text;
        // The layer's own Source Text is what gets spoken, so the 64-unit limit
        // has to be measured against that and not against the panel's text box.
        var truncated = spokenText.length > MAX_TEXT_UNITS ? textLayer.name : "";
        var unmarked = unmarkedKanji(spokenText) ? textLayer.name : "";

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

        // Read back off the effect that was just written, so the plan describes
        // the audio that will actually play — including the pronunciation
        // override and the truncation at MAX_TEXT_UNITS, neither of which the
        // panel's own planner used to account for.
        var plan = planFromEngine(effect);
        if (options.fitDuration) {
            textLayer.outPoint = Math.min(comp.duration,
                Math.max(textLayer.inPoint + comp.frameDuration, textLayer.inPoint + plan.duration));
        }
        if (options.markers) { updateTimingMarkers(textLayer, plan); }
        // A line drives either its own sliders or a shared rig, never both: two
        // sets of the same five controls on one layer is the confusion this was
        // built to remove. Whichever set is not wanted comes off.
        if (rigLayer) {
            removePerLayerRig(textLayer);
            ensureRigTarget(textLayer, rigLayer);
        } else {
            if (previousRig) { unbindFromRig(textLayer); }
            if (options.controllers) { updateAnimationControls(textLayer, plan); }
        }
        if (options.typeOn) {
            updateTypeOn(textLayer, plan, comp.time,
                typeOnCurve(options.typeOnLeave), options.typeOnSmoothness);
            if (options.typeOnCenter) {
                updateTypeOnCentering(comp, textLayer, plan,
                    typeOnCurve(options.typeOnLeave));
            }
        }
        return {
            truncated: truncated,
            unmarkedKanji: unmarked,
            plan: plan,
            // Anything this layer had baked is now a recording of what it used
            // to say. Muting it is what keeps the layer honest without throwing
            // away the undo history a re-bake would cost.
            stale: markBakeStale(comp, textLayer),
            releasedRig: previousRig && (!rigLayer || previousRig.index !== rigLayer.index)
                ? previousRig : null
        };
    }

    // Kanji has no reading the engine can look up: the same character is read
    // differently depending on the word, which needs a dictionary and a
    // disambiguator. Kana is unambiguous, so a text that mixes the two is
    // almost certainly Japanese, and its kanji is about to be spoken with
    // Chinese readings. Say so rather than let it sound wrong quietly.
    function unmarkedKanji(text) {
        var depth = 0;
        var sawKana = false;
        var kanji = "";
        var index;
        for (index = 0; index < text.length; index += 1) {
            var code = text.charCodeAt(index);
            if (code === 0x5B) { depth += 1; continue; }
            if (code === 0x5D) { depth -= 1; continue; }
            // Hiragana and katakana, but not the prolonged sound mark, which
            // only ever follows a kana anyway.
            if (code >= 0x3041 && code <= 0x30FF) { sawKana = true; continue; }
            // Marked characters are covered by their override.
            if (depth > 0) { continue; }
            if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)) {
                kanji += String.fromCharCode(code);
            }
        }
        return sawKana ? kanji : "";
    }

    // Everything the panel adds to a layer, so it can be taken off again in one
    // step instead of hunting through the effect stack.
    function removeFromLayer(comp, layer) {
        var removed = 0;
        // The baked audio is Island Chatter's too, and leaving it behind means
        // the layer goes on speaking after it has been removed. The WAV on disk
        // is left alone: it costs nothing to keep and it is not ours to delete.
        var baked = bakedLayerFor(comp, layer);
        if (baked) {
            var bakedName = String(baked.name);
            baked.remove();
            removed += 1;
            var found;
            for (found = app.project.numItems; found >= 1; found -= 1) {
                var item = app.project.item(found);
                if (item instanceof FootageItem && item.name === bakedName) { item.remove(); }
            }
        }
        // The pointer at a shared rig goes too. Rebuilding that rig without this
        // line is the caller's job, because it has to happen after every layer
        // in the selection has been dealt with.
        var names = RIG_TRACK_NAMES.concat([RIG_TARGET_NAME, BAKE_POINTER_NAME]);
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

    // Taking the rig itself away has to reach everything pointing at it, or the
    // lines keep a pointer to nothing and the face keeps an expression that can
    // no longer find a mouth shape.
    function removeRigLayer(comp, rigLayer) {
        var removed = 0;
        var index;
        for (index = 1; index <= comp.numLayers; index += 1) {
            var candidate = comp.layer(index);
            if (candidate.index === rigLayer.index) { continue; }
            var target = rigTargetLayer(comp, candidate);
            if (target && target.index === rigLayer.index) { removed += unbindFromRig(candidate); }
        }
        rigLayer.remove();
        return removed + 1;
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

    // Ships beside the .aex, in Support Files/Plug-ins/Island Chatter/.
    //
    // Deriving that from the panel's own location only works while the panel is
    // where the installer put it. Folder.startup is After Effects' Support Files
    // directory whatever is running, which covers a panel opened from somewhere
    // else through File > Scripts > Run Script File, and the host test suites,
    // which load the panel body out of the repository.
    var TOOL_RELATIVE_PATH = "/Plug-ins/Island Chatter/island_chatter_bake.exe";

    function bakeToolFile() {
        var candidates = [];
        try {
            candidates.push(new File($.fileName).parent.parent.parent.fsName + TOOL_RELATIVE_PATH);
        } catch (locationError) { /* $.fileName is not always a real path */ }
        try {
            candidates.push(Folder.startup.fsName + TOOL_RELATIVE_PATH);
        } catch (startupError) { /* not running inside After Effects */ }
        var index;
        for (index = 0; index < candidates.length; index += 1) {
            var tool = new File(candidates[index]);
            if (tool.exists) { return tool; }
        }
        return null;
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
    // release is called if the first attempt cannot write the file, which happens
    // when a previous bake of the same layer is still imported. Nothing about the
    // project is touched until a render has actually succeeded.
    function bakeLayer(layer, folder, release) {
        var tool = requireEngineTool();
        var effect = findNativeEffect(layer);
        if (!effect) {
            throw new Error("Apply Island Chatter to this layer first. / 請先對此圖層按 Apply。");
        }
        var target = new File(folder.fsName + "/" + bakeFileName(layer) + ".wav");

        // The path goes over as hex UTF-8 for the same reason the text does:
        // system.callSystem() hands the command line to the console code page,
        // which turns anything it cannot represent into "?" before the tool
        // sees it. A Chinese layer name or project folder would fail outright.
        var command = quoted(tool.fsName) +
            " --out-hex " + hexUtf8(target.fsName) +
            engineVoiceArguments(effect);

        function attempt() {
            if (target.exists) { target.remove(); }
            var reply = String(system.callSystem(command));
            return reply.indexOf("OK ") === 0 && target.exists ? "" : reply;
        }

        var failure = attempt();
        if (failure && release) {
            release();
            failure = attempt();
        }
        if (failure) {
            throw new Error("Bake failed for " + layer.name + "\n轉檔失敗：" + layer.name +
                "\n\n" + target.fsName + "\n" + failure);
        }
        return target;
    }

    /*
     * Baking the same layer twice used to fail outright: After Effects keeps the
     * imported WAV open, so the file could be neither deleted nor rewritten and
     * the tool reported "cannot open the output file for writing".
     *
     * native/tests/ae-rebake-probe.jsx established what actually releases the
     * handle on After Effects 26. Removing the layer does not. Removing the
     * footage item does not either. Only a purge does, and of the four targets
     * SNAPSHOT_CACHES is the one that does not work. UNDO_CACHES is used here
     * because it is the cheapest that does: the undo history goes, but the RAM
     * preview survives, which matters more while working.
     *
     * This is only reached on a re-bake, and only after the first write has
     * already failed, so an ordinary first bake costs nothing.
     */
    /*
     * Which audio layer belongs to which line.
     *
     * Until 1.6.0 the answer was the name: a bake was called "<layer> (baked)".
     * That breaks the moment the line is renamed — and Import names every layer
     * after its own text, so editing a line renames it. A Layer Control on the
     * text layer survives renaming and reordering, and reads as "None" when the
     * audio is deleted, which is the same mechanism the rig uses.
     *
     * The name is still tried afterwards, so bakes made before the pointer
     * existed are still found.
     */
    var BAKE_POINTER_NAME = "IC Bake";
    var BAKE_STALE_SUFFIX = " (stale)";

    function bakedLayerFor(comp, layer) {
        var pointer = findNamedEffect(layer, BAKE_POINTER_NAME);
        if (pointer && pointer.matchName === "ADBE Layer Control") {
            var at = Math.round(pointer.property(1).value);
            if (at >= 1 && at <= comp.numLayers && at !== layer.index) { return comp.layer(at); }
        }
        var bakedName = layer.name + " (baked)";
        var index;
        for (index = 1; index <= comp.numLayers; index += 1) {
            if (comp.layer(index).name === bakedName) { return comp.layer(index); }
        }
        return null;
    }

    function pointAtBake(layer, audioLayer) {
        var pointer = findNamedEffect(layer, BAKE_POINTER_NAME);
        if (!pointer) {
            pointer = layer.property("ADBE Effect Parade").addProperty("ADBE Layer Control");
            pointer.name = BAKE_POINTER_NAME;
        }
        var target = pointer.property(1);
        if (valuesDiffer(target.value, audioLayer.index)) { target.setValue(audioLayer.index); }
    }

    /*
     * A bake that no longer matches its line.
     *
     * Baking silences the live effect, so after the text changes the layer plays
     * a recording of what it used to say and nothing says so. Re-baking
     * automatically would be worse than it sounds: releasing the imported WAV
     * needs app.purge(), so every Apply would throw away the undo history.
     *
     * Instead the stale recording is muted and the live effect comes back on.
     * What you hear is always what the layer says; the muted layer keeps the
     * name so it is obvious a bake is waiting to be redone, and pressing Bake
     * replaces it.
     */
    function markBakeStale(comp, layer) {
        var audioLayer = bakedLayerFor(comp, layer);
        if (!audioLayer) { return false; }
        var alreadyStale = String(audioLayer.name).indexOf(BAKE_STALE_SUFFIX,
            String(audioLayer.name).length - BAKE_STALE_SUFFIX.length) >= 0;
        // audioEnabled, not enabled: the video switch does nothing to a layer
        // that has no picture.
        try { audioLayer.audioEnabled = false; } catch (error) { /* not an AVLayer */ }
        if (!alreadyStale) { audioLayer.name = audioLayer.name + BAKE_STALE_SUFFIX; }
        var effect = findNativeEffect(layer);
        if (effect) { effect.enabled = true; }
        var tone = findToneBootstrap(layer);
        if (tone) { tone.enabled = true; }
        return !alreadyStale;
    }

    function releasePreviousBake(comp, layer) {
        var previous = bakedLayerFor(comp, layer);
        var names = [layer.name + " (baked)"];
        if (previous) { names.push(String(previous.name)); }
        var index;
        var at;
        for (index = comp.numLayers; index >= 1; index -= 1) {
            var candidate = comp.layer(index);
            if (previous && candidate.index === previous.index) { candidate.remove(); continue; }
            for (at = 0; at < names.length; at += 1) {
                if (candidate.name === names[at]) { candidate.remove(); break; }
            }
        }
        for (index = app.project.numItems; index >= 1; index -= 1) {
            var item = app.project.item(index);
            if (!(item instanceof FootageItem)) { continue; }
            for (at = 0; at < names.length; at += 1) {
                if (item.name === names[at]) { item.remove(); break; }
            }
        }
        app.purge(PurgeTarget.UNDO_CACHES);
    }

    function bakeToLayer(comp, layer, folder) {
        var file = bakeLayer(layer, folder, function () {
            releasePreviousBake(comp, layer);
        });
        // A re-bake that never had to release anything still must not stack a
        // second copy of the voice on the timeline.
        releasePreviousBake(comp, layer);
        var imported = app.project.importFile(new ImportOptions(file));
        imported.name = layer.name + " (baked)";
        var audioLayer = comp.layers.add(imported);
        audioLayer.startTime = layer.inPoint;
        audioLayer.name = layer.name + " (baked)";
        audioLayer.moveAfter(layer);
        pointAtBake(layer, audioLayer);
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
        // Resolved once, before the loop: creating a layer renumbers the
        // composition, and every line in this batch has to point at the same one.
        var rigLayer = null;
        if (options.rigShared) {
            if (!options.rigCharacter) {
                throw new Error("Choose or create a character first. / 請先選擇或新增角色。");
            }
            rigLayer = ensureRigLayer(comp, options.rigCharacter);
            writeRigSettings(rigLayer, settings);
        }
        var index;
        var truncated = [];
        var unmarkedKanjiLayers = [];
        var planned = [];
        var touched = [];
        var stale = 0;
        for (index = 0; index < layers.length; index += 1) {
            // One pronunciation override cannot safely describe several
            // different selected layers, so batch mode uses each Source Text.
            var layerPronunciation = layers.length === 1 ? pronunciation : "";
            var overflowed = applyToTextLayer(
                comp, layers[index], layerPronunciation, settings, options, rigLayer);
            if (overflowed.truncated) { truncated.push(overflowed.truncated); }
            if (overflowed.unmarkedKanji) { unmarkedKanjiLayers.push(overflowed.unmarkedKanji); }
            planned.push({ layer: layers[index], plan: overflowed.plan });
            if (overflowed.releasedRig) { touched.push(overflowed.releasedRig); }
            if (overflowed.stale) { stale += 1; }
            layers[index].selected = true;
        }
        // Rebuilt after the whole batch rather than once per line, so twenty
        // lines cost one rebuild instead of twenty, and a rig a line has just
        // left is rewritten without it.
        if (rigLayer) { touched.push(rigLayer); }
        touched = uniqueLayers(touched);
        var overlaps = [];
        for (index = 0; index < touched.length; index += 1) {
            overlaps = overlaps.concat(rebuildSharedRig(comp, touched[index], planned).overlaps);
        }
        return {
            count: layers.length,
            truncated: truncated,
            unmarkedKanji: unmarkedKanjiLayers,
            rigs: touched.length,
            stale: stale,
            overlaps: overlaps
        };
    }

    /*
     * A whole script in one go.
     *
     * Building a scene by hand is one new text layer, one paste, one drag along
     * the timeline and one Apply per line, twenty times over. Everything needed
     * to do it in one step was already here: the engine knows how long each line
     * takes, so the next one can start where the last one ends.
     *
     * Fit Duration is forced on regardless of the checkbox, because laying lines
     * end to end means knowing where each one ends, and the plan is the only
     * thing that knows.
     */
    var IMPORT_HEADROOM = 60;

    /*
     * Laying lines out on the beat.
     *
     * The gap between two lines is measured in beats, and the next line starts
     * on a beat — which makes it a minimum rather than an exact distance. Only
     * converting beats to seconds would not put anything on the grid: unless
     * Tempo Lock is on, a line is not a whole number of beats long, so an exact
     * gap after it lands between two beats and every line after that inherits
     * the drift.
     *
     * The grid runs from the start of the composition, so a line placed by an
     * import and a line placed by a re-flow land on the same beats.
     */
    function beatDuration(bpm) {
        return 60.0 / clamp(bpm, 20, 400);
    }

    /*
     * How fine the grid is.
     *
     * The gap is a note value: 1 is a crotchet, 0.5 a quaver, 0.25 a
     * semiquaver. The grid has to be that fine or the fraction does nothing —
     * snapping every line to a whole beat makes half a beat and a whole beat
     * land in the same place most of the time, which is what "decimals are not
     * supported" looked like.
     *
     * A gap of a beat or more still lands on ordinary beats. "Leave two beats"
     * means any beat two beats away, not only every second beat.
     *
     * A gap of zero asks for no grid at all: the lines run straight on.
     */
    function gridStep(gapBeats, bpm) {
        return beatDuration(bpm) * Math.min(1, Math.max(0, gapBeats));
    }

    // Forward, never to the nearest: a line is not moved earlier than the point
    // it was asked for. The tolerance is there because a time already on the
    // grid must not be pushed a whole step further by floating-point dust —
    // Re-flow snaps its first line on every run, and at 137 BPM the scene
    // otherwise walks a beat later each press.
    function snapForward(time, step) {
        if (step <= 0) { return time; }
        return Math.ceil(time / step - 1e-6) * step;
    }

    function nextLineStart(previousEnd, gapBeats, bpm) {
        return snapForward(previousEnd + Math.max(0, gapBeats) * beatDuration(bpm),
            gridStep(gapBeats, bpm));
    }

    /*
     * A speaker's name in front of the line.
     *
     * Only read when the panel is told the script has them, because nothing
     * separates "咪咪：你好" from "注意：這裡很危險" — both are a few characters,
     * a colon and a sentence. Guessing would invent a character called 注意 and
     * swallow the word out of the line.
     */
    var SPEAKER_NAME_LIMIT = 16;

    function splitSpeaker(line) {
        var text = String(line);
        var at = -1;
        var index;
        for (index = 0; index < text.length && index <= SPEAKER_NAME_LIMIT; index += 1) {
            var code = text.charCodeAt(index);
            if (code === 0x3A || code === 0xFF1A) { at = index; break; }
        }
        if (at <= 0) { return { speaker: "", text: trim(text) }; }
        var name = trim(text.substring(0, at));
        var said = trim(text.substring(at + 1));
        // A name with nothing after it is a line of dialogue that happens to end
        // in a colon, not a speaker.
        if (!name || !said || name.length > SPEAKER_NAME_LIMIT) {
            return { speaker: "", text: trim(text) };
        }
        // Override syntax in a name would mean the name was never a name.
        if (name.indexOf("[") >= 0 || name.indexOf("]") >= 0 || name.indexOf("|") >= 0) {
            return { speaker: "", text: trim(text) };
        }
        return { speaker: name, text: said };
    }

    function importScript(scriptText, settings, options, gapBeats, bpm) {
        if (!app.project) { app.newProject(); }
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            throw new Error("Open an active composition first. / 請先開啟合成。");
        }
        var written = String(scriptText).split(/[\r\n]+/);
        var spoken = [];
        var scripted = 0;
        var index;
        var at;
        for (index = 0; index < written.length; index += 1) {
            var line = trim(written[index]);
            if (!line) { continue; }
            scripted += 1;
            // The speaker is read off the whole line before it is cut up, so a
            // long line's second half belongs to the same character.
            var said = options.speakers ? splitSpeaker(line) : { speaker: "", text: line };
            var pieces = splitForTransport(said.text);
            for (at = 0; at < pieces.length; at += 1) {
                spoken.push({ text: pieces[at], speaker: said.speaker });
            }
        }
        if (!spoken.length) {
            throw new Error("There is no script to import. / 沒有可以匯入的劇本文字。");
        }
        // The character chosen in the panel is what a line with no speaker in
        // front of it belongs to.
        var fallbackRig = null;
        if (options.rigShared) {
            if (!options.rigCharacter) {
                throw new Error("Choose or create a character first. / 請先選擇或新增角色。");
            }
            fallbackRig = ensureRigLayer(comp, options.rigCharacter);
            writeRigSettings(fallbackRig, settings);
        }
        var sequenced = {
            markers: options.markers,
            fitDuration: true,
            controllers: options.controllers,
            rigShared: options.rigShared,
            rigCharacter: options.rigCharacter,
            typeOn: options.typeOn,
            typeOnCenter: options.typeOnCenter,
            typeOnLeave: options.typeOnLeave,
            typeOnSmoothness: options.typeOnSmoothness
        };
        var wasDuration = comp.duration;
        // The first line lands on a beat too. Starting it wherever the time
        // indicator happens to sit would put the whole scene off the grid.
        var cursor = snapForward(comp.time, gridStep(gapBeats, bpm));
        var planned = [];
        var made = [];
        var unmarked = [];
        var touched = [];
        var cast = [];
        for (index = 0; index < spoken.length; index += 1) {
            // Grown before the layer is placed, not after: Fit Duration clamps
            // to the end of the composition, so a line placed past it would be
            // silently squashed to nothing.
            if (comp.duration < cursor + IMPORT_HEADROOM) {
                comp.duration = cursor + IMPORT_HEADROOM;
            }
            var lineRig = fallbackRig;
            if (spoken[index].speaker && options.controllers) {
                lineRig = ensureRigLayer(comp, spoken[index].speaker);
                var known = false;
                for (at = 0; at < cast.length; at += 1) {
                    if (cast[at] === spoken[index].speaker) { known = true; }
                }
                if (!known) { cast.push(spoken[index].speaker); }
            }
            var layer = comp.layers.addText(spoken[index].text);
            layer.name = spoken[index].text.substring(0, 32).replace(/[\r\n]+/g, " ");
            layer.startTime = cursor;
            var applied = applyToTextLayer(comp, layer, "", settings, sequenced, lineRig);
            if (applied.unmarkedKanji) { unmarked.push(applied.unmarkedKanji); }
            if (lineRig) { touched.push(lineRig); }
            planned.push({ layer: layer, plan: applied.plan });
            made.push(layer);
            cursor = nextLineStart(layer.outPoint, gapBeats, bpm);
        }
        // Back to what it was unless the script genuinely needs more room. The
        // last line's own end, not the cursor, which has already stepped past it.
        var wanted = wasDuration;
        for (index = 0; index < made.length; index += 1) {
            if (made[index].outPoint > wanted) { wanted = made[index].outPoint; }
        }
        if (Math.abs(comp.duration - wanted) > 0.0005) { comp.duration = wanted; }
        var overlaps = [];
        touched = uniqueLayers(touched);
        for (index = 0; index < touched.length; index += 1) {
            overlaps = overlaps.concat(rebuildSharedRig(comp, touched[index], planned).overlaps);
        }
        for (index = 1; index <= comp.numLayers; index += 1) { comp.layer(index).selected = false; }
        for (index = 0; index < made.length; index += 1) { made[index].selected = true; }
        return {
            count: made.length,
            // How many script lines were too long for one layer and became
            // several, so the panel can say so rather than leave the user
            // counting layers.
            split: made.length - scripted,
            grew: comp.duration > wasDuration ? comp.duration : 0,
            cast: cast,
            rigs: touched.length,
            unmarkedKanji: unmarked,
            overlaps: overlaps
        };
    }

    /*
     * Importing a song.
     *
     * The panel does not read the MIDI file. It asks the engine, for the same
     * reason it asks for the timing plan: ExtendScript is ES3, a binary parser
     * written there could not be tested without a host, and two readings of the
     * same format would drift apart the first time either changed. The engine
     * already knows how many syllables a lyric line has, which is the other
     * half of the question — so one call answers both, and the panel's job is
     * to place layers.
     */
    function utf8FromHex(hex) {
        var text = "";
        var index = 0;
        var pending = 0;
        var codepoint = 0;
        while (index + 1 < hex.length) {
            // Not "byte": ExtendScript is ES3, where byte is a future reserved
            // word, and the whole panel refuses to load with "illegal use of
            // reserved word" pointing at this line.
            var octet = parseInt(hex.substring(index, index + 2), 16);
            index += 2;
            if (isNaN(octet)) { return ""; }
            if (pending > 0) {
                if ((octet & 0xC0) !== 0x80) { return ""; }
                codepoint = (codepoint << 6) | (octet & 0x3F);
                pending -= 1;
            } else if (octet < 0x80) {
                codepoint = octet;
            } else if ((octet & 0xE0) === 0xC0) {
                codepoint = octet & 0x1F; pending = 1;
            } else if ((octet & 0xF0) === 0xE0) {
                codepoint = octet & 0x0F; pending = 2;
            } else if ((octet & 0xF8) === 0xF0) {
                codepoint = octet & 0x07; pending = 3;
            } else {
                return "";
            }
            if (pending === 0) { text += characterFromCode(codepoint); }
        }
        // A track name in some other encoding decodes to nothing rather than to
        // mojibake, and the caller falls back to numbering the track.
        return pending === 0 ? text : "";
    }

    // Kept apart from the call that produces it, for the same reason
    // parseEnginePlan() is: a parser with no host in it can be exercised by
    // npm test, and a malformed reply is the thing most worth pinning.
    function parseTrackList(reply) {
        var lines = String(reply).split(/[\r\n]+/);
        var tracks = [];
        var declared = -1;
        var bpm = 0;
        var index;
        for (index = 0; index < lines.length; index += 1) {
            var fields = lines[index].split(" ");
            if (fields[0] === "BPM") { bpm = parseFloat(fields[1]); }
            else if (fields[0] === "END") { declared = parseInt(fields[1], 10); }
            else if (fields[0] === "T") {
                tracks.push({
                    index: parseInt(fields[1], 10),
                    notes: parseInt(fields[2], 10),
                    name: fields[3] === "-" ? "" : utf8FromHex(fields[3])
                });
            }
        }
        // callSystem() reports no exit status, so a tool that died halfway would
        // otherwise read as a file with fewer tracks in it.
        if (declared !== tracks.length) {
            throw new Error("Island Chatter could not read that MIDI file." +
                "\n無法讀取這個 MIDI 檔。\n\n" + reply);
        }
        return { tracks: tracks, bpm: bpm };
    }

    function midiTracks(midiFile) {
        var tool = requireEngineTool();
        return parseTrackList(system.callSystem(quoted(tool.fsName) +
            " --list-tracks --midi-hex " + hexUtf8(midiFile.fsName)));
    }

    function parseSong(reply) {
        var lines = String(reply).split(/[\r\n]+/);
        var song = { bpm: 120, extraNotes: 0, extraSyllables: 0, dropped: 0, split: 0, lines: [] };
        var declared = -1;
        var index;
        var at;
        for (index = 0; index < lines.length; index += 1) {
            var fields = lines[index].split(" ");
            if (fields[0] === "BPM") { song.bpm = parseFloat(fields[1]); }
            else if (fields[0] === "END") { declared = parseInt(fields[1], 10); }
            else if (fields[0] === "EXTRA") {
                song.extraNotes = parseInt(fields[1], 10);
                song.extraSyllables = parseInt(fields[2], 10);
                song.dropped = parseInt(fields[3], 10);
                song.split = parseInt(fields[4], 10) || 0;
            } else if (fields[0] === "L") {
                song.lines.push({
                    start: parseFloat(fields[2]),
                    bpm: parseFloat(fields[3]),
                    syllables: parseInt(fields[4], 10),
                    notes: parseInt(fields[5], 10),
                    continued: parseInt(fields[6], 10) !== 0,
                    text: "",
                    melody: []
                });
            } else if (fields[0] === "X" || fields[0] === "N") {
                var which = song.lines[parseInt(fields[1], 10)];
                if (!which) { continue; }
                for (at = 2; at < fields.length; at += 1) {
                    var number = parseInt(fields[at], 10);
                    if (isNaN(number)) { continue; }
                    // Characters travel as decimal codepoints for the same
                    // reason the timing plan's do: stdout comes back through the
                    // console code page and would turn Chinese into "?".
                    if (fields[0] === "X") { which.text += characterFromCode(number); }
                    else { which.melody.push(number); }
                }
            }
        }
        if (declared !== song.lines.length) {
            throw new Error("Island Chatter could not lay out that song." +
                "\n無法把歌詞和旋律對起來。\n\n" + reply);
        }
        return song;
    }

    function songFromMidi(midiFile, trackIndex, lyrics, tonic) {
        var tool = requireEngineTool();
        // An empty lyric drops the flag rather than passing an empty value.
        // This is a command *line*, not an argument array: a trailing
        // "--lyrics " with nothing after it is one token, the tool reaches for
        // a value that is not there, and prints its usage instead of a song.
        var words = hexUtf8(lyrics);
        return parseSong(system.callSystem(quoted(tool.fsName) +
            " --dump-song --midi-hex " + hexUtf8(midiFile.fsName) +
            " --track " + trackIndex +
            " --tonic " + Math.round(tonic || 0) +
            (words ? " --lyrics " + words : "")));
    }

    function importSong(midiFile, trackIndex, lyrics, settings, options, tonic) {
        if (!app.project) { app.newProject(); }
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            throw new Error("Open an active composition first. / 請先開啟合成。");
        }
        // No lyric is not an error: the engine sings the melody's own note
        // names instead, and hands them back as the text for each layer.
        var song = songFromMidi(midiFile, trackIndex, lyrics, tonic);
        if (!song.lines.length) {
            throw new Error("There is nothing to sing on that track. / 這一軌沒有東西可以唱。");
        }
        var fallbackRig = null;
        if (options.rigShared) {
            if (!options.rigCharacter) {
                throw new Error("Choose or create a character first. / 請先選擇或新增角色。");
            }
            fallbackRig = ensureRigLayer(comp, options.rigCharacter);
            writeRigSettings(fallbackRig, settings);
        }
        var sung = {
            markers: options.markers,
            // The melody decides how long a line lasts, so the length always
            // follows it. A sung line left at the wrong length would show the
            // words after the singing stopped.
            fitDuration: true,
            controllers: options.controllers,
            rigShared: options.rigShared,
            rigCharacter: options.rigCharacter,
            typeOn: options.typeOn,
            typeOnCenter: options.typeOnCenter,
            typeOnLeave: options.typeOnLeave,
            typeOnSmoothness: options.typeOnSmoothness
        };
        var wasDuration = comp.duration;
        var planned = [];
        var made = [];
        var touched = [];
        var unmarked = [];
        var truncated = [];
        var index;
        for (index = 0; index < song.lines.length; index += 1) {
            var line = song.lines[index];
            // A line goes where its own first note is. An imported song is not
            // laid out on the panel's beat grid: it belongs at the times the
            // MIDI file says, or it stops being the song.
            var start = comp.time + line.start;
            if (comp.duration < start + IMPORT_HEADROOM) {
                comp.duration = start + IMPORT_HEADROOM;
            }
            var layer = comp.layers.addText(line.text);
            layer.name = line.text.substring(0, 32).replace(/[\r\n]+/g, " ");
            layer.startTime = start;
            var lineSettings = {};
            var key;
            for (key in settings) {
                if (settings.hasOwnProperty(key)) { lineSettings[key] = settings[key]; }
            }
            lineSettings.melody = line.melody;
            lineSettings.melodyBpm = line.bpm;
            var applied = applyToTextLayer(comp, layer, "", lineSettings, sung, fallbackRig);
            if (applied.unmarkedKanji) { unmarked.push(applied.unmarkedKanji); }
            // The engine splits a long line rather than cutting it, so this
            // should never fire. It is reported anyway: silently losing the
            // end of a line is the one outcome nobody could detect.
            if (applied.truncated) { truncated.push(applied.truncated); }
            if (fallbackRig) { touched.push(fallbackRig); }
            planned.push({ layer: layer, plan: applied.plan });
            made.push(layer);
        }
        var wanted = wasDuration;
        for (index = 0; index < made.length; index += 1) {
            if (made[index].outPoint > wanted) { wanted = made[index].outPoint; }
        }
        if (Math.abs(comp.duration - wanted) > 0.0005) { comp.duration = wanted; }
        var overlaps = [];
        touched = uniqueLayers(touched);
        for (index = 0; index < touched.length; index += 1) {
            overlaps = overlaps.concat(rebuildSharedRig(comp, touched[index], planned).overlaps);
        }
        for (index = 1; index <= comp.numLayers; index += 1) { comp.layer(index).selected = false; }
        for (index = 0; index < made.length; index += 1) { made[index].selected = true; }
        return {
            count: made.length,
            bpm: song.bpm,
            extraNotes: song.extraNotes,
            extraSyllables: song.extraSyllables,
            dropped: song.dropped,
            split: song.split,
            grew: comp.duration > wasDuration ? comp.duration : 0,
            unmarkedKanji: unmarked,
            truncated: truncated,
            overlaps: overlaps
        };
    }

    /*
     * Re-syncing a line that has been edited.
     *
     * Pressing Apply on a selection rewrites every layer with whatever the panel
     * is currently showing, which is right when that is what you want and wrong
     * the rest of the time: a selection spanning two characters is silently
     * repainted into one voice, and so is a layer applied before the sliders
     * were nudged. Editing text is the common case, and it should not require
     * getting the panel back to the state it was in when the layer was made.
     *
     * So this reads the voice off the layer itself and changes nothing else
     * about it. What it updates is decided by what the layer already has: only a
     * line that carries markers gets its markers rebuilt, only one with a rig
     * gets its rig rebuilt. The panel's checkboxes cannot add anything here.
     *
     * The length is always refitted, because a text change that does not move
     * the layer's out point leaves every timing after it wrong.
     */
    function resyncLayer(comp, layer, options) {
        var effect = findNativeEffect(layer);
        if (!effect) { return null; }
        var voice = settingsFromEffect(effect);
        var text = textFromLayer(layer);
        var truncated = text.length > MAX_TEXT_UNITS ? layer.name : "";
        var unmarked = unmarkedKanji(text) ? layer.name : "";
        var previousRig = rigTargetLayer(comp, layer);
        var hadMarkers = hasTimingMarkers(layer);
        var hadTypeOn = !!findNamedProperty(
            layer.property("ADBE Text Properties").property("ADBE Text Animators"),
            "Island Chatter Type-On");
        var hadOwnRig = !!findNamedEffect(layer, RIG_TRACK_NAMES[0]);
        setEffectParameters(effect, text, voice, comp.time);
        var plan = planFromEngine(effect);
        // An edit that made the line longer can push it past the end of the
        // composition, where the out point is clamped and the line is squashed
        // to whatever room was left. Growing first is the same reason Import
        // does: a line silently cut short is worse than a longer composition.
        // Only Apply leaves the composition alone, because putting a voice on a
        // layer is not a request to change how long the film is.
        if (comp.duration < layer.inPoint + plan.duration) {
            comp.duration = layer.inPoint + plan.duration;
        }
        layer.outPoint = Math.max(layer.inPoint + comp.frameDuration,
            layer.inPoint + plan.duration);
        if (hadMarkers) { updateTimingMarkers(layer, plan); }
        if (hadOwnRig) { updateAnimationControls(layer, plan); }
        if (hadTypeOn) {
            updateTypeOn(layer, plan, comp.time,
                typeOnCurve(options.typeOnLeave), options.typeOnSmoothness);
            if (findNamedProperty(
                layer.property("ADBE Text Properties").property("ADBE Text Animators"),
                CENTER_ANIMATOR_NAME)) {
                updateTypeOnCentering(comp, layer, plan, typeOnCurve(options.typeOnLeave));
            }
        }
        return {
            plan: plan,
            rig: previousRig,
            truncated: truncated,
            unmarkedKanji: unmarked,
            stale: markBakeStale(comp, layer)
        };
    }

    // The batch around resyncLayer(): rigs are merged once at the end, because
    // a rig with six edited lines in it would otherwise be rebuilt six times.
    function resyncSelection(comp, layers, options) {
        var index;
        var done = 0;
        var stale = 0;
        var touched = [];
        var planned = [];
        var truncated = [];
        var unmarked = [];
        for (index = 0; index < layers.length; index += 1) {
            var synced = resyncLayer(comp, layers[index], options);
            if (!synced) { continue; }
            done += 1;
            if (synced.stale) { stale += 1; }
            if (synced.rig) { touched.push(synced.rig); }
            if (synced.truncated) { truncated.push(synced.truncated); }
            if (synced.unmarkedKanji) { unmarked.push(synced.unmarkedKanji); }
            planned.push({ layer: layers[index], plan: synced.plan });
        }
        var overlaps = [];
        touched = uniqueLayers(touched);
        for (index = 0; index < touched.length; index += 1) {
            overlaps = overlaps.concat(rebuildSharedRig(comp, touched[index], planned).overlaps);
        }
        return {
            count: done,
            stale: stale,
            rigs: touched.length,
            truncated: truncated,
            unmarkedKanji: unmarked,
            overlaps: overlaps
        };
    }

    function hasTimingMarkers(layer) {
        var markers = layer.property("ADBE Marker");
        var index;
        for (index = 1; index <= markers.numKeys; index += 1) {
            if (String(markers.keyValue(index).comment).indexOf("IC:") === 0) { return true; }
        }
        return false;
    }

    /*
     * Re-laying lines out after the script has been edited.
     *
     * Import produces a tidy sequence exactly once. Change one line's text and
     * it grows or shrinks; delete one and there is a hole. Everything after it
     * has to move, which is a drag-and-drop chore proportional to how long the
     * scene is — and the tool that knows every line's real length is right here.
     *
     * The first line stays where it is, except for being pulled onto the beat.
     * Everything else follows it. Baked audio moves with its line, or the sound
     * ends up under whatever line has taken that place on the timeline.
     */
    function reflowLayers(comp, layers, gapBeats, bpm) {
        var ordered = [];
        var index;
        for (index = 0; index < layers.length; index += 1) {
            if (findNativeEffect(layers[index])) { ordered.push(layers[index]); }
        }
        if (!ordered.length) {
            throw new Error("Select the lines to lay out. / 請選取要排列的台詞圖層。");
        }
        ordered.sort(function (first, second) {
            return first.inPoint - second.inPoint || first.index - second.index;
        });
        var wasDuration = comp.duration;
        var cursor = snapForward(ordered[0].inPoint, gridStep(gapBeats, bpm));
        var touched = [];
        var planned = [];
        for (index = 0; index < ordered.length; index += 1) {
            var layer = ordered[index];
            var plan = planFromEngine(findNativeEffect(layer));
            if (comp.duration < cursor + plan.duration + IMPORT_HEADROOM) {
                comp.duration = cursor + plan.duration + IMPORT_HEADROOM;
            }
            var audioLayer = bakedLayerFor(comp, layer);
            var shift = cursor - layer.inPoint;
            // startTime, not inPoint: a line the user has trimmed keeps its trim.
            layer.startTime = layer.startTime + shift;
            layer.outPoint = Math.max(layer.inPoint + comp.frameDuration,
                layer.inPoint + plan.duration);
            if (audioLayer) { audioLayer.startTime = audioLayer.startTime + shift; }
            var boundTo = rigTargetLayer(comp, layer);
            if (boundTo) { touched.push(boundTo); }
            planned.push({ layer: layer, plan: plan });
            cursor = nextLineStart(layer.outPoint, gapBeats, bpm);
        }
        var wanted = wasDuration;
        for (index = 0; index < ordered.length; index += 1) {
            if (ordered[index].outPoint > wanted) { wanted = ordered[index].outPoint; }
        }
        if (Math.abs(comp.duration - wanted) > 0.0005) { comp.duration = wanted; }
        // Keyframes do not follow a layer that has been moved, so every rig the
        // moved lines belong to has to be merged again.
        var overlaps = [];
        touched = uniqueLayers(touched);
        for (index = 0; index < touched.length; index += 1) {
            overlaps = overlaps.concat(rebuildSharedRig(comp, touched[index], planned).overlaps);
        }
        return {
            count: ordered.length,
            rigs: touched.length,
            grew: comp.duration > wasDuration ? comp.duration : 0,
            overlaps: overlaps
        };
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

    /*
     * Interface language. The literals in this file stay written as
     * "English / 中文" so the source reads naturally and the release checks can
     * still find them; T() picks one side, or the Japanese below.
     *
     * Nothing here reaches the effect. Which language the panel is in has no
     * bearing on what is spoken: kana is read as Japanese and Han characters as
     * Mandarin whatever this is set to.
     */
    var UI_LANGUAGE = "zh";
    var UI_LANGUAGE_SETTING = "uiLanguage";
    var IC_JAPANESE_UI = {
        "Direct text-layer voice / 文字圖層直接發聲": "テキストレイヤーが直接しゃべる",
        "Read selected layer / 讀取選取圖層": "選択レイヤーを読み込む",
        "Pronunciation override (optional) / 讀音覆寫（可留空）": "読み方の指定（省略可）",
        "Sunny / 明亮": "サニー",
        "Tiny / 迷你": "タイニー",
        "Cozy / 溫厚": "コージー",
        "Buzzy / 電子": "バジー",
        "Chirpy / 活潑": "チャーピー",
        "Whisper / 耳語": "ウィスパー",
        "Elder / 年長": "エルダー",
        "Droid / 機器": "ドロイド",
        "Neutral / 中性": "ふつう",
        "Happy / 開心": "うれしい",
        "Angry / 生氣": "おこり",
        "Scared / 害怕": "こわがり",
        "Question / 疑問": "ぎもん",
        "Sleepy / 疲倦": "ねむい",
        "Robot / 機器人": "ロボット",
        "Young / 少年": "こども",
        "Adult / 成熟": "おとな",
        "Giant / 巨大": "きょだい",
        "Pitch / 音高": "ピッチ",
        "Speed / 速度": "はやさ",
        "Volume / 音量": "おんりょう",
        "Consonant / 聲母": "しいん",
        "Clarity / 清晰度": "はっきりさ",
        "Cuteness / 可愛度": "かわいさ",
        "Formant / 共鳴": "きょうめい",
        "Vibrato / 顫音": "ビブラート",
        "Vibrato Rate / 顫音速率": "ビブラート速度",
        "Seed / 種子": "シード",
        "Voice / 人聲": "ボイス",
        "Reed / 簧片": "リード",
        "Chip / 電子": "チップ",
        "Metallic / 金屬": "メタリック",
        "Granular / 破碎": "グラニュラー",
        "Growl / 低吼": "うなり",
        "Tempo / 節拍": "テンポ",
        "1 per beat / 每拍 1 字": "1拍に1音",
        "2 per beat / 每拍 2 字": "1拍に2音",
        "3 per beat / 每拍 3 字": "1拍に3音",
        "4 per beat / 每拍 4 字": "1拍に4音",
        "Markers / 逐字標記": "マーカー",
        "Fit Duration / 配合長度": "長さを合わせる",
        "Rig / 動畫控制": "リグ",
        "Per layer / 每層": "レイヤーごと",
        "Shared / 共用角色": "キャラ共有",
        "New / 新增角色": "キャラを追加",
        "Rebuild / 重建": "作り直す",
        "Mouth switch / 建立嘴型切換": "口パクをつなぐ",
        "Import script / 匯入劇本": "台本を読み込む",
        "Gap / 間隔": "あいだ",
        "Speakers / 含角色名": "話者名つき",
        "Choose MIDI / 選 MIDI": "MIDI を選ぶ",
        "Sing / 唱出來": "歌わせる",
        "Key / 唱名調": "階名のド",
        "Transpose / 移調": "移調",
        "Tone / 聲調": "声調",
        "Re-sync / 重新同步": "文字だけ更新",
        "Re-flow / 重新排列": "並べ直す",
        "There are no Island Chatter lines here. / 這個合成裡沒有台詞圖層。":
            "このコンポにセリフのレイヤーがありません。",
        "Select the lines to lay out. / 請選取要排列的台詞圖層。":
            "並べ直すセリフを選んでください。",
        "Paste a script into the text box first. / 請先把劇本貼進上面的文字框。":
            "先に台本をテキスト欄に貼り付けてください。",
        "There is no script to import. / 沒有可以匯入的劇本文字。":
            "読み込める台本がありません。",
        "Choose or create a character first. / 請先選擇或新增角色。":
            "先にキャラを選ぶか追加してください。",
        "There is no shared rig here. / 這個合成裡沒有共用控制器。":
            "このコンポには共有リグがありません。",
        "Type-On / 逐字顯示": "一文字ずつ表示",
        "Center / 維持置中": "中央ぞろえを保つ",
        "Leave / 離開": "出るカーブ",
        "Smoothness / 平滑": "なめらかさ",
        "Apply to selected text layers / 套用到選取文字圖層": "選択したテキストレイヤーに適用",
        "Bake / 轉成音訊": "音声ファイルに書き出す",
        "Remove / 移除": "取り除く",
        "Save / 儲存角色": "キャラを保存",
        "Delete / 刪除": "削除",
        "Custom / 自訂": "カスタム",
        "Random / 隨機": "ランダム",
        "Name this character / 幫這個角色取個名字": "キャラの名前を入れてください",
        "Captain / 隊長": "たいちょう",
        "Grandma / 奶奶": "おばあちゃん",
        "Mimi / 咪咪": "ミミ",
        "Edit text, then apply / 修改文字後按套用": "テキストを直したら適用を押す",
        "Error / 錯誤": "エラー",
        "Read text only / 只讀到文字（此圖層尚未套用）": "テキストだけ読み込みました（未適用）",
        "Select a text layer. / 請選取文字圖層。": "テキストレイヤーを選んでください。",
        "Open an active composition first. / 請先開啟合成。": "先にコンポジションを開いてください。",
        "Apply Island Chatter first, then bake. / 請先按 Apply 再轉成音訊。": "先に適用してから書き出してください。",
        "Apply Island Chatter to this layer first. / 請先對此圖層按 Apply。": "このレイヤーにまず適用してください。"
    };

    function T(literal) {
        var text = String(literal);
        if (UI_LANGUAGE === "ja") {
            var translated = IC_JAPANESE_UI[text];
            // typeof, because every object inherits names like "constructor".
            if (typeof translated === "string") { return translated; }
        }
        var split = text.indexOf(" / ");
        if (split < 0) { return text; }
        // Japanese falls back to the English half rather than the Chinese one:
        // a reader who chose 日本語 is more likely to get something from
        // "Formant" than from "共鳴".
        return UI_LANGUAGE === "zh" ? text.substring(split + 3) : text.substring(0, split);
    }

    // Every control that carries a translatable label, with the literal it was
    // built from, so switching language can put it back through T().
    var localisedControls = [];

    function looksBilingual(value) {
        return typeof value === "string" && value.indexOf(" / ") > 0;
    }

    // Walked once after the panel is built, rather than wrapping eighty call
    // sites. edittext holds what the user typed and is never touched.
    function localiseTree(node) {
        var index;
        if (node.type !== "edittext" && looksBilingual(node.text)) {
            localisedControls.push({ control: node, literal: String(node.text) });
            node.text = T(node.text);
        }
        if (node.items) {
            for (index = 0; index < node.items.length; index += 1) {
                if (looksBilingual(node.items[index].text)) {
                    localisedControls.push({
                        control: node.items[index], literal: String(node.items[index].text) });
                    node.items[index].text = T(node.items[index].text);
                }
            }
        }
        if (node.children) {
            for (index = 0; index < node.children.length; index += 1) {
                localiseTree(node.children[index]);
            }
        }
    }

    function relabelUI() {
        var index;
        for (index = 0; index < localisedControls.length; index += 1) {
            localisedControls[index].control.text = T(localisedControls[index].literal);
        }
    }

    function buildUI(host) {
        var panel = host instanceof Panel ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.margins = 12;
        panel.spacing = 8;
        // Interface language only; it has no effect on what is spoken.
        var languageRow = panel.add("group");
        languageRow.orientation = "row";
        languageRow.alignment = ["right", "top"];
        var languageCodes = ["zh", "en", "ja"];
        var languagePicker = languageRow.add("dropdownlist", undefined,
            ["繁體中文", "English", "日本語"]);
        languagePicker.helpTip = "Interface language. What is spoken does not change." +
            "\n介面語言，不影響唸出來的內容。";
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
            // Follow the layer's own binding rather than leaving the panel
            // pointing at whichever character happened to be showing.
            var bound = rigTargetLayer(comp, layer);
            refreshCharacters(bound ? rigCharacterName(bound) : chosenCharacter());
            if (bound) { rigShared.value = true; }
            var effect = findNativeEffect(layer);
            if (!effect) {
                status.text = "Read text only / 只讀到文字（此圖層尚未套用）";
                return;
            }
            applySettingsToUI(settingsFromEffect(effect));
            status.text = "Read settings from / 已讀取設定：" + layer.name +
                (bound ? "  (" + rigCharacterName(bound) + ")" : "");
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
        // Timbre. Every default reproduces 1.0.x, so nothing here changes an
        // existing layer until it is moved.
        var formant = addSlider(panel, "Formant / 共鳴", 0.25, 4.00, 1.00);
        formant.helpTip = "Scales the vocal tract without touching the pitch." +
            "\n縮放口腔大小，音高不變：往左變小動物，往右變巨人。";
        var source = panel.add("dropdownlist", undefined, [
            "Voice / 人聲", "Reed / 簧片", "Chip / 電子", "Metallic / 金屬",
            "Granular / 破碎", "Growl / 低吼"
        ]);
        source.selection = 0;
        source.helpTip = "What the vocal folds are replaced with." +
            "\n換掉發聲源本身，不只是換共鳴。";
        var vibrato = addSlider(panel, "Vibrato / 顫音", 0.00, 4.00, 1.00);
        var vibratoRate = addSlider(panel, "Vibrato Rate / 顫音速率", 0.00, 30.00, 9.20);
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
        // Written out rather than "1 / beat": the interface translator treats
        // anything containing " / " as an "English / 中文" pair and keeps one
        // side, which turned all four of these into the word "beat".
        var perBeat = tempoRow.add("dropdownlist", undefined,
            ["1 per beat / 每拍 1 字", "2 per beat / 每拍 2 字",
                "3 per beat / 每拍 3 字", "4 per beat / 每拍 4 字"]);
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
            setSliderValue(formant, clamp(loaded.formant, 0.25, 4.00));
            source.selection = clamp(loaded.source, 0, 5);
            setSliderValue(vibrato, clamp(loaded.vibrato, 0.00, 4.00));
            setSliderValue(vibratoRate, clamp(loaded.vibratoRate, 0.00, 30.00));
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

        /*
         * Where the rig goes. Per layer is what every project before this did
         * and stays the default, because switching an existing project's twenty
         * layers over on the next Apply is not a thing to do without being asked.
         */
        var rigRow = panel.add("group");
        rigRow.orientation = "row";
        var rigScope = rigRow.add("group");
        rigScope.orientation = "row";
        var rigPerLayer = rigScope.add("radiobutton", undefined, "Per layer / 每層");
        var rigShared = rigScope.add("radiobutton", undefined, "Shared / 共用角色");
        rigPerLayer.value = true;
        rigPerLayer.helpTip = "Five sliders on each line, as before." +
            "\n每一句自己長五根滑桿，跟以前一樣。";
        rigShared.helpTip = "One set of sliders on a null, driven by whichever line is" +
            " speaking. This is what lets a whole scene drive one character." +
            "\n一整組滑桿放在一個空物件上，由「當下正在講話的那一句」驅動。" +
            "\n一個角色的嘴巴就綁這一組，不管那句是第幾層。";
        // Character names are the user's own words, so they are never put
        // through the interface translator.
        var characterList = rigRow.add("dropdownlist", undefined, []);
        characterList.preferredSize.width = 110;
        var newCharacterButton = rigRow.add("button", undefined, "New / 新增角色");
        var rebuildButton = rigRow.add("button", undefined, "Rebuild / 重建");
        rebuildButton.helpTip = "Re-merge the shared rig from its lines. Needed after moving" +
            " a line in time, because the rig holds keyframes rather than a live link." +
            "\n重新合併共用控制器。把台詞在時間上搬動之後按一下 —— " +
            "\n控制器上是關鍵影格，不是即時連動，所以它不會自己知道。";

        var mouthRow = panel.add("group");
        mouthRow.orientation = "row";
        var mouthButton = mouthRow.add("button", undefined, "Mouth switch / 建立嘴型切換");
        mouthButton.helpTip = "Wire selected layers to the chosen character's IC Mouth." +
            "\n把選取的圖層接到所選角色的 IC Mouth 上。" +
            "\n\nIC Mouth：0 閉嘴，1=a，2=i，3=u，4=e，5=o。" +
            "\n選一個嘴型合成 → 用時間重映射，第 0 格閉嘴，之後依序 a i u e o。" +
            "\n選多個圖層 → 用不透明度切換，由上而下依序是閉嘴、a、i、u、e、o。" +
            "\n\n（IC Head Bounce 是 ±55，IC Blink 是 0／100，" +
            "\nIC Speaking 講話中為 100，IC Line 是現在第幾句。）";

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

        var importRow = panel.add("group");
        importRow.orientation = "row";
        var importButton = importRow.add("button", undefined, "Import script / 匯入劇本");
        importButton.helpTip = "Turn the text box above into one layer per line, laid end to" +
            " end from the current time." +
            "\n把上面的文字框一行變一層，從目前時間點依序排好。" +
            "\n\n每一句都會套用目前的語音設定，長度自動配合語音（不管有沒有勾配合長度）。" +
            "\n太長的句子會自動斷成兩層，斷在標點上，不會被截掉。" +
            "\n合成不夠長時會自動延長到剛好放得下。";
        importRow.add("statictext", undefined, "Gap / 間隔");
        var gapField = importRow.add("edittext", undefined, "1");
        gapField.characters = 4;
        gapField.helpTip = "Beats between one line and the next, against the BPM above." +
            "\n每一句之間空幾拍，用上面那個 BPM 換算。可以填小數。" +
            "\n\n1 = 四分音符，0.5 = 八分音符，0.25 = 十六分音符，2 = 二分音符。" +
            "\n格線會跟著這個數字變細：填 0.5 就對齊到八分音符上。" +
            "\n\n下一句會落在「上一句結束後至少這麼多」的那個格線上，所以這是最小值、" +
            "\n不是固定距離 —— 沒開節拍鎖定時每句長度不是整數拍，" +
            "\n固定距離會讓第三句開始就飄出格線。" +
            "\n填 0 就是完全不留白也不對齊，一句接著一句。";
        var gapReadout = importRow.add("statictext", undefined, "");
        gapReadout.preferredSize.width = 150;
        var speakersOn = importRow.add("checkbox", undefined, "Speakers / 含角色名");
        speakersOn.helpTip = "Read \"Mimi: hello\" as a line spoken by Mimi: the name is" +
            " stripped and the line joins that character's rig." +
            "\n把「咪咪：你好」讀成咪咪講的話 —— 名字不會被唸出來，該句自動加入那個角色。" +
            "\n全形和半形冒號都可以。" +
            "\n\n預設關閉是故意的：「注意：這裡很危險」跟角色名長得一模一樣，" +
            "\n自動判斷會生出一個叫「注意」的角色，還把那兩個字從台詞裡吃掉。";

        var singRow = panel.add("group");
        singRow.orientation = "row";
        var midiButton = singRow.add("button", undefined, "Choose MIDI / 選 MIDI");
        midiButton.helpTip = "Pick a MIDI file and list the tracks in it. Nothing is created" +
            " until Sing." +
            "\n選一個 MIDI 檔，把裡面的軌道列出來。按了不會馬上建圖層。" +
            "\n\n選好軌道之後再按「唱出來」。分成兩步是因為一個 MIDI 檔常常有好幾軌，" +
            "\n猜錯會唱到伴奏。";
        var trackList = singRow.add("dropdownlist", undefined, []);
        trackList.preferredSize.width = 150;
        trackList.helpTip = "Which track carries the tune. / 哪一軌是旋律。" +
            "\n預設選音符最多的那一軌。";
        singRow.add("statictext", undefined, "Transpose / 移調");
        var transposeField = singRow.add("edittext", undefined, "0");
        transposeField.characters = 4;
        transposeField.helpTip = "Semitones added to every note, for a tune written outside" +
            " the character's comfortable range." +
            "\n每個音都往上或往下移幾個半音。-12 是低八度，12 是高八度。" +
            "\n\n聲線不會自己移調：MIDI 寫哪個音就唱哪個音，" +
            "\n所以兩個角色合唱不會走音。角色的差別在共鳴和音色，不在音高。";
        singRow.add("statictext", undefined, "Key / 唱名調");
        var solfegeKey = singRow.add("dropdownlist", undefined,
            ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
        solfegeKey.selection = 0;
        solfegeKey.preferredSize.width = 60;
        solfegeKey.helpTip = "Which pitch is do, when the melody sings its own note names." +
            "\n文字框空白時會唱唱名，這裡決定哪個音是 Do。" +
            "\n\n留在 C 就是固定調（C 是 Do）。選 G 就是首調（G 是 Do），整組唱名跟著移。" +
            "\n只影響唱出來的名字，不影響音高——音高永遠照 MIDI 寫的。" +
            "\n黑鍵沿用下面那個白鍵的名字（升 Do 唱成 Do）。";
        singRow.add("statictext", undefined, "Tone / 聲調");
        var toneBlendField = singRow.add("edittext", undefined, "15");
        toneBlendField.characters = 4;
        toneBlendField.helpTip = "How much of the Mandarin tone contour survives, as a" +
            " percentage." +
            "\n中文四聲保留多少（百分比）。" +
            "\n\n唱歌時音高由旋律決定，完整的四聲會跟旋律打架。" +
            "\n這裡留下的部分變成每個音的起音方向 —— 四聲從上面滑下來，二聲從下面滑上來，" +
            "\n聽起來還是中文咬字，但音準是旋律的。0 = 完全不要，100 = 全部保留。";
        var singButton = singRow.add("button", undefined, "Sing / 唱出來");
        singButton.helpTip = "Sing the lyrics in the text box to the chosen track." +
            "\n把上面文字框裡的歌詞，照選定那一軌的旋律唱出來。" +
            "\n\n一行歌詞一層，每一層放在該句第一個音符的時間上 —— 匯入 MIDI 不看間隔格線，" +
            "\n歌要對在它自己的時間上。長度一律配合旋律。" +
            "\n一個字配一個音，依序發下去；歌詞裡打一個 - 代表前一個字延續唱到下一個音。" +
            "\n和弦只取最高音。音符和字數對不上時會在下面說，不會默默處理。";
        var songReadout = singRow.add("statictext", undefined, "");
        songReadout.preferredSize.width = 190;

        var applyButton = panel.add("button", undefined,
            "Apply to selected text layers / 套用到選取文字圖層");
        applyButton.preferredSize.height = 34;

        var editRow = panel.add("group");
        editRow.orientation = "row";
        var resyncButton = editRow.add("button", undefined, "Re-sync / 重新同步");
        resyncButton.helpTip = "Update the selected lines from their own Source Text, keeping" +
            " each one's own voice exactly as it is." +
            "\n用每一層自己的 Source Text 重新同步文字、長度、標記與動畫控制。" +
            "\n\n和 Apply 的差別：**完全不碰聲音**。面板現在顯示什麼都不影響，" +
            "\n每層維持它自己已經存著的聲音設定。" +
            "\n改字的時候用這個，選再多層、跨再多角色都不會被蓋掉。" +
            "\n\n只會更新這層本來就有的東西：沒有標記的不會被加上標記。長度一律重算。";
        var reflowButton = editRow.add("button", undefined, "Re-flow / 重新排列");
        reflowButton.helpTip = "Lay the selected lines out again end to end, using the gap" +
            " above and each line's real length." +
            "\n把選取的台詞依現在的長度重新接起來排好，間隔用上面設定的拍數。" +
            "\n沒有選取任何圖層時，會排整個合成裡的所有台詞。" +
            "\n\n改了字、刪了一句之後用這個 —— 後面所有句子會自己讓位或補上。" +
            "\n第一句留在原地（只會被拉到最近的拍點上），其餘跟著它排。" +
            "\n轉成音訊過的聲音會跟著它的台詞一起移動。";

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

        function activeComp() {
            var open = app.project ? app.project.activeItem : null;
            return open && open instanceof CompItem ? open : null;
        }

        // Setting a dropdown's selection fires onChange, and that handler loads
        // the character's stored voice into the panel. Refilling the list must
        // not be mistaken for the user picking a character, or every Apply would
        // quietly overwrite the settings they were in the middle of adjusting.
        var loadingCharacters = false;

        function refreshCharacters(preferred) {
            var comp = activeComp();
            var names = [];
            var index;
            if (comp) {
                var found = rigLayers(comp);
                for (index = 0; index < found.length; index += 1) {
                    names.push(rigCharacterName(found[index]));
                }
            }
            loadingCharacters = true;
            while (characterList.items.length > 0) {
                characterList.remove(characterList.items[characterList.items.length - 1]);
            }
            for (index = 0; index < names.length; index += 1) {
                characterList.add("item", names[index]);
            }
            for (index = 0; index < names.length; index += 1) {
                if (names[index] === preferred) { characterList.selection = index; }
            }
            if (!characterList.selection && names.length) { characterList.selection = 0; }
            loadingCharacters = false;
            return names;
        }

        function chosenCharacter() {
            return characterList.selection ? String(characterList.selection.text) : "";
        }

        function chosenRigLayer(comp) {
            var name = chosenCharacter();
            return name ? findRigLayer(comp, name) : null;
        }

        function currentBpm() {
            var value = parseFloat(bpmField.text);
            return clamp(isNaN(value) ? 120 : value, 20, 400);
        }

        function currentGapBeats() {
            var value = parseFloat(gapField.text);
            return Math.max(0, isNaN(value) ? 1 : value);
        }

        // The gap is a note value, so both halves of what it means are worth
        // showing: how long it is, and how fine a grid the lines land on.
        function refreshGap() {
            var beats = currentGapBeats();
            var seconds = beats * beatDuration(currentBpm());
            if (beats <= 0) {
                gapReadout.text = "= 0s  無格線";
                return;
            }
            var note = "";
            if (!valuesDiffer(beats, 0.25)) { note = "  十六分"; }
            else if (!valuesDiffer(beats, 0.5)) { note = "  八分"; }
            else if (!valuesDiffer(beats, 1)) { note = "  四分"; }
            else if (!valuesDiffer(beats, 2)) { note = "  二分"; }
            gapReadout.text = "= " + seconds.toFixed(3) + "s" + note;
        }

        // Read once, in one place: Apply and Import must not be able to disagree
        // about what the panel is currently asking for.
        function currentSettings() {
            return {
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
                tempoLock: tempoOn.value,
                formant: formant.value,
                source: source.selection ? source.selection.index : 0,
                vibrato: vibrato.value,
                vibratoRate: vibratoRate.value,
                // How a melody is sung, which the panel does own. The melody
                // itself is not here on purpose: it belongs to the line, and
                // only Import puts one in.
                transpose: currentTranspose(),
                toneBlend: currentToneBlend(),
                portamento: 0.040,
                vibratoDelay: 0.30
            };
        }

        function currentTranspose() {
            var value = parseInt(transposeField.text, 10);
            return isNaN(value) ? 0 : clamp(value, -48, 48);
        }

        function currentToneBlend() {
            var value = parseFloat(toneBlendField.text);
            return isNaN(value) ? 0.15 : clamp(value, 0, 100) / 100;
        }

        // Which pitch class "do" is, for a melody singing its own note names.
        // Zero is C, where fixed and movable solfège agree.
        function currentSolfegeKey() {
            return solfegeKey.selection ? solfegeKey.selection.index : 0;
        }

        function currentOptions() {
            return {
                markers: markers.value,
                fitDuration: fitDuration.value,
                controllers: controllers.value,
                rigShared: controllers.value && rigShared.value,
                rigCharacter: chosenCharacter(),
                typeOn: typeOn.value,
                typeOnCenter: typeOnCenter.value,
                typeOnLeave: easeLeave.value,
                typeOnSmoothness: smoothness.value,
                speakers: speakersOn.value
            };
        }

        /*
         * What the panel was left set to, kept between sessions.
         *
         * Only the interface language and saved characters used to survive a
         * restart, so a project spread over several days meant setting the
         * voice and the four workflow boxes again every morning.
         *
         * Stored as one flat "name=number" string, and read back a field at a
         * time: a state written by an older version simply has fewer names in
         * it, and the ones it does have still land.
         */
        var PANEL_STATE_SETTING = "panelState";
        var restoringState = false;

        function panelState() {
            return {
                voice: voice.selection ? voice.selection.index : 0,
                emotion: emotion.selection ? emotion.selection.index : 0,
                characterSize: characterSize.selection ? characterSize.selection.index : 2,
                source: source.selection ? source.selection.index : 0,
                pitch: pitch.value, speed: speed.value, volume: volume.value,
                consonant: consonant.value, clarity: clarity.value, cuteness: cuteness.value,
                formant: formant.value, vibrato: vibrato.value, vibratoRate: vibratoRate.value,
                seed: Math.round(seed.value),
                tempoOn: tempoOn.value ? 1 : 0,
                bpm: parseFloat(bpmField.text),
                perBeat: perBeat.selection ? perBeat.selection.index : 1,
                markers: markers.value ? 1 : 0,
                fitDuration: fitDuration.value ? 1 : 0,
                controllers: controllers.value ? 1 : 0,
                rigShared: rigShared.value ? 1 : 0,
                typeOn: typeOn.value ? 1 : 0,
                typeOnCenter: typeOnCenter.value ? 1 : 0,
                easeLeave: easeLeave.value,
                smoothness: smoothness.value,
                gapBeats: currentGapBeats(),
                speakers: speakersOn.value ? 1 : 0,
                // How a melody is sung is a panel setting and survives a
                // restart. The melody and the file it came from do not: they
                // belong to the layers, and a remembered path that no longer
                // resolves is worse than an empty field.
                transpose: currentTranspose(),
                toneBlend: Math.round(currentToneBlend() * 100),
                solfegeKey: currentSolfegeKey()
            };
        }

        function remember() {
            if (restoringState) { return; }
            var state = panelState();
            var parts = [];
            var name;
            for (name in state) {
                if (!state.hasOwnProperty(name)) { continue; }
                var value = state[name];
                if (typeof value !== "number" || isNaN(value)) { continue; }
                parts.push(name + "=" + value);
            }
            // A preference that cannot be written is not worth interrupting
            // anyone over; the panel still works, it just forgets.
            try {
                app.settings.saveSetting(SCRIPT_NAME, PANEL_STATE_SETTING, parts.join("|"));
            } catch (error) { /* read-only preferences */ }
        }

        function storedNumber(state, name, fallback) {
            var value = state[name];
            return (typeof value === "number" && !isNaN(value)) ? value : fallback;
        }

        function restoreState() {
            if (!app.settings.haveSetting(SCRIPT_NAME, PANEL_STATE_SETTING)) { return; }
            var chunks = String(app.settings.getSetting(SCRIPT_NAME, PANEL_STATE_SETTING)).split("|");
            var state = {};
            var index;
            for (index = 0; index < chunks.length; index += 1) {
                var split = chunks[index].indexOf("=");
                if (split <= 0) { continue; }
                var parsed = parseFloat(chunks[index].substring(split + 1));
                if (!isNaN(parsed)) { state[chunks[index].substring(0, split)] = parsed; }
            }
            restoringState = true;
            voice.selection = clamp(Math.round(storedNumber(state, "voice", 0)), 0, voice.items.length - 1);
            emotion.selection = clamp(Math.round(storedNumber(state, "emotion", 0)), 0, emotion.items.length - 1);
            characterSize.selection = clamp(Math.round(storedNumber(state, "characterSize", 2)), 0, characterSize.items.length - 1);
            source.selection = clamp(Math.round(storedNumber(state, "source", 0)), 0, source.items.length - 1);
            setSliderValue(pitch, clamp(storedNumber(state, "pitch", 1.00), 0.10, 4.00));
            setSliderValue(volume, clamp(storedNumber(state, "volume", 0.78), 0.00, 2.00));
            setSliderValue(consonant, clamp(storedNumber(state, "consonant", 1.25), 0.00, 6.00));
            setSliderValue(clarity, clamp(storedNumber(state, "clarity", 0.78), 0.00, 1.00));
            setSliderValue(cuteness, clamp(storedNumber(state, "cuteness", 0.55), 0.00, 1.00));
            setSliderValue(formant, clamp(storedNumber(state, "formant", 1.00), 0.25, 4.00));
            setSliderValue(vibrato, clamp(storedNumber(state, "vibrato", 1.00), 0.00, 4.00));
            setSliderValue(vibratoRate, clamp(storedNumber(state, "vibratoRate", 9.20), 0.00, 30.00));
            setSliderValue(seed, clamp(Math.round(storedNumber(state, "seed", 0)), 0, 999999));
            tempoOn.value = storedNumber(state, "tempoOn", 0) !== 0;
            bpmField.text = String(clamp(storedNumber(state, "bpm", 120), 20, 400));
            perBeat.selection = clamp(Math.round(storedNumber(state, "perBeat", 1)), 0, perBeat.items.length - 1);
            markers.value = storedNumber(state, "markers", 1) !== 0;
            fitDuration.value = storedNumber(state, "fitDuration", 1) !== 0;
            controllers.value = storedNumber(state, "controllers", 1) !== 0;
            // Radio buttons clear each other within their group, but only when
            // the one being turned on is set last.
            rigPerLayer.value = storedNumber(state, "rigShared", 0) === 0;
            rigShared.value = !rigPerLayer.value;
            typeOn.value = storedNumber(state, "typeOn", 0) !== 0;
            typeOnCenter.value = storedNumber(state, "typeOnCenter", 1) !== 0;
            setSliderValue(easeLeave, clamp(storedNumber(state, "easeLeave", DEFAULT_LEAVE_INFLUENCE),
                MIN_INFLUENCE, MAX_INFLUENCE));
            setSliderValue(smoothness, clamp(storedNumber(state, "smoothness", DEFAULT_SMOOTHNESS), 0, 100));
            gapField.text = String(Math.max(0, storedNumber(state, "gapBeats", 1)));
            speakersOn.value = storedNumber(state, "speakers", 0) !== 0;
            transposeField.text = String(clamp(Math.round(storedNumber(state, "transpose", 0)), -48, 48));
            toneBlendField.text = String(clamp(Math.round(storedNumber(state, "toneBlend", 15)), 0, 100));
            solfegeKey.selection = clamp(Math.round(storedNumber(state, "solfegeKey", 0)), 0, solfegeKey.items.length - 1);
            // Speed last, and behind the guard, so restoring it is not mistaken
            // for the user dragging it out of tempo mode.
            writingSpeed = true;
            setSliderValue(speed, clamp(storedNumber(state, "speed", 1.00), 0.10, 10.00));
            writingSpeed = false;
            restoringState = false;
            refreshTempo();
            refreshGap();
        }

        // Chained rather than assigned: several of these already carry a
        // handler, and replacing one would quietly switch tempo mode off.
        function alsoRemember(control, event) {
            var existing = control[event];
            control[event] = function () {
                if (existing) { existing.call(this); }
                remember();
            };
        }

        characterList.onChange = function () {
            if (loadingCharacters) { return; }
            rigShared.value = true;
            var comp = activeComp();
            var rigLayer = comp ? chosenRigLayer(comp) : null;
            // A character created before any voice was applied to it has nothing
            // stored yet; the panel keeps whatever it is showing.
            var loaded = rigLayer ? rigSettings(rigLayer) : null;
            if (loaded) {
                applySettingsToUI(loaded);
                status.text = "Character / 角色: " + chosenCharacter();
            }
        };

        newCharacterButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            var name = prompt("Name this character / 幫這個角色取個名字",
                "Character " + (characterList.items.length + 1));
            if (!name) { return; }
            name = trim(name);
            if (!name) { return; }
            app.beginUndoGroup(SCRIPT_NAME + " - New character");
            try {
                // Built now rather than on the next Apply, so the mouth can be
                // wired up before a single line has been written.
                ensureRigLayer(comp, name);
                rigShared.value = true;
                refreshCharacters(name);
                status.text = "Character / 角色: " + name;
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        rebuildButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            // Whatever the selection points at, or every rig in the composition
            // when nothing is selected.
            var wanted = [];
            var index;
            for (index = 0; index < comp.selectedLayers.length; index += 1) {
                var picked = comp.selectedLayers[index];
                if (isRigLayer(picked)) { wanted.push(picked); continue; }
                var target = rigTargetLayer(comp, picked);
                if (target) { wanted.push(target); }
            }
            if (!wanted.length) { wanted = rigLayers(comp); }
            if (!wanted.length) {
                alert("There is no shared rig here. / 這個合成裡沒有共用控制器。");
                return;
            }
            wanted = uniqueLayers(wanted);
            app.beginUndoGroup(SCRIPT_NAME + " - Rebuild rig");
            try {
                var overlaps = [];
                var lines = 0;
                for (index = 0; index < wanted.length; index += 1) {
                    var merged = rebuildSharedRig(comp, wanted[index], null);
                    lines += merged.lines;
                    overlaps = overlaps.concat(merged.overlaps);
                }
                status.text = "Rebuilt / 已重建 " + wanted.length + " rig(s), " +
                    lines + " line(s)";
                if (overlaps.length) {
                    status.text = "Overlapping lines / 台詞重疊: " + overlaps.join(", ");
                }
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        mouthButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            var rigLayer = chosenRigLayer(comp);
            if (!rigLayer) {
                alert("Choose or create a character first. / 請先選擇或新增角色。");
                return;
            }
            var targets = [];
            var index;
            for (index = 0; index < comp.selectedLayers.length; index += 1) {
                if (!isRigLayer(comp.selectedLayers[index])) {
                    targets.push(comp.selectedLayers[index]);
                }
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Mouth switch");
            try {
                var built = buildMouthSwitch(comp, rigLayer, targets);
                status.text = built.kind === "remap"
                    ? "Mouth on Time Remap / 嘴型已接上時間重映射"
                    : "Mouth switch / 已接上嘴型 " + built.count + " 層 -> " +
                        rigCharacterName(rigLayer);
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

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
            // A rig null is not a text layer, but it is Island Chatter's, and
            // Remove is where a user goes to be rid of it.
            var doomed = [];
            var affected = [];
            var index;
            for (index = 0; index < comp.selectedLayers.length; index += 1) {
                if (isRigLayer(comp.selectedLayers[index])) {
                    doomed.push(comp.selectedLayers[index]);
                }
            }
            doomed = uniqueLayers(doomed);
            for (index = 0; index < layers.length; index += 1) {
                var bound = rigTargetLayer(comp, layers[index]);
                if (bound) { affected.push(bound); }
            }
            // Worked out before anything is deleted, because a rig that is about
            // to go must not be rebuilt and a deleted layer cannot be asked
            // anything at all.
            var survivors = [];
            affected = uniqueLayers(affected);
            for (index = 0; index < affected.length; index += 1) {
                var going = false;
                var at;
                for (at = 0; at < doomed.length; at += 1) {
                    if (doomed[at].index === affected[index].index) { going = true; }
                }
                if (!going) { survivors.push(affected[index]); }
            }
            if (!layers.length && !doomed.length) {
                alert("Select a text layer. / 請選取文字圖層。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Remove");
            try {
                var removed = 0;
                for (index = 0; index < layers.length; index += 1) {
                    removed += removeFromLayer(comp, layers[index]);
                }
                for (index = 0; index < doomed.length; index += 1) {
                    removed += removeRigLayer(comp, doomed[index]);
                }
                for (index = 0; index < survivors.length; index += 1) {
                    rebuildSharedRig(comp, survivors[index], null);
                }
                refreshCharacters(chosenCharacter());
                status.text = "Removed / 已移除 " + removed + " item(s) from " +
                    (layers.length + doomed.length) + " layer(s)";
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };
        resyncButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            var layers = selectedTextLayers(comp);
            if (!layers.length) {
                alert("Select a text layer. / 請選取文字圖層。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Re-sync");
            try {
                var synced = resyncSelection(comp, layers, currentOptions());
                status.text = "Re-synced / 已重新同步 " + synced.count + " layer(s)" +
                    (synced.rigs ? "  rig x" + synced.rigs : "") +
                    (synced.stale ? "  bake 過期 x" + synced.stale : "");
                if (!synced.count) {
                    status.text = "Apply Island Chatter to these layers first. / 這些圖層還沒套用過。";
                }
                if (synced.overlaps.length) {
                    status.text = "Overlapping lines / 台詞重疊: " + synced.overlaps.join(", ");
                }
                if (synced.truncated.length) {
                    status.text = "Truncated / 已截斷: " + synced.truncated.join(", ");
                }
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        reflowButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert("Open an active composition first. / 請先開啟合成。");
                return;
            }
            // Nothing selected means the whole scene, which is what you want
            // after deleting a line you no longer have selected.
            var layers = selectedTextLayers(comp);
            var index;
            if (!layers.length) {
                for (index = 1; index <= comp.numLayers; index += 1) {
                    if (isTextLayer(comp.layer(index)) && findNativeEffect(comp.layer(index))) {
                        layers.push(comp.layer(index));
                    }
                }
            }
            if (!layers.length) {
                alert("There are no Island Chatter lines here. / 這個合成裡沒有台詞圖層。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Re-flow");
            try {
                var laid = reflowLayers(comp, layers, currentGapBeats(), currentBpm());
                status.text = "Re-flowed / 已排列 " + laid.count + " layer(s) @ " +
                    currentGapBeats() + " 拍" +
                    (laid.rigs ? "  rig x" + laid.rigs : "") +
                    (laid.grew ? "  合成延長到 " + laid.grew.toFixed(2) + "s" : "");
                if (laid.overlaps.length) {
                    status.text = "Overlapping lines / 台詞重疊: " + laid.overlaps.join(", ");
                }
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        importButton.onClick = function () {
            var script = trim(textInput.text);
            if (!script) {
                alert("Paste a script into the text box first. / 請先把劇本貼進上面的文字框。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Import script");
            try {
                var imported = importScript(script, currentSettings(), currentOptions(),
                    currentGapBeats(), currentBpm());
                refreshCharacters(chosenCharacter());
                status.text = "Imported / 已匯入 " + imported.count + " layer(s)" +
                    (imported.split > 0 ? "  (+" + imported.split + " 斷句)" : "") +
                    (imported.cast.length ? "  角色: " + imported.cast.join(", ") : "") +
                    (imported.grew ? "  合成延長到 " + imported.grew.toFixed(2) + "s" : "");
                if (imported.overlaps.length) {
                    status.text = "Overlapping lines / 台詞重疊: " + imported.overlaps.join(", ");
                }
                if (imported.unmarkedKanji.length) {
                    status.text = "Kanji read as Chinese / 漢字以中文讀音唸出: " +
                        imported.unmarkedKanji.join(", ");
                }
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
                remember();
            }
        };
        // The chosen file and what the engine said is in it. Deliberately not
        // remembered between sessions: a path that no longer exists is worse
        // than an empty field, and the melody itself lives on the layers.
        var chosenMidi = null;
        var midiTrackInfo = [];

        midiButton.onClick = function () {
            var picked = File.openDialog("Choose a MIDI file / 選一個 MIDI 檔",
                "MIDI:*.mid;*.midi,All files:*.*");
            if (!picked) { return; }
            try {
                var listed = midiTracks(picked);
                var usable = [];
                var index;
                for (index = 0; index < listed.tracks.length; index += 1) {
                    if (listed.tracks[index].notes > 0) { usable.push(listed.tracks[index]); }
                }
                if (!usable.length) {
                    status.text = "No notes in that file / 這個檔案裡沒有音符";
                    return;
                }
                chosenMidi = picked;
                midiTrackInfo = usable;
                trackList.removeAll();
                // The track with the most notes first, because that is almost
                // always the melody and it saves a decision most of the time.
                var best = 0;
                for (index = 0; index < usable.length; index += 1) {
                    var label = usable[index].name ||
                        ("Track " + usable[index].index);
                    trackList.add("item", label + "  (" + usable[index].notes + ")");
                    if (usable[index].notes > usable[best].notes) { best = index; }
                }
                trackList.selection = best;
                bpmField.text = String(Math.round(listed.bpm));
                refreshTempo();
                songReadout.text = usable.length + " 軌・" + Math.round(listed.bpm) + " BPM";
                status.text = "MIDI loaded / 已讀取 " + picked.name +
                    "  —— 選好軌道後按「唱出來」";
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            }
        };

        singButton.onClick = function () {
            var lyrics = trim(textInput.text);
            if (!chosenMidi) {
                alert("Choose a MIDI file first. / 請先按「選 MIDI」挑一個檔案。");
                return;
            }
            // An empty text box is a request, not a mistake: with no words the
            // melody sings its own note names.
            var which = trackList.selection ? trackList.selection.index : 0;
            var track = midiTrackInfo[which];
            if (!track) {
                alert("Choose a track first. / 請先選一個軌道。");
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Import MIDI");
            try {
                var sungSettings = currentSettings();
                var sung = importSong(chosenMidi, track.index, lyrics, sungSettings,
                    currentOptions(), currentSolfegeKey());
                refreshCharacters(chosenCharacter());
                songReadout.text = sung.count + " 句・" + Math.round(sung.bpm) + " BPM";
                status.text = (lyrics ? "Sung / 已唱出 " : "Sung note names / 已唱唱名 ") +
                    sung.count + " layer(s)" +
                    (sung.grew ? "  合成延長到 " + sung.grew.toFixed(2) + "s" : "");
                // Everything that did not line up, said out loud. A lyric that
                // does not fit its melody is the most likely thing to be wrong
                // about an import, and only the user can decide what to do.
                var trouble = [];
                if (sung.extraSyllables) {
                    trouble.push(sung.extraSyllables + " 個字沒有音符（用最後一個音唱完）");
                }
                if (sung.extraNotes) { trouble.push(sung.extraNotes + " 個音符沒有字"); }
                if (sung.dropped) { trouble.push("和弦捨去 " + sung.dropped + " 個音"); }
                if (sung.split) { trouble.push("太長的句子拆成 " + sung.split + " 層"); }
                if (sung.truncated.length) {
                    trouble.push("被截斷: " + sung.truncated.join(", "));
                }
                if (trouble.length) {
                    status.text = "Sung / 已唱出 " + sung.count + " 句 —— " + trouble.join("，");
                }
                if (sung.unmarkedKanji.length) {
                    status.text = "Kanji read as Chinese / 漢字以中文讀音唸出: " +
                        sung.unmarkedKanji.join(", ");
                }
            } catch (error) {
                status.text = "Error / 錯誤";
                alert(error.toString());
            } finally {
                app.endUndoGroup();
                remember();
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
                var applied = createOrUpdate(
                    text, trim(pronunciationInput.text), currentSettings(), currentOptions());
                refreshCharacters(chosenCharacter());
                status.text = "Applied to " + applied.count + " layer(s) / 已套用 " +
                    applied.count + " 個圖層" +
                    (applied.rigs ? "  rig x" + applied.rigs : "") +
                    (applied.stale ? "  bake 過期 x" + applied.stale : "");
                // Two lines of one character talking at once is nearly always a
                // mistake. The rig is still built — the later line wins — but
                // saying nothing would leave the user hunting for why a mouth
                // stops halfway through a word.
                if (applied.overlaps.length) {
                    status.text = "Overlapping lines / 台詞重疊: " + applied.overlaps.join(", ");
                }
                if (applied.unmarkedKanji.length) {
                    status.text = "Kanji read as Chinese / 漢字以中文讀音唸出: " +
                        applied.unmarkedKanji.join(", ");
                }
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
                remember();
            }
        };

        // Every control that decides what Apply does. onChange fires when a
        // slider is released, not while it is dragged, so this is one write per
        // adjustment rather than one per pixel.
        var remembered = [voice, emotion, characterSize, source, perBeat, pitch, speed,
            volume, consonant, clarity, cuteness, formant, vibrato, vibratoRate, seed,
            markers, fitDuration, controllers, typeOn, typeOnCenter, rigPerLayer,
            rigShared, easeLeave, smoothness, speakersOn];
        var rememberAt;
        for (rememberAt = 0; rememberAt < remembered.length; rememberAt += 1) {
            alsoRemember(remembered[rememberAt], "onChange");
        }
        alsoRemember(tempoOn, "onClick");
        alsoRemember(bpmField, "onChange");
        alsoRemember(gapField, "onChange");
        alsoRemember(transposeField, "onChange");
        alsoRemember(toneBlendField, "onChange");
        alsoRemember(solfegeKey, "onChange");
        // The gap is stated in beats, so its seconds move when either does.
        bpmField.onChange = (function (existing) {
            return function () { if (existing) { existing.call(this); } refreshGap(); };
        }(bpmField.onChange));
        gapField.onChange = (function (existing) {
            return function () { if (existing) { existing.call(this); } refreshGap(); };
        }(gapField.onChange));
        refreshGap();

        // Built in "English / 中文" throughout, then translated in one pass.
        if (app.settings.haveSetting(SCRIPT_NAME, UI_LANGUAGE_SETTING)) {
            var stored = String(app.settings.getSetting(SCRIPT_NAME, UI_LANGUAGE_SETTING));
            var storedIndex;
            for (storedIndex = 0; storedIndex < languageCodes.length; storedIndex += 1) {
                if (languageCodes[storedIndex] === stored) { UI_LANGUAGE = stored; }
            }
        }
        var pickerIndex;
        for (pickerIndex = 0; pickerIndex < languageCodes.length; pickerIndex += 1) {
            if (languageCodes[pickerIndex] === UI_LANGUAGE) {
                languagePicker.selection = pickerIndex;
            }
        }
        localiseTree(panel);
        // After the language pass, because the list holds the user's own
        // character names and must not go through it.
        refreshCharacters("");
        // Last, so it overrides the defaults every control was built with
        // rather than being overwritten by them.
        restoreState();
        languagePicker.onChange = function () {
            UI_LANGUAGE = languageCodes[languagePicker.selection ? languagePicker.selection.index : 0];
            app.settings.saveSetting(SCRIPT_NAME, UI_LANGUAGE_SETTING, UI_LANGUAGE);
            relabelUI();
            panel.layout.layout(true);
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

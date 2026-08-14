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
    // Appended in 1.8.0: velocity and the fine part of each note's length. A
    // 1.7.0 project reads these as zero, which is no dynamics and no extra
    // length, and the coarse field alone still means the same durations.
    var PARAM_MELODY_DETAIL_FIRST = 215;
    /*
     * Appended in 3.2.0: a vowel space measured from somebody's own voice.
     *
     * The flag, then ten numbers — F1 and F2 for a, e, i, o, u, in Hz. A
     * project saved before 3.2.0 reads all eleven as zero, which is exactly
     * "nothing measured": the engine's own vowel table stands and the line
     * sounds the way it always did. Mirrors kParamCustomTimbre and
     * kParamCustomVowelFirst in native/plugin/params.hpp.
     */
    var PARAM_CUSTOM_TIMBRE = 279;
    var PARAM_CUSTOM_VOWEL_FIRST = 280;
    // a e i o u, two numbers each, in that order — the order the engine's own
    // vowel table starts with, so a measurement lands on its own row.
    var CUSTOM_VOWEL_NAMES = ["a", "e", "i", "o", "u"];
    var CUSTOM_VOWEL_VALUES = 10;
    // One slot per note, holding pitch * 512 + ticks in the same 0-65535 range
    // a text unit uses. Mirrors kMelodySlots and kMelodySlotStride in
    // native/include/island_chatter/dsp.hpp.
    var MELODY_SLOTS = 64;
    var MELODY_SLOT_STRIDE = 512;
    // A tick is a ninety-sixth of a beat, split across the two slots as
    // coarse * 4 + extra. Mirrors kMelodyTicksPerBeat in dsp.hpp.
    var MELODY_TICKS_PER_BEAT = 96;
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

    /*
     * Which character a line was given, written where the line can carry it.
     *
     * Until 3.1.0 a line only knew this while it pointed at a shared rig: the
     * rig layer's comment holds the voice (invariant 8l), so unbinding a line —
     * or never binding it, which is what the per-layer rig is — left nothing
     * anywhere saying who was speaking. The numbers were on the effect, but
     * eight sliders are not a name, and "is this still 咪咪?" could only be
     * answered by comparing them by hand.
     *
     * It goes in the effect's *display name* rather than in a new control. The
     * layer's own `comment` belongs to the user, a marker would sit among the
     * timing markers, and a slider cannot hold a string; the effect name is
     * already something this panel writes — `[Override]` has lived there since
     * 1.0.2 — and `findEffect()` matches on `matchName` first, so a renamed
     * effect is still found. It also puts the answer where somebody would look
     * for it: the Effect Controls panel now reads `Island Chatter Voice · 咪咪`.
     *
     * The identity stored is language-independent. A built-in character's label
     * is `"Mimi / 咪咪"`, and writing whichever half the panel happens to be
     * showing would make the same line read as a different character after a
     * language switch — invariant 8i's lesson, in a place that outlives the
     * session. So the English half is stored and the panel translates it back
     * for display.
     *
     * Nothing behavioural hangs on it: a user who renames the effect loses the
     * label and nothing else. It is a record, not a pointer.
     */
    var CHARACTER_MARK = " · ";
    var OVERRIDE_MARK = " [Override]";

    var BUILT_IN_CHARACTERS = ["Custom / 自訂", "Mimi / 咪咪", "Captain / 隊長",
        "Grandma / 奶奶", "Robot / 機器人"];

    function effectDisplayName(character, hasOverride) {
        return DISPLAY_NAME +
            (character ? CHARACTER_MARK + character : "") +
            (hasOverride ? OVERRIDE_MARK : "");
    }

    function characterOfEffect(effect) {
        if (!effect) { return ""; }
        var name = String(effect.name);
        var at = name.indexOf(CHARACTER_MARK);
        if (at < 0) { return ""; }
        var found = name.substring(at + CHARACTER_MARK.length);
        if (found.length > OVERRIDE_MARK.length &&
                found.substring(found.length - OVERRIDE_MARK.length) === OVERRIDE_MARK) {
            found = found.substring(0, found.length - OVERRIDE_MARK.length);
        }
        return trim(found);
    }

    function characterOfLayer(layer) {
        return characterOfEffect(findNativeEffect(layer));
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

    function melodyDetailProperty(effect, index) {
        return effect.property(PARAM_MELODY_DETAIL_FIRST + index);
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
        /*
         * The measured vowel space, when the settings carry one.
         *
         * `customVowels` absent means the caller is not talking about it, and
         * the layer keeps whatever it has — the same rule the melody follows
         * (invariant 8t), and for the same reason: Apply must not wipe a
         * measurement that Import or a saved character put there. An empty
         * array *is* talking about it, and clears it.
         */
        if (settings.customVowels) {
            var measured = settings.customVowels;
            var anyMeasured = false;
            var vowel;
            for (vowel = 0; vowel < CUSTOM_VOWEL_VALUES; vowel += 1) {
                var hertz = measured.length > vowel ? Math.round(measured[vowel]) : 0;
                if (hertz > 0) { anyMeasured = true; }
                setPropertyValue(effect.property(PARAM_CUSTOM_VOWEL_FIRST + vowel),
                    clamp(hertz, 0, 5000), time);
            }
            setPropertyValue(effect.property(PARAM_CUSTOM_TIMBRE), anyMeasured ? 1 : 0, time);
        }
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
            var details = settings.melodyDetails || [];
            for (index = 0; index < MELODY_SLOTS; index += 1) {
                setPropertyValue(melodySlotProperty(effect, index),
                    index < notes ? settings.melody[index] : 0, time);
                setPropertyValue(melodyDetailProperty(effect, index),
                    index < notes && index < details.length ? details[index] : 0, time);
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

    function melodyDetailsFromEffect(effect) {
        var notes = Math.min(Math.round(effect.property(PARAM_MELODY_LENGTH).value), MELODY_SLOTS);
        var details = [];
        var index;
        for (index = 0; index < notes; index += 1) {
            details.push(Math.round(melodyDetailProperty(effect, index).value));
        }
        return details;
    }

    // The inverse of setEffectParameters(): what the layer is actually set to,
    // which is not necessarily what the panel is showing. The melody comes back
    // with it, which is what lets Re-sync rewrite an edited line without the
    // panel having to know what tune it was singing.
    function settingsFromEffect(effect) {
        return {
            melody: melodyFromEffect(effect),
            melodyDetails: melodyDetailsFromEffect(effect),
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
            vibratoRate: effect.property(PARAM_VIBRATO_RATE).value,
            // Always read, so Re-sync writes back exactly what it found and a
            // measured voice survives an edit to the text (invariant 8o).
            customVowels: customVowelsFromEffect(effect)
        };
    }

    /*
     * The ten numbers a layer is carrying, or an empty array.
     *
     * Empty when the flag is off, rather than the ten numbers that happen to be
     * sitting there: a layer whose custom timbre was cleared has zeros written
     * over it, but a project from before 3.2.0 has zeros because nothing was
     * ever written, and both must read as "no measurement" without the caller
     * having to know which.
     */
    function customVowelsFromEffect(effect) {
        var out = [];
        if (Math.round(effect.property(PARAM_CUSTOM_TIMBRE).value) === 0) { return out; }
        var index;
        for (index = 0; index < CUSTOM_VOWEL_VALUES; index += 1) {
            out.push(Math.round(effect.property(PARAM_CUSTOM_VOWEL_FIRST + index).value));
        }
        return out;
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
            " --melody-detail " + melodyDetailsFromEffect(effect).join(",") +
            " --melody-bpm " + effect.property(PARAM_MELODY_BPM).value +
            " --transpose " + Math.round(effect.property(PARAM_MELODY_TRANSPOSE).value) +
            " --tone-blend " + (effect.property(PARAM_TONE_BLEND).value / 100) +
            " --portamento " + (effect.property(PARAM_PORTAMENTO).value / 1000) +
            " --vibrato-delay " + effect.property(PARAM_VIBRATO_DELAY).value;
    }

    /*
     * A voice, as the engine's command line spells it.
     *
     * One builder, taking the settings object both sides already speak: a layer
     * goes through `settingsFromEffect()` first, and Preview hands over what
     * the panel is holding. Two builders would have been the shorter change and
     * would have drifted the first time a control was added — the panel would
     * preview a voice the layer will not render, which is the same class of
     * mistake invariant 8b names for timing and 8ab for provider tables.
     */
    function voiceArguments(settings) {
        return " --voice " + settings.voice +
            " --emotion " + settings.emotion +
            " --size " + settings.characterSize +
            " --seed " + settings.seed +
            " --rate " + ENGINE_SAMPLE_RATE +
            " --pitch " + settings.pitch +
            " --speed " + settings.speed +
            " --volume " + settings.volume +
            " --consonant " + settings.consonant +
            " --clarity " + settings.clarity +
            " --cuteness " + settings.cuteness +
            " --tempo-lock " + (settings.tempoLock ? 1 : 0) +
            " --formant " + settings.formant +
            " --source " + settings.source +
            " --vibrato " + settings.vibrato +
            " --vibrato-rate " + settings.vibratoRate;
    }

    function engineVoiceArguments(effect) {
        return melodyArguments(effect) +
            " --text " + hexUtf8(textFromEffect(effect)) +
            voiceArguments(settingsFromEffect(effect));
    }

    function requireEngineTool() {
        var tool = bakeToolFile();
        if (!tool) {
            throw new Error(M("island_chatter_bake.exe is missing. Reinstall Island Chatter. / 找不到 island_chatter_bake.exe，請重新安裝 Island Chatter。"));
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
                    startSamples: parseInt(fields[1], 10),
                    lengthSamples: parseInt(fields[2], 10)
                });
            }
        }
        // callSystem() reports no exit status, so a tool that died halfway would
        // otherwise read as a short utterance and silently shorten the layer.
        if (!rate || samples < 0 || declared !== events.length) {
            throw new Error(
                M("Island Chatter could not read the timing plan. / Island Chatter 無法讀取時間規劃。") +
                "\n\n" + reply);
        }
        /*
         * Seconds come from the rate the plan states, not from the constant the
         * panel happens to ask for, and not until the whole reply has been read.
         *
         * They are the same number for a spoken line, because the panel is what
         * passed it. They are not for an analysed recording: that answers about
         * a file whose rate nobody here chose, and a plan reading 44100 divided
         * by a hardcoded 48000 would put every mouth shape 9% early, drifting
         * further the longer the line, with nothing on screen to say why.
         */
        var at;
        for (at = 0; at < events.length; at += 1) {
            events[at].time = events[at].startSamples / rate;
            events[at].duration = events[at].lengthSamples / rate;
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
    var RIG_TRACKS = ["mouth", "volume", "pitch", "bounce", "blink", "accent"];
    var RIG_TRACK_NAMES = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce", "IC Blink",
        "IC Accent"];
    // Accent rests at 50, which is where every syllable leaves it.
    var RIG_TRACK_DEFAULTS = [0, 0, 100, 0, 0, 50];

    /*
     * IC Accent: 100 at the top of every syllable, settling to 50 across it.
     *
     * The other five tracks are hold keys — nothing between one key and the
     * next, because a rig that interpolates costs a per-frame evaluation and
     * this one deliberately does not. Accent is the exception: a value that
     * snapped between 100 and 50 would be the same thing IC Volume already
     * gives. What makes it useful is the shape, so it is the one track written
     * with a curve.
     *
     * Fast out of the attack and slow into the settle, which is how anything
     * struck behaves. The influences are the two ends of that: a small one
     * leaves at speed, a large one arrives crawling.
     *
     * Each key still holds where it lands, so the value sits at 50 through a
     * pause and snaps back to 100 on the next syllable rather than ramping up
     * to meet it.
     */
    var ACCENT_HIGH = 100;
    var ACCENT_LOW = 50;
    var ACCENT_ATTACK = { holdIn: true, inInfluence: 8, outInfluence: 8 };
    var ACCENT_SETTLE = { holdOut: true, inInfluence: 85, outInfluence: 85 };
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
    /*
     * When the mouth shuts.
     *
     * Speaking, every syllable closes at 82% of its length, and the closed span
     * runs from there to the next syllable — which in dialogue includes the gap
     * and any punctuation rest, so it lasts long enough to read as a mouth
     * closing. Measured on ordinary dialogue: eleven closes, the longest 242 ms,
     * one of them under a frame.
     *
     * Sung notes butt straight up against each other, so that span collapses to
     * the 18% bite and nothing else. On a real song line that is 36 closes in
     * 5.4 seconds with 24 of them shorter than a frame at 30 fps — and hold keys
     * are sampled per frame, so which ones land is arbitrary. The mouth does not
     * close, it flickers. The same rule fails the other way on a held note: two
     * seconds of "ah" shuts the mouth for 360 ms in the middle of it.
     *
     * A percentage was the wrong unit for both. Closing the mouth takes about as
     * long whatever the note does, and it only happens when there is a break to
     * close for. So a sung line closes only when the silence that follows is at
     * least this many frames long — frames, because the failure is a
     * frame-sampling artefact and the threshold has to be in the same units.
     */
    var MOUTH_CLOSE_FRAMES = 2;

    /*
     * Which of the two mouth styles the rig is written in.
     *
     * A panel-wide preference rather than a per-layer one, because it is a look
     * for the whole film: a scene with half its lines flapping and half of them
     * legato is not a thing anyone wants. It is read at the two places that
     * build a rig and handed to mergeRigTimeline() explicitly, so the function
     * itself stays pure and the portable tests can pin both styles.
     *
     * False — the default since 1.10.0 — closes the mouth only where there is a
     * pause to close for. True is what every release up to 1.9.1 wrote: a close
     * at 82% of every syllable, which on ordinary dialogue is nineteen open-shut
     * cycles for ten syllables and the mouth shut 41% of the time.
     */
    var mouthChatter = false;

    // How long a sung note's head bounce may last. Without it a four-beat note
    // leans slowly to one side for three quarters of a second.
    var SUNG_BOUNCE_SECONDS = 0.12;

    function mergeRigTimeline(lines, baseline, frameDuration) {
        var tracks = {
            mouth: [], volume: [], pitch: [], bounce: [], blink: [], accent: [],
            speaking: [], lineIndex: []
        };
        var overlaps = [];
        // Thirty frames a second unless the caller says otherwise, which only
        // the portable tests ever leave out.
        var visibleGap = MOUTH_CLOSE_FRAMES * (frameDuration > 0 ? frameDuration : 1 / 30);
        function key(track, time, value) { track.push({ time: time, value: value }); }
        key(tracks.mouth, baseline, 0);
        key(tracks.volume, baseline, 0);
        key(tracks.pitch, baseline, 100);
        key(tracks.bounce, baseline, 0);
        key(tracks.blink, baseline, 0);
        key(tracks.accent, baseline, ACCENT_LOW);
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
                var finish;
                var shuts = true;
                var bounceEnd;
                // Chatter is the spoken look only. A sung line always uses the
                // pause rule, because there the short closes are sub-frame and
                // that is a sampling artefact rather than a style.
                if (line.sung || !line.chatter) {
                    // A sung note runs to its own end, and only shuts if the
                    // silence after it is long enough to see. Two notes with
                    // nothing between them just change shape.
                    var nextStart = at + 1 < line.plan.events.length
                        ? line.start + line.plan.events[at + 1].time
                        : limit;
                    var until = Math.min(nextStart, limit);
                    finish = Math.min(start + event.duration, until);
                    shuts = (until - finish) >= visibleGap ||
                        at + 1 >= line.plan.events.length;
                    // Only a held note needs the bounce capped; a spoken
                    // syllable is far too short to reach it.
                    bounceEnd = line.sung
                        ? Math.min(start + Math.min(event.duration * 0.38, SUNG_BOUNCE_SECONDS), limit)
                        : Math.min(start + event.duration * 0.38, limit);
                } else {
                    finish = Math.min(start + event.duration * 0.82, limit);
                    bounceEnd = Math.min(start + event.duration * 0.38, limit);
                }
                key(tracks.mouth, start, event.mouth);
                if (shuts) { key(tracks.mouth, finish, 0); }
                key(tracks.volume, start, 82);
                if (shuts) { key(tracks.volume, finish, 0); }
                key(tracks.pitch, start, tonePitch(event.tone));
                key(tracks.pitch, finish, 100);
                key(tracks.bounce, start, syllable % 2 ? -55 : 55);
                key(tracks.bounce, bounceEnd, 0);
                // Struck at the top of the syllable and left to settle across
                // it, whatever the mouth is doing.
                tracks.accent.push(
                    { time: start, value: ACCENT_HIGH, shape: ACCENT_ATTACK });
                tracks.accent.push({
                    time: Math.min(start + event.duration, limit),
                    value: ACCENT_LOW,
                    shape: ACCENT_SETTLE
                });
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

    /*
     * A key with a different interpolation on each side.
     *
     * setEasedKey() is bezier on both, which Type-On wants and Accent does not:
     * Accent has to leave the settle as a hard step and arrive at it on a
     * curve. AE takes the two independently, so the shape is described rather
     * than approximated.
     */
    function setShapedKey(property, time, value, shape) {
        property.setValueAtTime(time, value);
        try {
            var index = property.nearestKeyIndex(time);
            // Ease first, type second. setTemporalEaseAtKey() puts the key back
            // to bezier on both sides, so setting the interpolation before it
            // is silently undone — verified against After Effects 26: the eases
            // landed, both HOLD sides did not, and the track read as a ramp
            // where it should have stepped. The host suite checks the types
            // back off the layer for exactly this reason.
            property.setTemporalEaseAtKey(index,
                [new KeyframeEase(0, shape.inInfluence)],
                [new KeyframeEase(0, shape.outInfluence)]);
            property.setInterpolationTypeAtKey(index,
                shape.holdIn ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.BEZIER,
                shape.holdOut ? KeyframeInterpolationType.HOLD : KeyframeInterpolationType.BEZIER);
        } catch (error) {
            // Older hosts may reject one of the two; the values still land.
        }
    }

    function writeRigTrack(slider, keys) {
        clearKeys(slider);
        var index;
        for (index = 0; index < keys.length; index += 1) {
            if (keys[index].shape) {
                setShapedKey(slider, keys[index].time, keys[index].value, keys[index].shape);
            } else {
                setHoldKey(slider, keys[index].time, keys[index].value);
            }
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

    function updateAnimationControls(comp, layer, plan) {
        var effect = findNativeEffect(layer);
        var merged = mergeRigTimeline(
            [{ name: layer.name, start: layer.inPoint, plan: plan, order: 0,
               sung: !!(effect && melodyFromEffect(effect).length),
               chatter: mouthChatter }],
            layer.inPoint, comp.frameDuration);
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

    /*
     * Driving the mouth from a recording.
     *
     * A line the engine speaks and a line somebody recorded reach the rig by
     * exactly the same road: the engine is asked for a plan, and the plan says
     * where each syllable falls and which mouth shape it wears. `--analyse`
     * prints that format from a WAV, so nothing between here and the face knows
     * or cares which of the two it is looking at.
     *
     * What an audio line does not have is a native effect, which is what
     * everything else in this file uses to recognise one of its own. So it
     * carries two sliders instead — the settings the analysis was run with, so
     * Rebuild can reproduce exactly the same plan rather than quietly making a
     * different one when the panel's controls have since been moved.
     */
    var AUDIO_LINE_NAME = "IC Audio Line";
    var AUDIO_VOWELS_NAME = "IC Audio Vowels";

    /*
     * How long the line was before Island Chatter made it fit.
     *
     * Fit Duration overwrites the out point, and until 3.1.0 nothing recorded
     * what it overwrote — so Remove took the effects, the markers, the rig and
     * the recording off a layer and left it sitting at the length the engine
     * had decided, with nothing on it to say why. There is no undo for that
     * once the session is closed.
     *
     * A *duration*, not an out point. Re-flow moves lines by shifting
     * `startTime`, and an absolute out point restored after a move would put
     * the layer back where it used to be rather than back to the length it used
     * to have. The difference shows up only after a Re-flow, which is exactly
     * the case nobody tests by hand.
     *
     * Written once, by `fitLayerToPlan()`, and only the first time: the value
     * has to be what the layer had before *any* of this, not what the previous
     * Apply left. Everything else about it is the `IC Rig Target` idiom —
     * a named control on the layer, not a parameter slot, so no published ABI
     * index moves (invariant 1).
     */
    var ORIGINAL_LENGTH_NAME = "IC Original Length";

    /*
     * The one place a line is fitted to its plan.
     *
     * `clampToComp` is a real distinction and not a tidy-up: Apply keeps the
     * clamp because putting a voice on a layer is not a request to change how
     * long the film is (invariant 8o), while Import, Re-flow and Re-sync grow
     * the composition first and then fit into the room they made.
     */
    function fitLayerToPlan(comp, layer, seconds, clampToComp) {
        if (!findNamedEffect(layer, ORIGINAL_LENGTH_NAME)) {
            ensureSlider(layer, ORIGINAL_LENGTH_NAME, layer.outPoint - layer.inPoint);
        }
        var wanted = Math.max(layer.inPoint + comp.frameDuration, layer.inPoint + seconds);
        layer.outPoint = clampToComp ? Math.min(comp.duration, wanted) : wanted;
    }

    // Null when this line was never fitted, which is what a layer with Fit
    // Duration switched off looks like: there is nothing to put back.
    function originalLengthOf(layer) {
        var effect = findNamedEffect(layer, ORIGINAL_LENGTH_NAME);
        if (!effect) { return null; }
        try {
            var seconds = effect.property(1).value;
            return seconds > 0 ? seconds : null;
        } catch (unreadable) { return null; }
    }

    function isAudioLine(layer) {
        return findNamedEffect(layer, AUDIO_LINE_NAME) !== null;
    }

    // The file behind a footage layer, or null for a solid, a precomp, a camera
    // or anything else that has no file of its own.
    function audioSourceFile(layer) {
        try {
            if (!layer.source || !(layer.source instanceof FootageItem)) { return null; }
            var main = layer.source.mainSource;
            if (!main || !(main instanceof FileSource)) { return null; }
            return main.file;
        } catch (notFootage) { return null; }
    }

    function layerHasAudio(layer) {
        try { return layer.hasAudio === true; } catch (noAudio) { return false; }
    }

    function audioSettingsFromLayer(layer) {
        var control = findNamedEffect(layer, AUDIO_LINE_NAME);
        var vowels = findNamedEffect(layer, AUDIO_VOWELS_NAME);
        return {
            sensitivity: control ? clamp(control.property(1).value, 0, 100) / 100 : 0.5,
            vowels: vowels ? Math.round(vowels.property(1).value) !== 0 : true
        };
    }

    function planFromAudio(file, settings) {
        var tool = requireEngineTool();
        return parseEnginePlan(system.callSystem(
            quoted(tool.fsName) +
            " --analyse-hex " + hexUtf8(file.fsName) +
            " --rate " + ENGINE_SAMPLE_RATE +
            " --sensitivity " + settings.sensitivity +
            " --vowels " + (settings.vowels ? 1 : 0)));
    }

    /*
     * The plan describes the whole file; the layer may be using part of it.
     *
     * Trimming a layer is the ordinary thing to do to a recording, and the
     * events outside the trim belong to audio nobody can hear. Left in, they
     * would open the mouth before the line starts and hold it open after the
     * line ends — and because the rig is keyframes rather than an expression,
     * that would look like a bug in the face rather than in the trim.
     */
    function planWithinLayer(plan, layer) {
        var from = layer.inPoint - layer.startTime;
        var until = layer.outPoint - layer.startTime;
        var kept = [];
        var index;
        for (index = 0; index < plan.events.length; index += 1) {
            var event = plan.events[index];
            var finish = event.time + event.duration;
            if (finish <= from || event.time >= until) { continue; }
            var start = Math.max(event.time, from);
            kept.push({
                character: event.character,
                reading: event.reading,
                mouth: event.mouth,
                tone: event.tone,
                time: start,
                duration: Math.max(0, Math.min(finish, until) - start)
            });
        }
        return { events: kept, duration: Math.min(plan.duration, until) };
    }

    // Everything an audio line contributes to a merge, from the layer alone, so
    // Rebuild needs nothing the panel happens to be showing.
    function audioLineFor(comp, layer, order) {
        var file = audioSourceFile(layer);
        if (!file || !file.exists) { return null; }
        var plan = planWithinLayer(planFromAudio(file, audioSettingsFromLayer(layer)), layer);
        return {
            name: layer.name,
            // The plan counts from the start of the file, and startTime is where
            // the file's first sample sits on the timeline. inPoint is where the
            // trim begins, which is not the same thing and is already accounted
            // for by planWithinLayer().
            start: layer.startTime,
            plan: plan,
            order: order,
            // A recording is neither sung nor chatter: the mouth closes where
            // the sound stops, which is what the pause rule already does and
            // what makes silence in the file close the mouth for free.
            sung: false,
            chatter: false
        };
    }

    /*
     * Hand a recording to a character.
     *
     * Everything that can be wrong here is something the user can see and fix,
     * so each of them is named rather than folded into one failure. Refusing a
     * time-stretched layer is the one that matters: nothing in the analysis
     * measures the stretch, so accepting it would put every mouth shape wrong
     * by the stretch factor and look exactly like the feature not working.
     */
    function lipSyncLayer(comp, layer, settings, rigLayer) {
        var file = audioSourceFile(layer);
        if (!file || !layerHasAudio(layer)) {
            throw new Error(M("{0} is not an audio layer. / {0} 不是音訊圖層。", layer.name));
        }
        if (!file.exists) {
            throw new Error(M("The file for {0} is missing. / 找不到 {0} 的檔案。", layer.name));
        }
        if (Math.abs(layer.stretch - 100) > 0.01) {
            throw new Error(M(
                "{0} is time-stretched; set it back to 100% first. / {0} 有時間伸縮，請先改回 100%。",
                layer.name));
        }
        var plan = planWithinLayer(planFromAudio(file, settings), layer);
        // Written after the analysis succeeded, so a layer that could not be
        // read does not end up marked as one that was.
        ensureSlider(layer, AUDIO_LINE_NAME, Math.round(settings.sensitivity * 100));
        ensureSlider(layer, AUDIO_VOWELS_NAME, settings.vowels ? 1 : 0);
        ensureRigTarget(layer, rigLayer);
        return plan;
    }

    function rigMembers(comp, rigLayer) {
        var output = [];
        var index;
        for (index = 1; index <= comp.numLayers; index += 1) {
            var candidate = comp.layer(index);
            // A text layer the engine speaks, or a recording that was analysed.
            if (!isTextLayer(candidate) && !isAudioLine(candidate)) { continue; }
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
            // A recording carries no effect to read a voice off, so it answers
            // for itself. Its plan is re-made rather than remembered, because a
            // trimmed or moved layer changes which part of the file is heard
            // and only the layer knows that.
            if (isAudioLine(members[index])) {
                var recorded = audioLineFor(comp, members[index], index);
                if (recorded) { lines.push(recorded); }
                continue;
            }
            var effect = findNativeEffect(members[index]);
            // A member whose voice was taken off contributes nothing, but stays
            // bound: taking Island Chatter off a line is what Remove is for.
            if (!effect) { continue; }
            var plan = null;
            for (at = 0; planned && at < planned.length; at += 1) {
                if (planned[at].layer.index === members[index].index) { plan = planned[at].plan; }
            }
            // planForLayer(), not planFromEngine(): a line whose voice came
            // back from a cloud model has its plan read out of that recording,
            // and a rebuild that reached for the engine instead would put the
            // mouth back on timings nobody can hear.
            if (!plan) { plan = planForLayer(comp, members[index], effect); }
            lines.push({
                name: members[index].name,
                start: members[index].inPoint,
                plan: plan,
                order: index,
                // A sung line is legato; a spoken one is not, and the mouth
                // shuts on a different rule for each.
                sung: melodyFromEffect(effect).length > 0,
                chatter: mouthChatter
            });
        }
        var merged = mergeRigTimeline(lines, rigLayer.inPoint, comp.frameDuration);
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
            throw new Error(
                M("Select the mouth layers, or one mouth precomp. / 請選取嘴型圖層，或一個嘴型合成。"));
        }
        if (targets.length === 1 && targets[0].source && targets[0].source instanceof CompItem) {
            ensureRigTarget(targets[0], rigLayer);
            if (!targets[0].timeRemapEnabled) { targets[0].timeRemapEnabled = true; }
            targets[0].property("ADBE Time Remapping").expression = mouthRemapExpression();
            return { kind: "remap", count: 1 };
        }
        if (targets.length > MOUTH_SHAPE_COUNT) {
            throw new Error(M(
                "A mouth needs {0} shapes: closed, a, i, u, e, o. / 一組嘴型需要 {0} 張：閉嘴、a、i、u、e、o。",
                MOUTH_SHAPE_COUNT));
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
                throw new Error(M("{0} has no Opacity to switch. / {0} 沒有可切換的不透明度。",
                    ordered[index].name));
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
            throw new Error(M("Type-On could not build its text animator on this layer. / 逐字顯示無法在這個圖層上建立文字動畫。"));
        }
        // A Range Selector carries both percentage and index controls; only the
        // pair matching its Units setting is writable.
        var start = findPropertyByMatchName(selector, "ADBE Text Percent Start");
        var end = findPropertyByMatchName(selector, "ADBE Text Percent End");
        if (!start || !end) {
            throw new Error(M("The Type-On range selector has no percentage controls. / 逐字顯示的範圍選取器沒有百分比控制項。"));
        }
        // Keyed properties reject setValue(); the user may have animated either
        // of these after a previous Apply.
        try {
            setPropertyValue(opacity, 0, time);
            setPropertyValue(end, 100, time);
        } catch (hidden) {
            throw new Error(M("Set the Island Chatter Reveal selector's Advanced > Units back to Percentage. / 請把 Island Chatter Reveal 選取器的 Advanced > Units 改回 Percentage。") +
                "\n(" + hidden.toString() + ")");
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
            throw new Error(M("Native effect is not installed: {0} / 找不到已安裝的效果：{0}",
                EFFECT_NAME) + "\n(" + error.toString() + ")");
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
                throw new Error(
                    M("The built-in Tone effect is unavailable. / 找不到 AE 內建的 Tone／音調效果。"));
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
        /*
         * Who this line is, recorded on the line itself.
         *
         * A shared rig's name wins, because that is the product's own idea of a
         * character and it is what the user typed. It is recorded even though
         * the rig pointer already implies it — the pointer is what goes away
         * when the line is unbound or the rig is deleted, and that is precisely
         * when somebody wants to know who used to be speaking.
         *
         * Without a rig it falls back to the timbre the panel is holding, and
         * only when the sliders still match it: a character name on a line that
         * no longer sounds like that character is worse than no name, because
         * it is believed.
         *
         * Written on every Apply, including as an empty string, so a re-Apply
         * with the sliders moved off a character clears the old label rather
         * than leaving it to be read months later.
         */
        var character = rigLayer ? rigCharacterName(rigLayer) : trim(settings.character || "");
        effect.name = effectDisplayName(character, trim(pronunciation));

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
            fitLayerToPlan(comp, textLayer, plan.duration, true);
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
            if (options.controllers) { updateAnimationControls(comp, textLayer, plan); }
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
        // CLOUD_VOICE_NAME is on this list because it is on the text layer; the
        // two sliders that record how the recording was read are on the audio
        // layer, which the block above has already taken away whole.
        /*
         * The length goes back before the control that remembers it is taken.
         *
         * Reading it after the loop would read a property off an effect that
         * has just been removed, which is invariant 3's hazard in its simplest
         * form. A layer that was never fitted has no record and is left exactly
         * as it is — Remove is not an excuse to change a length nobody set.
         */
        var wasLong = originalLengthOf(layer);
        if (wasLong !== null) {
            layer.outPoint = Math.min(comp.duration,
                Math.max(layer.inPoint + comp.frameDuration, layer.inPoint + wasLong));
        }
        var names = RIG_TRACK_NAMES.concat(
            [RIG_TARGET_NAME, BAKE_POINTER_NAME, CLOUD_VOICE_NAME, ORIGINAL_LENGTH_NAME]);
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

    // Both tools ship beside the .aex, in Support Files/Plug-ins/Island Chatter/.
    //
    // Deriving that from the panel's own location only works while the panel is
    // where the installer put it. Folder.startup is After Effects' Support Files
    // directory whatever is running, which covers a panel opened from somewhere
    // else through File > Scripts > Run Script File, and the host test suites,
    // which load the panel body out of the repository.
    var TOOL_FOLDER_PATH = "/Plug-ins/Island Chatter/";

    function toolFile(name) {
        var candidates = [];
        try {
            candidates.push(
                new File($.fileName).parent.parent.parent.fsName + TOOL_FOLDER_PATH + name);
        } catch (locationError) { /* $.fileName is not always a real path */ }
        try {
            candidates.push(Folder.startup.fsName + TOOL_FOLDER_PATH + name);
        } catch (startupError) { /* not running inside After Effects */ }
        var index;
        for (index = 0; index < candidates.length; index += 1) {
            var tool = new File(candidates[index]);
            if (tool.exists) { return tool; }
        }
        return null;
    }

    function bakeToolFile() { return toolFile("island_chatter_bake.exe"); }

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

    /*
     * Preview: hear a line without putting it anywhere.
     *
     * Until 3.1.0 the only way to hear a voice was to apply it to a layer and
     * RAM-preview the composition, which means every timbre you try leaves a
     * layer, an effect stack and an undo step behind. This touches the project
     * not at all: the engine renders to a WAV in the temp folder and Windows
     * plays it. Nothing is imported, so invariant 8g's purge never comes into
     * it, and there is no bake to go stale.
     *
     * The file has one fixed name and is overwritten, so previewing forty times
     * leaves one file rather than forty. It is not deleted afterwards on
     * purpose: PlaySync has just finished with it, deleting it would be one
     * more thing to fail, and it is in the folder Windows empties anyway.
     */
    var PREVIEW_FILE_NAME = "island-chatter-preview.wav";

    function previewFile() {
        return new File(Folder.temp.fsName.replace(/\\/g, "/") + "/" + PREVIEW_FILE_NAME);
    }

    /*
     * Custom timbre: five recordings in, ten numbers out.
     *
     * The user holds each vowel for a second or two and saves five files; the
     * engine tool measures F1 and F2 from each, and those replace the engine's
     * vowel table. What comes back is a *vocal tract*, not a recording — the
     * synthesizer still draws every tone contour, every syllable length and
     * every mouth shape, which is why this is not sample playback. Samples
     * cannot bend to a Mandarin fourth tone, and a product whose whole point is
     * Chinese cannot ship a voice that flattens them.
     *
     * A file that turns out to be mostly silence is refused by name rather than
     * averaged into the voice: `frames` is how many frames of the recording
     * actually held a vowel, and a handful of them is a cough or a room.
     */
    /*
     * Which build the panel is talking to.
     *
     * The panel ships identically in both packages — it is plain text, and a
     * limit written here would be a limit anybody could delete — so it cannot
     * know by itself. It asks the engine tool, which does know because the
     * answer is compiled into it.
     *
     * The point of asking at all is that a trial has to *say* it is a trial.
     * The audio carries a chirp every few seconds, and somebody who does not
     * know that is somebody deciding the synthesizer is broken.
     */
    /*
     * Asked once and kept, because the answer cannot change while the panel is
     * open and `callSystem()` costs ~85 ms.
     *
     * The reply is `BUILD <kind> <version>`. The version comes from the same
     * place for the same reason as the kind: the panel is plain text installed
     * beside whatever tools happen to be there, so a version written *here*
     * would be the panel's rather than the product's.
     */
    var buildAnswer = null;
    function buildInfo() {
        if (buildAnswer) { return buildAnswer; }
        buildAnswer = { trial: false, version: "" };
        var tool = bakeToolFile();
        if (!tool) { return buildAnswer; }
        var reply = String(system.callSystem(quoted(tool.fsName) + " --build"));
        buildAnswer.trial = reply.indexOf("ISLAND-CHATTER-TRIAL") >= 0;
        var fields = trim(reply).split(/\s+/);
        // BUILD <kind> <version>. An older tool prints only two, and an absent
        // version shows as nothing rather than as the word "undefined".
        if (fields.length >= 3 && fields[0] === "BUILD") { buildAnswer.version = fields[2]; }
        return buildAnswer;
    }

    function buildIsTrial() { return buildInfo().trial; }

    /*
     * What a trial will apply to in one press.
     *
     * **This reverses a decision invariant 8ai argued for, and the argument was
     * not wrong — it was outvoted.** 8ai says a layer limit stops anybody
     * judging whether twenty lines of dialogue hold together, which is true and
     * is the cost being accepted here.
     *
     * It is also a *soft* limit and has to be described as one. The panel is
     * plain text; anybody who can open it in Notepad can raise this number.
     * The mark in the audio is the part that is compiled in and the part that
     * actually holds, which is why making it louder and more frequent mattered
     * more than this does.
     */
    var TRIAL_MAX_LAYERS = 10;
    // What the status line tells people to expect. Kept next to the layer
    // limit and checked against dsp.cpp by `tests/validate-script.js`, because
    // a trial that says "every four seconds" and marks every two reads as a
    // fault rather than as a watermark.
    var TRIAL_MARK_SECONDS = 2;

    function refuseBeyondTrialLimit(count) {
        if (!buildIsTrial() || count <= TRIAL_MAX_LAYERS) { return; }
        throw new Error(M(
            "The trial applies to {0} layers at a time and {1} are selected.\n\nThe full version has no limit. / 試用版一次最多套用 {0} 層，你選了 {1} 層。\n\n正式版沒有這個限制。",
            TRIAL_MAX_LAYERS, count));
    }

    var MIN_VOWEL_FRAMES = 8;

    function measureVowelFile(file) {
        var tool = requireEngineTool();
        var reply = String(system.callSystem(quoted(tool.fsName) +
            " --measure-vowel " + hexUtf8(file.fsName)));
        var fields = trim(reply).split(/\s+/);
        if (fields.length < 4 || fields[0] !== "VOWEL") {
            throw new Error(M("Could not read {0}. / 無法讀取 {0}。", file.name) + "\n\n" + reply);
        }
        var first = parseInt(fields[1], 10);
        var second = parseInt(fields[2], 10);
        var frames = parseInt(fields[3], 10);
        if (!first || !second || frames < MIN_VOWEL_FRAMES) {
            throw new Error(M(
                "There is not enough steady sound in {0} to measure a vowel. Record a second or two of one held vowel. / {0} 裡面沒有足夠穩定的聲音可以量。請錄一兩秒、一個拉長的母音。",
                file.name));
        }
        return [first, second];
    }

    /*
     * Renders with the panel's own settings, not a layer's — the whole point is
     * to hear a voice before anything is committed to one — and the engine tool
     * plays it too.
     *
     * **Playback is the tool's job because PowerShell is not available here.**
     * The obvious spelling is a one-line `Media.SoundPlayer` handed to
     * `system.callSystem()`, and it works from a PowerShell prompt. Inside
     * After Effects it does not work at all: *every* PowerShell command comes
     * back as an empty string in about 130 ms, having run nothing and written
     * nothing — including `powershell -NoProfile -Command "'ALIVE'"` — while
     * `cmd /c echo` returns its output normally. `native/tests/ae-preview-probe.jsx`
     * is that measurement, and it is the reason `--play` exists.
     *
     * With the tool doing it, the path travels as hex like every other path
     * (invariant 8e), so a user folder with Chinese in it works, and the reply
     * is ours to define. `PlaySound` blocks until the sound ends, which is what
     * a preview button wants; After Effects does not repaint meanwhile and the
     * tooltip says so.
     *
     * Both halves of the reply are checked. `callSystem()` reports no exit
     * status, so a render that failed and a playback that failed would each
     * otherwise look exactly like a short, silent success.
     */
    function previewVoice(text, settings) {
        var tool = requireEngineTool();
        var target = previewFile();
        if (target.exists) { target.remove(); }
        var reply = String(system.callSystem(quoted(tool.fsName) +
            " --out-hex " + hexUtf8(target.fsName) +
            " --play" +
            " --text " + hexUtf8(text) +
            voiceArguments(settings)));
        if (reply.indexOf("OK ") !== 0 || !target.exists) {
            throw new Error(M("Could not render the preview. / 無法算出試聽的聲音。") +
                "\n\n" + reply);
        }
        if (reply.indexOf("PLAYED") < 0) {
            throw new Error(M("Windows could not play the preview. / Windows 無法播放試聽的聲音。") +
                "\n\n" + reply);
        }
    }

    // Beside the .aep, so baked audio travels with the project.
    function bakeFolder() {
        if (!app.project.file) {
            throw new Error(M("Save the project first so the audio can go beside it. / 請先儲存專案，音訊會放在專案檔旁邊。"));
        }
        var folder = new Folder(app.project.file.parent.fsName + "/" + BAKE_FOLDER_NAME);
        if (!folder.exists && !folder.create()) {
            throw new Error(M("Could not create {0} / 無法建立 {0}", folder.fsName));
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
            throw new Error(M("Apply Island Chatter to this layer first. / 請先對此圖層按 Apply。"));
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
            throw new Error(M("Bake failed for {0} / 轉檔失敗：{0}", layer.name) +
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
        /*
         * The index is read once, here, and the Layer object is never asked
         * again.
         *
         * Written as `previous.index` inside the loop it throws
         * "ReferenceError: Object is invalid" on the *second* bake of a layer,
         * every time: the loop removes that very layer and then goes on
         * dereferencing it on every remaining iteration, and there is always at
         * least one remaining iteration because the text layer itself is below
         * it. A first bake never noticed, because there is no previous bake to
         * hold on to — which is why this survived from 1.6.0 until
         * ae-bake-test.jsx was run against it.
         *
         * Comparing numbers is safe here only because the walk goes downward:
         * removing a layer renumbers the ones *below* it, and those have
         * already been visited. Anything above keeps the index it had.
         */
        var previousIndex = previous ? previous.index : 0;
        var index;
        var at;
        for (index = comp.numLayers; index >= 1; index -= 1) {
            var candidate = comp.layer(index);
            if (previousIndex && candidate.index === previousIndex) {
                candidate.remove();
                continue;
            }
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

    /*
     * A voice from somebody else's model.
     *
     * This is Bake with a different renderer, and saying it that way is the
     * design rather than a description. Everything the bake path already knows
     * how to do — write a file beside the project, release the previous one,
     * import it, point the line at it, silence the live effect, go stale when
     * the text changes — is exactly what a cloud voice needs, and none of it is
     * written twice. What arrives is a WAV, and from the WAV onwards this is
     * 2.3.0's job: the analyser reads it and prints the same plan the engine
     * prints, so the mouth moves without anything downstream being told where
     * the sound came from. The two features meet here and that is the whole of
     * the feature.
     *
     * What it is emphatically not is a live effect. An audio callback that
     * waits on a network is a hung host, so this is one press, one file, and
     * invariant 8's determinism is left alone. Editing the text does not
     * silently re-fetch it either — that would be spending money on a keystroke.
     */
    var VOICE_TOOL_NAME = "island_chatter_voice.exe";
    // 3.0.0's offline model. Optional in a way the cloud tool is not: it ships
    // beside the others but the 170 MB model it needs does not, so this tool
    // may be present and still have nothing to offer.
    var LOCAL_TOOL_NAME = "island_chatter_local.exe";
    // Beside the bakes, one level down, because these are named after a hash
    // rather than after a line and a folder of them is not worth reading.
    var CLOUD_FOLDER_NAME = "cloud";
    // Auditions go under the temp folder instead, never beside a project: the
    // tuning dialog must work with nothing open and must leave no trace in
    // somebody's project directory (invariant 8af).
    var AUDITION_FOLDER_NAME = "island-chatter-audition";
    var CLOUD_SUFFIX = " (voice)";
    /*
     * On the *text* layer, not on the audio.
     *
     * It says one thing: this line's plan comes back from a file rather than
     * from the engine. That is the only downstream difference a cloud voice
     * makes, and putting the mark on the line keeps the line as the rig member,
     * so Type-On, markers, overlap resolution and Fit Duration go on working
     * exactly as they do for a spoken line.
     */
    var CLOUD_VOICE_NAME = "IC Cloud Voice";
    // Under 2000 characters a line. Providers have their own limits and would
    // refuse politely, but this refusal is free and the one that is not is a
    // bill. A line of dialogue is never this long by accident.
    var MAX_CLOUD_CHARACTERS = 2000;
    // What the offline model costs to fetch. Stated to the user before the
    // download starts; the tool has the authoritative per-file sizes.
    var LOCAL_MODEL_MEGABYTES = 177;

    /*
     * What each offline model costs to fetch, and what it has to say for itself.
     *
     * Keyed by the id the tool reports, so a row this table does not know about
     * still downloads — it just does so without a caveat and with the default
     * size. That is the right way round: a new model must not inherit another
     * model's warning, and an unknown row must not be unusable because this
     * table was not updated.
     *
     * The caveat is a message key rather than a sentence, because everything
     * the panel says goes through `M()` in three languages (invariant 8i) and a
     * string the tool sent could not be translated. It is the accent, which is
     * the one thing about the Chinese model somebody has to know *before*
     * spending 177 MB rather than after.
     */
    var IC_SOURCE_NOTES = {
        "local-melo": {
            megabytes: 177,
            caveat: "This model is Mandarin as it is spoken in China, by a woman. It is the only Chinese model whose licence allows it to ship here, and no Taiwanese-accented offline model exists; for Taiwan Mandarin use the built-in voice or Azure. / 這個模型是中國口音的普通話女聲。可商用授權的中文模型只有這一個，台灣國語的離線模型並不存在；要台灣國語請用內建的聲音或 Azure。"
        },
        "local-melo-ja": { megabytes: 171, caveat: "" }
    };

    /*
     * The offline model's own voice settings, and where they actually live.
     *
     * A neural model has knobs a provider's endpoint does not expose: which
     * speaker out of the several in the weights, how much the decoder may vary,
     * and how fast the line comes out. Until 3.4.0 they were constants in
     * `island_chatter_local`, so a package holding several speakers offered one.
     *
     * **They travel in the Voice ID field, which is not a shortcut.** Every one
     * of them changes the sound, so every one has to reach the cache key or the
     * cache hands back the previous setting's audio and the line simply does
     * not change when the dialog is closed. `voice` is already in that key, and
     * for a source that runs here the provider table fills it with the literal
     * `"default"` — it means nothing else. So the tuning *is* the voice, in the
     * sense the key already understands, and no new field was added anywhere.
     *
     * That is also why the field is left editable rather than being replaced by
     * the dialog: it is the same free-text voice field it has always been, the
     * tool refuses anything it cannot read *by name*, and a tuning can be
     * copied between machines.
     *
     * These numbers are a second copy of `cloud.hpp`'s, which
     * `tests/validate-script.js` compares field by field. The copy is safe in
     * the one way that matters: a name the tool does not know is **refused**
     * rather than ignored, so a panel that drifted would say so on the first
     * press instead of quietly rendering a voice nobody asked for.
     */
    // The two modal windows, in one place because the wrapped paragraphs
    // inside them are measured against these numbers.
    var MODEL_WINDOW_WIDTH = 520;
    var TUNING_WINDOW_WIDTH = 470;

    var TUNING_MAX_SPEAKER = 255;
    var TUNING_MIN_VARIATION = 0;
    var TUNING_MAX_VARIATION = 2;
    var TUNING_MIN_SPEED = 0.25;
    var TUNING_MAX_SPEED = 4;
    /*
     * -1 is not a speaker. It means "leave whatever the model says about
     * itself" — 1 in the Chinese package, 0 in the Japanese one.
     *
     * **There is no speaker control in the panel, and that is a finding rather
     * than an omission.** Both models were checked three ways: upstream's
     * `spk2id` is `{"ZH": 1}` and `{"JP": 0}`, both ONNX files carry
     * `n_speakers = 1` in their own metadata, and the 256 in upstream's config
     * is the embedding table's size. One trained voice each, in a table with
     * 255 empty slots — which is why an untrained index renders silence
     * instead of failing. 3.4.0 offered a number box and caught the silence
     * afterwards; there is nothing to offer, so 3.5.0 does not offer it.
     */
    var TUNING_DEFAULT_SPEAKER = -1;
    // MeloTTS's own defaults, from `tts_to_file(... noise_scale=0.6,
    // noise_scale_w=0.8, speed=1.0 ...)`. Until 3.5.0 variation was 0.667,
    // which is sherpa-onnx's generic VITS number and was inherited when the
    // offline voice still went through sherpa-onnx.
    var TUNING_DEFAULT_VARIATION = 0.6;
    var TUNING_DEFAULT_TIMBRE = 0.8;
    var TUNING_DEFAULT_SPEED = 1;

    /*
     * Named starting points, because three unlabelled decimals are not a
     * choice anybody can make.
     *
     * The first row is the only one with authority behind it: those are
     * MeloTTS's published defaults, and `tests/validate-script.js` checks them
     * against `cloud.hpp` so the two cannot drift. **The rest are this
     * product's own**, and they are not dressed up as anything else — each is
     * a starting point derived from what the two knobs actually do, and
     * picking one immediately shows its numbers on the sliders, so nothing
     * about a preset is hidden behind its name.
     *
     * `variation` is the spread of the latent the decoder samples: low is the
     * same performance every time, high is a different reading each render.
     * `timbre` is the same spread in the *duration* predictor, so it is
     * rhythm rather than colour — low is metronomic, high is loose.
     */
    var IC_TUNING_PRESETS = [
        { label: "MeloTTS default / MeloTTS 官方預設",
          variation: 0.6, timbre: 0.8, speed: 1 },
        { label: "Steady / 穩定",
          variation: 0.3, timbre: 0.4, speed: 1 },
        { label: "Lively / 活潑",
          variation: 0.9, timbre: 1, speed: 1.1 },
        { label: "Narration / 旁白",
          variation: 0.6, timbre: 0.55, speed: 0.9 },
        { label: "Hurried / 急促",
          variation: 0.75, timbre: 0.9, speed: 1.35 }
    ];
    // Shown when the sliders do not match any row. Never written to a project:
    // what gets stored is always the numbers.
    var TUNING_CUSTOM_LABEL = "Custom / 自訂";

    // Not parseFloat, which reads "1.5x" as 1.5: a typo accepted here is a
    // render nobody can account for. The whole string has to be the number.
    function tuningNumber(setting, value, low, high, whole) {
        if (!/^-?[0-9]+(\.[0-9]+)?$/.test(value)) {
            throw new Error(M("{0} has to be a number, not “{1}”. / {0} 要填數字，不能是「{1}」。",
                setting, value));
        }
        var amount = Number(value);
        if (whole && Math.floor(amount) !== amount) {
            throw new Error(M("{0} has to be a whole number. / {0} 要填整數。", setting));
        }
        if (amount < low || amount > high) {
            throw new Error(M("{0} has to be between {1} and {2}. / {0} 要在 {1} 到 {2} 之間。",
                setting, low, high));
        }
        return amount;
    }

    function tuningFromText(text) {
        var tuning = {
            speaker: TUNING_DEFAULT_SPEAKER,
            variation: TUNING_DEFAULT_VARIATION,
            timbre: TUNING_DEFAULT_TIMBRE,
            speed: TUNING_DEFAULT_SPEED
        };
        var said = trim(String(text === undefined || text === null ? "" : text));
        // "default" is what the provider table carries for a source on this
        // machine, so it is what arrives before anybody opens the dialog.
        if (!said || said === "default") { return tuning; }
        var pieces = said.split(";");
        var index;
        for (index = 0; index < pieces.length; index += 1) {
            var piece = trim(pieces[index]);
            if (!piece) { continue; }
            var at = piece.indexOf("=");
            if (at < 0) {
                throw new Error(M("“{0}” is not written as name=value. / 「{0}」不是「名稱=值」的寫法。",
                    piece));
            }
            var setting = trim(piece.substring(0, at));
            var value = trim(piece.substring(at + 1));
            if (setting === "speaker") {
                tuning.speaker = tuningNumber(setting, value, -1, TUNING_MAX_SPEAKER, true);
            } else if (setting === "variation") {
                tuning.variation = tuningNumber(
                    setting, value, TUNING_MIN_VARIATION, TUNING_MAX_VARIATION, false);
            } else if (setting === "timbre") {
                tuning.timbre = tuningNumber(
                    setting, value, TUNING_MIN_VARIATION, TUNING_MAX_VARIATION, false);
            } else {
                if (setting !== "speed") {
                    throw new Error(M("There is no voice setting called “{0}”. / 沒有叫「{0}」的聲音設定。",
                        setting));
                }
                tuning.speed = tuningNumber(
                    setting, value, TUNING_MIN_SPEED, TUNING_MAX_SPEED, false);
            }
        }
        return tuning;
    }

    function spellTuning(tuning) {
        return "speaker=" + tuning.speaker +
            ";variation=" + tuning.variation.toFixed(3) +
            ";timbre=" + tuning.timbre.toFixed(3) +
            ";speed=" + tuning.speed.toFixed(3);
    }

    /*
     * Always spelled, defaults included — 3.4.0 returned "" for them.
     *
     * The saving was real: an untuned line kept the cache file it already had.
     * The reasoning was wrong, and one release was enough to show it. An empty
     * spelling records "the defaults", not the numbers, so when `variation`
     * moved from 0.667 to MeloTTS's own 0.6 every file already named that way
     * quietly started claiming a sound it does not contain. Spelling costs one
     * re-render per offline line, which is four seconds of CPU and no money.
     */
    function tuningTextOf(tuning) {
        return spellTuning(tuning);
    }

    // Which preset these numbers are, or -1 for none. Compared through the
    // speller rather than field by field, so "the same tuning" means exactly
    // what the cache key means by it.
    function tuningPresetIndex(tuning) {
        var spelled = spellTuning(tuning);
        var index;
        for (index = 0; index < IC_TUNING_PRESETS.length; index += 1) {
            var row = IC_TUNING_PRESETS[index];
            if (spellTuning({
                speaker: TUNING_DEFAULT_SPEAKER,
                variation: row.variation,
                timbre: row.timbre,
                speed: row.speed
            }) === spelled) { return index; }
        }
        return -1;
    }

    // The first offline row in a source list, or "" when none is installed.
    function offlineSourceId(rows) {
        var index;
        for (index = 0; index < rows.length; index += 1) {
            if (rows[index].onThisMachine) { return rows[index].id; }
        }
        return "";
    }
    /*
     * Which source a panel with no remembered choice starts on.
     *
     * **An installed offline model first, from 3.8.0.** It costs nothing to
     * press, sends nothing anywhere, needs no account, and cannot fail on a
     * missing key — so it is the only source that is certain to work the first
     * time somebody presses the button. A default that can produce a bill or an
     * error about a credential is a bad first press whatever it sounds like.
     *
     * Azure is the fallback and the reason it is *the* fallback has not
     * changed: its default voice is `zh-TW-HsiaoChenNeural`, Taiwan Mandarin,
     * and this product is Traditional Chinese first. Every other cloud row
     * defaults to China-accented Chinese. The offline model is China-accented
     * too — which is said out loud in the model manager before the download,
     * not discovered afterwards — so anybody who wants Taiwan Mandarin is
     * still one row away, and `offlineSourceId()` returning "" leaves them
     * exactly where 2.5.0 put them.
     *
     * Neither is a reordering of the table: the remembered choice is stored as
     * an index, so moving rows would switch anybody who had already picked one.
     */
    var PREFERRED_PROVIDER_ID = "azure";

    function requireVoiceTool() {
        var tool = toolFile(VOICE_TOOL_NAME);
        if (!tool) {
            throw new Error(M("{0} is missing. Reinstall Island Chatter. / 找不到 {0}，請重新安裝 Island Chatter。",
                VOICE_TOOL_NAME));
        }
        return tool;
    }

    // Everything the tool says comes back through the console code page, so the
    // parts a person reads travel as hex. The first line is checked because
    // callSystem() reports no exit status: a tool that never ran returns an
    // empty string, which must not read as an empty answer.
    function parseVoiceReply(reply) {
        var lines = String(reply).split(/[\r\n]+/);
        if (!lines.length || lines[0].indexOf("VOICE ") !== 0) {
            throw new Error(
                M("Island Chatter could not run the AI voice tool. / Island Chatter 無法執行 AI 語音工具。") +
                "\n\n" + reply);
        }
        var answer = {
            providers: [], models: [], path: "", bytes: 0, cached: false, unspoken: ""
        };
        var index;
        for (index = 1; index < lines.length; index += 1) {
            var fields = lines[index].split(" ");
            if (fields[0] === "ERROR") {
                // The provider's own words, not a sentence of ours wrapped
                // round them. Invariant 8k is the reason.
                throw new Error(utf8FromHex(fields[1]));
            }
            if (fields[0] === "P") {
                answer.providers.push({
                    id: fields[1],
                    label: utf8FromHex(fields[2]),
                    host: fields[3],
                    model: fields[4] === "2d" ? "" : utf8FromHex(fields[4]),
                    voice: utf8FromHex(fields[5]),
                    needsRegion: fields[6] === "1",
                    // A reply written before this field existed reads as
                    // false, which is what every shipped source is.
                    onThisMachine: fields[7] === "1"
                });
            } else if (fields[0] === "PATH") {
                answer.path = utf8FromHex(fields[1]);
            } else if (fields[0] === "OK") {
                answer.path = utf8FromHex(fields[1]);
                answer.bytes = parseInt(fields[2], 10);
                answer.cached = fields[3] === "1";
            } else if (fields[0] === "M") {
                /*
                 * The catalogue, which is a different question from the menu.
                 *
                 * `--providers` answers "what can I offer today", and it has to
                 * stay that way or the menu offers something that fails when
                 * pressed. `--models` answers "what exists", which is what the
                 * manager below needs — and what nothing could answer until
                 * 3.3.0, when pressing the download button with nothing
                 * installed asked the user to select a model from a list that
                 * only shows installed ones.
                 */
                answer.models.push({
                    id: fields[1],
                    label: utf8FromHex(fields[2]),
                    installed: fields[3] === "1",
                    bytes: parseFloat(fields[4]) || 0,
                    folder: fields.length > 5 ? utf8FromHex(fields[5]) : ""
                });
            } else if (fields[0] === "WARN") {
                /*
                 * The offline model spoke the line but not all of it.
                 *
                 * Only the local tool sends this, and only for characters it has
                 * no sound for — kana, an emoji, one of the four syllabic
                 * nasals. It is a warning rather than an error because the rest
                 * of the line is fine and the file is real; what must not happen
                 * is that a render comes back a word short and nothing says so.
                 */
                answer.unspoken = utf8FromHex(fields[1]);
            }
        }
        return answer;
    }

    /*
     * Every voice source, asked for rather than written down.
     *
     * Two tools answer now and each reports only what it can actually serve:
     * the cloud tool always lists its three, and the local tool lists nothing
     * until its model is installed. So the menu never shows an option that
     * fails when pressed, and the panel still holds no copy of either table —
     * which is invariant 8b applied to a list that now has two sources.
     *
     * Each row remembers which tool produced it. That is the whole of the
     * dispatch: `on_this_machine` decides what to *ask* the user for, and this
     * decides who to *run*.
     */
    function voiceSources() {
        var found = [];
        var index;
        var tool = requireVoiceTool();
        var cloud = parseVoiceReply(
            system.callSystem(quoted(tool.fsName) + " --providers")).providers;
        for (index = 0; index < cloud.length; index += 1) {
            cloud[index].tool = tool;
            found.push(cloud[index]);
        }
        // The local tool is allowed to be absent: a build packaged without it,
        // or an older install. That is not an error, it is three sources
        // instead of four.
        var local = toolFile(LOCAL_TOOL_NAME);
        if (local) {
            var offered = parseVoiceReply(
                system.callSystem(quoted(local.fsName) + " --providers")).providers;
            for (index = 0; index < offered.length; index += 1) {
                offered[index].tool = local;
                found.push(offered[index]);
            }
        }
        return found;
    }

    function cloudFolder() {
        var folder = new Folder(bakeFolder().fsName + "/" + CLOUD_FOLDER_NAME);
        if (!folder.exists && !folder.create()) {
            throw new Error(M("Could not create {0} / 無法建立 {0}", folder.fsName));
        }
        return folder;
    }

    /*
     * Where the key lives, and what that costs.
     *
     * app.settings is After Effects' own preference file, in plain text, in the
     * user's profile. That is not a secret store and the panel says so rather
     * than implying otherwise: there is no key ring in ExtendScript, and
     * inventing an encryption whose key would have to ship in this same file
     * would be theatre. One key per provider, because they are separate
     * accounts with separate bills.
     */
    function keySettingName(providerId) { return "cloudKey_" + providerId; }

    function storedKey(providerId) {
        var name = keySettingName(providerId);
        if (!app.settings.haveSetting(SCRIPT_NAME, name)) { return ""; }
        return trim(String(app.settings.getSetting(SCRIPT_NAME, name)));
    }

    function rememberKey(providerId, key) {
        app.settings.saveSetting(SCRIPT_NAME, keySettingName(providerId), key);
    }

    /*
     * The key reaches the tool through a file, and the file exists for
     * milliseconds.
     *
     * A command line is readable by every process on the machine: Task Manager
     * shows it to anyone who turns the column on. So the key is written to the
     * temp directory and the path is what travels. The tool deletes the file as
     * soon as it has read it, before the socket is opened; this deletes it
     * again afterwards, because two attempts cost nothing and one missed one
     * leaves a credential on disk.
     */
    function writeKeyFile(key) {
        var name = "island-chatter-key-" +
            new Date().getTime().toString(36) +
            Math.floor(Math.random() * 0x10000).toString(36) + ".tmp";
        var file = new File(Folder.temp.fsName + "/" + name);
        file.encoding = "UTF-8";
        if (!file.open("w")) {
            throw new Error(M("Could not write the temporary key file. / 無法寫入暫存金鑰檔。"));
        }
        file.write(key);
        file.close();
        return file;
    }

    /*
     * Asking for a key without putting it on screen.
     *
     * ScriptUI's edittext takes noecho, which is the one thing a plain prompt()
     * cannot do, and a billing credential typed into a shared screen recording
     * is worth the extra twenty lines. Forget is in the same dialog because
     * "how do I take it off this machine" is a question that deserves an answer
     * a button away rather than a paragraph in a README.
     *
     * The dialog is built with M() rather than through localiseTree(), because
     * it is created on demand, after the language is already known.
     */
    function askForCloudKey(provider, existing, account) {
        var dialog = new Window("dialog", SCRIPT_NAME);
        dialog.orientation = "column";
        dialog.alignChildren = ["fill", "top"];
        dialog.margins = 14;
        dialog.spacing = 8;
        dialog.add("statictext", undefined,
            M("{0} account / {0} 帳號設定", provider.label));

        /*
         * `helpTip` set from `H()` directly rather than through `tip()`.
         *
         * `tip()` also registers a control so a language switch can rewrite it,
         * and there is nothing to rewrite here: the dialog is built on demand,
         * after the language is known, and closes before it can change. That is
         * the same reason its labels go through `M()` rather than
         * `localiseTree()`.
         */
        function accountRow(caption, value, wide, secret) {
            var row = dialog.add("group");
            row.orientation = "row";
            var title = row.add("statictext", undefined, caption);
            title.preferredSize.width = 108;
            var field = row.add("edittext", undefined, value,
                secret ? { noecho: true } : undefined);
            field.characters = wide;
            return field;
        }

        var field = accountRow(M("API key / 金鑰"), existing, 40, true);
        tipOnce(field, "cloudKey");
        /*
         * The three that used to sit on the page.
         *
         * They only ever meant anything to a cloud account, and they were on
         * screen whichever source was selected — including an offline model,
         * which has no account, no voice id and no region. Here they are with
         * the one other thing an account needs, and the page carries none of
         * it.
         */
        var voiceField = accountRow(M("Voice ID / 音色代號"), account.voice, 32, false);
        tipOnce(voiceField, "cloudVoiceId");
        var modelField = accountRow(M("Model / 模型"), account.model, 32, false);
        tipOnce(modelField, "cloudModel");
        var regionField = accountRow(M("Region / 區域"), account.region, 16, false);
        tipOnce(regionField, "cloudRegion");
        // Only one provider has a per-region endpoint, and a field nobody needs
        // is a field somebody fills in wrongly once. Disabled rather than
        // hidden, so the dialog does not change shape between providers.
        regionField.enabled = provider.needsRegion;

        // Said plainly rather than implied. There is no key store in
        // ExtendScript, and an encryption whose key shipped in this same file
        // would be theatre.
        dialog.add("statictext", undefined,
            M("Kept in this computer's After Effects preferences, in plain text. / 會存在這台電腦的 After Effects 偏好設定裡，是明碼。"));
        var buttons = dialog.add("group");
        buttons.orientation = "row";
        buttons.alignment = ["right", "top"];
        var saveButton = buttons.add("button", undefined, M("Save / 儲存"));
        var forgetButton = buttons.add("button", undefined, M("Forget / 清除"));
        var cancelButton = buttons.add("button", undefined, M("Cancel / 取消"));
        var answer = null;
        function readFields() {
            return {
                voice: trim(String(voiceField.text)),
                model: trim(String(modelField.text)),
                region: trim(String(regionField.text))
            };
        }
        saveButton.onClick = function () {
            answer = readFields();
            answer.key = trim(String(field.text));
            dialog.close();
        };
        /*
         * Forget clears the key and *keeps* the rest.
         *
         * "Take my credential off this machine" is not "forget which voice I
         * use". Clearing all four would mean anybody taking a key off a shared
         * machine also loses the settings they would have to type again on the
         * next one.
         */
        forgetButton.onClick = function () {
            answer = readFields();
            answer.key = "";
            dialog.close();
        };
        cancelButton.onClick = function () { answer = null; dialog.close(); };
        dialog.show();
        return answer;
    }

    /*
     * The same button, asking a source that runs here for the thing it actually
     * needs.
     *
     * A cloud source needs an account; a local one has none and needs a voice.
     * Greying the key button out for an offline model — which is what 3.0.0 did
     * — leaves the one control that configures a source doing nothing on the
     * only sources this product can configure at all.
     *
     * Built with M() rather than through localiseTree() for the reason
     * askForCloudKey() gives: it is created on demand, when the language is
     * already known.
     */
    function askForVoiceTuning(source, existing, sampleText) {
        var tuning;
        try {
            tuning = tuningFromText(existing);
        } catch (unreadable) {
            // Whatever is in the field cannot be read, so the dialog opens on
            // the model's own settings. Refusing to open would leave somebody
            // with a bad string and no way to fix it except retyping it.
            tuning = tuningFromText("");
        }
        var dialog = new Window("dialog", SCRIPT_NAME);
        dialog.orientation = "column";
        dialog.alignChildren = ["fill", "top"];
        dialog.margins = 14;
        dialog.spacing = 9;
        dialog.add("statictext", undefined,
            M("Voice settings for {0} / {0} 的聲音設定", source.label));

        /*
         * The preset menu is the control, and the sliders are what it shows.
         *
         * 3.4.0 asked for four decimals in four text boxes with a paragraph
         * underneath explaining what they meant. Nobody can pick 0.667 out of
         * a paragraph. A named row picks all three at once and the sliders
         * then say exactly what it picked, so the menu is a shortcut rather
         * than a black box, and moving any slider drops the menu to Custom
         * instead of leaving it claiming a preset that is no longer selected.
         */
        var presetRow = dialog.add("group");
        presetRow.orientation = "row";
        var presetTitle = presetRow.add("statictext", undefined, M("Preset / 預設"));
        presetTitle.preferredSize.width = 92;
        var presetMenu = presetRow.add("dropdownlist", undefined, []);
        var pick;
        for (pick = 0; pick < IC_TUNING_PRESETS.length; pick += 1) {
            presetMenu.add("item", T(IC_TUNING_PRESETS[pick].label));
        }
        presetMenu.add("item", T(TUNING_CUSTOM_LABEL));
        presetMenu.preferredSize.width = 250;

        /*
         * A slider and the number it is on, because either alone is worse.
         *
         * The number without the slider is 3.4.0. The slider without the
         * number cannot be written down, copied to another machine, or
         * checked against the preset that claims to have set it.
         */
        function tuningSlider(caption, value, low, high) {
            var row = dialog.add("group");
            row.orientation = "row";
            var title = row.add("statictext", undefined, caption);
            title.preferredSize.width = 92;
            var slider = row.add("slider", undefined, value, low, high);
            slider.preferredSize.width = 210;
            var readout = row.add("statictext", undefined, "0.00");
            // Filled *before* it is measured: preferredSize on an empty
            // statictext is ignored, which is the trap invariant 8z records.
            readout.preferredSize.width = 40;
            var hint = row.add("statictext", undefined,
                M("{0} to {1} / {0} 到 {1}", String(low), String(high)));
            hint.preferredSize.width = 78;
            slider.readout = readout;
            return slider;
        }

        var variationSlider = tuningSlider(M("Variation / 變化"), tuning.variation,
            TUNING_MIN_VARIATION, TUNING_MAX_VARIATION);
        var timbreSlider = tuningSlider(M("Rhythm / 節奏變化"), tuning.timbre,
            TUNING_MIN_VARIATION, TUNING_MAX_VARIATION);
        var speedSlider = tuningSlider(M("Speed / 語速"), tuning.speed,
            TUNING_MIN_SPEED, TUNING_MAX_SPEED);

        // Rounded to what the wire format carries, so what is shown is what is
        // stored and two sliders a pixel apart are not two cache entries.
        function readSliders() {
            return {
                speaker: TUNING_DEFAULT_SPEAKER,
                variation: Number(variationSlider.value.toFixed(3)),
                timbre: Number(timbreSlider.value.toFixed(3)),
                speed: Number(speedSlider.value.toFixed(3))
            };
        }

        function showNumbers() {
            variationSlider.readout.text = variationSlider.value.toFixed(2);
            timbreSlider.readout.text = timbreSlider.value.toFixed(2);
            speedSlider.readout.text = speedSlider.value.toFixed(2);
        }

        function showPreset() {
            var at = tuningPresetIndex(readSliders());
            presetMenu.selection = at < 0 ? IC_TUNING_PRESETS.length : at;
        }

        var settingSliders = false;
        function sliderMoved() {
            showNumbers();
            // Guarded, or applying a preset re-enters through onChanging and
            // reads the sliders back before they have all been set — which
            // lands on Custom the instant a preset is chosen.
            if (!settingSliders) { showPreset(); }
        }
        variationSlider.onChanging = sliderMoved;
        variationSlider.onChange = sliderMoved;
        timbreSlider.onChanging = sliderMoved;
        timbreSlider.onChange = sliderMoved;
        speedSlider.onChanging = sliderMoved;
        speedSlider.onChange = sliderMoved;

        presetMenu.onChange = function () {
            if (!presetMenu.selection) { return; }
            var at = presetMenu.selection.index;
            // The Custom row is a state, not a choice: selecting it changes
            // nothing, because there is nothing it could mean.
            if (at < 0 || at >= IC_TUNING_PRESETS.length) { return; }
            var row = IC_TUNING_PRESETS[at];
            settingSliders = true;
            variationSlider.value = row.variation;
            timbreSlider.value = row.timbre;
            speedSlider.value = row.speed;
            settingSliders = false;
            showNumbers();
        };

        // Measured rather than guessed, for the reason addWrapped() gives: this
        // paragraph is five lines in Chinese and six in Japanese, and it had
        // been given four.
        addWrapped(dialog, M(
            "Variation is how much the voice may differ from one render to the next; rhythm is the same thing for how long each syllable is held. Speed is this model's own — the panel's Speed slider belongs to the built-in voice and never reaches a line an offline model spoke. There is no speaker to choose: both models were trained with one voice each. / 「變化」是每次算出來可以差多少，「節奏變化」是同一件事、但作用在每個字拉多長。「語速」是這個模型自己的——面板上的 Speed 滑桿是內建聲音在用的，碰不到離線模型唸出來的句子。沒有語者可以選：這兩個模型各自都只訓練了一個聲音。"),
            TUNING_WINDOW_WIDTH);

        var buttons = dialog.add("group");
        buttons.orientation = "row";
        buttons.alignment = ["fill", "top"];
        /*
         * Audition, which is the reason any of the rest is usable.
         *
         * Three numbers describing how a voice varies cannot be judged by
         * reading them. It renders through the real model with the real
         * tuning, into the temp folder rather than beside the project, so this
         * touches nothing — invariant 8af, the same rule the engine's Preview
         * follows. First press pays the model load, so it says so.
         */
        var playButton = buttons.add("button", undefined, M("Play / 試聽"));
        var playReadout = buttons.add("statictext", undefined,
            M("First press loads the model / 第一次按要先載入模型"));
        playReadout.preferredSize.width = 240;
        var saveButton = buttons.add("button", undefined, M("Save / 儲存"));
        var cancelButton = buttons.add("button", undefined, M("Cancel / 取消"));

        playButton.onClick = function () {
            var said = trim(String(sampleText || ""));
            if (!said) {
                alert(M("Type a line first, so there is something to hear. / 請先打一句話，才有東西可以聽。"));
                return;
            }
            playReadout.text = M("Rendering… / 計算中…");
            dialog.update();
            try {
                auditionVoiceTuning(source, tuningTextOf(readSliders()), said);
                playReadout.text = M("Played / 已播放");
            } catch (error) {
                playReadout.text = M("Could not play / 無法播放");
                alert(String(error.message || error));
            }
        };
        var answer = null;
        saveButton.onClick = function () {
            answer = { voice: tuningTextOf(readSliders()) };
            dialog.close();
        };
        cancelButton.onClick = function () { answer = null; dialog.close(); };

        showNumbers();
        showPreset();
        dialog.show();
        return answer;
    }

    /*
     * Hear a tuning without committing to it.
     *
     * Two tools, and the split is where the code already is: the offline tool
     * renders, because it is the one that owns the model, and the engine tool
     * plays, because that is where PlaySound and winmm live and a second copy
     * would be a second place to remember SND_NODEFAULT (without which Windows
     * substitutes its own ding for a file it cannot play, and a failure sounds
     * like a success).
     *
     * The cache folder is under the temp directory, not beside the project:
     * an audition must not write into somebody's project folder, and it must
     * work with no project open at all. Repeat presses on the same tuning are
     * then free, because the offline tool's cache does its usual job.
     */
    function auditionVoiceTuning(source, voice, text) {
        var tool = source.tool || toolFile(LOCAL_TOOL_NAME);
        if (!tool) {
            throw new Error(M("{0} is missing. Reinstall Island Chatter. / 找不到 {0}，請重新安裝 Island Chatter。",
                LOCAL_TOOL_NAME));
        }
        var folder = new Folder(Folder.temp.fsName.replace(/\\/g, "/") + "/" + AUDITION_FOLDER_NAME);
        if (!folder.exists && !folder.create()) {
            throw new Error(M("Could not create {0} / 無法建立 {0}", folder.fsName));
        }
        var spoken = parseVoiceReply(system.callSystem(quoted(tool.fsName) +
            " --speak --provider " + source.id +
            " --text " + hexUtf8(text) +
            (voice ? " --voice " + hexUtf8(voice) : "") +
            " --cache-dir " + hexUtf8(folder.fsName)));
        var file = new File(spoken.path);
        if (!file.exists) {
            throw new Error(M("The AI voice reported success but wrote no file. / AI 語音回報成功卻沒有寫出檔案。") +
                "\n\n" + spoken.path);
        }
        // PLAYED is checked because callSystem() reports no exit status, so a
        // playback that failed is otherwise indistinguishable from a short
        // silence — which is exactly what this dialog is for judging.
        var played = String(system.callSystem(quoted(requireEngineTool().fsName) +
            " --play-hex " + hexUtf8(file.fsName)));
        if (played.indexOf("PLAYED") < 0) {
            throw new Error(M("Windows could not play the preview. / Windows 無法播放試聽的聲音。") +
                "\n\n" + played);
        }
    }

    function cloudArguments(settings) {
        return " --provider " + settings.provider +
            " --text " + hexUtf8(settings.text) +
            (settings.voice ? " --voice " + hexUtf8(settings.voice) : "") +
            (settings.model ? " --model " + hexUtf8(settings.model) : "") +
            (settings.region ? " --region " + hexUtf8(settings.region) : "");
    }

    /*
     * One line of speech, from the cache or from the provider.
     *
     * The tool decides which, because the tool owns the cache key: the panel
     * computing a hash of its own would be a second copy of the thing that
     * decides whether money is spent, and the two copies would disagree the
     * first time a field was added to either. All the panel does is say where
     * the folder is and report which of the two happened.
     */
    function speakToFile(settings) {
        var tool = settings.tool || requireVoiceTool();
        var folder = cloudFolder();
        /*
         * A source that runs here gets no key file, because there is no key and
         * writing one would put an empty credential on disk for no reason. The
         * rest of the command is identical for both, which is why the local
         * tool accepts --key-file and ignores it rather than refusing it: one
         * command builder, and the difference is a single conditional.
         */
        var keyFile = settings.onThisMachine ? null : writeKeyFile(settings.key);
        var answer;
        try {
            answer = parseVoiceReply(system.callSystem(quoted(tool.fsName) +
                " --speak" + cloudArguments(settings) +
                (keyFile ? " --key-file " + hexUtf8(keyFile.fsName) : "") +
                " --cache-dir " + hexUtf8(folder.fsName)));
        } finally {
            if (keyFile && keyFile.exists) { keyFile.remove(); }
        }
        var file = new File(answer.path);
        if (!file.exists) {
            throw new Error(M("The AI voice reported success but wrote no file. / AI 語音回報成功卻沒有寫出檔案。") +
                "\n\n" + answer.path);
        }
        return { file: file, cached: answer.cached, unspoken: answer.unspoken };
    }

    /*
     * Which audio a line's plan should be read from, or none.
     *
     * A stale recording answers "none", and that is not an oversight: going
     * stale mutes the audio and turns the live effect back on, so what is heard
     * is the engine again — and the mouth has to follow what is heard. One
     * check keeps the two from ever disagreeing.
     */
    function cloudVoiceLayer(comp, layer) {
        if (!findNamedEffect(layer, CLOUD_VOICE_NAME)) { return null; }
        var audioLayer = bakedLayerFor(comp, layer);
        if (!audioLayer) { return null; }
        var live = false;
        try { live = audioLayer.audioEnabled === true; } catch (notAudio) { live = false; }
        if (!live) { return null; }
        var file = audioSourceFile(audioLayer);
        return file && file.exists ? audioLayer : null;
    }

    /*
     * The plan for a line, whoever made it.
     *
     * This is the one place that decides, and everything else — markers, the
     * rig, the mouth switch, Type-On, Fit Duration — keeps asking for "the
     * plan" exactly as it did in 1.0.10. That is invariant 8aa's promise being
     * collected: because a recording prints the format the engine prints, a
     * line whose sound came from a cloud model needed no new code anywhere
     * downstream of here.
     */
    function planForLayer(comp, layer, effect) {
        var voiced = cloudVoiceLayer(comp, layer);
        if (voiced) {
            return planWithinLayer(
                planFromAudio(audioSourceFile(voiced), audioSettingsFromLayer(voiced)), voiced);
        }
        return planFromEngine(effect);
    }

    function cloudVoiceToLayer(comp, layer, settings) {
        var spoken = speakToFile(settings);
        // Only after the file is in hand. Everything below changes the project,
        // and a failed request must leave it exactly as it was.
        releasePreviousBake(comp, layer);
        var imported = app.project.importFile(new ImportOptions(spoken.file));
        imported.name = layer.name + CLOUD_SUFFIX;
        var audioLayer = comp.layers.add(imported);
        audioLayer.startTime = layer.inPoint;
        audioLayer.name = layer.name + CLOUD_SUFFIX;
        audioLayer.moveAfter(layer);
        pointAtBake(layer, audioLayer);
        // The settings the mouth was read with, on the layer that was read, so
        // a later Rebuild reproduces this plan rather than making a different
        // one out of whatever the panel happens to be showing. Same reasoning,
        // and the same two controls, as an analysed recording.
        ensureSlider(audioLayer, AUDIO_LINE_NAME, Math.round(settings.sensitivity * 100));
        ensureSlider(audioLayer, AUDIO_VOWELS_NAME, settings.vowels ? 1 : 0);
        ensureSlider(layer, CLOUD_VOICE_NAME, 1);
        var effect = findNativeEffect(layer);
        if (effect) { effect.enabled = false; }
        var tone = findToneBootstrap(layer);
        if (tone) { tone.enabled = false; }
        return { audioLayer: audioLayer, cached: spoken.cached, unspoken: spoken.unspoken };
    }

    /*
     * One line, from the button to a moving mouth.
     *
     * The plan is fetched back through planForLayer() rather than from the
     * analysis directly, which looks like a detour and is not: it is the same
     * switch every later Rebuild will go through, so if that switch is ever
     * wrong the button shows it immediately instead of the next time somebody
     * moves an unrelated line.
     */
    function cloudVoiceLine(comp, layer, settings, options) {
        var made = cloudVoiceToLayer(comp, layer, settings);
        var plan = planForLayer(comp, layer, findNativeEffect(layer));
        retimeToPlan(comp, layer, plan, options);
        return { plan: plan, cached: made.cached, audioLayer: made.audioLayer,
            unspoken: made.unspoken };
    }

    function createOrUpdate(text, pronunciation, settings, options) {
        if (!app.project) { app.newProject(); }
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            throw new Error(M("Open an active composition first. / 請先開啟合成。"));
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
                throw new Error(M("Choose or create a character first. / 請先選擇或新增角色。"));
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

    /*
     * Subtitles that stay up until the next one arrives.
     *
     * Fit Duration ends a line where its audio ends, which is right for the
     * sound and wrong for the words: between "……好啊。" and the reply there is a
     * beat of silence, and the screen goes blank for it. Reading a scene back
     * then flickers, one line at a time.
     *
     * Only ever extends. A gap of zero already runs the lines straight on, and
     * two lines that deliberately overlap must not be pulled shorter to meet.
     * The last line keeps its own length, because there is nothing after it to
     * hold on for.
     *
     * The audio is unaffected: past the end of the utterance copy_region fills
     * silence, and the Tone bootstrap is at level zero.
     */
    function holdUntilNextLine(comp, layers) {
        var ordered = [];
        var index;
        for (index = 0; index < layers.length; index += 1) {
            if (findNativeEffect(layers[index])) { ordered.push(layers[index]); }
        }
        ordered.sort(function (first, second) {
            return first.inPoint - second.inPoint || first.index - second.index;
        });
        var held = 0;
        for (index = 0; index + 1 < ordered.length; index += 1) {
            var until = Math.min(ordered[index + 1].inPoint, comp.duration);
            if (until > ordered[index].outPoint + 0.0005) {
                ordered[index].outPoint = until;
                held += 1;
            }
        }
        return held;
    }

    function importScript(scriptText, settings, options, gapBeats, bpm) {
        if (!app.project) { app.newProject(); }
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            throw new Error(M("Open an active composition first. / 請先開啟合成。"));
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
            throw new Error(M("There is no script to import. / 沒有可以匯入的劇本文字。"));
        }
        // The character chosen in the panel is what a line with no speaker in
        // front of it belongs to.
        var fallbackRig = null;
        if (options.rigShared) {
            if (!options.rigCharacter) {
                throw new Error(M("Choose or create a character first. / 請先選擇或新增角色。"));
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
        // After the composition has settled, so a line is never held past the
        // end of it and then clamped back.
        var held = options.hold ? holdUntilNextLine(comp, made) : 0;
        var overlaps = [];
        touched = uniqueLayers(touched);
        for (index = 0; index < touched.length; index += 1) {
            overlaps = overlaps.concat(rebuildSharedRig(comp, touched[index], planned).overlaps);
        }
        for (index = 1; index <= comp.numLayers; index += 1) { comp.layer(index).selected = false; }
        for (index = 0; index < made.length; index += 1) { made[index].selected = true; }
        return {
            count: made.length,
            held: held,
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
            throw new Error(
                M("Island Chatter could not read that MIDI file. / Island Chatter 無法讀取這個 MIDI 檔。") +
                "\n\n" + reply);
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
                    melody: [],
                    details: []
                });
            } else if (fields[0] === "X" || fields[0] === "N" || fields[0] === "D") {
                var which = song.lines[parseInt(fields[1], 10)];
                if (!which) { continue; }
                for (at = 2; at < fields.length; at += 1) {
                    var number = parseInt(fields[at], 10);
                    if (isNaN(number)) { continue; }
                    // Characters travel as decimal codepoints for the same
                    // reason the timing plan's do: stdout comes back through the
                    // console code page and would turn Chinese into "?".
                    if (fields[0] === "X") { which.text += characterFromCode(number); }
                    else if (fields[0] === "D") { which.details.push(number); }
                    else { which.melody.push(number); }
                }
            }
        }
        if (declared !== song.lines.length) {
            throw new Error(
                M("Island Chatter could not lay out that song. / Island Chatter 無法排出這首歌。") +
                "\n\n" + reply);
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

    /*
     * Turning a sung line back into a spoken one.
     *
     * Apply deliberately leaves a layer's melody alone, so that pressing it on a
     * song does not silently undo the import — which leaves no way to undo it on
     * purpose. This is that way. It reads the voice off the layer and puts it
     * back with an empty melody, so nothing about the character changes, and
     * refits the length because the line is about to get much shorter.
     */
    function clearMelody(comp, layer) {
        var effect = findNativeEffect(layer);
        if (!effect || !melodyFromEffect(effect).length) { return false; }
        var voice = settingsFromEffect(effect);
        voice.melody = [];
        voice.melodyDetails = [];
        setEffectParameters(effect, textFromLayer(layer), voice, comp.time);
        effect = findNativeEffect(layer);
        var plan = planFromEngine(effect);
        fitLayerToPlan(comp, layer, plan.duration, true);
        if (hasTimingMarkers(layer)) { updateTimingMarkers(layer, plan); }
        markBakeStale(comp, layer);
        return true;
    }

    // Layers an import created, so a second import can offer to replace them
    // instead of laying a whole second copy of the song on top of the first.
    var SONG_TAG_NAME = "IC Song";

    function songLayers(comp) {
        var found = [];
        var index;
        for (index = 1; index <= comp.numLayers; index += 1) {
            if (findNamedEffect(comp.layer(index), SONG_TAG_NAME)) {
                found.push(comp.layer(index));
            }
        }
        return found;
    }

    function importSong(midiFile, trackIndex, lyrics, settings, options, tonic) {
        if (!app.project) { app.newProject(); }
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            throw new Error(M("Open an active composition first. / 請先開啟合成。"));
        }
        // No lyric is not an error: the engine sings the melody's own note
        // names instead, and hands them back as the text for each layer.
        var song = songFromMidi(midiFile, trackIndex, lyrics, tonic);
        if (!song.lines.length) {
            throw new Error(M("There is nothing to sing on that track. / 這一軌沒有東西可以唱。"));
        }
        var fallbackRig = null;
        if (options.rigShared) {
            if (!options.rigCharacter) {
                throw new Error(M("Choose or create a character first. / 請先選擇或新增角色。"));
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
            lineSettings.melodyDetails = line.details;
            lineSettings.melodyBpm = line.bpm;
            var applied = applyToTextLayer(comp, layer, "", lineSettings, sung, fallbackRig);
            ensureSlider(layer, SONG_TAG_NAME, 1);
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
    /*
     * Put a line back on a plan, rebuilding only what it already had.
     *
     * Pulled out of resyncLayer() rather than copied, because the cloud voice
     * needs precisely this and needs it to behave identically: a new plan
     * arrives, the line is refitted, and whatever the layer was already
     * carrying — markers, its own rig, Type-On — is rewritten while nothing new
     * is added. That last part is invariant 8o's rule, and it now has one
     * implementation instead of two that could drift.
     */
    function retimeToPlan(comp, layer, plan, options) {
        var hadMarkers = hasTimingMarkers(layer);
        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        var hadTypeOn = !!findNamedProperty(animators, "Island Chatter Type-On");
        var hadOwnRig = !!findNamedEffect(layer, RIG_TRACK_NAMES[0]);
        // An edit that made the line longer can push it past the end of the
        // composition, where the out point is clamped and the line is squashed
        // to whatever room was left. Growing first is the same reason Import
        // does: a line silently cut short is worse than a longer composition.
        // Only Apply leaves the composition alone, because putting a voice on a
        // layer is not a request to change how long the film is.
        if (comp.duration < layer.inPoint + plan.duration) {
            comp.duration = layer.inPoint + plan.duration;
        }
        fitLayerToPlan(comp, layer, plan.duration, false);
        if (hadMarkers) { updateTimingMarkers(layer, plan); }
        if (hadOwnRig) { updateAnimationControls(comp, layer, plan); }
        if (hadTypeOn) {
            updateTypeOn(layer, plan, comp.time,
                typeOnCurve(options.typeOnLeave), options.typeOnSmoothness);
            if (findNamedProperty(animators, CENTER_ANIMATOR_NAME)) {
                updateTypeOnCentering(comp, layer, plan, typeOnCurve(options.typeOnLeave));
            }
        }
    }

    function resyncLayer(comp, layer, options) {
        var effect = findNativeEffect(layer);
        if (!effect) { return null; }
        var voice = settingsFromEffect(effect);
        var text = textFromLayer(layer);
        var truncated = text.length > MAX_TEXT_UNITS ? layer.name : "";
        var unmarked = unmarkedKanji(text) ? layer.name : "";
        var previousRig = rigTargetLayer(comp, layer);
        setEffectParameters(effect, text, voice, comp.time);
        // The engine's, deliberately: re-syncing is what a text edit needs, and
        // a text edit is exactly what makes a cloud recording say the wrong
        // thing. markBakeStale() below mutes it and turns the live effect back
        // on, so this plan is the one that matches what will be heard.
        var plan = planFromEngine(effect);
        retimeToPlan(comp, layer, plan, options);
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
    /*
     * A sung line is not re-flowed.
     *
     * Re-flow lays dialogue out end to end on the beat grid, which is exactly
     * the wrong thing to do to a song: an imported melody sits at the times its
     * MIDI file says, and dragging it onto the panel's grid takes it off its own
     * accompaniment. They are skipped and counted rather than refused, because a
     * scene can hold both and the spoken lines still want tidying.
     */
    function reflowLayers(comp, layers, gapBeats, bpm, hold) {
        var ordered = [];
        var sung = 0;
        var index;
        for (index = 0; index < layers.length; index += 1) {
            var candidate = findNativeEffect(layers[index]);
            if (!candidate) { continue; }
            if (melodyFromEffect(candidate).length) { sung += 1; continue; }
            ordered.push(layers[index]);
        }
        if (!ordered.length) {
            throw new Error(sung
                ? M("Those lines are singing; Re-flow would take them off their MIDI times. / 選到的都是唱歌圖層，重新排列會把它們從 MIDI 的時間拉走。")
                : M("Select the lines to lay out. / 請選取要排列的台詞圖層。"));
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
            fitLayerToPlan(comp, layer, plan.duration, false);
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
        // Re-flow has to hold as well as lay out. Laying the scene out again
        // without it would silently undo every hold the import made, which is
        // the first thing anyone does after editing a line.
        var held = hold ? holdUntilNextLine(comp, ordered) : 0;
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
            held: held,
            sungSkipped: sung,
            grew: comp.duration > wasDuration ? comp.duration : 0,
            overlaps: overlaps
        };
    }

    function addSlider(parent, label, minimum, maximum, value, decimals) {
        /*
         * Two decimals unless the caller says otherwise, which only Seed does.
         *
         * A seed is a whole number and was drawn as `271.00`. Two decimal
         * places on a value that cannot have any read as though the control
         * were finer than it is, and as though 271.00 and 271.01 were different
         * voices. They are the same voice; the second is not expressible.
         */
        var places = decimals === undefined ? 2 : decimals;
        var group = parent.add("group");
        group.orientation = "row";
        var title = group.add("statictext", undefined, label);
        // A deliberate width, so every slider starts in the same column. It
        // must survive a language change, which is what icFixedWidth says.
        title.preferredSize.width = 110;
        title.icFixedWidth = true;
        var slider = group.add("slider", undefined, value, minimum, maximum);
        slider.alignment = ["fill", "center"];
        var field = group.add("edittext", undefined, value.toFixed(places));
        field.characters = 5;
        slider.onChanging = function () { field.text = slider.value.toFixed(places); };
        field.onChange = function () {
            var parsed = parseFloat(field.text);
            slider.value = clamp(isNaN(parsed) ? value : parsed, minimum, maximum);
            field.text = slider.value.toFixed(places);
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
        /*
         * Two tabs from 3.6.0, split by whether a control exists anywhere else.
         * Everything on the second page is an effect parameter and appears in
         * Effect Controls once a line is applied; nothing on the first page
         * does. It replaced "Speak / 說話", "Timbre & animation / 音色與動畫"
         * and "Sing & dub / 唱歌與配音".
         */
        "Lines & animation / 句子與動畫": "セリフとアニメーション",
        // The Voice page's section headings, added in 3.8.0. The page was five
        // unrelated things in one column and read as one long list of sliders.
        "— Character / 角色 —": "— キャラクター —",
        "— Timbre / 音色 —": "— 音色 —",
        "— Listen / 試聽與自訂音色 —": "— 試聴と自分の声 —",
        "— Sing from MIDI / 用 MIDI 唱歌 —": "— MIDI で歌わせる —",
        "— Mouth from a recording / 用錄音對嘴 —": "— 録音から口を動かす —",
        // The sound-source dropdown had no label at all until 3.8.0; it showed
        // only its own value, which read as a list of voices rather than as
        // what replaces the vocal folds.
        "Sound source / 發聲源": "音源",
        "Voice / 聲音": "声",
        "Lip-sync from audio / 音檔轉口型": "音声から口を動かす",
        "Sensitivity / 靈敏度": "感度",
        "Vowels / 判斷母音": "母音を判定",
        "{0} syllable(s) found / 找到 {0} 個音節": "{0} 音節を検出しました",
        "Select an audio layer. / 請選取音訊圖層。": "音声レイヤーを選択してください。",
        "Add a character on the Animation page first. / 請先在「動畫」頁新增角色。":
            "先に「アニメーション」ページでキャラクターを追加してください。",
        "{0} is not an audio layer. / {0} 不是音訊圖層。": "{0} は音声レイヤーではありません。",
        "The file for {0} is missing. / 找不到 {0} 的檔案。": "{0} のファイルが見つかりません。",
        "{0} is time-stretched; set it back to 100% first. / {0} 有時間伸縮，請先改回 100%。":
            "{0} はタイムストレッチされています。先に 100% に戻してください。",
        "Lip-synced {0} layer(s) onto {1} / 已對嘴 {0} 層到「{1}」":
            "{0} レイヤーを「{1}」に口パクさせました",
        "Lip-synced {0} layer(s); {1} overlap / 已對嘴 {0} 層；有 {1} 句重疊":
            "{0} レイヤーを口パクさせました。{1} 件が重なっています",
        "Preview / 試聽": "試聴",
        "My voice… / 我的聲音…": "自分の声…",
        "Clear / 清除": "消去",
        // 3.9.0 states both numbers. A trial that says "every few seconds" and
        // marks every two reads as a fault rather than as a watermark.
        "Trial: a mark every {0} seconds, {1} layers at a time / 試用版：每 {0} 秒一段標記聲，一次最多 {1} 層":
            "体験版：{0} 秒ごとに印の音、一度に {1} レイヤーまで",
        "Trial / 試用版": "体験版",
        "The trial applies to {0} layers at a time and {1} are selected.\n\nThe full version has no limit. / 試用版一次最多套用 {0} 層，你選了 {1} 層。\n\n正式版沒有這個限制。":
            "体験版は一度に {0} レイヤーまでです。{1} レイヤーが選択されています。\n\n製品版に制限はありません。",
        "Built-in / 內建": "内蔵",
        "{0} of 5 vowels / 5 個母音中的 {0} 個": "母音 5 つのうち {0} つ",
        "Choose a recording of a held “{0}” / 請選一段拉長的「{0}」的錄音":
            "「{0}」を伸ばして録音したファイルを選んでください",
        "Measured {0} vowel(s); Apply writes them onto a layer / 已量到 {0} 個母音，按 Apply 才會寫到圖層上":
            "母音を {0} つ測りました。レイヤーに書き込むには「適用」を押してください",
        "Back to the built-in voice / 已改回內建的聲音": "内蔵の声に戻しました",
        "Could not read {0}. / 無法讀取 {0}。": "{0} を読み取れませんでした。",
        "There is not enough steady sound in {0} to measure a vowel. Record a second or two of one held vowel. / {0} 裡面沒有足夠穩定的聲音可以量。請錄一兩秒、一個拉長的母音。":
            "{0} には母音を測れるだけの安定した音がありません。母音を 1〜2 秒伸ばして録音してください。",
        "Playing… / 播放中…": "再生中…",
        "Previewed / 已試聽": "試聴しました",
        "Type something first, or select a text layer to hear. / 請先打字，或選一個文字圖層來聽。":
            "先に文字を入力するか、聴きたいテキストレイヤーを選んでください。",
        "Could not render the preview. / 無法算出試聽的聲音。":
            "試聴用の音声を生成できませんでした。",
        "Windows could not play the preview. / Windows 無法播放試聽的聲音。":
            "Windows が試聴用の音声を再生できませんでした。",
        // "Cloud voice" until 3.8.0. Both kinds of source are a neural model,
        // so the pair below has to keep saying which one leaves the machine —
        // that is the whole of invariant 8aj's argument about this button.
        "AI voice / AI 語音": "AI 音声",
        "API key / 金鑰": "APIキー",
        "Offline models… / 離線模型…": "オフラインモデル…",
        "Offline models / 離線模型": "オフラインモデル",
        "Offline AI voice / 離線 AI 語音": "オフライン AI 音声",
        "Download / 下載": "ダウンロード",
        "Remove / 移除": "取り除く",
        "Close / 關閉": "閉じる",
        "Installed · {0} MB / 已安裝 · {0} MB": "導入済み・{0} MB",
        "Not downloaded · {0} MB / 尚未下載 · {0} MB": "未ダウンロード・{0} MB",
        "Removed {0} / 已移除 {0}": "{0} を取り除きました",
        "This build knows about no offline models. / 這個版本沒有任何離線模型。":
            "このビルドにはオフラインモデルがありません。",
        "Models live in your own user folder, so removing Island Chatter leaves them alone. After Effects stops responding while one downloads. / 模型放在你自己的使用者資料夾，所以移除 Island Chatter 不會動到它們。下載時 After Effects 會沒有反應。":
            "モデルはご自身のユーザーフォルダーに保存されるため、Island Chatter を削除しても残ります。ダウンロード中は After Effects が応答しなくなります。",
        "Download {0}?\n\nAbout {1} MB, once. After that this voice needs no network and no account — it runs on this computer.\n\nAfter Effects will not respond while it downloads. / 要下載{0}嗎？\n\n大約 {1} MB，只下載這一次。之後這個語音不用連網、不用帳號，完全在這台電腦上算。\n\n下載時 After Effects 會沒有反應。":
            "{0} をダウンロードしますか？\n\n約 {1} MB、一度だけです。以後この音声はネットワークもアカウントも不要で、このパソコンの中だけで動きます。\n\nダウンロード中は After Effects が応答しなくなります。",
        "Remove {0}?\n\nIt frees about {1} MB. You can download it again at any time. / 要移除{0}嗎？\n\n會空出大約 {1} MB。之後隨時可以再下載一次。":
            "{0} を取り除きますか？\n\n約 {1} MB が空きます。いつでも再ダウンロードできます。",
        "This model is Mandarin as it is spoken in China, by a woman. It is the only Chinese model whose licence allows it to ship here, and no Taiwanese-accented offline model exists; for Taiwan Mandarin use the built-in voice or Azure. / 這個模型是中國口音的普通話女聲。可商用授權的中文模型只有這一個，台灣國語的離線模型並不存在；要台灣國語請用內建的聲音或 Azure。":
            "このモデルの声は中国の標準中国語（普通話）を話す女性です。商用利用できるライセンスの中国語モデルはこれだけで、台湾なまりのオフラインモデルは存在しません。台湾の中国語には内蔵の音声か Azure をお使いください。",
        "This voice has no sound for these characters, so they were left out: {0} / 這個語音沒有這些字的發音，所以沒有唸出來：{0}":
            "この音声には次の文字の読みがないため、読み上げられませんでした：{0}",
        "Downloading… / 下載中…": "ダウンロード中…",
        "Model ready / 模型已就緒": "モデルの準備ができました",
        "Download failed / 下載失敗": "ダウンロードに失敗しました",
        "Offline model installed ({0} MB) / 離線模型已安裝（{0} MB）":
            "オフラインモデルを入れました（{0} MB）",
        // Not "Voice / 音色": the Timbre tab already carries that, and this is
        // the provider's own identifier for a voice rather than a setting.
        "Voice ID / 音色代號": "ボイスID",
        "Model / 模型": "モデル",
        "Region / 區域": "リージョン",
        // The key dialog holds the voice id, model and region too from 3.8.0,
        // so it is the account rather than just the key.
        "{0} account / {0} 帳號設定": "{0} のアカウント設定",
        "Kept in this computer's After Effects preferences, in plain text. / 會存在這台電腦的 After Effects 偏好設定裡，是明碼。":
            "このパソコンの After Effects 環境設定に、平文のまま保存されます。",
        "Save / 儲存": "保存",
        "Forget / 清除": "消去",
        "Cancel / 取消": "キャンセル",
        // The offline model's own voice settings. The key button says this
        // instead of "API key" when the selected source runs on this machine,
        // because such a source has no account and does have a voice.
        "Tuning… / 調音…": "声の調整…",
        "Voice settings for {0} / {0} 的聲音設定": "{0} の声の設定",
        // No "Speaker" row from 3.5.0: both models were trained with one voice
        // each, so there was never anything to choose.
        "Preset / 預設": "プリセット",
        "MeloTTS default / MeloTTS 官方預設": "MeloTTS の既定",
        "Steady / 穩定": "安定",
        "Lively / 活潑": "いきいき",
        "Narration / 旁白": "ナレーション",
        "Hurried / 急促": "早口",
        "Custom / 自訂": "カスタム",
        "Variation / 變化": "ゆらぎ",
        "Rhythm / 節奏變化": "リズムのゆらぎ",
        "Speed / 語速": "はやさ",
        "{0} to {1} / {0} 到 {1}": "{0}～{1}",
        "Play / 試聽": "試聴",
        "First press loads the model / 第一次按要先載入模型":
            "最初の一回はモデルの読み込みが入ります",
        "Rendering… / 計算中…": "合成中…",
        "Played / 已播放": "再生しました",
        "Could not play / 無法播放": "再生できませんでした",
        "Type a line first, so there is something to hear. / 請先打一句話，才有東西可以聽。":
            "先に一行入力してください。聞くものがありません。",
        "Variation is how much the voice may differ from one render to the next; rhythm is the same thing for how long each syllable is held. Speed is this model's own — the panel's Speed slider belongs to the built-in voice and never reaches a line an offline model spoke. There is no speaker to choose: both models were trained with one voice each. / 「變化」是每次算出來可以差多少，「節奏變化」是同一件事、但作用在每個字拉多長。「語速」是這個模型自己的——面板上的 Speed 滑桿是內建聲音在用的，碰不到離線模型唸出來的句子。沒有語者可以選：這兩個模型各自都只訓練了一個聲音。":
            "「ゆらぎ」は合成するたびに声がどれだけ変わってよいか、「リズムのゆらぎ」は同じことを一音ごとの長さに当てはめたものです。「はやさ」はこのモデル自身のもので、パネルの Speed スライダーは内蔵の音声のものなので、オフラインモデルがしゃべった行には届きません。話者は選べません。どちらのモデルも声が一つしか学習されていないためです。",
        "Voice tuned / 已調過音": "声を調整しました",
        "“{0}” is not written as name=value. / 「{0}」不是「名稱=值」的寫法。":
            "「{0}」が name=value の形になっていません。",
        "There is no voice setting called “{0}”. / 沒有叫「{0}」的聲音設定。":
            "「{0}」という声の設定はありません。",
        "{0} has to be a number, not “{1}”. / {0} 要填數字，不能是「{1}」。":
            "{0} には数字を入れてください。「{1}」は数字ではありません。",
        "{0} has to be a whole number. / {0} 要填整數。": "{0} には整数を入れてください。",
        "{0} has to be between {1} and {2}. / {0} 要在 {1} 到 {2} 之間。":
            "{0} は {1} から {2} のあいだにしてください。",
        "Key saved / 已存下金鑰": "APIキーを保存しました",
        "Key cleared / 已清除金鑰": "APIキーを消去しました",
        "Choose a provider first. / 請先選一家供應商。":
            "先にサービスを選んでください。",
        "Set the API key for {0} first. / 請先設定 {0} 的 API 金鑰。":
            "先に {0} の APIキーを設定してください。",
        "{0} needs the region its resource is in. / {0} 需要填寫資源所在的區域。":
            "{0} にはリソースのリージョンが必要です。",
        "{0} is longer than {1} characters. Split it first. / {0} 超過 {1} 個字，請先拆成幾句。":
            "{0} は {1} 文字を超えています。先に分けてください。",
        "The selected layer(s) have no text in them. / 選取的圖層裡沒有文字。":
            "選択したレイヤーに文字がありません。",
        "Send {0} line(s), {1} characters, to {2}?\n\nThe text leaves this computer. Lines already fetched with the same settings are reused and cost nothing. / 要把 {0} 句、共 {1} 個字送到 {2} 嗎？\n\n文字會離開這台電腦。文字和設定都沒變的句子會直接沿用上次的檔案，不會再花錢。":
            "{0} 行・{1} 文字を {2} に送信しますか？\n\n文字はこのパソコンの外に出ます。文字も設定も変わっていない行は前回のファイルを使い回すので、費用はかかりません。",
        "Speak {0} line(s), {1} characters, with {2}?\n\nThis runs on your own computer: nothing is sent anywhere and nothing is billed. / 要用 {2} 唸出 {0} 句、共 {1} 個字嗎？\n\n這是在你自己的電腦上算的，不會送出任何東西，也不會產生費用。":
            "{0} 行・{1} 文字を {2} でしゃべらせますか？\n\nこれはあなたのパソコンの中で動きます。どこにも送信されず、費用もかかりません。",
        "{0} new, {1} reused / 新增 {0}、沿用 {1}": "新規 {0} 件・再利用 {1} 件",
        "AI voice on {0} layer(s) via {1} / 已用 {1} 為 {0} 層配音":
            "{1} で {0} レイヤーに声を当てました",
        "{0} is missing. Reinstall Island Chatter. / 找不到 {0}，請重新安裝 Island Chatter。":
            "{0} が見つかりません。Island Chatter を再インストールしてください。",
        "Island Chatter could not run the AI voice tool. / Island Chatter 無法執行 AI 語音工具。":
            "Island Chatter は AI 音声ツールを実行できませんでした。",
        "Could not write the temporary key file. / 無法寫入暫存金鑰檔。":
            "一時的なキーファイルを書き込めませんでした。",
        "The AI voice reported success but wrote no file. / AI 語音回報成功卻沒有寫出檔案。":
            "クラウド音声は成功と答えましたが、ファイルが作られていません。",
        "Direct text-layer voice / 文字圖層直接發聲": "テキストレイヤーが直接しゃべる",
        // What a character saved by 1.0.2 is called: it had one unnamed slot.
        "Saved / 已儲存": "保存済み",
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
        "Hold / 接到下一句": "次までのばす",
        "Chatter / 逐字開合": "1 音ずつ開閉",
        "Choose MIDI / 選 MIDI": "MIDI を選ぶ",
        "Sing / 唱出來": "歌わせる",
        "Speak / 改回講話": "しゃべりに戻す",
        "Key / 唱名調": "階名のド",
        "Transpose / 移調": "移調",
        "Tone % / 聲調 %": "声調 %",
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
        // Was "Leave / 離開" until 3.7.0, which named the side of the keyframe
        // the influence sits on rather than what moving it does.
        "Ease / 緩動": "動きのため",
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
        "Apply Island Chatter to this layer first. / 請先對此圖層按 Apply。": "このレイヤーにまず適用してください。",

        /*
         * Everything the panel says while it is running, rather than the labels
         * it was built with. These were written straight into status.text and
         * alert() until 2.0, which meant every user saw both halves of every
         * message and a Japanese user saw no Japanese at all — the interface
         * was translated and the interface's own voice was not.
         *
         * {0} and {1} stand in for whatever the message counts, so a
         * translation can put the number where its own grammar wants it.
         * Rebuilding these by concatenation is what stranded "已唱出 3 句" in
         * an English panel.
         */
        "Select a saved character first. / 請先選取自訂角色。":
            "先に保存したキャラを選んでください。",
        "Select a text layer or enter text first. / 請選取文字圖層或先輸入文字。":
            "テキストレイヤーを選ぶか、文字を入力してください。",
        "Select the lines to turn back into speech. / 請選取要改回講話的圖層。":
            "しゃべりに戻すレイヤーを選んでください。",
        "Apply Island Chatter to these layers first. / 這些圖層還沒套用過。":
            "これらのレイヤーにはまだ適用されていません。",
        "Choose a MIDI file first. / 請先按「選 MIDI」挑一個檔案。":
            "先に「MIDI を選ぶ」でファイルを選んでください。",
        "Choose a track first. / 請先選一個軌道。": "先にトラックを選んでください。",
        "There is nothing to sing on that track. / 這一軌沒有東西可以唱。":
            "このトラックには歌えるものがありません。",
        "Choose a MIDI file / 選一個 MIDI 檔": "MIDI ファイルを選ぶ",
        "Character {0} / 角色 {0}": "キャラ {0}",
        "Read settings from {0} / 已讀取設定：{0}": "{0} から設定を読み込みました",
        "Saved {0} / 已儲存：{0}": "{0} を保存しました",
        "Now editing {0} / 目前角色：{0}": "編集中のキャラ：{0}",
        "Rebuilt {0} rig(s), {1} line(s) / 已重建 {0} 組控制器、{1} 句":
            "リグ {0} 組・{1} 行を作り直しました",
        "Overlapping lines: {0} / 台詞重疊：{0}": "セリフが重なっています：{0}",
        "Mouth on Time Remap / 嘴型已接上時間重映射":
            "口パクをタイムリマップにつなぎました",
        "Mouth switch on {0} layer(s) -> {1} / 已接上嘴型 {0} 層 -> {1}":
            "口パクを {0} レイヤーにつなぎました -> {1}",
        "Baked {0} layer(s) -> {1} / 已轉成音訊 {0} 層 -> {1}":
            "{0} レイヤーを書き出しました -> {1}",
        "Removed {0} item(s) from {1} layer(s) / 已移除 {1} 層上的 {0} 個項目":
            "{1} レイヤーから {0} 項目を取り除きました",
        "Re-synced {0} layer(s) / 已重新同步 {0} 層": "{0} レイヤーを更新しました",
        "Re-flowed {0} layer(s) @ {1} beat(s) / 已排列 {0} 層 @ {1} 拍":
            "{0} レイヤーを {1} 拍あけて並べ直しました",
        "Imported {0} layer(s) / 已匯入 {0} 層": "{0} レイヤーを読み込みました",
        "Truncated: {0} / 已截斷：{0}": "文字が切れました：{0}",
        "Kanji read as Chinese: {0} / 漢字以中文讀音唸出：{0}":
            "漢字は中国語読みです：{0}",
        "No notes in that file / 這個檔案裡沒有音符": "このファイルに音符がありません",
        "MIDI loaded: {0} — pick a track, then Sing / 已讀取 {0} —— 選好軌道後按「唱出來」":
            "MIDI を読み込みました：{0} —— トラックを選んで「歌わせる」",
        "Sung {0} layer(s) / 已唱出 {0} 層": "{0} レイヤーを歌わせました",
        "Sung note names on {0} layer(s) / 已唱唱名 {0} 層":
            "階名で {0} レイヤーを歌わせました",
        "Sung {0} line(s) — {1} / 已唱出 {0} 句 —— {1}": "{0} 行を歌わせました —— {1}",
        "Speaking again: {0} layer(s) / 已改回講話 {0} 層":
            "{0} レイヤーをしゃべりに戻しました",
        "None of those were singing / 選取的圖層沒有旋律":
            "選んだレイヤーにメロディがありません",
        "Applied to {0} layer(s) / 已套用 {0} 個圖層": "{0} レイヤーに適用しました",
        // Tails, appended to a message above. Each carries its own leading gap
        // so the caller only ever joins localised pieces.
        "  rig x{0} / 　控制器 x{0}": "　リグ x{0}",
        "  stale bake x{0} / 　轉檔過期 x{0}": "　書き出し古い x{0}",
        "  held x{0} / 　接到下一句 x{0}": "　次までのばす x{0}",
        "  +{0} split / 　+{0} 斷句": "　+{0} 行に分割",
        "  cast: {0} / 　角色：{0}": "　キャラ：{0}",
        "  comp grown to {0}s / 　合成延長到 {0}s": "　コンポを {0}s に延長",
        "  ({0} sung layer(s) left in place) / 　（唱歌 {0} 層維持原位）":
            "　（歌の {0} レイヤーはそのまま）",
        // What did not line up in an import, said out loud rather than guessed at.
        "{0} syllable(s) with no note / {0} 個字沒有音符（用最後一個音唱完）":
            "{0} 文字に音符がありません（最後の音でのばします）",
        "{0} note(s) with no syllable / {0} 個音符沒有字": "{0} 音に歌詞がありません",
        "{0} note(s) dropped from chords / 和弦捨去 {0} 個音": "和音から {0} 音を省きました",
        "{0} long line(s) split / 太長的句子拆成 {0} 層": "長い行を {0} レイヤーに分けました",
        "truncated: {0} / 被截斷：{0}": "切れました：{0}",
        // The readouts beside the tempo, gap and MIDI controls.
        "Speed set manually / 語速為手動設定": "はやさは手動設定です",
        "{0} s/syllable   Speed {1} / {0} 秒／字   Speed {1}": "{0} 秒／音   Speed {1}",
        "  (x{0} character) / 　（x{0} 角色補償）": "　（x{0} キャラ補正）",
        "   OUT OF RANGE / 　　超出範圍": "　　範囲外",
        "= 0s  no grid / = 0s　無格線": "= 0s　グリッドなし",
        "  sixteenth / 　十六分": "　16 分",
        "  eighth / 　八分": "　8 分",
        "  quarter / 　四分": "　4 分",
        "  half / 　二分": "　2 分",
        "{0} track(s) · {1} BPM / {0} 軌・{1} BPM": "{0} トラック・{1} BPM",
        "{0} line(s) · {1} BPM / {0} 句・{1} BPM": "{0} 行・{1} BPM",
        // The two questions the panel asks, rather than tells.
        "There are already {0} layer(s) here from an earlier MIDI import.\n\nRemove them first? No adds a second copy. / 這個合成裡已經有 {0} 層是之前匯入的。\n\n要先移除它們嗎？按「否」就直接再加一份。":
            "このコンポには前回の MIDI 読み込みで作られたレイヤーが {0} 枚あります。" +
            "\n\n先に取り除きますか？「いいえ」でもう一組追加します。",
        "Only the first {0} UTF-16 units are spoken; the rest of the Source Text was cut:\n\n{1} / 只會唸出前 {0} 個 UTF-16 字元，超出的 Source Text 已截斷：\n\n{1}":
            "しゃべるのは最初の {0} UTF-16 単位までです。残りのソーステキストは切りました：\n\n{1}",
        // Errors raised deep in the panel and shown through alert().
        "The built-in Tone effect is unavailable. / 找不到 AE 內建的 Tone／音調效果。":
            "After Effects 内蔵のトーン効果が見つかりません。",
        "Save the project first so the audio can go beside it. / 請先儲存專案，音訊會放在專案檔旁邊。":
            "先にプロジェクトを保存してください。音声はその隣に書き出します。",
        "Could not create {0} / 無法建立 {0}": "{0} を作成できませんでした",
        "Bake failed for {0} / 轉檔失敗：{0}": "書き出しに失敗しました：{0}",
        "There is no script to import. / 沒有可以匯入的劇本文字。":
            "読み込める台本がありません。",
        "island_chatter_bake.exe is missing. Reinstall Island Chatter. / 找不到 island_chatter_bake.exe，請重新安裝 Island Chatter。":
            "island_chatter_bake.exe が見つかりません。Island Chatter を入れ直してください。",
        "Island Chatter could not read the timing plan. / Island Chatter 無法讀取時間規劃。":
            "タイミングの計算結果を読み取れませんでした。",
        "Island Chatter could not read that MIDI file. / Island Chatter 無法讀取這個 MIDI 檔。":
            "この MIDI ファイルを読み取れませんでした。",
        "Island Chatter could not lay out that song. / Island Chatter 無法排出這首歌。":
            "この曲を並べられませんでした。",
        "Select the mouth layers, or one mouth precomp. / 請選取嘴型圖層，或一個嘴型合成。":
            "口パク用のレイヤー、または口パクコンポを選んでください。",
        "A mouth needs {0} shapes: closed, a, i, u, e, o. / 一組嘴型需要 {0} 張：閉嘴、a、i、u、e、o。":
            "口パクには {0} 枚必要です：閉じ、a、i、u、e、o。",
        "{0} has no Opacity to switch. / {0} 沒有可切換的不透明度。":
            "{0} には切り替えられる不透明度がありません。",
        "Type-On could not build its text animator on this layer. / 逐字顯示無法在這個圖層上建立文字動畫。":
            "このレイヤーに一文字ずつ表示のアニメーターを作れませんでした。",
        "The Type-On range selector has no percentage controls. / 逐字顯示的範圍選取器沒有百分比控制項。":
            "一文字ずつ表示の範囲セレクターに％の項目がありません。",
        "Set the Island Chatter Reveal selector's Advanced > Units back to Percentage. / 請把 Island Chatter Reveal 選取器的 Advanced > Units 改回 Percentage。":
            "Island Chatter Reveal セレクターの詳細 > 単位を「割合」に戻してください。",
        "Native effect is not installed: {0} / 找不到已安裝的效果：{0}":
            "効果がインストールされていません：{0}",
        "Those lines are singing; Re-flow would take them off their MIDI times. / 選到的都是唱歌圖層，重新排列會把它們從 MIDI 的時間拉走。":
            "選んだのはすべて歌のレイヤーです。並べ直すと MIDI の時間から外れてしまいます。"
    };

    /*
     * 简体中文, derived from the Traditional half rather than written out again.
     *
     * 163 messages and 29 tooltips duplicated by hand would drift the first
     * time one of them was reworded, and every future message would need two
     * Chinese versions or silently have none. The difference is mechanical, so
     * it is done mechanically — and `npm test` fails if a new string uses a
     * character this has never seen.
     *
     * Two passes, and the order matters. Converting character by character
     * alone gives Simplified characters spelling *Taiwan* terminology: 算圖佇列
     * comes out as 算图伫列, which nobody in China says. The terms go
     * first and fix the vocabulary; the characters then fix the script.
     *
     * Longest term first, because 專案檔 has to become 项目文件 before 專案
     * becomes 项目 and before the bare 檔 becomes 文件.
     */
    var IC_SIMPLIFIED_TERMS = [
        ["關鍵影格", "关键帧"], ["文字圖層", "文本图层"],
        // The cloud voice brought four more, and every one of them is a word
        // that a character map alone would leave reading as Taiwan usage:
        // 执行绪, 网路, 命令列 and 偏好设置 are all correct Simplified spellings
        // of terms nobody in China says. 偏好設定 has to precede the
        // bare 設定 or it becomes 偏好设置 before this line is ever reached.
        ["偏好設定", "首选项"], ["執行緒", "线程"], ["暫存檔", "临时文件"],
        ["專案檔", "项目文件"], ["資料夾", "文件夹"], ["空物件", "空对象"],
        ["選取器", "选择器"], ["文字框", "文本框"], ["轉檔", "导出"],
        ["命令列", "命令行"], ["網路", "网络"],
        ["影格", "帧"], ["佇列", "队列"], ["算圖", "渲染"], ["專案", "项目"],
        ["檔案", "文件"], ["滑桿", "滑块"], ["音訊", "音频"], ["匯入", "导入"],
        ["貼進", "粘贴到"], ["字元", "字符"], ["介面", "界面"], ["選取", "选中"],
        ["設定", "设置"], ["預設", "默认"], ["儲存", "保存"], ["套用", "应用"],
        ["嘴型", "口型"], ["建立", "创建"], ["檔", "文件"]
    ];

    /*
     * Every Han character the panel's Chinese text uses whose Simplified form
     * differs. Traditional to Simplified is the safe direction: it is
     * many-to-one, so 發 and 髮 both give 发 and no choice has to be made.
     *
     * The one character here that is genuinely context-dependent is 著: it is
     * 着 as a particle (連著, 跟著, 接著, which is every use in this panel) and
     * stays 著 in 著名 and 顯著. If a message ever needs that second sense, it
     * needs a term-table entry rather than this map.
     */
    var IC_SIMPLIFIED_CHARS = {
        "並": "并", "併": "并", "佇": "伫", "來": "来", "個": "个", "們": "们",
        "陸": "陆", "灣": "湾", "國": "国", "貨": "货", "試": "试", "帶": "带", "復": "复", "鐘": "钟", "穩": "稳", "視": "视", "順": "顺", "彎": "弯", "複": "复", "製": "制",
        "償": "偿", "儲": "储", "內": "内", "兩": "两", "刪": "删", "別": "别",
        "剛": "刚", "劃": "划", "劇": "剧", "動": "动", "匯": "汇", "問": "问",
        "啟": "启", "嗎": "吗", "唸": "念", "圍": "围", "圖": "图", "夠": "够",
        "夾": "夹", "專": "专", "對": "对", "層": "层", "屬": "属", "幫": "帮",
        "幾": "几", "張": "张", "彈": "弹", "後": "后", "從": "从", "愛": "爱",
        "捨": "舍", "換": "换", "擇": "择", "敗": "败", "數": "数", "斷": "断",
        "於": "于", "時": "时", "會": "会", "東": "东", "桿": "杆", "標": "标",
        "樣": "样", "機": "机", "檔": "档", "氣": "气", "決": "决", "沒": "没",
        "準": "准", "溫": "温", "漢": "汉", "潑": "泼", "為": "为", "無": "无",
        "現": "现", "產": "产", "畫": "画", "當": "当", "疊": "叠", "發": "发",
        "種": "种", "節": "节", "範": "范", "細": "细", "組": "组", "結": "结",
        "綁": "绑", "經": "经", "維": "维", "線": "线", "編": "编", "縮": "缩",
        "續": "续", "聲": "声", "聽": "听", "與": "与", "舊": "旧", "著": "着",
        "蓋": "盖", "處": "处", "號": "号", "補": "补", "裝": "装", "裡": "里",
        "見": "见", "規": "规", "訂": "订", "訊": "讯", "記": "记", "設": "设",
        "詞": "词", "話": "话", "該": "该", "語": "语", "誤": "误", "說": "说",
        "調": "调", "請": "请", "講": "讲", "讀": "读", "變": "变", "讓": "让",
        "貼": "贴", "資": "资", "軌": "轨", "輯": "辑", "輸": "输", "轉": "转",
        "這": "这", "連": "连", "進": "进", "過": "过", "遠": "远", "適": "适",
        "選": "选", "還": "还", "邊": "边", "錯": "错", "鍵": "键", "鎖": "锁",
        "長": "长", "閉": "闭", "開": "开", "間": "间", "關": "关", "隊": "队",
        "隨": "随", "險": "险", "離": "离", "電": "电", "靜": "静", "響": "响",
        "項": "项", "預": "预", "頓": "顿", "題": "题", "顫": "颤", "顯": "显",
        "風": "风", "飄": "飘", "餘": "余", "馬": "马", "驅": "驱", "鳴": "鸣",
        "麼": "么", "點": "点", "齊": "齐", "寫": "写",
        // Added with the audio lip-sync page. 乾 is only ever 乾淨 here, which
        // is 干净; the other sense (乾坤) has no place in a panel about mouths.
        "靈": "灵", "頁": "页", "錄": "录", "頭": "头", "運": "运", "訴": "诉",
        "絕": "绝", "乾": "干", "淨": "净", "樂": "乐", "環": "环", "頻": "频",
        "確": "确", "應": "应", "單": "单", "純": "纯", "狀": "状", "約": "约",
        // Added with the cloud voice. 係 is only ever 關係 here, which is 关系.
        "雲": "云", "鑰": "钥", "區": "区", "腦": "脑", "錢": "钱", "傳": "传",
        "帳": "账", "認": "认", "網": "网", "辦": "办", "執": "执", "緒": "绪",
        "報": "报", "壓": "压", "碼": "码", "務": "务", "暫": "暂", "給": "给",
        "係": "系", "價": "价", "欄": "栏", "費": "费",
        // Added with the offline model.
        "載": "载", "統": "统", "員": "员", "權": "权",
        // Added with the two-page panel: 聲音參數, 緩動.
        "參": "参", "緩": "缓"
    };

    function simplify(text) {
        var index;
        for (index = 0; index < IC_SIMPLIFIED_TERMS.length; index += 1) {
            text = text.split(IC_SIMPLIFIED_TERMS[index][0])
                .join(IC_SIMPLIFIED_TERMS[index][1]);
        }
        var out = "";
        for (index = 0; index < text.length; index += 1) {
            var character = text.charAt(index);
            var mapped = IC_SIMPLIFIED_CHARS[character];
            // typeof, because every object inherits names like "constructor".
            out += (typeof mapped === "string") ? mapped : character;
        }
        return out;
    }

    /*
     * Tooltips. Not "English / 中文" pairs like every label, because these are
     * paragraphs rather than names: the Chinese ones explain why a control
     * exists and what it costs, and squeezing three of those into one key
     * would be unreadable in the source and impossible to translate cleanly.
     * A short id, three bodies, and H() picks one.
     *
     * Until 2.0 each of these was one thin English sentence with the real
     * explanation concatenated after it in Chinese, so an English panel showed
     * a wall of Chinese and a Japanese panel showed the same wall.
     */
    var IC_HELP = {};
    function help(id, en, zh, ja) { IC_HELP[id] = { en: en, zh: zh, ja: ja }; }

    help("language",
        "Interface language. What is spoken does not change.",
        "介面語言，不影響唸出來的內容。",
        "画面の言語です。しゃべる内容は変わりません。");

    help("readLayer",
        "Load the layer's text and, if Island Chatter is already on it, every" +
        " voice setting back into this panel.",
        "把圖層的文字讀進來；若已套用過 Island Chatter，連語音設定一起讀回面板。",
        "レイヤーのテキストを読み込みます。すでに適用されていれば、" +
        "\nボイス設定もまとめてこのパネルに戻します。");

    help("pronunciation",
        "Force a reading where the character alone is ambiguous. Inline" +
        " overrides, tone-number pinyin and Zhuyin all work." +
        "\n\nExamples: [重|chong2]新, ni3 hao3, ㄋㄧˇ ㄏㄠˇ",
        "同一個字有兩種唸法時，在這裡指定。可用行內覆寫、數字調拼音或注音。" +
        "\n\n例：[重|chong2]新、ni3 hao3、ㄋㄧˇ ㄏㄠˇ",
        "同じ漢字に読みが二つあるときに指定します。" +
        "\nインライン指定・数字つきピンイン・注音のどれでも使えます。" +
        "\n\n例：[重|chong2]新、ni3 hao3、ㄋㄧˇ ㄏㄠˇ");

    help("formant",
        "Scales the vocal tract without touching the pitch. Left is a small" +
        " animal, right is a giant.",
        "縮放口腔大小，音高不變：往左變小動物，往右變巨人。",
        "音の高さは変えずに、口の中の大きさだけを変えます。" +
        "\n左へ回すと小動物、右へ回すと巨人になります。");

    help("source",
        "What the vocal folds are replaced with. This changes the sound source" +
        " itself, not just the resonance on top of it.",
        "換掉發聲源本身，不只是換共鳴。",
        "声帯そのものを何に置き換えるかです。" +
        "\n響きだけでなく、音の出どころが変わります。");

    help("tempo",
        "Derive Speed from a tempo instead of setting it by hand.",
        "用節拍速度推算語速，取代手動設定。",
        "はやさを手で決めるかわりに、テンポから計算します。");

    help("chatter",
        "Close the mouth on every syllable, the way every release up to 1.9.1" +
        " did." +
        "\n\nOff by default: the mouth now closes only where there is a real" +
        " pause — punctuation and the end of a line — and consecutive" +
        " syllables just change shape." +
        "\nOn ten syllables of dialogue the old rule opened and shut 19 times" +
        " with the mouth closed 41% of the frames; the new one closes 5 times," +
        " 27%, and all five land where a mouth should close." +
        "\n\nTick this to get the old look back. A sung line ignores it either" +
        " way: there the short closes are shorter than one frame, which is a" +
        " sampling artefact rather than a style." +
        "\n\nExisting keyframes are not rewritten until you press Rebuild" +
        " (shared rig) or Apply again (per-layer).",
        "每個字都把嘴巴閉一次，1.9.1 以前的作法。" +
        "\n\n預設是關的：嘴巴只在真的有停頓的地方閉（標點、句尾），連著的字之間只換嘴型。" +
        "\n一句十個字的台詞，舊作法會開合 19 次、嘴巴有 41% 的時間是閉的；" +
        "\n新作法是 5 次、27%，而那 5 次都落在該閉的地方。" +
        "\n\n勾起來就會回到舊的樣子。唱歌的句子不受這個勾選影響——" +
        "\n那裡的短閉嘴比一個影格還短，是取樣問題不是風格。" +
        "\n\n改了之後要按 Rebuild／重建（共用）或重新 Apply（每層）才會重寫關鍵影格。",
        "1 音ごとに口を閉じます。1.9.1 までの動きです。" +
        "\n\n既定はオフで、句読点と行末など本当に間があるところだけ閉じ、" +
        "\n続いている音のあいだは口の形だけが変わります。" +
        "\n10 音のセリフで、昔の規則は 19 回開閉してフレームの 41% が閉じた状態でした。" +
        "\n今は 5 回・27% で、その 5 回はどれも閉じるべき場所です。" +
        "\n\nチェックすると昔の見た目に戻ります。歌の行はどちらでも変わりません——" +
        "\nそこでの短い閉じは 1 フレームより短く、演出ではなくサンプリングの副産物です。" +
        "\n\n既存のキーフレームは、Rebuild（共有リグ）か再適用（レイヤーごと）まで書き換わりません。");

    help("typeOnCenter",
        "Keep the revealed text centred as it types on, gliding into place" +
        " instead of growing out of the left edge. For centre-justified text.",
        "讓已顯示的文字保持置中並平滑滑動，而不是從左邊長出來。適用於置中對齊的文字。",
        "表示済みの文字を中央にそろえたまま滑らせます。" +
        "\n左端から伸びていく代わりです。中央ぞろえのテキスト向け。");

    help("lipSync",
        "Drive a character's mouth from a recording instead of from text." +
        " Select an audio layer, pick the character on the Animation page, and" +
        " press this." +
        "\n\nThe engine reads the file, finds the syllables in it, and writes" +
        " the same rig it writes for a spoken line — so the mouth switch, the" +
        " markers and the head bounce all work exactly as they already do." +
        " Nothing about the recording is changed and no audio is generated." +
        "\n\nUse it for your own voice, for a dub, or for anything else that" +
        " arrived as a file. WAV and AIFF only: export an MP3 as one of those" +
        " first, and the panel will say so if you forget." +
        "\n\nSilence in the file closes the mouth, so pauses look after" +
        " themselves. Trim the layer and only the trimmed part is used." +
        " A time-stretched layer is refused, because nothing here can tell how" +
        " far the stretch moved each syllable." +
        "\n\nType-On is not available for a recording: there is no text to" +
        " reveal. Rebuild re-reads the file, so moving or re-trimming the layer" +
        " and pressing Rebuild is all it takes to put the mouth right again.",
        "用一段錄音來驅動角色的嘴巴，而不是用文字。選一個音訊圖層，在「動畫」頁選好角色，" +
        "然後按這裡。" +
        "\n\n引擎會讀那個檔案、找出裡面的音節，寫出跟講話的句子一模一樣的控制器——" +
        "\n所以嘴型切換、逐字標記、頭部晃動全部照常運作。錄音本身不會被改動，也不會產生新的音檔。" +
        "\n\n自己錄的聲音、配音、或任何別的地方來的檔案都可以。只收 WAV 和 AIFF：" +
        "\nMP3 請先轉存成這兩種之一，忘了的話面板會告訴你。" +
        "\n\n檔案裡的靜音會讓嘴巴閉起來，所以停頓不用另外處理。圖層剪過的話只會用剪過的那一段。" +
        "\n有時間伸縮的圖層會被拒絕，因為這裡沒有東西知道伸縮把每個音節移動了多少。" +
        "\n\n錄音沒有逐字顯示可用：沒有文字可以顯示。重建會重新讀一次檔案，" +
        "\n所以圖層移動或重新剪過之後，按一下重建就會對回去。",
        "テキストではなく録音からキャラクターの口を動かします。" +
        "\n音声レイヤーを選び、「アニメーション」ページでキャラクターを選んでから押してください。" +
        "\n\nエンジンがファイルを読んで音節を探し、しゃべる行と同じリグを書きます——" +
        "\n口の切り替えもマーカーも頭の動きも、これまでどおりに働きます。" +
        "\n録音そのものは変更されず、新しい音声も作られません。" +
        "\n\n自分の声でも、吹き替えでも、ほかから来たファイルでも構いません。" +
        "\nWAV と AIFF のみです。MP3 はどちらかに書き出してください。忘れても panel が知らせます。" +
        "\n\nファイル中の無音で口が閉じるので、間は自動で処理されます。" +
        "\nレイヤーをトリムすれば、その部分だけが使われます。" +
        "\nタイムストレッチされたレイヤーは拒否されます。ずれ幅を測る手段がここには無いからです。" +
        "\n\n録音では「1 文字ずつ表示」は使えません。表示する文字が無いためです。" +
        "\nRebuild でファイルを読み直すので、移動やトリムのあとは Rebuild を押すだけで合い直します。");

    help("sensitivity",
        "How much of a peak in loudness has to be there before it counts as a" +
        " syllable." +
        "\n\nLow takes almost every bump, which is what a clean close-mic" +
        " recording wants. High takes only the obvious ones, which is what you" +
        " need when there is music or room noise underneath." +
        "\n\nIf the mouth moves too often, raise it. If it misses syllables," +
        " lower it. There is no correct value — it depends on the recording.",
        "一個音量的高峰要多明顯，才算是一個音節。" +
        "\n\n調低幾乎每個起伏都算，適合乾淨的近距離錄音。" +
        "\n調高只算明顯的，適合底下還有音樂或環境噪音的時候。" +
        "\n\n嘴巴動得太頻繁就調高，漏掉音節就調低。沒有正確的數值，看錄音而定。",
        "どれくらいはっきりした音量の山を 1 音節と見なすかです。" +
        "\n\n低くするとほとんどの起伏を拾います。近接マイクのきれいな録音向けです。" +
        "\n高くすると目立つものだけを拾います。音楽や環境音が下にあるときはこちらです。" +
        "\n\n口が動きすぎるなら上げ、音節を取りこぼすなら下げてください。" +
        "\n正解の値はありません。録音によります。");

    help("vowels",
        "Work out which vowel is being said and use the matching mouth shape." +
        "\n\nOn a clean voice this is usually right; with music underneath it" +
        " often is not, and a wrong mouth shape is more distracting than a" +
        " plain one. Turn it off and every syllable gets the open shape" +
        " instead, which with the rig's own open-and-shut is the chatter look" +
        " this product is named for." +
        "\n\nIt is a guess either way, made from the shape of the sound rather" +
        " than from knowing the words. Measured against lines the engine spoke" +
        " itself, it agrees about two thirds of the time.",
        "判斷正在發的是哪個母音，用對應的嘴型。" +
        "\n\n乾淨的人聲通常判得對；底下有音樂的時候常常不對，" +
        "\n而錯的嘴型比單純的開合更容易讓人分心。關掉的話每個音節都用張開的嘴型，" +
        "\n配上控制器本來的開合，就是這個產品名字由來的那種碎嘴效果。" +
        "\n\n不管開關都是猜的——是從聲音的形狀判斷，不是真的知道在講什麼。" +
        "\n拿引擎自己唸出來的句子當標準答案量過，大約有三分之二會對。",
        "どの母音を発音しているかを判定し、対応する口の形を使います。" +
        "\n\nきれいな声ならたいてい当たりますが、音楽が下にあると外れがちです。" +
        "\n間違った口の形は、単純な開閉よりも気が散ります。" +
        "\nオフにすると全音節が開いた形になり、リグ自体の開閉と合わさって、" +
        "\nこの製品の名前の由来である「おしゃべり」の見た目になります。" +
        "\n\nどちらにしても推測です。言葉を知っているのではなく、音の形から判断しています。" +
        "\nエンジン自身がしゃべった行を正解として測ると、約 3 分の 2 が一致します。");

    help("cloudVoice",
        "Have an AI model speak the selected lines, then drive the mouth from" +
        " what it sent back." +
        "\n\nThe text leaves this computer: it is sent to the provider you" +
        " chose, using your own API key, and they bill you for it. Nothing is" +
        " sent until you press this and confirm the character count." +
        "\n\nIt is not a live effect and cannot be: a voice that had to be" +
        " fetched over a network could not be rendered on an audio thread. It" +
        " is one press, one file, exactly like Bake — the audio lands beside the" +
        " project and the mouth is read out of it by the same analyser that" +
        " reads any other recording." +
        "\n\nEditing the line afterwards does not fetch it again. The recording" +
        " is muted, the built-in voice comes back, and the layer is marked" +
        " (stale) until you press this again — because a keystroke should not" +
        " spend money.",
        "讓 AI 模型唸出選取的句子，再用回傳的聲音驅動嘴型。" +
        "\n\n文字會離開這台電腦：送到你選的那家供應商，用你自己的 API 金鑰，帳單也是你的。" +
        "\n按下去並確認字數之前，什麼都不會送出。" +
        "\n\n它不是即時效果，也不可能是：要等網路回來的聲音沒辦法在音訊執行緒上算。" +
        "\n它就是「按一次、產出一個音檔」，跟轉成音訊一樣——檔案放在專案旁邊，" +
        "\n嘴型由讀任何錄音的那個分析器讀出來。" +
        "\n\n之後改字不會自動重新去要。錄音會被靜音、內建的聲音回來、圖層標上 (stale)，" +
        "\n等你再按一次——因為敲一個鍵不應該花到錢。",
        "選択した行をクラウドのモデルにしゃべらせ、返ってきた音声から口を動かします。" +
        "\n\n文字はこのパソコンの外に出ます。選んだサービスに、あなた自身の APIキーで送られ、" +
        "\n料金もあなたに請求されます。ここを押して文字数を確認するまで、何も送信されません。" +
        "\n\nリアルタイム効果ではありませんし、あり得ません。" +
        "\nネットワークを待つ音声はオーディオスレッドでは計算できないからです。" +
        "\n「一度押す、ファイルが 1 つできる」——音声ファイルに書き出すのと同じです。" +
        "\n\n後から文字を直しても取り直しはしません。録音はミュートされ、内蔵の声が戻り、" +
        "\nレイヤーに (stale) が付きます。キーを 1 つ叩いただけでお金を使わないためです。");

    help("provider",
        "Which service speaks the line. The list comes from the tool itself, so" +
        " it is always the one the installed build can actually reach." +
        "\n\nOnly services that return uncompressed audio are offered, so no" +
        " audio decoder ships with this product. Each one is a separate account" +
        " with a separate key and a separate bill.",
        "由哪一家唸出這一句。清單是工具自己回報的，所以永遠是這個版本真的連得上的那幾家。" +
        "\n\n只收會回傳未壓縮音訊的供應商，這樣產品裡就不用夾一個音訊解碼器。" +
        "\n每一家都是各自的帳號、各自的金鑰、各自的帳單。",
        "どのサービスに読ませるかです。一覧はツール自身が返すので、" +
        "\nインストールされている版が実際に接続できるものだけが並びます。" +
        "\n\n非圧縮の音声を返すサービスだけを扱うので、この製品にデコーダーは入っていません。" +
        "\nそれぞれ別のアカウント・別のキー・別の請求です。");

    help("cloudKey",
        "Your own API key for the chosen service. It is typed hidden and kept" +
        " in this computer's After Effects preferences, in plain text — there is" +
        " no key store in ExtendScript, and this is said plainly rather than" +
        " implied." +
        "\n\nIt never appears on a command line, where every process on the" +
        " machine could read it: it is written to a temporary file that the" +
        " tool deletes as soon as it has read it. Forget takes it off this" +
        " machine.",
        "你自己在那家服務的 API 金鑰。輸入時不會顯示出來，存在這台電腦的 After Effects" +
        "\n偏好設定裡，是明碼——ExtendScript 沒有金鑰保管的地方，這件事直說比暗示好。" +
        "\n\n它不會出現在命令列上（那裡機器上每一支程式都讀得到）：" +
        "\n而是寫進一個暫存檔，工具讀完就把檔案刪掉。按「清除」就從這台電腦拿掉。",
        "選んだサービスの、あなた自身の APIキーです。入力は伏せ字で、" +
        "\nこのパソコンの After Effects 環境設定に平文で保存されます。" +
        "\nExtendScript にキーの保管場所がないためで、隠さずそのまま書いています。" +
        "\n\nコマンドラインには決して現れません（そこはマシン上のどのプロセスからも読めます）。" +
        "\n一時ファイルに書き、ツールが読み終えた時点で削除します。" +
        "\n「消去」でこのパソコンから取り除けます。");

    help("preview",
        "Hear the voice the panel is set to, without applying it to anything." +
        "\n\nWith a text layer selected it speaks that layer's words, in the" +
        " voice you are currently setting up rather than the one the layer" +
        " already carries. With nothing selected it speaks whatever is in the" +
        " text box." +
        "\n\nNothing is written to the project: no layer, no effect, no undo" +
        " step, no file beside the .aep. The audio goes to a temporary file" +
        " that is overwritten by the next preview." +
        "\n\nAfter Effects stops responding while it plays, because it waits" +
        " for the sound to finish. A line is a few seconds.",
        "直接聽面板上這組設定的聲音，不用先套到任何圖層上。" +
        "\n\n選著文字圖層時唸的是那一層的字，但用的是你現在正在調的聲音，不是那層已經帶著的。" +
        "\n沒選任何東西就唸文字框裡的內容。" +
        "\n\n專案完全不會被動到：不會多圖層、不會多特效、不會多一步復原，專案檔旁邊也不會多檔案。" +
        "\n聲音寫在暫存檔，下次試聽就蓋掉。" +
        "\n\n播放時 After Effects 會沒有反應，因為它在等聲音放完。一句話是幾秒鐘。",
        "パネルに設定した声を、どのレイヤーにも適用せずにそのまま聴けます。" +
        "\n\nテキストレイヤーを選んでいるときは、そのレイヤーの文字を、今設定中の声で読みます" +
        "\n（レイヤーがすでに持っている声ではありません）。何も選んでいなければ入力欄の文字を読みます。" +
        "\n\nプロジェクトには何も書き込みません。レイヤーもエフェクトも取り消し履歴も増えず、" +
        "\n.aep の隣にファイルもできません。音声は一時ファイルに書かれ、次の試聴で上書きされます。" +
        "\n\n再生中は After Effects が応答しなくなります。音が終わるまで待つためで、一文なら数秒です。");

    help("customTimbre",
        "Make the engine speak with the shape of your own voice." +
        "\n\nRecord yourself holding five vowels — ah, eh, ee, oh, oo — for a" +
        " second or two each, save them as five files, and pick them here in" +
        " that order. Any recorder will do; a phone is fine." +
        "\n\nWhat is measured is the two resonances that decide which vowel a" +
        " listener hears, and they replace the engine's own. Everything else" +
        " about the voice is still the engine: the tones, the timing, the" +
        " mouth shapes. That is why this is not sample playback — samples" +
        " cannot bend to a Mandarin tone, and this can." +
        "\n\nSo it is a resemblance, not a copy. It carries the size and shape" +
        " of your mouth, not your accent and not your delivery." +
        "\n\nSkip a vowel and the ones you did record decide how it sounds." +
        " Nothing reaches a layer until you press Apply, and Clear puts the" +
        " built-in voice back.",
        "讓引擎用你自己的嘴巴形狀講話。" +
        "\n\n錄五個拉長的母音——ㄚ、ㄝ、一、ㄛ、ㄨ——每個一兩秒，存成五個檔案，" +
        "\n然後照這個順序選進來。用什麼錄都可以，手機就行。" +
        "\n\n量的是決定「聽起來是哪個母音」的那兩個共振峰，拿它們換掉引擎自己的。" +
        "\n聲音的其他部分還是引擎：聲調、長短、嘴型，全都照舊。" +
        "\n這就是它不是取樣播放的原因——取樣沒辦法照著中文聲調彎，這個可以。" +
        "\n\n所以它是「像」，不是「複製」。它帶的是你嘴巴的大小和形狀，不是你的口音，也不是你的語氣。" +
        "\n\n少錄一個母音，那個母音就跟著你錄到的那幾個走。按 Apply 之前不會寫到任何圖層上，" +
        "\n按「清除」就換回內建的聲音。",
        "エンジンに、あなた自身の口の形で話させます。" +
        "\n\n母音を 5 つ——ア、エ、イ、オ、ウ——それぞれ 1〜2 秒伸ばして録音し、" +
        "\n5 つのファイルとして保存して、この順番で選んでください。録音機材は何でも構いません。" +
        "\n\n測るのは「どの母音に聞こえるか」を決める 2 つの共鳴で、それがエンジン内蔵の値と" +
        "\n置き換わります。声調も長さも口の形もエンジンのままです。サンプル再生ではないのは" +
        "\nそのためで、サンプルは中国語の声調に合わせて曲げられませんが、これはできます。" +
        "\n\nつまり「似せる」であって「複製」ではありません。運ばれるのは口の大きさと形で、" +
        "\nなまりや話し方ではありません。" +
        "\n\n録らなかった母音は、録った母音に合わせて決まります。「適用」を押すまでレイヤーには" +
        "\n何も書き込まれず、「消去」で内蔵の声に戻ります。");

    help("getModel",
        "Open the list of offline voice models: what there is, how big each one"
        + " is, and whether you have it. Downloading one gives you a voice source"
        + " that runs on this computer instead of on somebody else's."
        + "\n\nThere are two. Chinese and English, about 177 MB \u2014 a woman"
        + " speaking Mandarin as it is spoken in China. It is the only Chinese"
        + " model with a licence that allows it to be shipped with a product like"
        + " this one, and no offline model with a Taiwanese accent exists at any"
        + " licence; for Taiwan Mandarin use the built-in voice or Azure's zh-TW"
        + " voice. Japanese, about 171 MB, which reads kana and common kanji."
        + "\n\nNothing is fetched until you press Download and confirm, and a"
        + " model can be removed again from the same window. Afterwards that voice"
        + " needs no network, no account and no key, and nothing you type ever"
        + " leaves the machine."
        + "\n\nAfter Effects will not respond while one downloads. If it fails"
        + " part way, press it again: every file already fetched at the right"
        + " size is skipped, so only what is missing is downloaded."
        + "\n\nModels are stored under your own user folder, not in Program"
        + " Files, so they need no administrator rights and an uninstall leaves"
        + " them alone.",
        "\u6253\u958b\u96e2\u7dda\u8a9e\u97f3\u6a21\u578b\u7684\u6e05\u55ae\uff1a\u6709\u54ea\u4e9b\u3001\u5404\u591a\u5927\u3001\u4f60\u6709\u6c92\u6709\u3002\u4e0b\u8f09\u4e00\u500b\uff0c\u5c31\u6703\u591a\u4e00\u500b"
        + "\n\u5728\u4f60\u81ea\u5df1\u96fb\u8166\u4e0a\u8dd1\u7684\u8a9e\u97f3\u4f86\u6e90\u3002"
        + "\n\n\u6709\u5169\u500b\u3002\u4e2d\u6587\uff0b\u82f1\u6587\uff0c\u5927\u7d04 177 MB\uff0c\u662f\u4e2d\u570b\u53e3\u97f3\u7684\u666e\u901a\u8a71\u5973\u8072\u2014\u2014\u53ef\u5546\u7528\u6388\u6b0a\u3001"
        + "\n\u80fd\u8ddf\u8457\u9019\u7a2e\u7522\u54c1\u4e00\u8d77\u51fa\u8ca8\u7684\u4e2d\u6587\u6a21\u578b\u53ea\u6709\u9019\u4e00\u500b\uff1b\u53f0\u7063\u570b\u8a9e\u7684\u96e2\u7dda\u6a21\u578b\uff0c\u4e0d\u7ba1\u4ec0\u9ebc\u6388\u6b0a"
        + "\n\u90fd\u4e0d\u5b58\u5728\uff0c\u8981\u53f0\u7063\u570b\u8a9e\u8acb\u7528\u5167\u5efa\u7684\u8072\u97f3\u6216\u96f2\u7aef\u7684 Azure zh-TW \u97f3\u8272\u3002"
        + "\n\u65e5\u6587\uff0c\u5927\u7d04 171 MB\uff0c\u5047\u540d\u548c\u5e38\u7528\u6f22\u5b57\u90fd\u8b80\u5f97\u51fa\u4f86\u3002"
        + "\n\n\u6309\u300c\u4e0b\u8f09\u300d\u4e26\u78ba\u8a8d\u4e4b\u524d\u4ec0\u9ebc\u90fd\u4e0d\u6703\u6293\uff0c\u540c\u4e00\u500b\u8996\u7a97\u4e5f\u53ef\u4ee5\u628a\u6a21\u578b\u79fb\u9664\u3002\u88dd\u597d\u4e4b\u5f8c\u90a3\u500b\u8a9e\u97f3"
        + "\n\u4e0d\u7528\u9023\u7db2\u3001\u4e0d\u7528\u5e33\u865f\u3001\u4e0d\u7528\u91d1\u9470\uff0c\u4f60\u6253\u7684\u5b57\u5b8c\u5168\u4e0d\u6703\u96e2\u958b\u9019\u53f0\u96fb\u8166\u3002"
        + "\n\n\u4e0b\u8f09\u6642 After Effects \u6703\u6c92\u6709\u53cd\u61c9\u3002\u4e2d\u9014\u5931\u6557\u5c31\u518d\u6309\u4e00\u6b21\uff1a\u5df2\u7d93\u6293\u597d\u800c\u4e14\u5927\u5c0f\u6b63\u78ba\u7684\u6a94\u6848"
        + "\n\u6703\u8df3\u904e\uff0c\u53ea\u88dc\u7f3a\u7684\u90a3\u4e9b\u3002"
        + "\n\n\u6a21\u578b\u653e\u5728\u4f60\u81ea\u5df1\u7684\u4f7f\u7528\u8005\u8cc7\u6599\u593e\uff0c\u4e0d\u5728 Program Files\uff0c\u6240\u4ee5\u4e0d\u9700\u8981\u7cfb\u7d71\u7ba1\u7406\u54e1\u6b0a\u9650\uff0c"
        + "\n\u79fb\u9664\u7a0b\u5f0f\u4e5f\u4e0d\u6703\u52d5\u5230\u5b83\u5011\u3002",
        "\u30aa\u30d5\u30e9\u30a4\u30f3\u97f3\u58f0\u30e2\u30c7\u30eb\u306e\u4e00\u89a7\u3092\u958b\u304d\u307e\u3059\u3002\u4f55\u304c\u3042\u308a\u3001\u3069\u308c\u304f\u3089\u3044\u306e\u5927\u304d\u3055\u3067\u3001"
        + "\n\u5c0e\u5165\u6e08\u307f\u304b\u3069\u3046\u304b\u304c\u5206\u304b\u308a\u307e\u3059\u3002\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3059\u308b\u3068\u3001\u4ed6\u4eba\u306e\u30b5\u30fc\u30d0\u30fc\u3067\u306f\u306a\u304f"
        + "\n\u3053\u306e\u30d1\u30bd\u30b3\u30f3\u306e\u4e2d\u3067\u52d5\u304f\u97f3\u58f0\u30bd\u30fc\u30b9\u304c\u5897\u3048\u307e\u3059\u3002"
        + "\n\n2 \u3064\u3042\u308a\u307e\u3059\u3002\u4e2d\u56fd\u8a9e\uff0b\u82f1\u8a9e\u306f\u7d04 177 MB \u3067\u3001\u4e2d\u56fd\u306e\u6a19\u6e96\u4e2d\u56fd\u8a9e\uff08\u666e\u901a\u8a71\uff09\u3092"
        + "\n\u8a71\u3059\u5973\u6027\u3067\u3059\u3002\u3053\u306e\u7a2e\u306e\u88fd\u54c1\u306b\u540c\u68b1\u3067\u304d\u308b\u30e9\u30a4\u30bb\u30f3\u30b9\u306e\u4e2d\u56fd\u8a9e\u30e2\u30c7\u30eb\u306f\u3053\u308c\u3060\u3051\u3067\u3001"
        + "\n\u53f0\u6e7e\u306a\u307e\u308a\u306e\u30aa\u30d5\u30e9\u30a4\u30f3\u30e2\u30c7\u30eb\u306f\u30e9\u30a4\u30bb\u30f3\u30b9\u3092\u554f\u308f\u305a\u5b58\u5728\u3057\u307e\u305b\u3093\u3002\u53f0\u6e7e\u306e\u4e2d\u56fd\u8a9e\u306b\u306f"
        + "\n\u5185\u8535\u306e\u97f3\u58f0\u304b Azure zh-TW \u3092\u304a\u4f7f\u3044\u304f\u3060\u3055\u3044\u3002\u65e5\u672c\u8a9e\u306f\u7d04 171 MB \u3067\u3001"
        + "\n\u4eee\u540d\u3068\u5e38\u7528\u6f22\u5b57\u3092\u8aad\u307f\u307e\u3059\u3002"
        + "\n\n\u300c\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u300d\u3092\u62bc\u3057\u3066\u78ba\u8a8d\u3059\u308b\u307e\u3067\u4f55\u3082\u53d6\u5f97\u3057\u307e\u305b\u3093\u3002\u540c\u3058\u30a6\u30a3\u30f3\u30c9\u30a6\u304b\u3089"
        + "\n\u53d6\u308a\u9664\u304f\u3053\u3068\u3082\u3067\u304d\u307e\u3059\u3002\u5c0e\u5165\u5f8c\u306f\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u3082\u30a2\u30ab\u30a6\u30f3\u30c8\u3082\u30ad\u30fc\u3082\u4e0d\u8981\u3067\u3001"
        + "\n\u5165\u529b\u3057\u305f\u6587\u5b57\u304c\u3053\u306e\u30d1\u30bd\u30b3\u30f3\u306e\u5916\u306b\u51fa\u308b\u3053\u3068\u306f\u3042\u308a\u307e\u305b\u3093\u3002"
        + "\n\n\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u4e2d\u306f After Effects \u304c\u5fdc\u7b54\u3057\u306a\u304f\u306a\u308a\u307e\u3059\u3002\u9014\u4e2d\u3067\u5931\u6557\u3057\u305f\u3089\u3082\u3046\u4e00\u5ea6"
        + "\n\u62bc\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u6b63\u3057\u3044\u30b5\u30a4\u30ba\u3067\u53d6\u5f97\u6e08\u307f\u306e\u30d5\u30a1\u30a4\u30eb\u306f\u98db\u3070\u3057\u3001\u8db3\u308a\u306a\u3044\u5206\u3060\u3051\u53d6\u308a\u307e\u3059\u3002"
        + "\n\n\u30e2\u30c7\u30eb\u306f\u3054\u81ea\u8eab\u306e\u30e6\u30fc\u30b6\u30fc\u30d5\u30a9\u30eb\u30c0\u30fc\u306b\u4fdd\u5b58\u3055\u308c\u307e\u3059\u3002Program Files \u3067\u306f\u306a\u3044\u306e\u3067"
        + "\n\u7ba1\u7406\u8005\u6a29\u9650\u306f\u4e0d\u8981\u3067\u3001\u30a2\u30f3\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u3082\u6b8b\u308a\u307e\u3059\u3002");

    help("cloudVoiceId",
        "The provider's own name or id for the voice you want. Leave it as it" +
        " is to use the default this provider ships." +
        "\n\nIt is remembered per provider, so switching to another service and" +
        " back does not lose the one you set." +
        "\n\nThis has nothing to do with the Timbre page: those controls shape" +
        " the built-in engine's voice, and a cloud model is not it.",
        "那家供應商自己給這個聲音的名字或代號。不改就用它預設的那個。" +
        "\n\n會分供應商記住，所以換過去再換回來，你設過的不會不見。" +
        "\n\n這跟「音色」那一頁沒有關係：那些控制項調的是內建引擎的聲音，雲端模型不是它。",
        "使いたい声について、そのサービス自身が付けている名前や ID です。" +
        "\nそのままにしておけば、そのサービスの既定の声を使います。" +
        "\n\nサービスごとに記憶されるので、別のサービスに切り替えて戻しても設定は残ります。" +
        "\n\n「音色」ページとは無関係です。あちらは内蔵エンジンの声を作る操作で、" +
        "\nクラウドのモデルはそれではありません。");

    help("cloudModel",
        "Which of the provider's models does the speaking. The default is" +
        " whatever the tool reports for this provider, which is a model that" +
        " works rather than the cheapest or the newest." +
        "\n\nChanging it changes the price and the sound, and it is part of what" +
        " decides whether a line is fetched again or reused.",
        "由那家的哪一個模型來唸。預設是工具回報的那一個——那是「能用」的模型，" +
        "\n不是最便宜或最新的。" +
        "\n\n改了它，價錢和聲音都會變，而且它也算在「這句要不要重新去要」裡面。",
        "そのサービスのどのモデルにしゃべらせるかです。既定はツールが返すもので、" +
        "\n最安でも最新でもなく「動く」モデルです。" +
        "\n\n変更すると料金も音も変わります。行を取り直すか使い回すかの判断にも含まれます。");

    help("cloudRegion",
        "Only Azure needs this: its endpoint is per region, so the region your" +
        " Speech resource was created in is part of the address." +
        "\n\nIt is the short form from the portal, such as eastasia or westus2." +
        " The field is disabled for providers that have one address for" +
        " everybody.",
        "只有 Azure 需要：它的端點是分區域的，所以你的語音資源開在哪一區，也是位址的一部分。" +
        "\n\n填入口網站上那個短名字，例如 eastasia 或 westus2。" +
        "\n對所有人共用同一個位址的供應商，這一欄會是關掉的。",
        "これが要るのは Azure だけです。エンドポイントがリージョンごとに分かれているため、" +
        "\n音声リソースを作ったリージョンがアドレスの一部になります。" +
        "\n\nポータルに出ている短い名前（eastasia、westus2 など）を入れてください。" +
        "\n全員が同じアドレスを使うサービスでは、この欄は無効になります。");

    help("rigPerLayer",
        "Five sliders on each line, the way it has always worked.",
        "每一句自己長五根滑桿，跟以前一樣。",
        "行ごとに 5 本のスライダーが付きます。これまでどおりの動きです。");

    help("rigShared",
        "One set of sliders on a null, driven by whichever line is speaking." +
        " This is what lets a whole scene drive one character: the mouth binds" +
        " to that one set, whatever layer the line happens to be on.",
        "一整組滑桿放在一個空物件上，由「當下正在講話的那一句」驅動。" +
        "\n一個角色的嘴巴就綁這一組，不管那句是第幾層。",
        "スライダー 1 組をヌルに置き、いま話している行がそれを動かします。" +
        "\nキャラの口はこの 1 組につなぐだけで、行がどのレイヤーにあっても構いません。");

    help("rebuild",
        "Re-merge the shared rig from its lines. Needed after moving a line in" +
        " time, because the rig holds keyframes rather than a live link — so it" +
        " cannot find out on its own.",
        "重新合併共用控制器。把台詞在時間上搬動之後按一下 —— " +
        "\n控制器上是關鍵影格，不是即時連動，所以它不會自己知道。",
        "共有リグを行から作り直します。行を時間軸で動かしたあとに押してください——" +
        "\nリグはキーフレームで、リアルタイムの連動ではないので、自分では気づきません。");

    help("mouth",
        "Wire selected layers to the chosen character's IC Mouth." +
        "\n\nIC Mouth: 0 closed, 1=a, 2=i, 3=u, 4=e, 5=o." +
        "\nOne mouth precomp -> Time Remap, frame 0 closed, then a i u e o." +
        "\nSeveral layers -> Opacity switching, top to bottom: closed, a, i, u, e, o." +
        "\n\n(IC Head Bounce is ±55, IC Blink is 0/100, IC Speaking is 100 while" +
        " talking, IC Line is which line is running, IC Accent hits 100 on each" +
        " syllable and settles to 50.)",
        "把選取的圖層接到所選角色的 IC Mouth 上。" +
        "\n\nIC Mouth：0 閉嘴，1=a，2=i，3=u，4=e，5=o。" +
        "\n選一個嘴型合成 → 用時間重映射，第 0 格閉嘴，之後依序 a i u e o。" +
        "\n選多個圖層 → 用不透明度切換，由上而下依序是閉嘴、a、i、u、e、o。" +
        "\n\n（IC Head Bounce 是 ±55，IC Blink 是 0／100，" +
        "\nIC Speaking 講話中為 100，IC Line 是現在第幾句，" +
        "\nIC Accent 每個字彈到 100 再落到 50。）",
        "選んだレイヤーを、選んだキャラの IC Mouth につなぎます。" +
        "\n\nIC Mouth：0 が閉じ、1=a、2=i、3=u、4=e、5=o。" +
        "\n口パクコンポを 1 つ選ぶ → タイムリマップ。0 フレーム目が閉じ、以降 a i u e o。" +
        "\n複数レイヤーを選ぶ → 不透明度の切り替え。上から順に閉じ・a・i・u・e・o。" +
        "\n\n（IC Head Bounce は ±55、IC Blink は 0／100、" +
        "\nIC Speaking は発話中 100、IC Line は今何行目か、" +
        "\nIC Accent は 1 音ごとに 100 まで跳ねて 50 に落ちます。）");

    help("leave",
        "How the reveal and the recentring leave each position. Low leaves at" +
        " full speed and settles slowly; high draws the whole move out." +
        "\nThese are ordinary keyframes, so the graph editor still owns them" +
        " afterwards.",
        "逐字顯示與置中滑動離開每個位置的方式。低值＝全速離開、慢慢停入；高值＝整段拉長。" +
        "\n產生的是一般關鍵影格，之後仍可在圖表編輯器裡自由調整。",
        "一文字ずつ表示と中央そろえが、各位置から離れるときの動き方です。" +
        "\n低い＝全速で離れてゆっくり止まる、高い＝全体をゆっくり伸ばす。" +
        "\n作られるのは普通のキーフレームなので、あとからグラフエディターで直せます。");

    help("smoothness",
        "How softly each character crosses the reveal edge. 0 makes characters" +
        " pop, higher values fade them in.",
        "每個字跨過顯示邊界的柔和程度。0 是直接彈出，越高越像淡入。",
        "文字が表示の境目をまたぐときの柔らかさです。" +
        "\n0 でぱっと出て、大きくするほどフェードインになります。");

    help("import",
        "Turn the text box above into one layer per line, laid end to end from" +
        " the current time." +
        "\n\nEvery line gets the panel's current voice, and its length follows" +
        " the speech whether or not Fit Duration is ticked." +
        "\nA line too long for the transport is split in two at a punctuation" +
        " mark rather than cut off." +
        "\nThe composition is grown to fit if it needs to be.",
        "把上面的文字框一行變一層，從目前時間點依序排好。" +
        "\n\n每一句都會套用目前的語音設定，長度自動配合語音（不管有沒有勾配合長度）。" +
        "\n太長的句子會自動斷成兩層，斷在標點上，不會被截掉。" +
        "\n合成不夠長時會自動延長到剛好放得下。",
        "上のテキスト欄を 1 行 1 レイヤーにして、現在時間から順に並べます。" +
        "\n\n各行にはいまのボイス設定が入り、長さは「長さを合わせる」の有無に関わらず音声に従います。" +
        "\n長すぎる行は句読点で 2 レイヤーに分け、切り捨てません。" +
        "\nコンポが足りなければ、収まるところまで自動で伸ばします。");

    help("gap",
        "Beats between one line and the next, against the BPM above. Decimals" +
        " are fine." +
        "\n\n1 = a quarter note, 0.5 = an eighth, 0.25 = a sixteenth, 2 = a half." +
        "\nThe grid gets as fine as the number asks for: 0.5 lands lines on" +
        " eighth notes." +
        "\n\nThe next line falls on the first grid step at least this far after" +
        " the last one ended, so this is a minimum rather than a fixed" +
        " distance — without tempo lock a line is not a whole number of beats" +
        " long, and a fixed distance walks off the grid by the third line." +
        "\n0 means no gap and no grid at all: one line straight after another.",
        "每一句之間空幾拍，用上面那個 BPM 換算。可以填小數。" +
        "\n\n1 = 四分音符，0.5 = 八分音符，0.25 = 十六分音符，2 = 二分音符。" +
        "\n格線會跟著這個數字變細：填 0.5 就對齊到八分音符上。" +
        "\n\n下一句會落在「上一句結束後至少這麼多」的那個格線上，所以這是最小值、" +
        "\n不是固定距離 —— 沒開節拍鎖定時每句長度不是整數拍，" +
        "\n固定距離會讓第三句開始就飄出格線。" +
        "\n填 0 就是完全不留白也不對齊，一句接著一句。",
        "行と行のあいだを何拍あけるかを、上の BPM で換算します。小数も使えます。" +
        "\n\n1 = 4 分音符、0.5 = 8 分音符、0.25 = 16 分音符、2 = 2 分音符。" +
        "\nグリッドはこの数字の細かさになります。0.5 なら 8 分音符にそろいます。" +
        "\n\n次の行は「前の行が終わってから、少なくともこれだけ後」の最初のグリッドに乗ります。" +
        "\nつまり固定の距離ではなく最小値です——テンポロックなしでは行の長さが整数拍にならず、" +
        "\n固定距離だと 3 行目からグリッドを外れていきます。" +
        "\n0 なら間隔もグリッドもなしで、そのまま次の行が続きます。");

    help("hold",
        "Keep each line on screen until the next one starts, instead of ending" +
        " where its audio does." +
        "\n\nFit Duration cuts a layer to the length of the speech, so the" +
        " sound is right and the subtitle is not: a beat of silence between two" +
        " lines is a beat of blank screen." +
        "\nThis only ever lengthens a line — a gap of 0, or two lines that" +
        " already overlap, are untouched, and the last line keeps its own" +
        " length." +
        "\n\nThe audio does not change: after the speech ends that stretch is" +
        " silent. Re-flow honours this setting too.",
        "每一句的字留到下一句開始才消失，而不是講完就不見。" +
        "\n\n配合長度是照語音的長短切的，聲音對、字幕不對：兩句之間空一拍，畫面就空一拍。" +
        "\n勾了之後只會延長、不會縮短——間隔填 0 或兩句本來就重疊的話不受影響，" +
        "\n最後一句也維持自己的長度。" +
        "\n\n聲音完全不變：語音結束之後那段是靜音。" +
        "\n「重新排列」也會照這個設定重新接好。",
        "各行を、音が終わったところではなく次の行が始まるまで画面に残します。" +
        "\n\n「長さを合わせる」は音声の長さで切るので、音は合っていても字幕は合いません。" +
        "\n行間が 1 拍あけば、画面も 1 拍空きます。" +
        "\nこれは伸ばすだけです——間隔 0 や、もともと重なっている 2 行はそのままで、" +
        "\n最後の行は自分の長さを保ちます。" +
        "\n\n音は変わりません。発話のあとは無音です。「並べ直す」もこの設定に従います。");

    help("speakers",
        "Read \"Mimi: hello\" as a line spoken by Mimi: the name is stripped" +
        " and the line joins that character's rig. Full-width and half-width" +
        " colons both count." +
        "\n\nOff by default, on purpose: \"Warning: it is dangerous here\" looks" +
        " exactly like a speaker name, and guessing would invent a character" +
        " called Warning and eat the word out of the line.",
        "把「咪咪：你好」讀成咪咪講的話 —— 名字不會被唸出來，該句自動加入那個角色。" +
        "\n全形和半形冒號都可以。" +
        "\n\n預設關閉是故意的：「注意：這裡很危險」跟角色名長得一模一樣，" +
        "\n自動判斷會生出一個叫「注意」的角色，還把那兩個字從台詞裡吃掉。",
        "「ミミ：こんにちは」をミミのセリフとして読みます。" +
        "\n名前は読み上げず、その行はそのキャラのリグに入ります。全角・半角どちらのコロンでも。" +
        "\n\n既定でオフなのはわざとです。「注意：ここは危険です」は話者名と見分けがつかず、" +
        "\n自動で判定すると「注意」というキャラができて、その 2 文字がセリフから消えます。");

    help("chooseMidi",
        "Pick a MIDI file and list the tracks in it. Nothing is created until" +
        " Sing." +
        "\n\nTwo steps, because a MIDI file usually has several tracks and" +
        " guessing wrong means singing the accompaniment.",
        "選一個 MIDI 檔，把裡面的軌道列出來。按了不會馬上建圖層。" +
        "\n\n選好軌道之後再按「唱出來」。分成兩步是因為一個 MIDI 檔常常有好幾軌，" +
        "\n猜錯會唱到伴奏。",
        "MIDI ファイルを選び、中のトラックを一覧にします。押しただけでは何も作りません。" +
        "\n\n2 段階なのは、MIDI ファイルには普通いくつもトラックがあり、" +
        "\n間違えると伴奏を歌ってしまうからです。");

    help("track",
        "Which track carries the tune. The one with the most notes is picked" +
        " for you.",
        "哪一軌是旋律。預設選音符最多的那一軌。",
        "どのトラックがメロディかです。音符がいちばん多いものを既定で選びます。");

    help("transpose",
        "Semitones added to every note, for a tune written outside the" +
        " character's comfortable range. -12 is an octave down, 12 an octave up." +
        "\n\nA voice never transposes itself: a note is sung at the pitch the" +
        " MIDI wrote, so two characters singing together stay in the same key." +
        " What makes a character sound like itself is resonance and timbre, not" +
        " register.",
        "每個音都往上或往下移幾個半音。-12 是低八度，12 是高八度。" +
        "\n\n聲線不會自己移調：MIDI 寫哪個音就唱哪個音，" +
        "\n所以兩個角色合唱不會走音。角色的差別在共鳴和音色，不在音高。",
        "すべての音を何半音ずらすかです。-12 で 1 オクターブ下、12 で 1 オクターブ上。" +
        "\n\nボイス自体は移調しません。MIDI に書かれた高さでそのまま歌うので、" +
        "\n2 キャラで歌っても調がずれません。キャラの違いは響きと音色で、音域ではありません。");

    help("key",
        "Which pitch is do, when the melody sings its own note names." +
        "\n\nLeave it on C for fixed do. Pick G for movable do and the whole" +
        " set of names moves with it." +
        "\nIt changes only the names, never the pitch — that always follows the" +
        " MIDI. A black key takes the name of the white key below it.",
        "文字框空白時會唱唱名，這裡決定哪個音是 Do。" +
        "\n\n留在 C 就是固定調（C 是 Do）。選 G 就是首調（G 是 Do），整組唱名跟著移。" +
        "\n只影響唱出來的名字，不影響音高——音高永遠照 MIDI 寫的。" +
        "\n黑鍵沿用下面那個白鍵的名字（升 Do 唱成 Do）。",
        "歌詞が空のときに階名で歌います。どの音をドにするかをここで決めます。" +
        "\n\nC のままなら固定ド。G を選べば移動ドになり、階名がまとめてずれます。" +
        "\n変わるのは名前だけで、音の高さは変わりません——高さは常に MIDI どおりです。" +
        "\n黒鍵はすぐ下の白鍵の名前を使います。");

    help("toneBlend",
        "How much of the Mandarin tone contour survives, as a percentage." +
        "\n\nWhen singing, the melody owns the pitch, and a full tone contour" +
        " fights it. What is left here becomes the approach to each note — a" +
        " fourth tone slides down into it, a second tone up — so the" +
        " articulation still sounds like Mandarin while the tuning belongs to" +
        " the tune. 0 = none, 100 = all of it.",
        "中文四聲保留多少（百分比）。" +
        "\n\n唱歌時音高由旋律決定，完整的四聲會跟旋律打架。" +
        "\n這裡留下的部分變成每個音的起音方向 —— 四聲從上面滑下來，二聲從下面滑上來，" +
        "\n聽起來還是中文咬字，但音準是旋律的。0 = 完全不要，100 = 全部保留。",
        "中国語の四声をどれだけ残すか（％）です。" +
        "\n\n歌では高さをメロディが決めるので、四声をそのまま出すとぶつかります。" +
        "\nここで残した分は各音への入り方になります——四声は上から、二声は下から滑り込みます。" +
        "\n発音は中国語のままで、音程はメロディのものになります。0 = なし、100 = そのまま。");

    help("sing",
        "Sing the lyrics in the text box to the chosen track." +
        "\n\nOne layer per lyric line, each placed at the time of its own first" +
        " note — a MIDI import ignores the gap grid, because a song belongs on" +
        " its own timing. Length always follows the melody." +
        "\nOne syllable per note, in order; a - in the lyric holds the previous" +
        " syllable across the next note. A chord keeps only its top note." +
        "\nWhatever does not line up is reported below rather than silently" +
        " absorbed.",
        "把上面文字框裡的歌詞，照選定那一軌的旋律唱出來。" +
        "\n\n一行歌詞一層，每一層放在該句第一個音符的時間上 —— 匯入 MIDI 不看間隔格線，" +
        "\n歌要對在它自己的時間上。長度一律配合旋律。" +
        "\n一個字配一個音，依序發下去；歌詞裡打一個 - 代表前一個字延續唱到下一個音。" +
        "\n和弦只取最高音。音符和字數對不上時會在下面說，不會默默處理。",
        "上のテキスト欄の歌詞を、選んだトラックのメロディで歌わせます。" +
        "\n\n歌詞 1 行につき 1 レイヤー。各レイヤーはその行の最初の音符の時間に置かれます——" +
        "\nMIDI の読み込みは間隔グリッドを見ません。歌はそれ自身の時間に合わせるものだからです。" +
        "\n長さは必ずメロディに従います。" +
        "\n1 文字に 1 音を順に割り当てます。歌詞の - は、前の文字を次の音までのばす印です。" +
        "\n和音はいちばん上の音だけを使います。合わなかったところは黙って処理せず、下に表示します。");

    help("speak",
        "Take the melody off the selected lines so they speak again." +
        "\n\nThe voice settings are untouched, and the length goes back to what" +
        " the speech needs." +
        "\nApply deliberately leaves a melody alone, so a whole song is never" +
        " lost by accident — which is why clearing one needs its own button.",
        "把選取圖層上的旋律拿掉，變回一般講話。" +
        "\n\n聲音設定完全不動，長度會重新配合講話的長短。" +
        "\nApply 是故意不會清掉旋律的（免得誤刪一整首歌），所以要清就按這個。",
        "選んだ行からメロディを外して、しゃべりに戻します。" +
        "\n\nボイス設定はそのままで、長さはしゃべりに合わせ直します。" +
        "\n適用はメロディをわざと残します（曲をまるごと失わないため）。" +
        "\nだから消すには専用のこのボタンが要ります。");

    help("resync",
        "Update the selected lines from their own Source Text, keeping each" +
        " one's voice exactly as it is." +
        "\n\nThe difference from Apply: this never touches the sound. Whatever" +
        " the panel is showing makes no difference — every layer keeps the" +
        " settings it already stored." +
        "\nUse it after editing text; select as many layers and as many" +
        " characters as you like and nothing gets repainted." +
        "\n\nIt only refreshes what a layer already had: a line with no markers" +
        " does not gain any. The length is always recomputed.",
        "用每一層自己的 Source Text 重新同步文字、長度、標記與動畫控制。" +
        "\n\n和 Apply 的差別：**完全不碰聲音**。面板現在顯示什麼都不影響，" +
        "\n每層維持它自己已經存著的聲音設定。" +
        "\n改字的時候用這個，選再多層、跨再多角色都不會被蓋掉。" +
        "\n\n只會更新這層本來就有的東西：沒有標記的不會被加上標記。長度一律重算。",
        "選んだ行を、その行自身のソーステキストから作り直します。ボイスはそのままです。" +
        "\n\n適用との違い：音にはいっさい触れません。パネルの表示が何であっても関係なく、" +
        "\n各レイヤーは自分が保存している設定を保ちます。" +
        "\nテキストを直したあとはこちらを。何レイヤー選んでも、キャラをまたいでも上書きされません。" +
        "\n\n更新されるのはもともとあったものだけです。マーカーのない行にマーカーは付きません。" +
        "\n長さは必ず計算し直します。");

    help("reflow",
        "Lay the selected lines out again end to end, using the gap above and" +
        " each line's real length. With nothing selected it lays out every line" +
        " in the composition." +
        "\n\nUse it after editing or deleting a line — everything after it" +
        " makes room or closes up." +
        "\nThe first line stays where it is (pulled only to the nearest beat)" +
        " and the rest follow it. Baked audio moves with its line.",
        "把選取的台詞依現在的長度重新接起來排好，間隔用上面設定的拍數。" +
        "\n沒有選取任何圖層時，會排整個合成裡的所有台詞。" +
        "\n\n改了字、刪了一句之後用這個 —— 後面所有句子會自己讓位或補上。" +
        "\n第一句留在原地（只會被拉到最近的拍點上），其餘跟著它排。" +
        "\n轉成音訊過的聲音會跟著它的台詞一起移動。",
        "選んだ行を、上の間隔と各行の実際の長さで並べ直します。" +
        "\n何も選んでいなければ、コンポ内のすべてのセリフを並べます。" +
        "\n\nテキストを直したり 1 行消したあとに——以降の行が自分で詰めたり空けたりします。" +
        "\n最初の行はその場に残り（いちばん近い拍に寄るだけ）、残りがそれに続きます。" +
        "\n書き出した音声も、そのセリフと一緒に動きます。");

    help("bake",
        "Write the voice to {0} beside the project file and bring it back as an" +
        " audio layer. No render queue, no dialogs.",
        "把語音寫進專案檔旁邊的「{0}」資料夾並放回專案，不需要算圖佇列。",
        "音声をプロジェクトファイルの隣の「{0}」に書き出し、" +
        "\nオーディオレイヤーとして戻します。レンダーキューもダイアログも不要です。");

    help("remove",
        "Take Island Chatter off the selected layers: the effect, the Tone" +
        " bootstrap, the rig sliders, the IC: markers and the Type-On animator.",
        "把 Island Chatter 從選取圖層完全移除：效果、Tone、控制器滑桿、IC: 標記與逐字顯示動畫。",
        "選んだレイヤーから Island Chatter を取り除きます。" +
        "\n効果、トーン、リグのスライダー、IC: マーカー、一文字ずつ表示のアニメーターすべてです。");

    function T(literal) {
        var text = String(literal);
        if (UI_LANGUAGE === "ja") {
            var translated = IC_JAPANESE_UI[text];
            // typeof, because every object inherits names like "constructor".
            if (typeof translated === "string") { return translated; }
        }
        var split = text.indexOf(" / ");
        // Nothing to split: a bare name like "IC Mouth" is the same in every
        // language, and simplify() leaves anything without Han characters alone.
        if (split < 0) { return UI_LANGUAGE === "cn" ? simplify(text) : text; }
        if (UI_LANGUAGE === "zh") { return text.substring(split + 3); }
        // "cn" is 简体中文, made from the same Chinese half rather than kept as
        // a fourth set of strings. "zh" means Traditional throughout this file.
        if (UI_LANGUAGE === "cn") { return simplify(text.substring(split + 3)); }
        // Japanese falls back to the English half rather than the Chinese one:
        // a reader who chose 日本語 is more likely to get something from
        // "Formant" than from "共鳴".
        return text.substring(0, split);
    }

    /*
     * A message with numbers or names in it. Same "English / 中文" key as any
     * label, so one table answers for the whole interface, with {0}..{2}
     * standing in for the parts that are the same in every language.
     *
     * The placeholders are why this exists rather than concatenation. Written
     * as "已唱出 " + n + " 句", the count sits between two Chinese fragments
     * and there is nowhere for a translation to go; every one of these messages
     * was built that way until 2.0, and every one of them showed Chinese in an
     * English panel.
     */
    function fill(text, values) {
        var index;
        for (index = 0; index < values.length; index += 1) {
            if (values[index] === undefined) { continue; }
            // Split/join rather than replace(), which with a string pattern
            // changes only the first match. Nothing shipped needs the second
            // one yet — T() has already discarded the other language's half by
            // the time this runs — but a translation is free to name the same
            // thing twice, and losing it silently is the kind of bug that only
            // shows up in the language nobody on the project reads.
            text = text.split("{" + index + "}").join(String(values[index]));
        }
        return text;
    }

    function M(literal, first, second, third) {
        return fill(T(literal), [first, second, third]);
    }

    // A tooltip body in the current language. Falls back the way T() does: a
    // reader who chose 日本語 gets more out of English than out of Chinese.
    function H(id, first) {
        var entry = IC_HELP[id];
        if (!entry || typeof entry.en !== "string") { return ""; }
        var body = entry.en;
        if (UI_LANGUAGE === "zh" && entry.zh) { body = entry.zh; }
        if (UI_LANGUAGE === "cn" && entry.zh) { body = simplify(entry.zh); }
        if (UI_LANGUAGE === "ja" && entry.ja) { body = entry.ja; }
        return fill(body, [first]);
    }

    // Every control that carries a translatable label, with the literal it was
    // built from, so switching language can put it back through T().
    var localisedControls = [];
    // The same for tooltips, which localiseTree() cannot walk: helpTip is a
    // plain string with no marker in it saying which of three bodies it is.
    var localisedTips = [];
    // Groups and dropdowns whose size depends on text they do not own.
    var remeasured = [];

    /*
     * ScriptUI measures a control once and then keeps that size. Writing a
     * longer string into `.text` afterwards draws it into the old box, and
     * After Effects renders the overflow as an ellipsis — which is how the
     * Japanese panel came back reading "中央ぞ…" and "台本を読み…" with empty
     * space beside it. Nothing was too narrow; every label was still wearing
     * the Chinese label's measurements.
     *
     * -1 asks for a fresh measurement. The height is carried over rather than
     * also reset, because Apply is deliberately 34 px tall and nothing here
     * changes how tall a line of text is.
     */
    function remeasure(control) {
        if (control.icFixedWidth) { return; }
        /*
         * A tab is as tall as its page and a tabbed panel as tall as its
         * tallest, plus the strip of titles. Neither is a deliberate number the
         * way Apply's 34 px is, so both axes are asked for again — carrying the
         * old height over would pin every page to whatever the language it was
         * first built in happened to need.
         */
        if (control.type === "tab" || control.type === "tabbedpanel") {
            control.preferredSize = [-1, -1];
            return;
        }
        var height = -1;
        try { height = control.preferredSize[1]; } catch (ignored) { height = -1; }
        control.preferredSize = [-1, height];
    }

    function tip(control, id, value) {
        localisedTips.push({ control: control, id: id, value: value });
        control.helpTip = H(id, value);
        // A slider built by addSlider() carries its own number field, and a
        // tooltip that stops existing halfway across a control reads as a bug.
        if (control.valueField) {
            localisedTips.push({ control: control.valueField, id: id, value: value });
            control.valueField.helpTip = H(id, value);
        }
        return control;
    }

    /*
     * The same tooltip, on a control that will not outlive the language.
     *
     * `tip()` registers a control so a language switch can rewrite its
     * helpTip. A dialog built on demand must not be registered: it is created
     * after the language is known and destroyed before it can change, and the
     * switch would then be walking a list of dead ScriptUI objects. Same
     * reason a dialog's labels go through `M()` rather than `localiseTree()`.
     */
    function tipOnce(control, id) {
        control.helpTip = H(id);
        return control;
    }

    /*
     * Why this file breaks its own paragraphs, in two failures.
     *
     * A `statictext` with `multiline: true` is given a height and keeps it. It
     * does not grow to fit, and the window around it is sized from what its
     * children *claim* to need — so a paragraph that wraps to more lines than
     * its number allows is not scrolled or squashed, it is **cut off, and the
     * window is cut off with it**. The offline-models window lost its footer
     * and its Close button that way, on `[420, 32]`.
     *
     * The first fix computed the height instead of hardcoding it, which is the
     * obvious answer and was **still cut off** — the window came back with the
     * same missing button on a height that was measured rather than guessed.
     * Whatever ScriptUI does with a multiline control, it is not "use the
     * number it was given", and no arithmetic outside the control can fix
     * something the control ignores.
     *
     * So there is no multiline control here. `wrapLines()` breaks the text and
     * `addWrapped()` adds one ordinary single-line statictext per line, which
     * ScriptUI has always sized correctly. Nothing claims a height, so nothing
     * can claim the wrong one.
     *
     * That leaves one number to get right — where the line breaks — and it is
     * wrong in the safe direction on purpose: a break too early is a shorter
     * line, a break too late is a clipped one.
     */
    /*
     * Roughly one Latin character at the panel's font, rounded *up*. A Han
     * character or a kana counts as two of them, which is what makes one
     * number work for all four interface languages.
     *
     * Bigger is safer and that is the whole reason for the value. A larger
     * width per character means fewer characters fit on a line, which means
     * more lines, which means a taller box — and the two errors are not
     * symmetrical: a line too many is 16 px of window nobody looks at, a line
     * too few eats whatever was underneath. Measured, Han renders near 12 px
     * and Latin near 7, so counting Han as 16 and Latin as 8 leaves slack in
     * both directions.
     */
    var WRAP_UNIT_WIDTH = 8;

    function unitsIn(text) {
        var said = String(text);
        var units = 0;
        var index;
        for (index = 0; index < said.length; index += 1) {
            // U+2E80 is where the CJK radicals start; everything this panel
            // shows above it is full-width.
            units += said.charCodeAt(index) >= 0x2E80 ? 2 : 1;
        }
        return units;
    }

    /*
     * The paragraph, broken into lines here rather than by ScriptUI.
     *
     * Computing a height and handing it to a `multiline` statictext was the
     * *second* attempt and it was still cut off — a measured 32 px for a
     * two-line sentence, and the window still lost its Close button. Whatever
     * ScriptUI does with a multiline control's height, it is not "use the
     * number it was given", and no amount of arithmetic outside it fixes that.
     *
     * So there is no multiline control any more. A column of ordinary
     * single-line statictexts is something ScriptUI sizes correctly and always
     * has, and the only question left — where do the lines break — is one this
     * file can answer exactly rather than estimate.
     *
     * Latin breaks at the last space so words stay whole; Han and kana break
     * anywhere, which is what they do.
     */
    function wrapLines(text, width) {
        var perLine = Math.max(8, Math.floor(width / WRAP_UNIT_WIDTH));
        var lines = [];
        var paragraphs = String(text).split("\n");
        var at;
        for (at = 0; at < paragraphs.length; at += 1) {
            var said = paragraphs[at];
            var current = "";
            var units = 0;
            var index;
            for (index = 0; index < said.length; index += 1) {
                var letter = said.charAt(index);
                var wide = said.charCodeAt(index) >= 0x2E80;
                var cost = wide ? 2 : 1;
                if (units + cost > perLine && current.length) {
                    // A wide character may follow a Latin word without a space
                    // between them, so the break point is looked for either way
                    // and simply not found when there is none.
                    var space = current.lastIndexOf(" ");
                    if (!wide && space > 0) {
                        lines.push(current.substring(0, space));
                        current = current.substring(space + 1) + letter;
                        units = unitsIn(current);
                    } else {
                        lines.push(current);
                        current = letter;
                        units = cost;
                    }
                } else {
                    current += letter;
                    units += cost;
                }
            }
            lines.push(current);
        }
        return lines;
    }

    /*
     * The only way a paragraph should be added.
     *
     * One statictext per line, in a column, each of them the ordinary
     * single-line kind. Nothing here claims a height, so nothing here can claim
     * the wrong one.
     */
    function addWrapped(parent, text, width) {
        var column = parent.add("group");
        column.orientation = "column";
        column.alignChildren = ["left", "top"];
        column.spacing = 2;
        column.margins = 0;
        var lines = wrapLines(text, width);
        var index;
        for (index = 0; index < lines.length; index += 1) {
            var line = column.add("statictext", undefined, lines[index]);
            line.preferredSize.width = width;
        }
        return column;
    }

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
            var localisedAny = false;
            for (index = 0; index < node.items.length; index += 1) {
                if (looksBilingual(node.items[index].text)) {
                    localisedControls.push({
                        control: node.items[index], literal: String(node.items[index].text) });
                    node.items[index].text = T(node.items[index].text);
                    localisedAny = true;
                }
            }
            // A dropdown is as wide as its longest item, so a list whose items
            // changed has to be measured again even though its own text did not.
            if (localisedAny) { remeasured.push(node); }
        }
        if (node.children) {
            // Groups have no deliberate width in this panel; every one of them
            // is as wide as whatever it holds, so all of them go stale together.
            remeasured.push(node);
            for (index = 0; index < node.children.length; index += 1) {
                localiseTree(node.children[index]);
            }
        }
    }

    // Separate from relabelUI() because tip() runs while the panel is being
    // built, before the stored language has been read back — so the tooltips
    // it wrote are in whatever UI_LANGUAGE started as, and buildUI has to put
    // them right in the same pass that localises the labels.
    function relabelTips() {
        var index;
        for (index = 0; index < localisedTips.length; index += 1) {
            localisedTips[index].control.helpTip =
                H(localisedTips[index].id, localisedTips[index].value);
        }
    }

    function relabelUI() {
        var index;
        for (index = 0; index < localisedControls.length; index += 1) {
            var control = localisedControls[index].control;
            control.text = T(localisedControls[index].literal);
            // A dropdown's items are ListItems rather than controls and have no
            // size of their own; their list is in `remeasured` instead.
            if (control.preferredSize) { remeasure(control); }
        }
        for (index = 0; index < remeasured.length; index += 1) {
            remeasure(remeasured[index]);
        }
        relabelTips();
    }

    function buildUI(host) {
        var panel = host instanceof Panel ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.margins = 12;
        panel.spacing = 8;
        /*
         * Interface language only; it has no effect on what is spoken.
         *
         * Left-aligned, and it stays that way. Aligned right, its position is
         * measured from the widest row in the panel, so it moved every time the
         * language did — and in a dock narrower than that row it left the panel
         * entirely. The control that changes the language is the one control
         * that must never become unreachable, or the way back is a preferences
         * file.
         */
        var languageRow = panel.add("group");
        languageRow.orientation = "row";
        languageRow.alignment = ["left", "top"];
        /*
         * Stored by code, never by index, so hiding one here does not disturb
         * anybody's saved preference — and does not have to move `simplify()`.
         *
         * **简体中文 is off the menu from 3.8.0 and is still built.** It is
         * *derived* from the Traditional half (invariant 8i), so it costs
         * nothing to keep and everything to delete: dropping it would mean
         * losing the term table, the character map and the guard that every Han
         * character the panel can show is classified — the guard that catches
         * an unclassified character in *any* language. What is hidden is the
         * row, not the language.
         *
         * A preference that already says `cn` falls back to `zh` rather than
         * being honoured, and that is the deliberate half. Honouring it would
         * leave the picker showing nothing while the panel spoke a language no
         * row offers — and 简体中文 is derived from 繁體中文, so the nearest
         * visible language is the one it was made from. Putting the row back is
         * one entry in each of the two lists below.
         */
        var languageCodes = ["zh", "en", "ja"];
        var HIDDEN_LANGUAGE_CODES = ["cn"];
        var languagePicker = languageRow.add("dropdownlist", undefined,
            ["繁體中文", "English", "日本語"]);
        tip(languagePicker, "language");
        /*
         * The version sits on the row that already exists, so it costs no
         * height. Filled in at the end of buildUI() from what the tool reports;
         * empty here rather than a placeholder, because a number that is wrong
         * for the first half-second is worse than one that arrives.
         */
        var versionLabel = languageRow.add("statictext", undefined, "");
        versionLabel.preferredSize.width = 120;

        /*
         * Four pages of settings, and the verbs underneath them.
         *
         * Measured at 2.1.0 the panel wanted 414 x 1354 px, forty rows in one
         * column. A docked ScriptUI panel in After Effects does not scroll, it
         * clips, so on any ordinary dock the bottom third was simply not there
         * — and the bottom third was Apply, Re-sync, Re-flow, Bake, Remove and
         * the status line, which is to say everything anybody presses. The
         * settings are what there are too many of, so the settings are what get
         * paged; Apply and the rest stay outside the tabs, always reachable,
         * whichever page is showing.
         *
         * A page is free to be short. Speak is the tall one and decides the
         * height of the whole panel, which is why the timbre controls left it:
         * they are the ones you set once per character rather than per line.
         *
         * ae-size-probe.jsx prints what each page costs, and
         * ae-language-verify.jsx fails if any of them gets past its limit.
         */
        var tabs = panel.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        function addTab(label) {
            var tab = tabs.add("tab", undefined, label);
            tab.orientation = "column";
            tab.alignChildren = ["fill", "top"];
            tab.margins = 10;
            tab.spacing = 8;
            return tab;
        }
        /*
         * Two pages: **the line, and the voice.**
         *
         * The first is the line and what moves on screen — the text, how it is
         * read, how it is laid out in time, the rig, the mouth switch, Type-On,
         * the markers, importing a script. The second is the voice: what it
         * sounds like, and where the sound comes from.
         *
         * It started from a sharper rule — *can you do this anywhere else?* —
         * because every effect parameter on the second page exists again in
         * After Effects' own Effect Controls once a line is applied, where it
         * can be keyframed and where anybody working on that layer is already
         * looking. That rule is why the parameters are on the second page and
         * not the first, and it still holds. What it could not do on its own is
         * decide where MIDI, a recording and a cloud or offline model go: none
         * of them is a parameter, but all of them are the voice.
         *
         * **The count and the balance are both measured.** 2.2.0 went to four
         * pages because one column of forty rows wanted 1354 px against the
         * ~900 px a 1080p dock gives — a docked ScriptUI panel does not scroll,
         * it clips, and what was clipped was every verb the product has. 2.4.0
         * went to three. 3.6.0 went to two on the parameter rule alone and came
         * out at 968 and 396 px: the second page a third full, the first one
         * needing the height limits raised well past that dock. 3.7.0 moves the
         * saved characters, MIDI, lip-sync and the voice sources across, and
         * measures **628 and 736, with the panel at 964**.
         *
         * That is still ~60 px over what a 1080p dock gives, and that is the
         * remaining price: on a dock that short the bottom of the *second* page
         * clips, which is the offline-model row. The verbs are safe — Apply,
         * Re-sync, Re-flow and the status line live outside the tabbed panel
         * and always have. `TALLEST_PAGE` and `TALLEST_PANEL` in
         * ae-language-verify.jsx are 780 and 1010, one row of headroom each.
         */
        var mainTab = addTab("Lines & animation / 句子與動畫");
        var voiceTab = addTab("Voice / 聲音");
        tabs.selection = mainTab;

        /*
         * The Voice page is five unrelated things in one column, and it read
         * as one long list of sliders.
         *
         * The character, the mouth it is made with, hearing it, singing it
         * from a file, and taking the timing out of a recording — nothing on
         * screen said where one ended and the next began, so "選 MIDI" looked
         * like another property of the voice above it.
         *
         * **This costs no panel height, and that is a constraint rather than a
         * boast.** The panel is as tall as its *taller* page, which is Lines &
         * animation at 700 px; Voice had 632 and so had room — but not enough:
         * five headings at 16 px come to 80, and at the shared 8 px spacing the
         * page lands at 706 and takes the panel with it.
         *
         * So the headings are paid for out of the spacing they replace. At 5 px
         * the page measures ~683 and the panel does not move. A heading
         * separates two groups better than three pixels of nothing does, so the
         * page reads as *more* spaced out while measuring less.
         */
        voiceTab.spacing = 5;
        function addHeading(parent, label) {
            var heading = parent.add("statictext", undefined, label);
            heading.icHeading = true;
            return heading;
        }

        /*
         * Aliases, not a rename.
         *
         * The rows below are written where they read naturally — timbre with
         * timbre, animation with animation — and ScriptUI adds children in
         * source order, so pointing several names at one page merges them
         * without moving a single row. Doing it the other way round, by cutting
         * and pasting sixty lines into a different block, is how a control gets
         * lost or reordered in a diff nobody can review. The seven rows that
         * had to change page are re-pointed one line at a time below, and each
         * says which parameter it is.
         */
        var speakTab = mainTab;
        var animationTab = mainTab;
        /*
         * MIDI, a recording and a cloud or offline model are all on the second
         * page, and they are not effect parameters — so the rule the split
         * started from needed one more word.
         *
         * It is not "is this an effect parameter", it is **what is this
         * about**: the second page is the *voice* — what it sounds like and
         * where the sound comes from — and the first is the *line* and what
         * moves on screen. Every effect parameter is still on the second page,
         * because a parameter is by definition about the sound; what joins them
         * is the three other ways audio arrives, and the saved characters,
         * which are those parameters under a name.
         *
         * The reason to do it is measured. Split on the parameter rule alone
         * the pages were 968 and 396 px, so the second one was a third full
         * while the first needed the height limits raised past what a 1080p
         * dock gives. Moving these ten rows makes them 628 and 736, and brings
         * the whole panel from 1196 px down to about 964.
         */
        var scriptTab = voiceTab;
        var timbreTab = voiceTab;

        speakTab.add("statictext", undefined, "Direct text-layer voice / 文字圖層直接發聲");
        var textInput = speakTab.add("edittext", undefined, "你好，歡迎來到小島！", { multiline: true, scrolling: true });
        textInput.preferredSize = [390, 88];
        var selectedButton = speakTab.add("button", undefined,
            "Read selected layer / 讀取選取圖層");
        tip(selectedButton, "readLayer");
        selectedButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            var layer = comp && comp instanceof CompItem ? selectedTextLayer(comp) : null;
            if (!layer) {
                alert(M("Select a text layer. / 請選取文字圖層。"));
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
                status.text = M("Read text only / 只讀到文字（此圖層尚未套用）");
                return;
            }
            applySettingsToUI(settingsFromEffect(effect));
            /*
             * A line that is not bound to a rig can still say who it is.
             *
             * The rig's name is the better answer whenever there is a rig, so
             * it stays first; this is the case that used to have no answer at
             * all — a per-layer rig, or a line unbound from a shared one.
             */
            var who = bound ? rigCharacterName(bound) : characterOfEffect(effect);
            status.text = M("Read settings from {0} / 已讀取設定：{0}",
                layer.name + (who ? "  (" + who + ")" : ""));
        };
        speakTab.add("statictext", undefined,
            "Pronunciation override (optional) / 讀音覆寫（可留空）");
        var pronunciationInput = speakTab.add("edittext", undefined, "", { multiline: false });
        tip(pronunciationInput, "pronunciation");
        /*
         * Three dropdowns on one line rather than three lines of one.
         *
         * They were full-width and stacked, which cost 48 px of height to say
         * nothing extra: none of the three has a label either way, and reading
         * them left to right is no harder than reading them top to bottom. The
         * row has to stay under the width limit in Japanese, which is what
         * ae-language-verify.jsx is for — the answer if it ever stops fitting is
         * to split it back, not to shorten a translation.
         */
        /*
         * Effect parameters from here to the end of the sliders, so the second
         * page: voice `1`, emotion `71`, character size `72`, then pitch `2`,
         * speed `3`, volume `4`, consonant `5`, clarity `73`, cuteness `74`.
         * Every one of them is in Effect Controls once a line is applied.
         */
        addHeading(voiceTab, "— Character / 角色 —");
        var characterRowTop = voiceTab.add("group");
        characterRowTop.orientation = "row";
        var voice = characterRowTop.add("dropdownlist", undefined, [
            "Sunny / 明亮", "Tiny / 迷你", "Cozy / 溫厚", "Buzzy / 電子",
            "Chirpy / 活潑", "Whisper / 耳語", "Elder / 年長", "Droid / 機器"
        ]);
        voice.selection = 0;
        var emotion = characterRowTop.add("dropdownlist", undefined, [
            "Neutral / 中性", "Happy / 開心", "Angry / 生氣", "Scared / 害怕",
            "Question / 疑問", "Sleepy / 疲倦", "Robot / 機器人"
        ]);
        emotion.selection = 0;
        var characterSize = characterRowTop.add("dropdownlist", undefined,
            ["Tiny / 迷你", "Young / 少年", "Adult / 成熟", "Giant / 巨大"]);
        characterSize.selection = 2;
        // Ranges match the effect parameters in plugin/IslandChatterNative.cpp.
        var pitch = addSlider(voiceTab, "Pitch / 音高", 0.10, 4.00, 1.00);
        var speed = addSlider(voiceTab, "Speed / 速度", 0.10, 10.00, 1.00);
        var volume = addSlider(voiceTab, "Volume / 音量", 0.00, 2.00, 0.78);
        var consonant = addSlider(voiceTab, "Consonant / 聲母", 0.00, 6.00, 1.25);
        var clarity = addSlider(voiceTab, "Clarity / 清晰度", 0.00, 1.00, 0.78);
        var cuteness = addSlider(voiceTab, "Cuteness / 可愛度", 0.00, 1.00, 0.55);
        // Timbre, on its own page: these are set once for a character, not once
        // per line, and Speak is the page that decides how tall the panel is.
        // Every default reproduces 1.0.x, so nothing here changes an existing
        // layer until it is moved.
        addHeading(timbreTab, "— Timbre / 音色 —");
        var formant = addSlider(timbreTab, "Formant / 共鳴", 0.25, 4.00, 1.00);
        tip(formant, "formant");
        /*
         * The one control on this page that said only its own value.
         *
         * It was a bare full-width dropdown reading "人聲", sitting between
         * Formant and Vibrato with nothing to say what it was choosing — so it
         * read as a list of voices rather than as what replaces the vocal
         * folds. Now it is a titled row in the same 110 px column the sliders
         * start in, which is also what makes the page scan as one thing.
         */
        var sourceRow = timbreTab.add("group");
        sourceRow.orientation = "row";
        var sourceTitle = sourceRow.add("statictext", undefined, "Sound source / 發聲源");
        sourceTitle.preferredSize.width = 110;
        sourceTitle.icFixedWidth = true;
        var source = sourceRow.add("dropdownlist", undefined, [
            "Voice / 人聲", "Reed / 簧片", "Chip / 電子", "Metallic / 金屬",
            "Granular / 破碎", "Growl / 低吼"
        ]);
        source.alignment = ["fill", "center"];
        source.selection = 0;
        tip(source, "source");
        var vibrato = addSlider(timbreTab, "Vibrato / 顫音", 0.00, 4.00, 1.00);
        var vibratoRate = addSlider(timbreTab, "Vibrato Rate / 顫音速率", 0.00, 30.00, 9.20);
        var seed = addSlider(timbreTab, "Seed / 種子", 0, 999999, 0, 0);

        // Tempo. Speed stays the underlying control; these just drive it, which
        // is why they stay on the same page as the Speed slider they write to.
        var tempoRow = speakTab.add("group");
        tempoRow.orientation = "row";
        var tempoOn = tempoRow.add("checkbox", undefined, "Tempo / 節拍");
        tip(tempoOn, "tempo");
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
        var tempoReadout = speakTab.add("statictext", undefined, "");
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
                tempoReadout.text = M("Speed set manually / 語速為手動設定");
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
            tempoReadout.text =
                M("{0} s/syllable   Speed {1} / {0} 秒／字   Speed {1}",
                    perSyllable.toFixed(3), derived.toFixed(3)) +
                (valuesDiffer(style, 1.0)
                    ? M("  (x{0} character) / 　（x{0} 角色補償）", style.toFixed(2)) : "") +
                (derived > 10.0 || derived < 0.10 ? M("   OUT OF RANGE / 　　超出範圍") : "");
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

        /*
         * Preview lives on this page because this is the page you are on when
         * you want it: eight sliders that change how a character sounds, and no
         * way to hear the difference without applying it to a layer first.
         *
         * Its own row rather than beside Random and Save. The panel is 796 px
         * of the 800 it may have and the Speak page is 568 of 570 (invariant
         * 8z), so a row that could be measured wrong is not worth the 30 px
         * this one costs on a page that has 80 to spare.
         */
        /*
         * On the second page from 3.8.0, and this is the seam 3.7.0 wrote down
         * and left open.
         *
         * Both buttons are about the voice and nothing else. Preview auditions
         * the twelve sliders directly above it — having it a tab away from them
         * meant adjusting a number on one page and pressing Play on another.
         * "My voice…" measures five vowels into parameters `279-289`, which are
         * the last four rows of this same page.
         *
         * It stays *panel-only* work — nothing in Effect Controls renders a WAV
         * or measures a formant — so it is not here because the parameter rule
         * moved it. It is here because the page is the voice, which is the rule
         * 3.7.0 settled on.
         */
        addHeading(voiceTab, "— Listen / 試聽與自訂音色 —");
        var previewRow = voiceTab.add("group");
        var previewButton = previewRow.add("button", undefined, "Preview / 試聽");
        tip(previewButton, "preview");

        /*
         * Custom timbre, on the page about what a character sounds like.
         *
         * Two buttons and a readout, on the row Preview already opened, because
         * the panel is 796 px of the 800 it may have (invariant 8z) and this
         * page is the one with room. The readout says how many vowels are
         * measured rather than the numbers themselves: ten formants in Hz mean
         * nothing to the person who recorded them, and "5 vowels" is the whole
         * of what they need to know.
         */
        var vowelButton = previewRow.add("button", undefined, "My voice… / 我的聲音…");
        tip(vowelButton, "customTimbre");
        var vowelClear = previewRow.add("button", undefined, "Clear / 清除");
        var vowelReadout = previewRow.add("statictext", undefined, "Built-in / 內建", { truncate: "end" });
        // Measured before the panel is asked how wide it is: an empty
        // statictext measures as nothing (invariant 8z), so it is filled with
        // its own longest text rather than left blank.
        vowelReadout.preferredSize.width = 120;
        var measuredVowels = [];

        function showVowels() {
            var measured = 0;
            var index;
            for (index = 0; index < CUSTOM_VOWEL_NAMES.length; index += 1) {
                if (measuredVowels[index * 2] > 0) { measured += 1; }
            }
            vowelReadout.text = measured
                ? M("{0} of 5 vowels / 5 個母音中的 {0} 個", measured)
                : M("Built-in / 內建");
            return measured;
        }

        /*
         * One dialog per vowel, in the order the engine's table starts with.
         *
         * Five separate presses rather than one folder, because the panel has
         * to know *which* vowel each file is and a folder cannot say. Cancel on
         * any of them keeps what was measured so far, so a session can be done
         * in two sittings — the engine treats an unmeasured vowel as "follow
         * the others" rather than as an error.
         */
        vowelButton.onClick = function () {
            var gathered = measuredVowels.slice(0);
            while (gathered.length < CUSTOM_VOWEL_VALUES) { gathered.push(0); }
            var index;
            var measured = 0;
            for (index = 0; index < CUSTOM_VOWEL_NAMES.length; index += 1) {
                var file = File.openDialog(M(
                    "Choose a recording of a held “{0}” / 請選一段拉長的「{0}」的錄音",
                    CUSTOM_VOWEL_NAMES[index]));
                if (!file) { break; }
                try {
                    var pair = measureVowelFile(file);
                    gathered[index * 2] = pair[0];
                    gathered[index * 2 + 1] = pair[1];
                    measured += 1;
                } catch (error) {
                    alert(String(error.message || error));
                    break;
                }
            }
            if (!measured) { return; }
            measuredVowels = gathered;
            var total = showVowels();
            status.text = M("Measured {0} vowel(s); Apply writes them onto a layer / 已量到 {0} 個母音，按 Apply 才會寫到圖層上",
                total);
        };

        vowelClear.onClick = function () {
            // An empty array is not the same as nothing: it clears the layer's
            // measurement on the next Apply, where dropping the field entirely
            // would leave the old one in place. Same rule as the melody's.
            measuredVowels = [];
            showVowels();
            status.text = M("Back to the built-in voice / 已改回內建的聲音");
        };

        /*
         * What gets spoken, and why the selected layer wins.
         *
         * Adjusting a timbre with a line selected means you want to hear that
         * line — in the voice the panel is holding, which is the one you are
         * changing, not the one the layer already carries. With nothing
         * selected it falls back to the text box, so the button still works
         * with no composition open.
         *
         * Truncated to MAX_TEXT_UNITS even though the tool has no such limit:
         * that is what the layer will say once it is applied (invariant 8m),
         * and a preview of a longer sentence than the product can speak is a
         * preview of the wrong thing.
         */
        function previewText() {
            var comp = activeComp();
            var chosen = comp ? selectedTextLayers(comp) : [];
            if (chosen.length) {
                var said = trim(textFromLayer(chosen[0]));
                if (said) {
                    return said.length > MAX_TEXT_UNITS
                        ? said.substring(0, MAX_TEXT_UNITS) : said;
                }
            }
            return trim(String(textInput.text));
        }

        previewButton.onClick = function () {
            var said = previewText();
            if (!said) {
                alert(M("Type something first, or select a text layer to hear. / 請先打字，或選一個文字圖層來聽。"));
                return;
            }
            // No undo group: this writes nothing to the project, which is the
            // whole point of it.
            try {
                status.text = M("Playing… / 播放中…");
                previewVoice(said, currentSettings());
                status.text = M("Previewed / 已試聽");
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(String(error.message || error));
            }
        };

        // Saved characters sit with the timbre they mostly carry.
        /*
         * Back on the first page from 3.8.0, at the user's asking, and the
         * reason it is defensible is that a saved character is the *opposite*
         * of the second page rather than a part of it.
         *
         * 3.7.0 put it beside the sliders because it moves all of them at
         * once. But that argument is about watching it work, and picking a
         * character is not something anybody wants to watch — it is the
         * shortcut that means never opening the second page at all. A shortcut
         * belongs where the work is.
         */
        var characterRow = mainTab.add("group");
        var preset = characterRow.add("dropdownlist", undefined, BUILT_IN_CHARACTERS.slice(0));
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
            var wanted = BUILT_IN_CHARACTERS.slice(0);
            var saved = readSavedPresets();
            var index;
            for (index = 0; index < saved.length; index += 1) { wanted.push(saved[index].name); }
            while (preset.items.length > 0) { preset.remove(preset.items[preset.items.length - 1]); }
            for (index = 0; index < wanted.length; index += 1) { preset.add("item", wanted[index]); }
            preset.selection = 0;
            return saved;
        }

        var savedPresets = refreshPresetList();

        // The eight numbers a saved character is, in the order they are stored.
        // One list, because Save writes it and currentCharacterName() compares
        // against it, and two copies would disagree the first time a control
        // joined a character.
        function presetValuesNow() {
            return [voice.selection ? voice.selection.index : 0,
                emotion.selection ? emotion.selection.index : 0,
                characterSize.selection ? characterSize.selection.index : 2,
                pitch.value, speed.value, clarity.value, cuteness.value,
                Math.round(seed.value)];
        }

        /*
         * The character the panel is on, or nothing, for a line with no rig.
         *
         * "On a character" means the dropdown names one *and* the sliders still
         * match it. Picking Mimi and then dragging Pitch leaves the dropdown
         * saying Mimi, and a line labelled Mimi that does not sound like Mimi
         * is a worse record than no label — this is the same reasoning as the
         * stale-bake rule in invariant 8r, applied to a name.
         *
         * A built-in is stored by its English half. The labels are
         * `"Mimi / 咪咪"` and the panel translates them, so storing what is on
         * screen would make one line read as two different characters depending
         * on which language it was applied in (invariant 8i), on a record meant
         * to outlive the session.
         */
        function currentCharacterName() {
            var at = preset.selection ? preset.selection.index : 0;
            if (at <= 0) { return ""; }
            var built = at < builtInPresets.length;
            var values = built ? builtInPresets[at]
                : (savedPresets[at - builtInPresets.length] || {}).values;
            if (!values) { return ""; }
            var now = presetValuesNow();
            var index;
            for (index = 0; index < values.length && index < now.length; index += 1) {
                if (Math.abs(values[index] - now[index]) > 0.0005) { return ""; }
            }
            if (!built) { return savedPresets[at - builtInPresets.length].name; }
            var label = BUILT_IN_CHARACTERS[at];
            var split = label.indexOf(" / ");
            return split < 0 ? label : label.substring(0, split);
        }

        saveButton.onClick = function () {
            var name = prompt(M("Name this character / 幫這個角色取個名字"),
                M("Character {0} / 角色 {0}", savedPresets.length + 1));
            if (!name) { return; }
            name = trim(name).replace(/[|=,]/g, " ");
            if (!name) { return; }
            var values = presetValuesNow();
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
            status.text = M("Saved {0} / 已儲存：{0}", name);
        };
        var deleteButton = characterRow.add("button", undefined, "Delete / 刪除");
        deleteButton.onClick = function () {
            var at = (preset.selection ? preset.selection.index : 0) - builtInPresets.length;
            if (at < 0) {
                alert(M("Select a saved character first. / 請先選取自訂角色。"));
                return;
            }
            savedPresets.splice(at, 1);
            writeSavedPresets(savedPresets);
            savedPresets = refreshPresetList();
        };
        var workflowRow = animationTab.add("group");
        var markers = workflowRow.add("checkbox", undefined, "Markers / 逐字標記");
        markers.value = true;
        var fitDuration = workflowRow.add("checkbox", undefined, "Fit Duration / 配合長度");
        fitDuration.value = true;
        /*
         * Two rows of two rather than one row of four. A row is as wide as
         * everything in it, and the panel is as wide as its widest row, so a
         * four-checkbox row set the width of the whole panel: 439 px in
         * Japanese against the 414 the text box asks for. Splitting costs one
         * line of height and takes the row out of the running entirely.
         */
        var animationRow = animationTab.add("group");
        var controllers = animationRow.add("checkbox", undefined, "Rig / 動畫控制");
        controllers.value = true;
        var typeOn = animationRow.add("checkbox", undefined, "Type-On / 逐字顯示");
        typeOn.value = false;
        var animationRowTwo = animationTab.add("group");
        var chatterOn = animationRowTwo.add("checkbox", undefined, "Chatter / 逐字開合");
        tip(chatterOn, "chatter");
        var typeOnCenter = animationRowTwo.add("checkbox", undefined, "Center / 維持置中");
        typeOnCenter.value = true;
        tip(typeOnCenter, "typeOnCenter");

        /*
         * Where the rig goes. Per layer is what every project before this did
         * and stays the default, because switching an existing project's twenty
         * layers over on the next Apply is not a thing to do without being asked.
         */
        var rigRow = animationTab.add("group");
        rigRow.orientation = "row";
        var rigScope = rigRow.add("group");
        rigScope.orientation = "row";
        var rigPerLayer = rigScope.add("radiobutton", undefined, "Per layer / 每層");
        var rigShared = rigScope.add("radiobutton", undefined, "Shared / 共用角色");
        rigPerLayer.value = true;
        tip(rigPerLayer, "rigPerLayer");
        tip(rigShared, "rigShared");
        // Which character, on its own row: the two radio buttons and the three
        // controls that act on a character came to 569 px in Japanese together.
        var rigRowTwo = animationTab.add("group");
        rigRowTwo.orientation = "row";
        // Character names are the user's own words, so they are never put
        // through the interface translator.
        var characterList = rigRowTwo.add("dropdownlist", undefined, []);
        characterList.preferredSize.width = 110;
        var newCharacterButton = rigRowTwo.add("button", undefined, "New / 新增角色");
        var rebuildButton = rigRowTwo.add("button", undefined, "Rebuild / 重建");
        tip(rebuildButton, "rebuild");

        var mouthRow = animationTab.add("group");
        mouthRow.orientation = "row";
        var mouthButton = mouthRow.add("button", undefined, "Mouth switch / 建立嘴型切換");
        tip(mouthButton, "mouth");

        // One influence shapes both the reveal and the recentring glide; the
        // arriving side is always full, so motion settles rather than stopping
        // dead. Low leaves at full speed, which is the fast-to-slow default.
        /*
         * "Ease", not "Leave".
         *
         * The old label named the *mechanism* — this is the temporal ease
         * influence on the outgoing side of each keyframe — and nobody reading
         * a panel is thinking about which side of a keyframe an influence sits
         * on. What the control does is decide whether the typing snaps or
         * drifts, and next to "Smoothness", which softens each character's
         * fade, "Ease" says which of the two motions it is about.
         */
        var easeLeave = addSlider(animationTab, "Ease / 緩動", MIN_INFLUENCE, MAX_INFLUENCE,
            DEFAULT_LEAVE_INFLUENCE);
        tip(easeLeave, "leave");
        var smoothness = addSlider(animationTab, "Smoothness / 平滑", 0, 100, DEFAULT_SMOOTHNESS);
        tip(smoothness, "smoothness");

        /*
         * A whole script is still typing, so it lives with the typing.
         *
         * Import is the same verb as Apply with more lines in it: text goes in,
         * voiced layers come out. Putting it on the Speak page keeps the two
         * next to each other and leaves the last page to the three ways a
         * performance arrives already *made* — sung from a file, recorded, or
         * spoken by somebody else's model.
         *
         * It costs the Speak page ~56 px and the Speak page is what decides how
         * tall the panel is, so this is the row that has to be watched: the
         * numbers are in ae-size-probe-result.txt and ae-language-verify.jsx
         * fails if a page passes 570 px or the panel passes 800.
         */
        var importRow = speakTab.add("group");
        importRow.orientation = "row";
        var importButton = importRow.add("button", undefined, "Import script / 匯入劇本");
        tip(importButton, "import");
        importRow.add("statictext", undefined, "Gap / 間隔");
        var gapField = importRow.add("edittext", undefined, "1");
        gapField.characters = 4;
        tip(gapField, "gap");
        var gapReadout = importRow.add("statictext", undefined, "");
        gapReadout.preferredSize.width = 150;
        // The two options that change what an import does, on their own row.
        var importRowTwo = speakTab.add("group");
        importRowTwo.orientation = "row";
        var holdOn = importRowTwo.add("checkbox", undefined, "Hold / 接到下一句");
        tip(holdOn, "hold");
        var speakersOn = importRowTwo.add("checkbox", undefined, "Speakers / 含角色名");
        tip(speakersOn, "speakers");

        /*
         * Singing, in three rows: pick the file, set how it is sung, then do it.
         *
         * These eleven controls were one row, and that row alone decided how
         * wide the panel had to be: 762 px in Chinese, 817 in Japanese, against
         * the 414 the text box asks for. It has been the widest thing in the
         * panel since 1.7.0 — Japanese only made it obvious, adding 55 px to a
         * row that was already 350 px too wide. No amount of shorter wording
         * reaches 414 from 762, so the row is split instead.
         */
        addHeading(scriptTab, "— Sing from MIDI / 用 MIDI 唱歌 —");
        var singRow = scriptTab.add("group");
        singRow.orientation = "row";
        var midiButton = singRow.add("button", undefined, "Choose MIDI / 選 MIDI");
        tip(midiButton, "chooseMidi");
        var trackList = singRow.add("dropdownlist", undefined, []);
        trackList.preferredSize.width = 150;
        tip(trackList, "track");

        var singRowTwo = scriptTab.add("group");
        singRowTwo.orientation = "row";
        singRowTwo.add("statictext", undefined, "Transpose / 移調");
        var transposeField = singRowTwo.add("edittext", undefined, "0");
        transposeField.characters = 4;
        tip(transposeField, "transpose");
        singRowTwo.add("statictext", undefined, "Key / 唱名調");
        var solfegeKey = singRowTwo.add("dropdownlist", undefined,
            ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
        solfegeKey.selection = 0;
        solfegeKey.preferredSize.width = 60;
        tip(solfegeKey, "key");
        // "Tone / 聲調" until 3.8.0, next to a box reading 15 — which parses as
        // "tone number 15" and is not a thing. It is a percentage of how much
        // of the Mandarin tone contour survives the melody, so it says so.
        singRowTwo.add("statictext", undefined, "Tone % / 聲調 %");
        var toneBlendField = singRowTwo.add("edittext", undefined, "15");
        toneBlendField.characters = 4;
        tip(toneBlendField, "toneBlend");

        var singRowThree = scriptTab.add("group");
        singRowThree.orientation = "row";
        var singButton = singRowThree.add("button", undefined, "Sing / 唱出來");
        tip(singButton, "sing");
        var clearMelodyButton = singRowThree.add("button", undefined, "Speak / 改回講話");
        tip(clearMelodyButton, "speak");
        // Empty until a MIDI file is chosen, and an empty statictext collapses:
        // the width on the next line is silently ignored, so this measures as
        // nothing until it has something to say and then sizes to its text.
        // ae-language-verify.jsx fills it before measuring the row for that
        // reason — with the readout's own text, not another readout's.
        var songReadout = singRowThree.add("statictext", undefined, "");
        songReadout.preferredSize.width = 190;

        /*
         * A recording driving the same face.
         *
         * There is no voice to set here and no text to type: the sound already
         * exists, and all the panel is being asked for is where the syllables
         * are in it. Which character it belongs to is the character menu on the
         * Animation page, the same one everything else binds to — a second copy
         * of it here would be a second thing to keep in step.
         */
        addHeading(scriptTab, "— Mouth from a recording / 用錄音對嘴 —");
        var lipSyncButton = scriptTab.add("button", undefined,
            "Lip-sync from audio / 音檔轉口型");
        tip(lipSyncButton, "lipSync");
        var audioRow = scriptTab.add("group");
        audioRow.orientation = "row";
        var vowelsOn = audioRow.add("checkbox", undefined, "Vowels / 判斷母音");
        vowelsOn.value = true;
        tip(vowelsOn, "vowels");
        var audioReadout = audioRow.add("statictext", undefined, "");
        audioReadout.preferredSize.width = 150;
        var sensitivity = addSlider(scriptTab, "Sensitivity / 靈敏度", 0, 100, 50);
        tip(sensitivity, "sensitivity");

        /*
         * A voice from a cloud model, on the page where performances arrive
         * from outside.
         *
         * It belongs here rather than on Speak, and rather than on a fifth tab.
         * The tab strip is already the widest thing in the panel at 447 px
         * against a 460 limit — 2.3.0 measured a fifth tab at 507 px, about
         * 97 px of which is the tab's own padding, so no amount of shortening a
         * title would have fitted it. And it belongs *with* these three: a
         * script, a MIDI file, a recording and a cloud voice are the four ways
         * a performance gets into a project without being typed into Speak.
         *
         * Three rows because two would not fit under 460 px in Japanese, and
         * because the region only means anything to one provider.
         */
        /*
         * The voice sources, on the first page and offline first.
         *
         * Two rows from 3.8.0 where there were three, and the row that went was
         * the cloud one: Voice ID, Model and Region are three text fields that
         * only ever mean anything to a cloud account, and they sat on the page
         * whichever source was selected. They live in the key dialog now — the
         * dialog that already exists for the *other* thing only a cloud account
         * needs — so the page carries the source, the button that configures
         * it, and the offline models. A local source's tuning was already
         * behind that same button, so both kinds of source are now one press
         * away rather than one being spread across the page.
         */
        var cloudRow = mainTab.add("group");
        cloudRow.orientation = "row";
        var cloudButton = cloudRow.add("button", undefined, "AI voice / AI 語音");
        tip(cloudButton, "cloudVoice");
        /*
         * "Voice source", not "provider", and the name is the forward
         * compatibility rather than a decoration.
         *
         * Today every entry is a company with an API. In 3.0.0 one of them is
         * meant to be a model running on this machine, and the expensive part
         * of that is not the model — it is a panel that has assumed in six
         * places that a source needs a key, needs a region and needs to warn
         * that the text is leaving the computer. The list is data from the
         * tool and carries a flag for that, so each of those is a question
         * rather than an assumption.
         */
        var providerList = cloudRow.add("dropdownlist", undefined, []);
        providerList.preferredSize.width = 110;
        tip(providerList, "provider");
        var keyButton = cloudRow.add("button", undefined, "API key / 金鑰");
        tip(keyButton, "cloudKey");

        /*
         * Voice ID, Model and Region stopped being controls in 3.8.0 and became
         * state. They are plain objects with a `.text`, which is the whole of
         * what the six places that touch them ever used.
         *
         * Not a hidden control and not a `Window` nobody shows: either would be
         * a real ScriptUI object that the width and height walks can reach and
         * that a future edit could accidentally add to a page. An object with
         * one property cannot be laid out at all, which is the point.
         *
         * `.enabled` is still assigned to the region one by
         * `showProviderFields()`. On a plain object that is a property nobody
         * reads, and it is left in place on purpose: the field is edited in the
         * key dialog now, and *that* dialog is where the region has to be
         * refused for a provider that has none.
         */
        var cloudVoiceField = { text: "" };
        var cloudModelField = { text: "" };
        var cloudRegionField = { text: "" };

        var cloudRowThree = mainTab.add("group");
        cloudRowThree.orientation = "row";
        /*
         * Fetching the offline model, which is the one thing in this product
         * that downloads anything.
         *
         * It belongs beside the key button — a cloud source needs a key, a
         * local one needs a model, and neither needs the other — and it was
         * there until it was measured: four controls took that row to 471 px in
         * Japanese against the 460 a dock can give. Invariant 8z says a row
         * that will not fit is split rather than reworded, and the panel is at
         * 796 px of its 800 so a new row is not available either. This row had
         * 200 px spare. The button says how big the download is before it
         * starts, because 178 MB on a slow line is a decision rather than a
         * click.
         */
        var modelButton = cloudRowThree.add("button", undefined, "Offline models… / 離線模型…");
        tip(modelButton, "getModel");
        /*
         * Off unless the offline tool is actually installed.
         *
         * It is not, in the releases that ship this: the offline voice is
         * finished code held back for two reasons written up in the changelog —
         * the sherpa-onnx build links espeak-ng (GPL v3+), and the only
         * permissively licensed Chinese model available is China-accented,
         * which is the wrong voice for a Traditional Chinese product. A button
         * that is present and fails reads as breakage; a button that is present
         * and greyed reads as "not yet", which is the truth.
         */
        modelButton.enabled = toolFile(LOCAL_TOOL_NAME) !== null;
        // Empty until something has been fetched, and an empty statictext
        // collapses: the width on the next line does nothing until it has text.
        var cloudReadout = cloudRowThree.add("statictext", undefined, "");
        cloudReadout.preferredSize.width = 170;

        var applyButton = panel.add("button", undefined,
            "Apply to selected text layers / 套用到選取文字圖層");
        applyButton.preferredSize.height = 34;

        var editRow = panel.add("group");
        editRow.orientation = "row";
        var resyncButton = editRow.add("button", undefined, "Re-sync / 重新同步");
        tip(resyncButton, "resync");
        var reflowButton = editRow.add("button", undefined, "Re-flow / 重新排列");
        tip(reflowButton, "reflow");

        var toolRow = panel.add("group");
        toolRow.orientation = "row";
        var bakeButton = toolRow.add("button", undefined, "Bake / 轉成音訊");
        tip(bakeButton, "bake", BAKE_FOLDER_NAME);
        var removeButton = toolRow.add("button", undefined, "Remove / 移除");
        tip(removeButton, "remove");
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

        // The cloud provider table and which row was last chosen. Both live up
        // here because restoreState() reads the remembered index long before
        // the table itself is fetched, which does not happen until the first
        // time somebody presses something that needs it.
        var cloudTable = [];
        var rememberedProvider = 0;

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
                gapReadout.text = M("= 0s  no grid / = 0s　無格線");
                return;
            }
            var note = "";
            if (!valuesDiffer(beats, 0.25)) { note = M("  sixteenth / 　十六分"); }
            else if (!valuesDiffer(beats, 0.5)) { note = M("  eighth / 　八分"); }
            else if (!valuesDiffer(beats, 1)) { note = M("  quarter / 　四分"); }
            else if (!valuesDiffer(beats, 2)) { note = M("  half / 　二分"); }
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
                // Who this is, for a line that will not be bound to a rig.
                // Empty unless the sliders still match the character named in
                // the dropdown; applyToTextLayer() prefers the rig's name when
                // there is one.
                character: currentCharacterName(),
                // The measured vowel space, always present so Apply either
                // writes one or clears one. A line cannot keep a voice the
                // panel is no longer holding.
                customVowels: measuredVowels.slice(0),
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
                speakers: speakersOn.value,
                hold: holdOn.value
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

        // A Tab is not a ListItem and carries no index of its own, so which one
        // is showing is found rather than asked for.
        function activeTabIndex() {
            var index;
            for (index = 0; index < tabs.children.length; index += 1) {
                if (tabs.children[index] === tabs.selection) { return index; }
            }
            return 0;
        }

        function panelState() {
            return {
                tab: activeTabIndex(),
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
                chatter: chatterOn.value ? 1 : 0,
                easeLeave: easeLeave.value,
                smoothness: smoothness.value,
                sensitivity: sensitivity.value,
                vowels: vowelsOn.value ? 1 : 0,
                gapBeats: currentGapBeats(),
                speakers: speakersOn.value ? 1 : 0,
                hold: holdOn.value ? 1 : 0,
                // How a melody is sung is a panel setting and survives a
                // restart. The melody and the file it came from do not: they
                // belong to the layers, and a remembered path that no longer
                // resolves is worse than an empty field.
                transpose: currentTranspose(),
                toneBlend: Math.round(currentToneBlend() * 100),
                solfegeKey: currentSolfegeKey(),
                // The provider menu is filled lazily, so for most of a session
                // it is empty and its selection is null. Writing 0 in that case
                // would quietly reset a remembered choice on the next time any
                // other control moved.
                provider: providerList.selection ? providerList.selection.index : rememberedProvider
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
            // A state written before 2.2.0 has no tab in it and opens on Speak,
            // which is where the panel has always started.
            tabs.selection = tabs.children[
                clamp(Math.round(storedNumber(state, "tab", 0)), 0, tabs.children.length - 1)];
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
            chatterOn.value = storedNumber(state, "chatter", 0) !== 0;
            mouthChatter = chatterOn.value;
            setSliderValue(easeLeave, clamp(storedNumber(state, "easeLeave", DEFAULT_LEAVE_INFLUENCE),
                MIN_INFLUENCE, MAX_INFLUENCE));
            setSliderValue(smoothness, clamp(storedNumber(state, "smoothness", DEFAULT_SMOOTHNESS), 0, 100));
            setSliderValue(sensitivity, clamp(storedNumber(state, "sensitivity", 50), 0, 100));
            vowelsOn.value = storedNumber(state, "vowels", 1) !== 0;
            gapField.text = String(Math.max(0, storedNumber(state, "gapBeats", 1)));
            speakersOn.value = storedNumber(state, "speakers", 0) !== 0;
            holdOn.value = storedNumber(state, "hold", 0) !== 0;
            transposeField.text = String(clamp(Math.round(storedNumber(state, "transpose", 0)), -48, 48));
            toneBlendField.text = String(clamp(Math.round(storedNumber(state, "toneBlend", 15)), 0, 100));
            solfegeKey.selection = clamp(Math.round(storedNumber(state, "solfegeKey", 0)), 0, solfegeKey.items.length - 1);
            // Kept as a number rather than applied: the menu has no items until
            // the tool has been asked, which is the first time it is needed.
            rememberedProvider = Math.max(0, Math.round(storedNumber(state, "provider", 0)));
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
                status.text = M("Now editing {0} / 目前角色：{0}", chosenCharacter());
            }
        };

        newCharacterButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var name = prompt(M("Name this character / 幫這個角色取個名字"),
                M("Character {0} / 角色 {0}", characterList.items.length + 1));
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
                status.text = M("Now editing {0} / 目前角色：{0}", name);
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        rebuildButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
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
                alert(M("There is no shared rig here. / 這個合成裡沒有共用控制器。"));
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
                status.text = M("Rebuilt {0} rig(s), {1} line(s) / 已重建 {0} 組控制器、{1} 句",
                    wanted.length, lines);
                if (overlaps.length) {
                    status.text = M("Overlapping lines: {0} / 台詞重疊：{0}", overlaps.join(", "));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        mouthButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var rigLayer = chosenRigLayer(comp);
            if (!rigLayer) {
                alert(M("Choose or create a character first. / 請先選擇或新增角色。"));
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
                    ? M("Mouth on Time Remap / 嘴型已接上時間重映射")
                    : M("Mouth switch on {0} layer(s) -> {1} / 已接上嘴型 {0} 層 -> {1}",
                        built.count, rigCharacterName(rigLayer));
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        bakeButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            if (!(comp && comp instanceof CompItem)) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var layers = selectedTextLayers(comp);
            if (!layers.length) {
                alert(M("Select a text layer. / 請選取文字圖層。"));
                return;
            }
            var ready = [];
            var pick;
            for (pick = 0; pick < layers.length; pick += 1) {
                if (findNativeEffect(layers[pick])) { ready.push(layers[pick]); }
            }
            if (!ready.length) {
                alert(M("Apply Island Chatter first, then bake. / 請先按 Apply 再轉成音訊。"));
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
                status.text = M("Baked {0} layer(s) -> {1} / 已轉成音訊 {0} 層 -> {1}",
                    made, BAKE_FOLDER_NAME);
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };
        removeButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            if (!(comp && comp instanceof CompItem)) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
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
                alert(M("Select a text layer. / 請選取文字圖層。"));
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
                status.text = M("Removed {0} item(s) from {1} layer(s) / 已移除 {1} 層上的 {0} 個項目",
                    removed, layers.length + doomed.length);
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };
        resyncButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var layers = selectedTextLayers(comp);
            if (!layers.length) {
                alert(M("Select a text layer. / 請選取文字圖層。"));
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Re-sync");
            try {
                var synced = resyncSelection(comp, layers, currentOptions());
                status.text = M("Re-synced {0} layer(s) / 已重新同步 {0} 層", synced.count) +
                    (synced.rigs ? M("  rig x{0} / 　控制器 x{0}", synced.rigs) : "") +
                    (synced.stale ? M("  stale bake x{0} / 　轉檔過期 x{0}", synced.stale) : "");
                if (!synced.count) {
                    status.text =
                        M("Apply Island Chatter to these layers first. / 這些圖層還沒套用過。");
                }
                if (synced.overlaps.length) {
                    status.text = M("Overlapping lines: {0} / 台詞重疊：{0}", synced.overlaps.join(", "));
                }
                if (synced.truncated.length) {
                    status.text = M("Truncated: {0} / 已截斷：{0}",
                        synced.truncated.join(", "));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        reflowButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
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
                alert(M("There are no Island Chatter lines here. / 這個合成裡沒有台詞圖層。"));
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Re-flow");
            try {
                var laid = reflowLayers(comp, layers, currentGapBeats(), currentBpm(),
                    holdOn.value);
                status.text = M("Re-flowed {0} layer(s) @ {1} beat(s) / 已排列 {0} 層 @ {1} 拍",
                    laid.count, currentGapBeats()) +
                    (laid.held ? M("  held x{0} / 　接到下一句 x{0}", laid.held) : "") +
                    (laid.sungSkipped
                        ? M("  ({0} sung layer(s) left in place) / 　（唱歌 {0} 層維持原位）",
                            laid.sungSkipped)
                        : "") +
                    (laid.rigs ? M("  rig x{0} / 　控制器 x{0}", laid.rigs) : "") +
                    (laid.grew
                        ? M("  comp grown to {0}s / 　合成延長到 {0}s", laid.grew.toFixed(2))
                        : "");
                if (laid.overlaps.length) {
                    status.text = M("Overlapping lines: {0} / 台詞重疊：{0}", laid.overlaps.join(", "));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
            }
        };

        importButton.onClick = function () {
            var script = trim(textInput.text);
            if (!script) {
                alert(M("Paste a script into the text box first. / 請先把劇本貼進上面的文字框。"));
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Import script");
            try {
                var imported = importScript(script, currentSettings(), currentOptions(),
                    currentGapBeats(), currentBpm());
                refreshCharacters(chosenCharacter());
                status.text = M("Imported {0} layer(s) / 已匯入 {0} 層", imported.count) +
                    (imported.split > 0
                        ? M("  +{0} split / 　+{0} 斷句", imported.split) : "") +
                    (imported.held ? M("  held x{0} / 　接到下一句 x{0}", imported.held) : "") +
                    (imported.cast.length
                        ? M("  cast: {0} / 　角色：{0}", imported.cast.join(", ")) : "") +
                    (imported.grew
                        ? M("  comp grown to {0}s / 　合成延長到 {0}s", imported.grew.toFixed(2))
                        : "");
                if (imported.overlaps.length) {
                    status.text = M("Overlapping lines: {0} / 台詞重疊：{0}", imported.overlaps.join(", "));
                }
                if (imported.unmarkedKanji.length) {
                    status.text = M("Kanji read as Chinese: {0} / 漢字以中文讀音唸出：{0}",
                        imported.unmarkedKanji.join(", "));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
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
            var picked = File.openDialog(M("Choose a MIDI file / 選一個 MIDI 檔"),
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
                    status.text = M("No notes in that file / 這個檔案裡沒有音符");
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
                songReadout.text = M("{0} track(s) · {1} BPM / {0} 軌・{1} BPM",
                    usable.length, Math.round(listed.bpm));
                status.text = M(
                    "MIDI loaded: {0} — pick a track, then Sing / 已讀取 {0} —— 選好軌道後按「唱出來」",
                    picked.name);
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            }
        };

        singButton.onClick = function () {
            var lyrics = trim(textInput.text);
            if (!chosenMidi) {
                alert(M("Choose a MIDI file first. / 請先按「選 MIDI」挑一個檔案。"));
                return;
            }
            // An empty text box is a request, not a mistake: with no words the
            // melody sings its own note names.
            var which = trackList.selection ? trackList.selection.index : 0;
            var track = midiTrackInfo[which];
            if (!track) {
                alert(M("Choose a track first. / 請先選一個軌道。"));
                return;
            }
            // A second import used to lay a whole extra copy of the song on top
            // of the first, with no hint that it had.
            var comp = app.project ? app.project.activeItem : null;
            var already = (comp && comp instanceof CompItem) ? songLayers(comp) : [];
            var replacing = false;
            if (already.length) {
                replacing = confirm(M(
                    "There are already {0} layer(s) here from an earlier MIDI import.\n\nRemove them first? No adds a second copy. / 這個合成裡已經有 {0} 層是之前匯入的。\n\n要先移除它們嗎？按「否」就直接再加一份。",
                    already.length));
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Import MIDI");
            try {
                if (replacing) {
                    var gone;
                    for (gone = already.length - 1; gone >= 0; gone -= 1) {
                        removeFromLayer(comp, already[gone]);
                        already[gone].remove();
                    }
                }
                var sungSettings = currentSettings();
                var sung = importSong(chosenMidi, track.index, lyrics, sungSettings,
                    currentOptions(), currentSolfegeKey());
                refreshCharacters(chosenCharacter());
                songReadout.text = M("{0} line(s) · {1} BPM / {0} 句・{1} BPM",
                    sung.count, Math.round(sung.bpm));
                status.text = (lyrics
                    ? M("Sung {0} layer(s) / 已唱出 {0} 層", sung.count)
                    : M("Sung note names on {0} layer(s) / 已唱唱名 {0} 層", sung.count)) +
                    (sung.grew
                        ? M("  comp grown to {0}s / 　合成延長到 {0}s", sung.grew.toFixed(2))
                        : "");
                // Everything that did not line up, said out loud. A lyric that
                // does not fit its melody is the most likely thing to be wrong
                // about an import, and only the user can decide what to do.
                var trouble = [];
                if (sung.extraSyllables) {
                    trouble.push(M(
                        "{0} syllable(s) with no note / {0} 個字沒有音符（用最後一個音唱完）",
                        sung.extraSyllables));
                }
                if (sung.extraNotes) {
                    trouble.push(M("{0} note(s) with no syllable / {0} 個音符沒有字",
                        sung.extraNotes));
                }
                if (sung.dropped) {
                    trouble.push(M("{0} note(s) dropped from chords / 和弦捨去 {0} 個音",
                        sung.dropped));
                }
                if (sung.split) {
                    trouble.push(M("{0} long line(s) split / 太長的句子拆成 {0} 層", sung.split));
                }
                if (sung.truncated.length) {
                    trouble.push(M("truncated: {0} / 被截斷：{0}", sung.truncated.join(", ")));
                }
                if (trouble.length) {
                    status.text = M("Sung {0} line(s) — {1} / 已唱出 {0} 句 —— {1}",
                        sung.count, trouble.join(UI_LANGUAGE === "en" ? ", " : "、"));
                }
                if (sung.unmarkedKanji.length) {
                    status.text = M("Kanji read as Chinese: {0} / 漢字以中文讀音唸出：{0}",
                        sung.unmarkedKanji.join(", "));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
                remember();
            }
        };

        clearMelodyButton.onClick = function () {
            var comp = app.project ? app.project.activeItem : null;
            if (!(comp && comp instanceof CompItem)) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var chosen = selectedTextLayers(comp);
            if (!chosen.length) {
                alert(M("Select the lines to turn back into speech. / 請選取要改回講話的圖層。"));
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Clear melody");
            try {
                var cleared = 0;
                var at;
                for (at = 0; at < chosen.length; at += 1) {
                    if (clearMelody(comp, chosen[at])) { cleared += 1; }
                }
                status.text = cleared
                    ? M("Speaking again: {0} layer(s) / 已改回講話 {0} 層", cleared)
                    : M("None of those were singing / 選取的圖層沒有旋律");
            } catch (error) {
                status.text = M("Error / 錯誤");
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
                alert(M("Select a text layer or enter text first. / 請選取文字圖層或先輸入文字。"));
                return;
            }
            /*
             * Before the undo group, so a refusal leaves no empty step behind.
             * A release build never gets here — the check asks the tool which
             * build this is, and the tool knows because it is compiled in.
             */
            try {
                refuseBeyondTrialLimit(hasSelection ? selectedTextLayers(comp).length : 1);
            } catch (limited) {
                alert(String(limited.message || limited));
                return;
            }
            app.beginUndoGroup(SCRIPT_NAME + " - Apply");
            try {
                var applied = createOrUpdate(
                    text, trim(pronunciationInput.text), currentSettings(), currentOptions());
                refreshCharacters(chosenCharacter());
                status.text = M("Applied to {0} layer(s) / 已套用 {0} 個圖層", applied.count) +
                    (applied.rigs ? M("  rig x{0} / 　控制器 x{0}", applied.rigs) : "") +
                    (applied.stale
                        ? M("  stale bake x{0} / 　轉檔過期 x{0}", applied.stale) : "");
                // Two lines of one character talking at once is nearly always a
                // mistake. The rig is still built — the later line wins — but
                // saying nothing would leave the user hunting for why a mouth
                // stops halfway through a word.
                if (applied.overlaps.length) {
                    status.text = M("Overlapping lines: {0} / 台詞重疊：{0}", applied.overlaps.join(", "));
                }
                if (applied.unmarkedKanji.length) {
                    status.text = M("Kanji read as Chinese: {0} / 漢字以中文讀音唸出：{0}",
                        applied.unmarkedKanji.join(", "));
                }
                if (applied.truncated.length) {
                    status.text = M("Truncated: {0} / 已截斷：{0}",
                        applied.truncated.join(", "));
                    alert(M(
                        "Only the first {0} UTF-16 units are spoken; the rest of the Source Text was cut:\n\n{1} / 只會唸出前 {0} 個 UTF-16 字元，超出的 Source Text 已截斷：\n\n{1}",
                        MAX_TEXT_UNITS, applied.truncated.join("\n")));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(error.toString());
            } finally {
                app.endUndoGroup();
                remember();
            }
        };

        lipSyncButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var chosen = [];
            var index;
            for (index = 0; index < comp.selectedLayers.length; index += 1) {
                var picked = comp.selectedLayers[index];
                if (audioSourceFile(picked) && layerHasAudio(picked)) { chosen.push(picked); }
            }
            if (!chosen.length) {
                alert(M("Select an audio layer. / 請選取音訊圖層。"));
                return;
            }
            // A recording always joins a shared character, because the whole
            // point of it is a face that several lines take turns driving.
            var name = chosenCharacter();
            if (!name) {
                alert(M("Add a character on the Animation page first. / 請先在「動畫」頁新增角色。"));
                return;
            }
            var how = {
                sensitivity: clamp(sensitivity.value, 0, 100) / 100,
                vowels: vowelsOn.value
            };
            app.beginUndoGroup(SCRIPT_NAME + " - Lip-sync from audio");
            try {
                var rigLayer = ensureRigLayer(comp, name);
                var syllables = 0;
                for (index = 0; index < chosen.length; index += 1) {
                    var plan = lipSyncLayer(comp, chosen[index], how, rigLayer);
                    syllables += plan.events.length;
                    if (markers.value) { updateTimingMarkers(chosen[index], plan); }
                }
                var merged = rebuildSharedRig(comp, rigLayer, null);
                rigShared.value = true;
                rigPerLayer.value = false;
                refreshCharacters(name);
                audioReadout.text = M("{0} syllable(s) found / 找到 {0} 個音節", syllables);
                status.text = merged.overlaps.length
                    ? M("Lip-synced {0} layer(s); {1} overlap / 已對嘴 {0} 層；有 {1} 句重疊",
                        chosen.length, merged.overlaps.length)
                    : M("Lip-synced {0} layer(s) onto {1} / 已對嘴 {0} 層到「{1}」",
                        chosen.length, name);
            } catch (error) {
                alert(String(error.message || error));
            } finally {
                app.endUndoGroup();
            }
        };

        /*
         * The provider menu, filled from the tool rather than written here.
         *
         * A second copy of the table in the panel would drift the first time a
         * default model changed at a vendor, and it would drift silently — the
         * menu would still work and still say the right names. It is fetched
         * lazily and inside a try, because the panel has to build even where
         * the tool is not installed: the host suites load this file straight out
         * of the repository.
         */
        function cloudSettingName(providerId, field) {
            return "cloud" + field + "_" + providerId;
        }

        // Per provider, because a voice id belongs to an account rather than to
        // the panel: switching to ElevenLabs and back should not lose the
        // OpenAI voice that was set an hour ago.
        function storedProviderField(providerId, field, fallback) {
            var name = cloudSettingName(providerId, field);
            if (!app.settings.haveSetting(SCRIPT_NAME, name)) { return fallback; }
            var value = trim(String(app.settings.getSetting(SCRIPT_NAME, name)));
            return value ? value : fallback;
        }

        function chosenProvider() {
            if (!providerList.selection) { return null; }
            var at = providerList.selection.index;
            return at >= 0 && at < cloudTable.length ? cloudTable[at] : null;
        }

        function showProviderFields() {
            var picked = chosenProvider();
            if (!picked) { return; }
            cloudVoiceField.text = storedProviderField(picked.id, "Voice", picked.voice);
            cloudModelField.text = storedProviderField(picked.id, "Model", picked.model);
            cloudRegionField.text = storedProviderField(picked.id, "Region", "");
            // Only one provider has a per-region endpoint. A field nobody needs
            // is a field somebody fills in wrongly once.
            cloudRegionField.enabled = picked.needsRegion;
            /*
             * A source that runs here has no account, so the button asks for
             * the other thing a source can need: its voice.
             *
             * 3.0.0 greyed it out instead, which left the one control that
             * configures a source doing nothing on the only sources this
             * product is able to configure. Relabelling rather than adding a
             * button is also the only option the row has — invariant 8z, the
             * panel is at 796 px of 800 and this row measured 471 in Japanese
             * with four controls in it.
             *
             * `preferredSize` back to automatic width afterwards, or the
             * longer label is drawn into the shorter one's box and comes back
             * as an ellipsis.
             */
            keyButton.text = picked.onThisMachine
                ? M("Tuning… / 調音…")
                : M("API key / 金鑰");
            keyButton.preferredSize = [-1, keyButton.preferredSize.height];
            try { keyButton.parent.layout.layout(true); } catch (noKeyLayout) { /* not built */ }
            /*
             * The button says what pressing it will do.
             *
             * Calling it "Cloud voice" while an offline model is selected is
             * not a wording problem: it contradicts the one thing that matters
             * about that model — that nothing leaves the machine — on the
             * control the user is about to press. The panel's own confirmation
             * already asks the table whether a source is local (invariant 8ab);
             * this is the same question asked of the label.
             *
             * `preferredSize` goes back to automatic width afterwards, or the
             * longer of the two labels is drawn into the shorter one's box and
             * After Effects renders the overflow as an ellipsis (invariant 8z).
             */
            cloudButton.text = picked.onThisMachine
                ? M("Offline AI voice / 離線 AI 語音")
                : M("AI voice / AI 語音");
            cloudButton.preferredSize = [-1, cloudButton.preferredSize.height];
            try { cloudButton.parent.layout.layout(true); } catch (noLayout) { /* not built yet */ }
        }

        function rememberProviderFields() {
            var picked = chosenProvider();
            if (!picked) { return; }
            try {
                app.settings.saveSetting(SCRIPT_NAME, cloudSettingName(picked.id, "Voice"),
                    trim(String(cloudVoiceField.text)));
                app.settings.saveSetting(SCRIPT_NAME, cloudSettingName(picked.id, "Model"),
                    trim(String(cloudModelField.text)));
                app.settings.saveSetting(SCRIPT_NAME, cloudSettingName(picked.id, "Region"),
                    trim(String(cloudRegionField.text)));
            } catch (error) { /* read-only preferences */ }
        }

        function refreshProviders(preferred) {
            cloudTable = voiceSources();
            while (providerList.items.length > 0) {
                providerList.remove(providerList.items[providerList.items.length - 1]);
            }
            var index;
            for (index = 0; index < cloudTable.length; index += 1) {
                // A vendor's name is a proper noun and never goes through the
                // translation table.
                providerList.add("item", cloudTable[index].label);
            }
            /*
             * Nothing remembered lands on Azure, not on row zero.
             *
             * This panel is Traditional Chinese first — the whole product is,
             * which is why the Simplified half is *derived* from it — and Azure
             * is the only source in the table whose default voice is actually
             * Taiwan Mandarin (`zh-TW-HsiaoChenNeural`). Leaving the default on
             * whichever vendor happens to be first in the tool's list hands a
             * Taiwanese user a China accent on the very first press.
             *
             * Chosen by id rather than by moving the row, because the remembered
             * choice is stored as an index: reordering the table would silently
             * switch anybody who had already picked one.
             */
            if (cloudTable.length) {
                var wanted = preferred;
                /*
                 * An id or an index, because the two callers know different
                 * things. `restoreState()` remembers a number — that is what
                 * the preference has always held — while a model that has just
                 * been downloaded is known by its id and has just changed the
                 * list it would be an index into. Resolving the id here is what
                 * lets the manager leave the user on the source they came for.
                 */
                if (typeof wanted === "string") {
                    var byId = -1;
                    var named;
                    for (named = 0; named < cloudTable.length; named += 1) {
                        if (cloudTable[named].id === wanted) { byId = named; }
                    }
                    wanted = byId < 0 ? undefined : byId;
                }
                if (wanted === undefined) {
                    /*
                     * Offline first, then Azure, then row zero. Asked of the
                     * table rather than written as a second list of ids:
                     * `offlineSourceId()` returns "" when nothing is installed,
                     * which is most first runs, and the fallback is then the
                     * one 2.5.0 chose for its accent.
                     */
                    wanted = 0;
                    var preferredId = offlineSourceId(cloudTable) || PREFERRED_PROVIDER_ID;
                    var pick;
                    for (pick = 0; pick < cloudTable.length; pick += 1) {
                        if (cloudTable[pick].id === preferredId) { wanted = pick; }
                    }
                }
                providerList.selection = clamp(Math.round(wanted), 0, cloudTable.length - 1);
            }
            showProviderFields();
            return cloudTable.length;
        }

        function requireProviders() {
            if (!cloudTable.length) { refreshProviders(rememberedProvider); }
            var picked = chosenProvider();
            if (!picked) {
                throw new Error(M("Choose a provider first. / 請先選一家供應商。"));
            }
            return picked;
        }

        providerList.onChange = function () { showProviderFields(); };

        keyButton.onClick = function () {
            try {
                var picked = requireProviders();
                /*
                 * The dispatch the label promises, asked of the table rather
                 * than assumed. A model on this machine has no account to hold
                 * a key for, and the dialog it opens instead writes into the
                 * Voice ID field — which is where the tuning has to be, because
                 * that is the field already in the cache key.
                 */
                if (picked.onThisMachine) {
                    /*
                     * The line the audition speaks is the one the user is
                     * looking at — `previewText()` takes the selected layer's
                     * text and falls back to the Speak box, exactly as the
                     * engine's own Preview does. Judging a voice on a sentence
                     * somebody else chose is judging the wrong thing.
                     */
                    var tuned = askForVoiceTuning(picked,
                        trim(String(cloudVoiceField.text)), previewText());
                    if (!tuned) { return; }
                    cloudVoiceField.text = tuned.voice;
                    rememberProviderFields();
                    cloudReadout.text = M("Voice tuned / 已調過音");
                    return;
                }
                var answer = askForCloudKey(picked, storedKey(picked.id), {
                    voice: String(cloudVoiceField.text),
                    model: String(cloudModelField.text),
                    region: String(cloudRegionField.text)
                });
                if (!answer) { return; }
                // Back into the state the speak path reads, then persisted per
                // provider — the fields used to save themselves on every
                // keystroke and now save once, on Save, which is the moment
                // that actually means something.
                cloudVoiceField.text = answer.voice;
                cloudModelField.text = answer.model;
                cloudRegionField.text = answer.region;
                rememberProviderFields();
                rememberKey(picked.id, answer.key);
                cloudReadout.text = answer.key
                    ? M("Key saved / 已存下金鑰")
                    : M("Key cleared / 已清除金鑰");
            } catch (error) {
                alert(String(error.message || error));
            }
        };

        /*
         * The only download this product ever makes, and it says so first.
         *
         * 177 MB is a decision, not a click, so the size and the destination
         * are both stated. It is resumable in the only sense that matters:
         * every file that is already there at the right length is skipped, so
         * pressing this again after a failure costs only what is missing.
         */
        /*
         * The offline models, as a place rather than as a button.
         *
         * 3.2.0 had a "Get model" button that fetched whichever offline row was
         * selected in the voice-source menu — and that menu only lists models
         * that are *already installed*, on purpose, so that nothing in it fails
         * when pressed. Which meant the first press anybody ever made answered
         * "choose an offline model in the menu first" and there was nothing to
         * choose. A dead end, and one nobody could get out of.
         *
         * So the button opens a window that lists every model the tool knows
         * about, installed or not, with its size, what it sounds like, and one
         * action each. The menu is unchanged: it still offers only what runs
         * today. The catalogue and the menu are two different questions and
         * they now have two different answers.
         */
        function showOfflineModels() {
            var local = toolFile(LOCAL_TOOL_NAME);
            if (!local) {
                alert(M("{0} is missing. Reinstall Island Chatter. / 找不到 {0}，請重新安裝 Island Chatter。",
                    LOCAL_TOOL_NAME));
                return;
            }
            var catalogue;
            try {
                catalogue = parseVoiceReply(
                    system.callSystem(quoted(local.fsName) + " --models")).models;
            } catch (error) {
                alert(String(error.message || error));
                return;
            }
            if (!catalogue.length) {
                alert(M("This build knows about no offline models. / 這個版本沒有任何離線模型。"));
                return;
            }

            /*
             * Wider than it was, which is half of why it was too small.
             *
             * The other half was the wrapped paragraphs claiming two lines and
             * needing three; `addWrapped()` fixes that. Width helps as well
             * though, and in the same direction for every language: a wider
             * paragraph is fewer lines, so the window gets shorter as it gets
             * wider. This is a modal, so it is not bound by the 460 px a docked
             * panel has to live inside (invariant 8z).
             */
            var dialog = new Window("dialog", M("Offline models / 離線模型"));
            dialog.orientation = "column";
            dialog.alignChildren = "fill";
            dialog.margins = 16;
            dialog.spacing = 10;

            var rows = [];
            var index;
            for (index = 0; index < catalogue.length; index += 1) {
                rows.push(addModelRow(dialog, catalogue[index], local));
            }

            addWrapped(dialog, M(
                "Models live in your own user folder, so removing Island Chatter leaves them alone. After Effects stops responding while one downloads. / 模型放在你自己的使用者資料夾，所以移除 Island Chatter 不會動到它們。下載時 After Effects 會沒有反應。"),
                MODEL_WINDOW_WIDTH);

            var closeRow = dialog.add("group");
            closeRow.alignment = "right";
            var closeButton = closeRow.add("button", undefined, M("Close / 關閉"),
                { name: "ok" });
            closeButton.onClick = function () { dialog.close(); };
            dialog.show();
        }

        /*
         * One model, and everything a person needs to decide about it.
         *
         * The size and the state come from the tool; the sentence about what it
         * sounds like comes from `IC_SOURCE_NOTES`, because it has to be
         * translated and a string the tool sent could not be (invariant 8i).
         * A model this panel has no note for still appears and still downloads:
         * an unknown row must not be unusable because a table was not updated.
         */
        function addModelRow(dialog, model, tool) {
            var box = dialog.add("panel", undefined, model.label);
            box.orientation = "column";
            box.alignChildren = "fill";
            box.margins = 12;
            box.spacing = 6;

            var note = IC_SOURCE_NOTES[model.id];
            if (note && note.caveat) {
                // The accent caveat is the longest sentence in this window and
                // it is three lines in Chinese, four in English and Japanese.
                // It was given two.
                addWrapped(box, M(note.caveat), MODEL_WINDOW_WIDTH - 40);
            }

            var row = box.add("group");
            row.orientation = "row";
            var state = row.add("statictext", undefined, "", { truncate: "end" });
            state.preferredSize.width = 250;
            var action = row.add("button", undefined, M("Download / 下載"));
            action.preferredSize.width = 110;

            function refreshRow(installed, megabytes) {
                state.text = installed
                    ? M("Installed · {0} MB / 已安裝 · {0} MB", Math.round(megabytes))
                    : M("Not downloaded · {0} MB / 尚未下載 · {0} MB", Math.round(megabytes));
                action.text = installed ? M("Remove / 移除") : M("Download / 下載");
                // Invariant 8z: a control keeps the width it was measured at,
                // so a label written afterwards is drawn into the old box and
                // After Effects renders the overflow as an ellipsis. Both of
                // these change at run time, so both are re-measured.
                state.preferredSize = [250, state.preferredSize.height];
                action.preferredSize = [110, action.preferredSize.height];
                dialog.layout.layout(true);
            }
            refreshRow(model.installed, model.bytes / 1048576);

            action.onClick = function () {
                var megabytes = Math.round(model.bytes / 1048576);
                if (model.installed) {
                    if (!confirm(M(
                            "Remove {0}?\n\nIt frees about {1} MB. You can download it again at any time. / 要移除{0}嗎？\n\n會空出大約 {1} MB。之後隨時可以再下載一次。",
                            model.label, megabytes))) {
                        return;
                    }
                    try {
                        parseVoiceReply(system.callSystem(
                            quoted(tool.fsName) + " --remove --provider " + model.id));
                        model.installed = false;
                        refreshRow(false, megabytes);
                        refreshProviders(rememberedProvider);
                        status.text = M("Removed {0} / 已移除 {0}", model.label);
                    } catch (error) {
                        alert(String(error.message || error));
                    }
                    return;
                }
                if (!confirm(M(
                        "Download {0}?\n\nAbout {1} MB, once. After that this voice needs no network and no account — it runs on this computer.\n\nAfter Effects will not respond while it downloads. / 要下載{0}嗎？\n\n大約 {1} MB，只下載這一次。之後這個語音不用連網、不用帳號，完全在這台電腦上算。\n\n下載時 After Effects 會沒有反應。",
                        model.label, megabytes))) {
                    return;
                }
                cloudReadout.text = M("Downloading… / 下載中…");
                try {
                    var answer = parseVoiceReply(system.callSystem(
                        quoted(tool.fsName) + " --install --provider " + model.id));
                    model.installed = true;
                    refreshRow(true, answer.bytes / 1048576);
                    // Asked again rather than assumed: the tool decides whether
                    // a model counts as installed, and it checks every size.
                    // Then the new source is *selected*, so the next thing the
                    // user presses is the one they came here for.
                    refreshProviders(model.id);
                    cloudReadout.text = M("Model ready / 模型已就緒");
                    status.text = M("Offline model installed ({0} MB) / 離線模型已安裝（{0} MB）",
                        Math.round(answer.bytes / 1048576));
                } catch (error) {
                    cloudReadout.text = M("Download failed / 下載失敗");
                    alert(String(error.message || error));
                }
            };
            return box;
        }

        modelButton.onClick = showOfflineModels;

        cloudButton.onClick = function () {
            var comp = activeComp();
            if (!comp) {
                alert(M("Open an active composition first. / 請先開啟合成。"));
                return;
            }
            var layers = selectedTextLayers(comp);
            if (!layers.length) {
                alert(M("Select a text layer. / 請選取文字圖層。"));
                return;
            }
            var picked;
            try { picked = requireProviders(); }
            catch (missing) { alert(String(missing.message || missing)); return; }
            // Asked of the source, not assumed of all of them: a model running
            // on this machine has no account behind it.
            var key = picked.onThisMachine ? "" : storedKey(picked.id);
            if (!picked.onThisMachine && !key) {
                alert(M("Set the API key for {0} first. / 請先設定 {0} 的 API 金鑰。", picked.label));
                return;
            }
            if (picked.needsRegion && !trim(String(cloudRegionField.text))) {
                alert(M("{0} needs the region its resource is in. / {0} 需要填寫資源所在的區域。",
                    picked.label));
                return;
            }
            /*
             * Everything that will be sent is worked out before anything is.
             *
             * A batch that fails halfway through has already been paid for, so
             * the refusals — an empty line, a line longer than any dialogue
             * ever is — all happen up here where they cost nothing.
             */
            var ready = [];
            var characters = 0;
            var index;
            for (index = 0; index < layers.length; index += 1) {
                var line = trim(textFromLayer(layers[index]));
                if (!line) { continue; }
                if (line.length > MAX_CLOUD_CHARACTERS) {
                    alert(M("{0} is longer than {1} characters. Split it first. / {0} 超過 {1} 個字，請先拆成幾句。",
                        layers[index].name, MAX_CLOUD_CHARACTERS));
                    return;
                }
                ready.push({ layer: layers[index], text: line });
                characters += line.length;
            }
            if (!ready.length) {
                alert(M("The selected layer(s) have no text in them. / 選取的圖層裡沒有文字。"));
                return;
            }
            /*
             * The two honest sentences, before the money is spent.
             *
             * Nothing here happens without this press. The text leaving the
             * machine is said out loud because it is true and because nobody
             * should find it out afterwards, and the count is said because a
             * batch of twenty lines is a bill rather than a click.
             */
            /*
             * A source that runs here gets a different sentence, because the
             * one below would be a lie about it.
             *
             * "The text leaves this computer" is the whole reason this
             * confirmation exists, and repeating it for a local model would
             * train people to click through the one warning that matters.
             */
            var agreed = picked.onThisMachine
                ? confirm(M(
                    "Speak {0} line(s), {1} characters, with {2}?\n\nThis runs on your own computer: nothing is sent anywhere and nothing is billed. / 要用 {2} 唸出 {0} 句、共 {1} 個字嗎？\n\n這是在你自己的電腦上算的，不會送出任何東西，也不會產生費用。",
                    ready.length, characters, picked.label))
                : confirm(M(
                    "Send {0} line(s), {1} characters, to {2}?\n\nThe text leaves this computer. Lines already fetched with the same settings are reused and cost nothing. / 要把 {0} 句、共 {1} 個字送到 {2} 嗎？\n\n文字會離開這台電腦。文字和設定都沒變的句子會直接沿用上次的檔案，不會再花錢。",
                    ready.length, characters, picked.label + " · " + picked.host));
            if (!agreed) { return; }
            app.beginUndoGroup(SCRIPT_NAME + " - AI voice");
            try {
                rememberProviderFields();
                var options = currentOptions();
                var how = {
                    provider: picked.id,
                    // Which tool serves this source, and whether it runs here.
                    // Everything below is the same for all four.
                    tool: picked.tool,
                    onThisMachine: picked.onThisMachine,
                    voice: trim(String(cloudVoiceField.text)),
                    model: trim(String(cloudModelField.text)),
                    region: trim(String(cloudRegionField.text)),
                    key: key,
                    sensitivity: clamp(sensitivity.value, 0, 100) / 100,
                    vowels: vowelsOn.value
                };
                var reused = 0;
                var touched = [];
                var planned = [];
                var unspoken = "";
                for (index = 0; index < ready.length; index += 1) {
                    how.text = ready[index].text;
                    var voiced = cloudVoiceLine(comp, ready[index].layer, how, options);
                    if (voiced.cached) { reused += 1; }
                    if (voiced.unspoken) { unspoken += voiced.unspoken; }
                    planned.push({ layer: ready[index].layer, plan: voiced.plan });
                    var bound = rigTargetLayer(comp, ready[index].layer);
                    if (bound) { touched.push(bound); }
                }
                // Once per rig at the end, not once per line: twenty lines on
                // one face would otherwise rebuild it twenty times.
                touched = uniqueLayers(touched);
                for (index = 0; index < touched.length; index += 1) {
                    rebuildSharedRig(comp, touched[index], planned);
                }
                cloudReadout.text = M("{0} new, {1} reused / 新增 {0}、沿用 {1}",
                    ready.length - reused, reused);
                status.text = M("AI voice on {0} layer(s) via {1} / 已用 {1} 為 {0} 層配音",
                    ready.length, picked.label);
                /*
                 * Said after the work rather than instead of it.
                 *
                 * The lines are voiced and the mouths move; what this reports is
                 * that some characters had no sound in this model, which is one
                 * alert at the end rather than one per line. The audio is right
                 * about what it contains — the analyser read the file, not the
                 * script — so this is the only place the difference can be seen.
                 */
                if (unspoken) {
                    alert(M("This voice has no sound for these characters, so they were left out: {0} / 這個語音沒有這些字的發音，所以沒有唸出來：{0}",
                        unspoken));
                }
            } catch (error) {
                status.text = M("Error / 錯誤");
                alert(String(error.message || error));
            } finally {
                app.endUndoGroup();
            }
        };

        // Every control that decides what Apply does. onChange fires when a
        // slider is released, not while it is dragged, so this is one write per
        // adjustment rather than one per pixel.
        var remembered = [voice, emotion, characterSize, source, perBeat, pitch, speed,
            volume, consonant, clarity, cuteness, formant, vibrato, vibratoRate, seed,
            markers, fitDuration, controllers, typeOn, typeOnCenter, rigPerLayer,
            rigShared, easeLeave, smoothness, speakersOn, holdOn, chatterOn,
            sensitivity, vowelsOn];
        var rememberAt;
        for (rememberAt = 0; rememberAt < remembered.length; rememberAt += 1) {
            alsoRemember(remembered[rememberAt], "onChange");
        }
        // The rig builders read this rather than being handed it through eight
        // call sites, so the checkbox keeps it in step.
        chatterOn.onClick = (function (existing) {
            return function () {
                mouthChatter = chatterOn.value;
                if (existing) { existing.call(this); }
            };
        }(chatterOn.onClick));
        alsoRemember(chatterOn, "onClick");
        alsoRemember(tempoOn, "onClick");
        // Which page you were last on is worth keeping: without it every reopen
        // lands on Speak and the timbre you were in the middle of is a click away.
        alsoRemember(tabs, "onChange");
        alsoRemember(bpmField, "onChange");
        alsoRemember(gapField, "onChange");
        alsoRemember(transposeField, "onChange");
        alsoRemember(toneBlendField, "onChange");
        alsoRemember(solfegeKey, "onChange");
        alsoRemember(providerList, "onChange");
        /*
         * The voice id, model and region used to be typed into the page, so
         * each carried an onChange that saved it. They are edited in the key
         * dialog now and that dialog calls `rememberProviderFields()` itself on
         * Save, which is a better moment than every keystroke: a half-typed
         * model name is not worth storing against a provider.
         */
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
            /*
             * A language that is built but no longer offered falls back rather
             * than being honoured, or the picker shows nothing while the panel
             * speaks something no row names. `HIDDEN_LANGUAGE_CODES` is what
             * makes that a decision instead of the loop above quietly not
             * matching.
             */
            var hiddenIndex;
            for (hiddenIndex = 0; hiddenIndex < HIDDEN_LANGUAGE_CODES.length; hiddenIndex += 1) {
                if (HIDDEN_LANGUAGE_CODES[hiddenIndex] === stored) { UI_LANGUAGE = "zh"; }
            }
        }
        var pickerIndex;
        for (pickerIndex = 0; pickerIndex < languageCodes.length; pickerIndex += 1) {
            if (languageCodes[pickerIndex] === UI_LANGUAGE) {
                languagePicker.selection = pickerIndex;
            }
        }
        localiseTree(panel);
        relabelTips();
        // After the language pass, because the list holds the user's own
        // character names and must not go through it.
        refreshCharacters("");
        // Last, so it overrides the defaults every control was built with
        // rather than being overwritten by them.
        restoreState();
        /*
         * A trial says so, once, where the panel says everything else.
         *
         * After restoreState() so nothing overwrites it, and in the status line
         * rather than an alert: an alert on every Apply is a product people
         * uninstall, and a line that never appears is a synthesizer people
         * think is broken.
         */
        if (buildIsTrial()) {
            status.text = M("Trial: a mark every {0} seconds, {1} layers at a time / 試用版：每 {0} 秒一段標記聲，一次最多 {1} 層",
                TRIAL_MARK_SECONDS, TRIAL_MAX_LAYERS);
        }
        /*
         * The version, beside the language picker.
         *
         * Read from the tool rather than written here — see buildInfo(). It is
         * set after the language pass on purpose: this is a number and a build
         * kind, not a sentence, so `localiseTree()` must not try to translate
         * it, and setting it afterwards keeps it out of that pass entirely.
         */
        var shown = buildInfo();
        if (shown.version) {
            versionLabel.text = shown.version + (shown.trial
                ? " " + M("Trial / 試用版") : "");
            versionLabel.preferredSize = [-1, versionLabel.preferredSize.height];
        }
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

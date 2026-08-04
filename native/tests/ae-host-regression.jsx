#target aftereffects

/*
 * Island Chatter After Effects host regression suite.
 *
 * Loads the real panel source, evaluates its body so the actual shipped
 * functions are exercised (not a reimplementation), then drives applyToTextLayer
 * through the cases that cannot be covered by the portable tests: effect-stack
 * ordering, Property handle invalidation across repeat Apply, keyframed rig
 * sliders, a Tone the user owns, unrelated layer types, and batch apply.
 *
 * Destructive only within its own temporary composition, which is removed
 * again. Nothing is saved and After Effects is not quit.
 */
(function () {
    var root = new File($.fileName).parent.parent.parent.fsName.replace(/\\/g, "/");
    var out = new File(root + "/ae-host-regression-result.txt");
    var lines = [];
    var failures = 0;
    var checks = 0;

    // Flush after every line: if a case ever hangs or takes After Effects down,
    // the report still shows exactly how far the suite got.
    function log(text) {
        lines.push(String(text));
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
    }
    function check(condition, label) {
        checks += 1;
        if (condition) { log("PASS  " + label); }
        else { failures += 1; log("FAIL  " + label); }
        return condition;
    }
    function attempt(label, body) {
        try { body(); log("PASS  " + label); checks += 1; return true; }
        catch (err) {
            checks += 1; failures += 1;
            log("FAIL  " + label + " -> " + err.toString() +
                (err.line ? " (line " + err.line + ")" : ""));
            return false;
        }
    }

    var comp = null;
    try {
        // Evaluate the panel body so every real function and constant is in
        // scope here. The trailing buildUI() call is dropped so no UI opens.
        var panelFile = new File(root + "/native/panel/IslandChatterNativePanel.jsx");
        panelFile.encoding = "UTF-8";
        panelFile.open("r");
        var source = panelFile.read();
        panelFile.close();

        var readingsFile = new File(root + "/native/panel/IslandChatterMandarinReadings.jsxinc");
        readingsFile.encoding = "UTF-8";
        readingsFile.open("r");
        var readingsSource = readingsFile.read();
        readingsFile.close();
        eval(readingsSource);

        var bodyStart = source.indexOf("{", source.indexOf("function islandChatterNativePanel("));
        var bodyEnd = source.indexOf("var panel = buildUI(thisObj);");
        if (bodyStart < 0 || bodyEnd < 0) { throw new Error("panel layout changed; cannot load body"); }
        eval(source.substring(bodyStart + 1, bodyEnd));
        log("loaded the real panel body from native/panel/IslandChatterNativePanel.jsx");
        log("");

        var settings = {
            voice: 1, pitch: 1.0, speed: 1.0, volume: 0.78, consonant: 1.25,
            emotion: 5, characterSize: 0, clarity: 0.78, cuteness: 0.55, seed: 4242
        };
        var options = { markers: true, fitDuration: true, controllers: true, typeOn: true,
            typeOnCenter: true };
        var TEXT = "你好，島民！今天天氣真好。";

        app.beginUndoGroup("Island Chatter host regression");
        comp = app.project.items.addComp("IC Host Regression", 640, 360, 1, 30, 30);
        // createOrUpdate() resolves the target through app.project.activeItem,
        // exactly as it does when a user is looking at a composition.
        comp.openInViewer();
        var layer = comp.layers.addText(TEXT);
        layer.name = "IC Regression Text";

        // --- 1. first apply -------------------------------------------------
        attempt("first apply", function () {
            applyToTextLayer(comp, layer, "", settings, options);
        });

        var effects = layer.property("ADBE Effect Parade");
        log("  effect stack: " + (function () {
            var names = [];
            for (var i = 1; i <= effects.numProperties; i += 1) {
                names.push(i + "=" + effects.property(i).name +
                    "[" + effects.property(i).matchName + "]");
            }
            return names.join(", ");
        }()));

        // "native" is a future reserved word in ExtendScript's ES3 dialect.
        var tone = null, chatter = null;
        for (var i = 1; i <= effects.numProperties; i += 1) {
            if (effects.property(i).matchName === "ADBE Aud Tone" &&
                effects.property(i).name === "Island Chatter Audio Bootstrap") { tone = effects.property(i); }
            if (effects.property(i).matchName === "Island Chatter Native") { chatter = effects.property(i); }
        }
        check(tone !== null, "Tone bootstrap exists");
        check(chatter !== null, "native effect exists");
        if (tone && chatter) {
            check(tone.propertyIndex < chatter.propertyIndex, "Tone sits before the native effect");
            check(tone.propertyIndex === chatter.propertyIndex - 1, "Tone is immediately before it");
            check(tone.property(6).value === 0, "Tone level is zero");
            check(chatter.numProperties === 77, "native effect exposes 77 parameters, got " + chatter.numProperties);
            check(Math.round(chatter.property(6).value) === TEXT.length,
                "text length parameter is " + TEXT.length + ", got " + Math.round(chatter.property(6).value));
            var textOk = true;
            for (var u = 0; u < TEXT.length; u += 1) {
                if (Math.round(chatter.property(7 + u).value) !== TEXT.charCodeAt(u)) { textOk = false; }
            }
            check(textOk, "all UTF-16 code units round-tripped into the hidden parameters");
            check(Math.abs(chatter.property(2).value - 1.0) < 0.001, "pitch parameter written");
            check(Math.round(chatter.property(71).value) === settings.emotion + 1, "emotion parameter written");
            check(Math.round(chatter.property(72).value) === settings.characterSize + 1, "character size written");
            check(Math.round(chatter.property(75).value) === settings.seed, "seed parameter written");
        }

        // Fit Duration must match the plan built from the same effective speed.
        var plan = estimateSpeech(TEXT, effectiveSpeed(settings));
        check(Math.abs((layer.outPoint - layer.inPoint) - plan.duration) < 0.05,
            "Fit Duration matches the planned length (" + plan.duration.toFixed(3) + "s, layer " +
            (layer.outPoint - layer.inPoint).toFixed(3) + "s)");

        var markers = layer.property("ADBE Marker");
        check(markers.numKeys === plan.events.length,
            "marker count matches syllable count (" + markers.numKeys + " vs " + plan.events.length + ")");

        var rigNames = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce", "IC Blink"];
        var rigOk = true;
        for (var r = 0; r < rigNames.length; r += 1) {
            var slider = findNamedEffect(layer, rigNames[r]);
            if (!slider || slider.property(1).numKeys === 0) { rigOk = false; }
        }
        check(rigOk, "all five rig sliders exist and are keyframed");

        // --- 2. repeat apply ------------------------------------------------
        attempt("repeat apply (Property handle invalidation)", function () {
            applyToTextLayer(comp, layer, "", settings, options);
        });
        attempt("third apply", function () {
            applyToTextLayer(comp, layer, "", settings, options);
        });
        effects = layer.property("ADBE Effect Parade");
        var toneCount = 0, nativeCount = 0;
        for (var j = 1; j <= effects.numProperties; j += 1) {
            if (effects.property(j).matchName === "ADBE Aud Tone") { toneCount += 1; }
            if (effects.property(j).matchName === "Island Chatter Native") { nativeCount += 1; }
        }
        check(toneCount === 1, "repeat apply did not duplicate the Tone (" + toneCount + ")");
        check(nativeCount === 1, "repeat apply did not duplicate the native effect (" + nativeCount + ")");
        check(markers.numKeys === plan.events.length,
            "repeat apply did not accumulate markers (" + markers.numKeys + ")");

        // --- 3. repeat apply with keyframed rig sliders ---------------------
        var mouth = findNamedEffect(layer, "IC Mouth").property(1);
        check(mouth.numKeys > 0, "rig slider carries keyframes before the next apply");
        attempt("apply again with keyframed rig sliders (the 1.0.1 case)", function () {
            applyToTextLayer(comp, layer, "", settings, options);
        });

        // --- 4. a Tone the user owns must not be hijacked -------------------
        var ownLayer = comp.layers.addText("測試");
        ownLayer.name = "User Tone Layer";
        var userTone = ownLayer.property("ADBE Effect Parade").addProperty("ADBE Aud Tone");
        userTone.name = "My Own Tone";
        userTone.property(6).setValueAtTime(0, 42);
        userTone.property(6).setValueAtTime(1, 7);
        var userKeys = userTone.property(6).numKeys;
        attempt("apply to a layer that already has the user's own Tone", function () {
            applyToTextLayer(comp, ownLayer, "", settings, options);
        });
        var ownEffects = ownLayer.property("ADBE Effect Parade");
        var stillMine = null, bootstrap = null, toneTotal = 0;
        for (var k = 1; k <= ownEffects.numProperties; k += 1) {
            if (ownEffects.property(k).matchName === "ADBE Aud Tone") {
                toneTotal += 1;
                if (ownEffects.property(k).name === "My Own Tone") { stillMine = ownEffects.property(k); }
                if (ownEffects.property(k).name === "Island Chatter Audio Bootstrap") { bootstrap = ownEffects.property(k); }
            }
        }
        check(stillMine !== null, "the user's Tone still exists under its own name");
        check(bootstrap !== null, "a separate bootstrap Tone was created");
        check(toneTotal === 2, "there are exactly two Tone effects (" + toneTotal + ")");
        if (stillMine) {
            check(stillMine.property(6).numKeys === userKeys,
                "the user's Tone kept its " + userKeys + " level keyframes, has " +
                stillMine.property(6).numKeys);
            check(stillMine.property(6).valueAtTime(0, false) === 42,
                "the user's Tone level was not zeroed");
        }

        // --- 5. unrelated layer types in the comp ---------------------------
        comp.layers.addCamera("Regression Camera", [320, 180]);
        comp.layers.addLight("Regression Light", [320, 180]);
        comp.layers.addSolid([1, 0, 0], "Regression Solid", 100, 100, 1);
        var afterExtras = comp.layers.addText("再測一次");
        attempt("apply with a camera, a light and a solid in the composition", function () {
            applyToTextLayer(comp, afterExtras, "", settings, options);
        });

        // --- 6. batch apply via the real entry point ------------------------
        var batchA = comp.layers.addText("第一層");
        var batchB = comp.layers.addText("第二層");
        for (var d = 1; d <= comp.numLayers; d += 1) { comp.layer(d).selected = false; }
        batchA.selected = true;
        batchB.selected = true;
        attempt("batch apply to two selected text layers", function () {
            var result = createOrUpdate("", "", settings, options);
            if (result.count !== 2) { throw new Error("expected 2 layers, applied to " + result.count); }
        });
        var batchOk = true;
        if (!findNativeEffect(batchA) || !findNativeEffect(batchB)) { batchOk = false; }
        check(batchOk, "both batched layers received the native effect");

        // --- 7. truncation reporting ----------------------------------------
        var longLayer = comp.layers.addText(new Array(80).join("島"));
        var truncated = "";
        attempt("apply to a layer longer than 64 UTF-16 units", function () {
            truncated = applyToTextLayer(comp, longLayer, "", settings, options);
        });
        check(truncated !== "", "over-long Source Text is reported as truncated");

        // --- 8. remove everything the panel added ----------------------------
        var cleanup = comp.layers.addText("清除測試");
        attempt("apply before removing", function () {
            applyToTextLayer(comp, cleanup, "", settings, options);
        });
        var beforeRemove = cleanup.property("ADBE Effect Parade").numProperties;
        check(beforeRemove >= 7, "the layer carries the full rig before removal (" + beforeRemove + ")");
        attempt("remove from layer", function () { removeFromLayer(cleanup); });
        check(cleanup.property("ADBE Effect Parade").numProperties === 0,
            "every effect was removed, " + cleanup.property("ADBE Effect Parade").numProperties + " left");
        check(cleanup.property("ADBE Marker").numKeys === 0, "IC: markers were removed");
        check(cleanup.property("ADBE Text Properties").property("ADBE Text Animators").numProperties === 0,
            "the Type-On animator was removed");
        check(cleanup.property("ADBE Text Properties")
            .property("ADBE Text Document").value.text === "清除測試",
            "Source Text survived the removal");
        attempt("remove again on an already clean layer", function () { removeFromLayer(cleanup); });

        // Removal must leave effects the user owns alone.
        var mixed = comp.layers.addText("混合測試");
        var userBlur = mixed.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        userBlur.name = "My Blur";
        attempt("apply to a layer that has a user effect", function () {
            applyToTextLayer(comp, mixed, "", settings, options);
        });
        attempt("remove from that layer", function () { removeFromLayer(mixed); });
        var survivors = mixed.property("ADBE Effect Parade");
        check(survivors.numProperties === 1 && survivors.property(1).name === "My Blur",
            "the user's own effect survived removal");

        // --- 9. tempo mode -----------------------------------------------------
        check(Math.abs(speedForTempo(120, 2, 0, 2) - 0.8) < 1e-9,
            "speedForTempo(120, 2, neutral, adult) should be 0.8, got " + speedForTempo(120, 2, 0, 2));
        check(Math.abs(speedForTempo(60, 1, 0, 2) - 0.2) < 1e-9,
            "speedForTempo(60, 1, neutral, adult) should be 0.2, got " + speedForTempo(60, 1, 0, 2));
        // The engine scales Speed again per emotion and size, so the tempo has to
        // divide that out or the beat drifts with the character.
        var tempoOk = true;
        var emotionAt;
        var sizeAt;
        for (emotionAt = 0; emotionAt < 7; emotionAt += 1) {
            for (sizeAt = 0; sizeAt < 4; sizeAt += 1) {
                var derived = speedForTempo(120, 2, emotionAt, sizeAt);
                var actual = 0.2 / effectiveSpeed(
                    { speed: derived, emotion: emotionAt, characterSize: sizeAt });
                if (Math.abs(actual - 0.25) > 0.00025) { tempoOk = false; }
            }
        }
        check(tempoOk, "120 BPM at 2/beat stays on the grid for every emotion and size");
        var tempoLayer = comp.layers.addText("節拍測試一二三四");
        var tempoSettings = {
            voice: 0, pitch: 1, speed: speedForTempo(120, 2), volume: 0.78, consonant: 1.25,
            emotion: 0, characterSize: 2, clarity: 0.78, cuteness: 0.55, seed: 7, tempoLock: true
        };
        attempt("apply with tempo lock", function () {
            applyToTextLayer(comp, tempoLayer, "", tempoSettings, options);
        });
        var tempoEffect = findNativeEffect(tempoLayer);
        check(tempoEffect && Math.round(tempoEffect.property(PARAM_TEMPO_LOCK).value) === 1,
            "the Tempo Lock parameter was written");
        var tempoMarkers = tempoLayer.property("ADBE Marker");
        var onGrid = true;
        var slot = 60.0 / 120.0 / 2.0;
        for (var m = 1; m <= tempoMarkers.numKeys; m += 1) {
            var at = tempoMarkers.keyTime(m) - tempoLayer.inPoint;
            if (Math.abs(at / slot - Math.round(at / slot)) > 0.02) { onGrid = false; }
        }
        check(onGrid, "every marker landed on the tempo grid");

        // --- 10. reading a layer's settings back -------------------------------
        var readLayer = comp.layers.addText("讀取測試");
        var stored = {
            voice: 5, pitch: 1.37, speed: 0.63, volume: 1.42, consonant: 2.11,
            emotion: 3, characterSize: 1, clarity: 0.41, cuteness: 0.87, seed: 31337,
            tempoLock: true
        };
        attempt("apply a distinctive set of settings", function () {
            applyToTextLayer(comp, readLayer, "", stored, options);
        });
        var readEffect = findNativeEffect(readLayer);
        var readBack = readEffect ? settingsFromEffect(readEffect) : null;
        check(readBack !== null, "settings can be read back off the layer");
        if (readBack) {
            var fields = ["voice", "emotion", "characterSize", "seed"];
            var exact = true;
            var f;
            for (f = 0; f < fields.length; f += 1) {
                if (readBack[fields[f]] !== stored[fields[f]]) {
                    exact = false;
                    log("    " + fields[f] + ": read " + readBack[fields[f]] +
                        ", stored " + stored[fields[f]]);
                }
            }
            check(exact, "voice, emotion, size and seed round-trip exactly");
            var floats = ["pitch", "speed", "volume", "consonant", "clarity", "cuteness"];
            var close = true;
            for (f = 0; f < floats.length; f += 1) {
                if (Math.abs(readBack[floats[f]] - stored[floats[f]]) > 0.005) {
                    close = false;
                    log("    " + floats[f] + ": read " + readBack[floats[f]] +
                        ", stored " + stored[floats[f]]);
                }
            }
            check(close, "the continuous controls round-trip within slider precision");
            check(readBack.tempoLock === true, "tempo lock round-trips");
            // A tempo-locked layer stores only Speed; the BPM has to come back out.
            var impliedBpm = tempoForSpeed(readBack.speed, 2, readBack.emotion, readBack.characterSize);
            var reDerived = speedForTempo(impliedBpm, 2, readBack.emotion, readBack.characterSize);
            check(Math.abs(reDerived - readBack.speed) < 1e-9,
                "Speed -> BPM -> Speed round-trips (" + impliedBpm.toFixed(2) + " BPM)");
        }

        log("");
        log("checks: " + checks + "   failures: " + failures);
        log(failures === 0 ? "RESULT: PASS" : "RESULT: FAIL");
    } catch (fatal) {
        failures += 1;
        log("FATAL: " + fatal.toString() + (fatal.line ? " (line " + fatal.line + ")" : ""));
        log("RESULT: FAIL");
    } finally {
        try { if (comp) { comp.remove(); } } catch (cleanup) { log("cleanup failed: " + cleanup.toString()); }
        try { app.endUndoGroup(); } catch (undoErr) {}
        log("done");
    }
}());

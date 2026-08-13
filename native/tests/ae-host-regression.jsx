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

        var bodyStart = source.indexOf("{", source.indexOf("function islandChatterNativePanel("));
        var bodyEnd = source.indexOf("var panel = buildUI(thisObj);");
        if (bodyStart < 0 || bodyEnd < 0) { throw new Error("panel layout changed; cannot load body"); }
        eval(source.substring(bodyStart + 1, bodyEnd));
        log("loaded the real panel body from native/panel/IslandChatterNativePanel.jsx");
        log("");

        var settings = {
            voice: 1, pitch: 1.0, speed: 1.0, volume: 0.78, consonant: 1.25,
            emotion: 5, characterSize: 0, clarity: 0.78, cuteness: 0.55, seed: 4242,
            // Complete, because a shared rig stores the whole voice on its layer
            // and a missing field would be written to the project as NaN.
            tempoLock: false, formant: 1.0, source: 0, vibrato: 1.0, vibratoRate: 9.2
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
            check(chatter.numProperties === 279, "native effect exposes 279 parameters, got " + chatter.numProperties);
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

        // Fit Duration must match the engine's plan. Asking for it here also
        // proves the panel can find and run island_chatter_bake from inside
        // After Effects, which is how every timing now reaches the layer.
        var plan = planFromEngine(chatter);
        check(plan.events.length > 0, "the engine returned a timing plan");
        check(Math.abs((layer.outPoint - layer.inPoint) - plan.duration) < 0.05,
            "Fit Duration matches the planned length (" + plan.duration.toFixed(3) + "s, layer " +
            (layer.outPoint - layer.inPoint).toFixed(3) + "s)");

        var markers = layer.property("ADBE Marker");
        check(markers.numKeys === plan.events.length,
            "marker count matches syllable count (" + markers.numKeys + " vs " + plan.events.length + ")");

        var rigNames = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce", "IC Blink",
            "IC Accent"];
        var rigOk = true;
        for (var r = 0; r < rigNames.length; r += 1) {
            var slider = findNamedEffect(layer, rigNames[r]);
            if (!slider || slider.property(1).numKeys === 0) { rigOk = false; }
        }
        check(rigOk, "all six rig sliders exist and are keyframed");

        // --- 1b. IC Accent actually carries its curve ------------------------
        //
        // setShapedKey() swallows a failed setInterpolationTypeAtKey or
        // setTemporalEaseAtKey, exactly as setEasedKey() does and for the same
        // reason — an older host should still get the values. The cost is that
        // a rejected call leaves keys that look animated and carry no shape at
        // all, which is the one thing this track exists for. So it is read back
        // rather than assumed.
        var accent = findNamedEffect(layer, "IC Accent");
        if (check(accent !== null, "IC Accent exists")) {
            var accentSlider = accent.property(1);
            check(accentSlider.numKeys >= 4,
                "IC Accent has a key pair per syllable (" + accentSlider.numKeys + ")");
            // Found by value rather than counted from the start: a line whose
            // first syllable begins at the layer's in point writes its rest key
            // and its first strike at the same time, and the second overwrites
            // the first, so there is no fixed index to reach for.
            var strike = 0, settle = 0;
            var k;
            for (k = 1; k < accentSlider.numKeys; k += 1) {
                if (Math.abs(accentSlider.keyValue(k) - 100) < 0.001 &&
                        Math.abs(accentSlider.keyValue(k + 1) - 50) < 0.001) {
                    strike = k; settle = k + 1; break;
                }
            }
            check(strike > 0, "IC Accent has a 100-then-50 pair");
            if (strike > 0) {
            check(accentSlider.keyInInterpolationType(strike) ===
                    KeyframeInterpolationType.HOLD,
                "the strike steps in rather than ramping up from the settle");
            check(accentSlider.keyOutInterpolationType(strike) ===
                    KeyframeInterpolationType.BEZIER,
                "the strike leaves on a curve");
            check(accentSlider.keyInInterpolationType(settle) ===
                    KeyframeInterpolationType.BEZIER,
                "the settle arrives on a curve");
            check(accentSlider.keyOutInterpolationType(settle) ===
                    KeyframeInterpolationType.HOLD,
                "the settle holds until the next syllable");
            // Fast out, slow in — the influences are the whole shape, and a
            // swallowed setTemporalEaseAtKey would leave both at the default.
            var leaving = accentSlider.keyOutTemporalEase(strike)[0].influence;
            var arriving = accentSlider.keyInTemporalEase(settle)[0].influence;
            check(leaving < arriving,
                "accent leaves at influence " + leaving.toFixed(1) +
                " and arrives at " + arriving.toFixed(1) + "; it must leave faster");
            }
        }

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
        attempt("remove from layer", function () { removeFromLayer(comp, cleanup); });
        check(cleanup.property("ADBE Effect Parade").numProperties === 0,
            "every effect was removed, " + cleanup.property("ADBE Effect Parade").numProperties + " left");
        check(cleanup.property("ADBE Marker").numKeys === 0, "IC: markers were removed");
        check(cleanup.property("ADBE Text Properties").property("ADBE Text Animators").numProperties === 0,
            "the Type-On animator was removed");
        check(cleanup.property("ADBE Text Properties")
            .property("ADBE Text Document").value.text === "清除測試",
            "Source Text survived the removal");
        attempt("remove again on an already clean layer", function () { removeFromLayer(comp, cleanup); });

        /*
         * Remove puts the length back, which nothing portable can see.
         *
         * validate-script.js can prove there is exactly one place that fits a
         * line and that Remove reads the record, but only a host has an
         * `outPoint`. The layer is deliberately trimmed to something that is
         * neither the composition's length nor the speech's, so a restore that
         * merely happens to land on one of those cannot pass.
         */
        var trimmed = comp.layers.addText("長度測試，這一句要夠長才看得出來。");
        trimmed.inPoint = 0.5;
        trimmed.outPoint = 3.25;
        var wanted = trimmed.outPoint - trimmed.inPoint;
        attempt("apply with Fit Duration on", function () {
            applyToTextLayer(comp, trimmed, "", settings, options);
        });
        var fitted = trimmed.outPoint - trimmed.inPoint;
        check(Math.abs(fitted - wanted) > 0.05,
            "Fit Duration actually changed the length (" + wanted.toFixed(3) +
            " -> " + fitted.toFixed(3) + "), or this test proves nothing");
        check(findNamedEffect(trimmed, ORIGINAL_LENGTH_NAME) !== null,
            "the original length was recorded on the layer");
        // A second Apply must not overwrite the record with the engine's length.
        attempt("apply a second time", function () {
            applyToTextLayer(comp, trimmed, "", settings, options);
        });
        check(Math.abs(originalLengthOf(trimmed) - wanted) < 0.001,
            "the record still holds the user's length after a re-Apply (" +
            originalLengthOf(trimmed) + ")");
        attempt("remove from the trimmed layer", function () { removeFromLayer(comp, trimmed); });
        check(Math.abs((trimmed.outPoint - trimmed.inPoint) - wanted) < 0.001,
            "Remove put the length back to " + wanted.toFixed(3) + ", got " +
            (trimmed.outPoint - trimmed.inPoint).toFixed(3));
        check(findNamedEffect(trimmed, ORIGINAL_LENGTH_NAME) === null,
            "and took the record with it");

        // A layer that was never fitted has no record, and Remove must not
        // invent one: its length is the user's business.
        var unfitted = comp.layers.addText("沒有配合長度");
        unfitted.inPoint = 1.0;
        unfitted.outPoint = 2.0;
        var plainOptions = {};
        for (var optionKey in options) {
            if (options.hasOwnProperty(optionKey)) { plainOptions[optionKey] = options[optionKey]; }
        }
        plainOptions.fitDuration = false;
        attempt("apply with Fit Duration off", function () {
            applyToTextLayer(comp, unfitted, "", settings, plainOptions);
        });
        check(findNamedEffect(unfitted, ORIGINAL_LENGTH_NAME) === null,
            "nothing was recorded for a layer that was never fitted");
        attempt("remove from it", function () { removeFromLayer(comp, unfitted); });
        check(Math.abs((unfitted.outPoint - unfitted.inPoint) - 1.0) < 0.001,
            "its length is untouched, got " + (unfitted.outPoint - unfitted.inPoint).toFixed(3));

        /*
         * The character a line was given, read back off the line.
         *
         * The rig's name wins when there is one; without a rig the panel's
         * character is used, and the effect is the only thing carrying it.
         */
        var named = comp.layers.addText("角色測試");
        var namedSettings = {};
        for (var settingKey in settings) {
            if (settings.hasOwnProperty(settingKey)) { namedSettings[settingKey] = settings[settingKey]; }
        }
        namedSettings.character = "Mimi";
        attempt("apply with a character", function () {
            applyToTextLayer(comp, named, "", namedSettings, options);
        });
        check(characterOfLayer(named) === "Mimi",
            "the line says which character it was given, got \"" + characterOfLayer(named) + "\"");
        check(findNativeEffect(named) !== null,
            "and the renamed effect is still found by matchName");
        namedSettings.character = "";
        attempt("apply again with no character", function () {
            applyToTextLayer(comp, named, "", namedSettings, options);
        });
        check(characterOfLayer(named) === "",
            "a re-Apply with no character clears the label rather than leaving it");
        attempt("apply with a character and a pronunciation override", function () {
            namedSettings.character = "咪咪";
            applyToTextLayer(comp, named, "ni3 hao3", namedSettings, options);
        });
        check(characterOfLayer(named) === "咪咪",
            "the character survives beside [Override], got \"" + characterOfLayer(named) + "\"");

        /*
         * Preview, all the way through: it renders, it plays, and it leaves the
         * project exactly as it found it.
         */
        var itemsBefore = app.project.numItems;
        var layersBefore = comp.numLayers;
        attempt("preview a line without touching the project", function () {
            previewVoice("你好，試聽。", settings);
        });
        check(app.project.numItems === itemsBefore,
            "preview imported nothing (" + itemsBefore + " -> " + app.project.numItems + ")");
        check(comp.numLayers === layersBefore,
            "preview added no layer (" + layersBefore + " -> " + comp.numLayers + ")");
        check(previewFile().exists, "preview wrote its temporary file");

        // Removal must leave effects the user owns alone.
        var mixed = comp.layers.addText("混合測試");
        var userBlur = mixed.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
        userBlur.name = "My Blur";
        attempt("apply to a layer that has a user effect", function () {
            applyToTextLayer(comp, mixed, "", settings, options);
        });
        attempt("remove from that layer", function () { removeFromLayer(comp, mixed); });
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

        /*
         * --- 11. one rig shared by several lines ------------------------------
         *
         * The point of the whole thing: a character's mouth is driven by
         * whichever line is speaking, whatever layer that line happens to be.
         * What cannot be checked without a host is that the pointer really is a
         * Layer Control that survives, that the merged keys really land on the
         * null, that the lines really lose their own sliders, and that the
         * generated mouth expression is one After Effects will actually
         * evaluate rather than a string that only looks right.
         */
        var sharedOptions = { markers: true, fitDuration: true, controllers: true,
            typeOn: false, typeOnCenter: false, rigShared: true, rigCharacter: "Mimi" };
        var spoken = ["第一句話", "第二句話", "第三句話"];
        var members = [];
        var s;
        for (s = 0; s < spoken.length; s += 1) {
            var made = comp.layers.addText(spoken[s]);
            made.name = "Line " + (s + 1);
            made.startTime = s * 3;
            members.push(made);
        }
        for (s = 1; s <= comp.numLayers; s += 1) { comp.layer(s).selected = false; }
        for (s = 0; s < members.length; s += 1) { members[s].selected = true; }
        attempt("apply three lines to one shared rig", function () {
            var shared = createOrUpdate("", "", settings, sharedOptions);
            if (shared.count !== 3) { throw new Error("applied to " + shared.count + " layers"); }
            if (shared.rigs !== 1) { throw new Error("rebuilt " + shared.rigs + " rigs, expected 1"); }
            if (shared.overlaps.length) { throw new Error("lines three seconds apart overlapped"); }
        });

        var rigLayer = findRigLayer(comp, "Mimi");
        check(rigLayer !== null, "a rig layer was created for the character");
        if (rigLayer) {
            check(isRigLayer(rigLayer), "the rig layer is recognised as one");
            check(rigLayer.name === "IC Rig Mimi", "the rig is named after the character, got " + rigLayer.name);
            var sharedNames = ["IC Mouth", "IC Volume", "IC Pitch", "IC Head Bounce",
                "IC Blink", "IC Accent", "IC Speaking", "IC Line"];
            var sharedOk = true;
            var totalKeys = 0;
            for (s = 0; s < sharedNames.length; s += 1) {
                var track = findNamedEffect(rigLayer, sharedNames[s]);
                if (!track || track.property(1).numKeys === 0) { sharedOk = false; }
                else { totalKeys += track.property(1).numKeys; }
            }
            check(sharedOk, "all seven shared tracks exist on the rig and are keyframed");
            log("  rig carries " + totalKeys + " keys across seven tracks");

            // The lines keep the pointer and lose the sliders. Both halves
            // matter: twenty sets of sliders is the problem being solved.
            var boundOk = true;
            var strippedOk = true;
            for (s = 0; s < members.length; s += 1) {
                var bound = rigTargetLayer(comp, members[s]);
                if (!bound || bound.index !== rigLayer.index) { boundOk = false; }
                if (findNamedEffect(members[s], "IC Mouth")) { strippedOk = false; }
            }
            check(boundOk, "every line points at the rig through its Layer Control");
            check(strippedOk, "no line kept a rig slider of its own");
            check(rigMembers(comp, rigLayer).length === 3,
                "the rig finds its three members, got " + rigMembers(comp, rigLayer).length);

            // Appending the pointer must not have separated the pair the audio
            // path depends on.
            var memberEffects = members[0].property("ADBE Effect Parade");
            var memberTone = null, memberChatter = null;
            for (s = 1; s <= memberEffects.numProperties; s += 1) {
                if (memberEffects.property(s).matchName === "ADBE Aud Tone") { memberTone = memberEffects.property(s); }
                if (memberEffects.property(s).matchName === "Island Chatter Native") { memberChatter = memberEffects.property(s); }
            }
            check(memberTone && memberChatter &&
                memberTone.propertyIndex === memberChatter.propertyIndex - 1,
                "Tone is still immediately before the native effect on a bound line");

            // The character's voice travels with the project, not with the
            // machine's preferences.
            var storedVoice = rigSettings(rigLayer);
            check(storedVoice !== null && storedVoice.seed === settings.seed &&
                storedVoice.voice === settings.voice,
                "the character's voice is stored on the rig and reads back");

            var lineSlider = findNamedEffect(rigLayer, "IC Line").property(1);
            var highest = 0;
            for (s = 1; s <= lineSlider.numKeys; s += 1) {
                if (lineSlider.keyValue(s) > highest) { highest = lineSlider.keyValue(s); }
            }
            check(highest === 3, "IC Line counts all three lines, reached " + highest);

            // Repeat apply: the case that broke the per-layer rig in 1.0.1.
            attempt("apply the same three lines again", function () {
                createOrUpdate("", "", settings, sharedOptions);
            });
            check(rigLayers(comp).length === 1,
                "repeat apply did not create a second rig (" + rigLayers(comp).length + ")");
            var controlCount = 0;
            var memberParade = members[0].property("ADBE Effect Parade");
            for (s = 1; s <= memberParade.numProperties; s += 1) {
                if (memberParade.property(s).name === "IC Rig Target") { controlCount += 1; }
            }
            check(controlCount === 1, "repeat apply did not stack a second pointer (" + controlCount + ")");

            // Moving a line is the case keyframes cannot follow on their own,
            // and Rebuild is the whole answer to it. If the rebuild did not
            // re-read the layer, this key would not move.
            var speaking = findNamedEffect(rigLayer, "IC Speaking").property(1);
            var lastBefore = speaking.keyTime(speaking.numKeys);
            members[2].startTime = members[2].startTime + 2;
            attempt("rebuild after moving the last line two seconds later", function () {
                rebuildSharedRig(comp, rigLayer, null);
            });
            speaking = findNamedEffect(rigLayer, "IC Speaking").property(1);
            var lastAfter = speaking.keyTime(speaking.numKeys);
            check(Math.abs((lastAfter - lastBefore) - 2) < 0.02,
                "the rig followed the moved line (" + lastBefore.toFixed(3) + "s -> " +
                lastAfter.toFixed(3) + "s)");

            // Two lines of one character at once: built anyway, reported anyway.
            members[1].startTime = members[0].startTime + 0.25;
            var clash = null;
            attempt("rebuild with two lines overlapping", function () {
                clash = rebuildSharedRig(comp, rigLayer, null);
            });
            check(clash && clash.overlaps.length >= 2,
                "the overlap was reported back to the panel");
            var mouthSlider = findNamedEffect(rigLayer, "IC Mouth").property(1);
            var strayKey = false;
            for (s = 1; s <= mouthSlider.numKeys; s += 1) {
                // The first line is cut where the second starts; nothing of it
                // may survive past that moment except keys the second line owns.
                if (mouthSlider.keyTime(s) > members[0].startTime + 0.25 + 0.0001 &&
                    mouthSlider.keyTime(s) < members[1].startTime) { strayKey = true; }
            }
            check(!strayKey, "the masked line left no keys inside the line that took over");

            // A face, driven by the rig. The expression is generated as text, so
            // the only proof it is correct is After Effects evaluating it.
            var shapeLayers = [];
            for (s = 0; s < 6; s += 1) {
                var shapeLayer = comp.layers.addSolid([0, 1, 0], "Mouth " + s, 40, 40, 1);
                shapeLayers.push(shapeLayer);
            }
            // Topmost is the closed mouth, so the newest solid must be last.
            shapeLayers.sort(function (first, second) { return first.index - second.index; });
            attempt("wire six mouth layers to the rig", function () {
                var built = buildMouthSwitch(comp, rigLayer, shapeLayers);
                if (built.count !== 6) { throw new Error("wired " + built.count + " layers"); }
            });
            var wiredOk = true;
            for (s = 0; s < shapeLayers.length; s += 1) {
                var wiredOpacity = opacityProperty(shapeLayers[s]);
                if (!findNamedEffect(shapeLayers[s], "IC Rig Target")) { wiredOk = false; }
                if (!wiredOpacity || !wiredOpacity.expressionEnabled) { wiredOk = false; }
            }
            check(wiredOk, "every mouth layer got a pointer and a live expression");

            // Evaluate it. Pick a moment the rig is actually speaking and read
            // the shape it asks for; exactly that layer must be visible.
            var probeTime = -1;
            mouthSlider = findNamedEffect(rigLayer, "IC Mouth").property(1);
            for (s = 1; s <= mouthSlider.numKeys; s += 1) {
                if (mouthSlider.keyValue(s) > 0 && probeTime < 0) {
                    probeTime = mouthSlider.keyTime(s) + 0.001;
                }
            }
            check(probeTime >= 0, "the rig opens the mouth somewhere");
            if (probeTime >= 0) {
                var wanted = Math.round(mouthSlider.valueAtTime(probeTime, false));
                var visible = [];
                for (s = 0; s < shapeLayers.length; s += 1) {
                    var lit = opacityProperty(shapeLayers[s]);
                    if (lit && lit.valueAtTime(probeTime, false) > 50) { visible.push(s); }
                }
                check(visible.length === 1 && visible[0] === wanted,
                    "at " + probeTime.toFixed(3) + "s the rig asks for shape " + wanted +
                    " and layers [" + visible.join(",") + "] are visible");
            }

            // Removing a line must leave the rig describing what is left.
            attempt("remove one line from the rig", function () {
                removeFromLayer(comp, members[2]);
                rebuildSharedRig(comp, rigLayer, null);
            });
            check(!findNamedEffect(members[2], "IC Rig Target"),
                "the removed line no longer points at the rig");
            check(rigMembers(comp, rigLayer).length === 2,
                "the rig is down to two members, has " + rigMembers(comp, rigLayer).length);

            // And removing the rig must reach everything that pointed at it,
            // rather than leaving six expressions hunting for a mouth shape.
            attempt("remove the rig itself", function () { removeRigLayer(comp, rigLayer); });
            check(rigLayers(comp).length === 0, "the rig layer is gone");
            var orphaned = false;
            for (s = 0; s < shapeLayers.length; s += 1) {
                var leftOver = opacityProperty(shapeLayers[s]);
                if (findNamedEffect(shapeLayers[s], "IC Rig Target")) { orphaned = true; }
                if (leftOver && leftOver.expressionEnabled) { orphaned = true; }
            }
            check(!orphaned, "no mouth layer was left pointing at a rig that no longer exists");
            var boundLeft = false;
            for (s = 0; s < 2; s += 1) {
                if (findNamedEffect(members[s], "IC Rig Target")) { boundLeft = true; }
            }
            check(!boundLeft, "no line was left pointing at a rig that no longer exists");
        }

        /*
         * --- 12. importing a script ------------------------------------------
         *
         * One line per layer, laid end to end. What needs a host is the
         * sequencing itself: the gap between two lines is only correct if the
         * engine's plan reached the layer's out point, and a composition too
         * short to hold the script silently squashes every line past its end.
         */
        // Three seconds, which three lines and two gaps do not fit into. The
        // blank line in the script must be skipped rather than become a layer.
        var importComp = app.project.items.addComp("IC Import", 320, 180, 1, 3, 30);
        importComp.openInViewer();
        var importOptions = { markers: true, fitDuration: false, controllers: true,
            typeOn: false, typeOnCenter: false, rigShared: false, rigCharacter: "",
            speakers: false };
        var importGap = 1;
        var importBpm = 120;
        var importBeat = 60.0 / importBpm;
        var script = "第一句話。\n\n第二句話。\n第三句話。";
        var report = null;
        attempt("import a four-line script into a three-second composition", function () {
            report = importScript(script, settings, importOptions, importGap, importBpm);
            if (report.count !== 3) { throw new Error("made " + report.count + " layers, expected 3"); }
            if (report.split !== 0) { throw new Error("split a line that fits"); }
        });
        var placed = [];
        for (s = 1; s <= importComp.numLayers; s += 1) {
            if (isTextLayer(importComp.layer(s)) && findNativeEffect(importComp.layer(s))) {
                placed.push(importComp.layer(s));
            }
        }
        placed.sort(function (first, second) { return first.inPoint - second.inPoint; });
        check(placed.length === 3, "three layers were created and all three speak");
        if (placed.length === 3) {
            // The gap is a minimum, not a distance: the next line waits at
            // least one beat and then starts on the next beat after that, so
            // the real gap is somewhere in [1, 2) beats.
            var spacingOk = true;
            var gridOk = true;
            for (s = 0; s < placed.length; s += 1) {
                var beats = placed[s].inPoint / importBeat;
                if (Math.abs(beats - Math.round(beats)) > 0.01) {
                    gridOk = false;
                    log("    line " + (s + 1) + " starts at " + beats.toFixed(3) + " beats");
                }
                if (s === 0) { continue; }
                var actualGap = placed[s].inPoint - placed[s - 1].outPoint;
                if (actualGap < importGap * importBeat - 0.02 ||
                    actualGap >= (importGap + 1) * importBeat + 0.02) {
                    spacingOk = false;
                    log("    gap " + s + ": " + actualGap.toFixed(3) + "s, expected between " +
                        (importGap * importBeat) + " and " + ((importGap + 1) * importBeat));
                }
            }
            check(gridOk, "every line starts on a beat at " + importBpm + " BPM");
            check(spacingOk, "each line waits at least the gap and then starts on a beat");
            // Fit Duration was unticked; sequencing has to override that or
            // every line would keep the default two seconds and drift apart.
            var lengthOk = true;
            for (s = 0; s < placed.length; s += 1) {
                var linePlan = planFromEngine(findNativeEffect(placed[s]));
                if (Math.abs((placed[s].outPoint - placed[s].inPoint) - linePlan.duration) > 0.05) {
                    lengthOk = false;
                }
            }
            check(lengthOk, "every line is exactly as long as the engine says it is");
            // The script is longer than the three seconds the comp was built with.
            check(importComp.duration > 3,
                "the composition grew to hold the script (" + importComp.duration.toFixed(2) + "s)");
            check(Math.abs(importComp.duration - placed[2].outPoint) < 0.05,
                "and grew to exactly what the script needs, not to the working headroom");
        }

        // A line too long for the transport becomes as many layers as it needs,
        // rather than being cut off at the limit the way a typed layer is.
        var longScript = "";
        for (s = 0; s < 90; s += 1) { longScript += "島民"; }
        var longReport = null;
        attempt("import one line of 180 characters", function () {
            longReport = importScript(longScript, settings, importOptions, importGap, importBpm);
        });
        check(longReport && longReport.count > 1,
            "the over-long line became " + (longReport ? longReport.count : 0) + " layers");
        check(longReport && longReport.split > 0, "the split was reported back to the panel");
        var nothingLost = "";
        var longLayers = [];
        for (s = 1; s <= importComp.numLayers; s += 1) {
            var candidate = importComp.layer(s);
            if (isTextLayer(candidate) && findNativeEffect(candidate) &&
                String(textFromLayer(candidate)).indexOf("島民") === 0) {
                longLayers.push(candidate);
            }
        }
        longLayers.sort(function (first, second) { return first.inPoint - second.inPoint; });
        var withinLimit = true;
        for (s = 0; s < longLayers.length; s += 1) {
            var carried = textFromLayer(longLayers[s]);
            nothingLost += carried;
            if (carried.length > MAX_TEXT_UNITS) { withinLimit = false; }
            // The effect must be speaking the whole layer, not a truncated part
            // of it: that is the difference between splitting and truncating.
            if (Math.round(findNativeEffect(longLayers[s]).property(PARAM_TEXT_LENGTH).value) !==
                carried.length) { withinLimit = false; }
        }
        check(withinLimit, "every piece fits the transport and is spoken in full");
        check(nothingLost === longScript,
            "the whole line survived the split (" + nothingLost.length + " of " +
            longScript.length + " characters)");

        // Import into a shared rig: one rig, every line a member, one rebuild.
        var importRigOptions = { markers: true, fitDuration: false, controllers: true,
            typeOn: false, typeOnCenter: false, rigShared: true, rigCharacter: "Captain",
            speakers: false };
        attempt("import three lines straight into a shared rig", function () {
            importScript("早安。\n午安。\n晚安。", settings, importRigOptions, importGap, importBpm);
        });
        var importedRig = findRigLayer(importComp, "Captain");
        check(importedRig !== null, "the character's rig was created by the import");
        if (importedRig && findNamedEffect(importedRig, "IC Line")) {
            check(rigMembers(importComp, importedRig).length === 3,
                "all three imported lines joined the rig, got " +
                rigMembers(importComp, importedRig).length);
            // Counting keys would be the wrong question: the first line starts
            // at the rig's own in point, so its opening key lands on top of the
            // resting one and the total is a key short of the arithmetic. What
            // proves the merge saw all three lines is that it numbered them.
            var importedLine = findNamedEffect(importedRig, "IC Line").property(1);
            var importedHighest = 0;
            for (s = 1; s <= importedLine.numKeys; s += 1) {
                if (importedLine.keyValue(s) > importedHighest) {
                    importedHighest = importedLine.keyValue(s);
                }
            }
            check(importedHighest === 3,
                "the rig was merged from all three lines in one pass, numbered to " + importedHighest);
        }
        /*
         * --- 13. the edit cycle ----------------------------------------------
         *
         * Import lays a scene out once. Everything after that is editing: a line
         * gets longer, a line is deleted, and every line after it has to move.
         * Re-sync makes a layer match its own text without touching its voice;
         * Re-flow puts the scene back in order. What needs a host is that the
         * two together really do land every line on the beat grid, and that a
         * layer's voice really is left alone.
         */
        var editComp = app.project.items.addComp("IC Edit", 320, 180, 1, 4, 30);
        editComp.openInViewer();
        var editOptions = { markers: true, fitDuration: false, controllers: true,
            typeOn: false, typeOnCenter: false, rigShared: false, rigCharacter: "",
            speakers: true, typeOnLeave: 0.1, typeOnSmoothness: 40 };
        var editBpm = 137;
        var editGap = 2;
        attempt("import a two-character script with speaker names", function () {
            var cast = importScript("咪咪：早安。\n隊長：你也早。\n咪咪：今天天氣真好。",
                settings, editOptions, editGap, editBpm);
            if (cast.count !== 3) { throw new Error("made " + cast.count + " layers"); }
            if (cast.cast.length !== 2) { throw new Error("found " + cast.cast.length + " characters"); }
        });
        check(findRigLayer(editComp, "咪咪") !== null, "the first speaker got a rig");
        check(findRigLayer(editComp, "隊長") !== null, "the second speaker got a rig");
        var mimi = findRigLayer(editComp, "咪咪");
        if (mimi) {
            check(rigMembers(editComp, mimi).length === 2,
                "two of the three lines belong to the first speaker, got " +
                rigMembers(editComp, mimi).length);
        }
        var dialogue = [];
        for (s = 1; s <= editComp.numLayers; s += 1) {
            if (isTextLayer(editComp.layer(s)) && findNativeEffect(editComp.layer(s))) {
                dialogue.push(editComp.layer(s));
            }
        }
        dialogue.sort(function (first, second) { return first.inPoint - second.inPoint; });
        check(dialogue.length === 3, "three lines were created");
        // The name must not be spoken. If the prefix were left in, the effect
        // would be carrying three more characters than the line has.
        if (dialogue.length === 3) {
            check(String(textFromLayer(dialogue[0])) === "早安。",
                "the speaker's name was taken out of the line, got \"" +
                textFromLayer(dialogue[0]) + "\"");
        }
        var editBeat = 60.0 / editBpm;
        var onGrid = true;
        for (s = 0; s < dialogue.length; s += 1) {
            var beats = dialogue[s].inPoint / editBeat;
            if (Math.abs(beats - Math.round(beats)) > 0.01) {
                onGrid = false;
                log("    line " + (s + 1) + " starts at " + beats.toFixed(3) + " beats");
            }
        }
        check(onGrid, "every line starts on a beat at " + editBpm + " BPM");

        // Re-sync must not touch the voice. Give one line a voice nothing else
        // has, then edit its text and check the voice survived.
        if (dialogue.length === 3) {
            var odd = dialogue[1];
            var oddSettings = { voice: 6, pitch: 1.73, speed: 0.61, volume: 1.31,
                consonant: 3.02, emotion: 2, characterSize: 3, clarity: 0.29,
                cuteness: 0.91, seed: 24601, tempoLock: false, formant: 1.84,
                source: 4, vibrato: 2.7, vibratoRate: 14.5 };
            attempt("give one line a distinctive voice", function () {
                applyToTextLayer(editComp, odd, "", oddSettings, editOptions, null);
            });
            odd.property("ADBE Text Properties").property("ADBE Text Document")
                .setValue(new TextDocument("你也早，今天真的很不錯喔。"));
            var beforeSync = settingsFromEffect(findNativeEffect(odd));
            var syncReport = null;
            attempt("re-sync after editing that line's text", function () {
                syncReport = resyncSelection(editComp, [odd], editOptions);
            });
            check(syncReport && syncReport.count === 1, "the line was re-synced");
            var afterSync = settingsFromEffect(findNativeEffect(odd));
            var voiceHeld = true;
            var field;
            for (field in beforeSync) {
                if (!beforeSync.hasOwnProperty(field)) { continue; }
                if (String(beforeSync[field]) !== String(afterSync[field])) {
                    voiceHeld = false;
                    log("    " + field + ": " + beforeSync[field] + " -> " + afterSync[field]);
                }
            }
            // The panel is holding completely different settings, and this is
            // what Apply would have written over the line instead.
            check(voiceHeld, "re-sync left every voice setting exactly as it was");
            check(Math.round(findNativeEffect(odd).property(PARAM_TEXT_LENGTH).value) ===
                String(textFromLayer(odd)).length,
                "re-sync wrote the new text into the effect");
            var syncedPlan = planFromEngine(findNativeEffect(odd));
            check(Math.abs((odd.outPoint - odd.inPoint) - syncedPlan.duration) < 0.05,
                "re-sync refitted the layer to the longer line");
            // The line is now longer, so it runs into the one after it until the
            // scene is laid out again.
            var reflowReport = null;
            attempt("re-flow the scene", function () {
                reflowReport = reflowLayers(editComp, dialogue, editGap, editBpm);
            });
            check(reflowReport && reflowReport.count === 3, "all three lines were laid out again");
            var stillOnGrid = true;
            var noOverlap = true;
            dialogue.sort(function (first, second) { return first.inPoint - second.inPoint; });
            for (s = 0; s < dialogue.length; s += 1) {
                var at = dialogue[s].inPoint / editBeat;
                if (Math.abs(at - Math.round(at)) > 0.01) { stillOnGrid = false; }
                if (s > 0 && dialogue[s].inPoint < dialogue[s - 1].outPoint - 0.001) {
                    noOverlap = false;
                }
            }
            check(stillOnGrid, "every line is still on a beat after the re-flow");
            check(noOverlap, "no line runs into the next one any more");
            // Twice must be the same as once, or every press walks the scene
            // one beat further along.
            var wherePut = [];
            for (s = 0; s < dialogue.length; s += 1) { wherePut.push(dialogue[s].inPoint); }
            attempt("re-flow again", function () {
                reflowLayers(editComp, dialogue, editGap, editBpm);
            });
            var stable = true;
            for (s = 0; s < dialogue.length; s += 1) {
                if (Math.abs(dialogue[s].inPoint - wherePut[s]) > 0.001) {
                    stable = false;
                    log("    line " + (s + 1) + ": " + wherePut[s].toFixed(4) + " -> " +
                        dialogue[s].inPoint.toFixed(4));
                }
            }
            check(stable, "re-flowing an already tidy scene moves nothing");

            // A fractional gap has to reach a finer grid than a whole beat, or
            // the number may as well be an integer. Half a beat at 137 BPM is
            // 0.2190s, and at least one line has to land somewhere a whole-beat
            // grid could never put it.
            attempt("re-flow at half a beat", function () {
                reflowLayers(editComp, dialogue, 0.5, editBpm);
            });
            dialogue.sort(function (first, second) { return first.inPoint - second.inPoint; });
            var halfBeat = editBeat / 2;
            var offTheBeat = 0;
            var onHalves = true;
            for (s = 0; s < dialogue.length; s += 1) {
                var halves = dialogue[s].inPoint / halfBeat;
                if (Math.abs(halves - Math.round(halves)) > 0.01) { onHalves = false; }
                var whole = dialogue[s].inPoint / editBeat;
                if (Math.abs(whole - Math.round(whole)) > 0.01) { offTheBeat += 1; }
            }
            check(onHalves, "every line sits on a half-beat after a half-beat re-flow");
            check(offTheBeat > 0,
                "at least one line landed between two beats, which a whole-beat grid cannot do");
        }
        try { editComp.remove(); } catch (editCleanup) { log("edit cleanup: " + editCleanup.toString()); }

        // --- 11b. holding a line until the next one -----------------------------
        //
        // Fit Duration ends a line where its audio ends, which leaves the screen
        // blank in every gap. Hold extends each line to the next one's start,
        // and must only ever extend: a gap of zero already runs the lines on.
        log("");
        var holdComp = app.project.items.addComp("IC Hold", 640, 360, 1, 60, 30);
        holdComp.openInViewer();
        var holdImport = null;
        attempt("import a script with Hold on", function () {
            holdImport = importScript("第一句。\n第二句。\n第三句。", settings,
                { markers: false, fitDuration: true, controllers: false, typeOn: false,
                  rigShared: false, rigCharacter: "", speakers: false, hold: true },
                2, 120);
        });
        if (holdImport) {
            var holdLines = [];
            var hl;
            for (hl = 1; hl <= holdComp.numLayers; hl += 1) {
                if (findNativeEffect(holdComp.layer(hl))) { holdLines.push(holdComp.layer(hl)); }
            }
            holdLines.sort(function (a, b) { return a.inPoint - b.inPoint; });
            check(holdLines.length === 3, "three lines were imported");
            check(holdImport.held === 2, "two of the three were held (got " + holdImport.held + ")");
            if (holdLines.length === 3) {
                var joined = true;
                var g;
                for (g = 0; g + 1 < holdLines.length; g += 1) {
                    if (Math.abs(holdLines[g].outPoint - holdLines[g + 1].inPoint) > 0.002) {
                        joined = false;
                        log("    line " + g + " ends " + holdLines[g].outPoint.toFixed(4) +
                            ", next starts " + holdLines[g + 1].inPoint.toFixed(4));
                    }
                }
                check(joined, "each line runs right up to the next one");
                // The last line keeps its own length: there is nothing after it
                // to hold on for, and stretching it to the end of the
                // composition would be inventing a duration.
                var lastPlan = planFromEngine(findNativeEffect(holdLines[2]));
                check(Math.abs((holdLines[2].outPoint - holdLines[2].inPoint) - lastPlan.duration) < 0.05,
                    "the last line still ends with its own audio");
                // Re-flow has to keep them joined rather than snapping every
                // line back to its audio length.
                attempt("re-flow with Hold on", function () {
                    reflowLayers(holdComp, holdLines, 2, 120, true);
                });
                holdLines.sort(function (a, b) { return a.inPoint - b.inPoint; });
                var stillJoined = true;
                for (g = 0; g + 1 < holdLines.length; g += 1) {
                    if (Math.abs(holdLines[g].outPoint - holdLines[g + 1].inPoint) > 0.002) {
                        stillJoined = false;
                    }
                }
                check(stillJoined, "re-flow put the holds back");
                // And with it off, the lines go back to their own lengths.
                attempt("re-flow with Hold off", function () {
                    reflowLayers(holdComp, holdLines, 2, 120, false);
                });
                holdLines.sort(function (a, b) { return a.inPoint - b.inPoint; });
                var firstPlan = planFromEngine(findNativeEffect(holdLines[0]));
                check(Math.abs((holdLines[0].outPoint - holdLines[0].inPoint) - firstPlan.duration) < 0.05,
                    "with Hold off a line ends with its audio again");
            }
        }
        // A gap of zero already runs the lines straight on, so holding must not
        // move anything at all.
        var tightComp = app.project.items.addComp("IC Hold Tight", 640, 360, 1, 60, 30);
        tightComp.openInViewer();
        attempt("import with no gap at all", function () {
            importScript("甲。\n乙。", settings,
                { markers: false, fitDuration: true, controllers: false, typeOn: false,
                  rigShared: false, rigCharacter: "", speakers: false, hold: false },
                0, 120);
        });
        var tightLines = [];
        var tl;
        for (tl = 1; tl <= tightComp.numLayers; tl += 1) {
            if (findNativeEffect(tightComp.layer(tl))) { tightLines.push(tightComp.layer(tl)); }
        }
        if (tightLines.length === 2) {
            tightLines.sort(function (a, b) { return a.inPoint - b.inPoint; });
            var before = tightLines[0].outPoint;
            var moved = holdUntilNextLine(tightComp, tightLines);
            check(moved === 0 && Math.abs(tightLines[0].outPoint - before) < 0.0005,
                "holding lines that already run on changes nothing");
        }
        try { tightComp.remove(); } catch (tightCleanup) { log("tight cleanup: " + tightCleanup.toString()); }
        try { holdComp.remove(); } catch (holdCleanup) { log("hold cleanup: " + holdCleanup.toString()); }

        // --- 12. singing --------------------------------------------------------
        //
        // The melody crosses into the effect as sixty-four appended parameters,
        // so this is the ABI round trip no unit test can see. It also covers the
        // two things a sung line must not do: report its segments as syllables,
        // and lose its tune to an ordinary Apply.
        log("");
        var singComp = app.project.items.addComp("IC Sing", 640, 360, 1, 30, 30);
        singComp.openInViewer();
        var singLayer = singComp.layers.addText("一閃一閃");
        // Four notes at 120 BPM: three of one beat and one of two, so the last
        // one is long enough that the engine has to split it into segments.
        var SING_BPM = 120;
        var singMelody = [60 * 512 + 24, 62 * 512 + 24, 64 * 512 + 24, 65 * 512 + 48];
        var singSettings = {
            voice: 0, pitch: 1.0, speed: 1.0, volume: 0.78, consonant: 1.25,
            emotion: 0, characterSize: 2, clarity: 0.78, cuteness: 0.55, seed: 909,
            tempoLock: false, formant: 1.0, source: 0, vibrato: 1.0, vibratoRate: 9.2,
            transpose: 0, toneBlend: 0.15, portamento: 0.040, vibratoDelay: 0.30,
            melody: singMelody, melodyBpm: SING_BPM
        };
        var sungPlan = null;
        attempt("apply a melody to a text layer", function () {
            sungPlan = applyToTextLayer(singComp, singLayer, "", singSettings,
                { markers: true, fitDuration: true, controllers: false, typeOn: false },
                null).plan;
        });
        var singEffect = findNativeEffect(singLayer);
        check(singEffect !== null, "the native effect is on the sung layer");
        if (singEffect) {
            check(singEffect.numProperties === 279,
                "the effect registers 279 parameters (got " + singEffect.numProperties + ")");
            var readMelody = melodyFromEffect(singEffect);
            var sameMelody = readMelody.length === singMelody.length;
            var m;
            for (m = 0; m < singMelody.length && sameMelody; m += 1) {
                if (readMelody[m] !== singMelody[m]) { sameMelody = false; }
            }
            check(sameMelody, "the melody round-trips through the parameter transport");
            var readSung = settingsFromEffect(singEffect);
            check(Math.abs(readSung.melodyBpm - SING_BPM) < 0.01, "the melody tempo round-trips");
            check(Math.abs(readSung.toneBlend - 0.15) < 0.002, "the tone blend round-trips");
        }
        if (sungPlan) {
            // Four syllables, however many segments the two-beat note needed.
            check(sungPlan.events.length === 4,
                "a sung line plans one event per syllable (got " + sungPlan.events.length + ")");
            // Three beats plus a two-beat note is 2.5s at 120 BPM, and the
            // engine adds a short tail after the last note.
            check(sungPlan.duration > 2.5 && sungPlan.duration < 2.8,
                "the plan lasts as long as the melody (" + sungPlan.duration.toFixed(3) + "s)");
            var firstGap = sungPlan.events[1].time - sungPlan.events[0].time;
            check(Math.abs(firstGap - 0.5) < 0.002,
                "one beat at 120 BPM is half a second (" + firstGap.toFixed(4) + "s)");
            check(Math.abs(sungPlan.events[3].duration - 1.0) < 0.01,
                "the two-beat note lasts a second (" + sungPlan.events[3].duration.toFixed(4) + "s)");
        }
        var sungMarkers = singLayer.property("ADBE Marker");
        check(sungMarkers.numKeys === 4,
            "a held note produces one marker, not one per segment (got " + sungMarkers.numKeys + ")");
        check(Math.abs((singLayer.outPoint - singLayer.inPoint) - sungPlan.duration) < 0.05,
            "Fit Duration followed the melody");

        // An ordinary Apply carries no melody, and must leave the layer singing.
        // Repainting a voice is what Apply is for; silently turning a song back
        // into speech is not.
        var plainSettings = {};
        var key;
        for (key in singSettings) {
            if (singSettings.hasOwnProperty(key) && key !== "melody" && key !== "melodyBpm") {
                plainSettings[key] = singSettings[key];
            }
        }
        attempt("apply again with no melody in hand", function () {
            applyToTextLayer(singComp, singLayer, "", plainSettings,
                { markers: true, fitDuration: true, controllers: false, typeOn: false }, null);
        });
        singEffect = findNativeEffect(singLayer);
        check(singEffect && melodyFromEffect(singEffect).length === 4,
            "Apply left the melody alone");

        // Re-sync reads the layer's own settings back, so it has to keep the
        // tune across a text edit.
        singLayer.property("ADBE Text Properties").property("ADBE Text Document")
            .setValue(new TextDocument("一閃一閃亮"));
        attempt("re-sync an edited sung line", function () {
            resyncLayer(singComp, singLayer, { typeOnLeave: 33, typeOnSmoothness: 20 });
        });
        singEffect = findNativeEffect(singLayer);
        check(singEffect && melodyFromEffect(singEffect).length === 4,
            "Re-sync kept the melody");
        // --- 13. importing a MIDI file end to end -------------------------------
        //
        // Everything above hands the melody straight to applyToTextLayer(). This
        // is the other half: the engine reads a real file, the panel reads the
        // engine, and lines land at the times the file says. The file is written
        // here rather than checked in, so the repository still ships no binaries
        // it does not build.
        log("");
        var midiFile = new File(Folder.temp.fsName + "/island-chatter-host-test.mid");
        var wrote = false;
        attempt("write a MIDI file to test with", function () {
            var b = [];
            function u8(v) { b.push(v & 0xFF); }
            function u32(v) { u8(v >> 24); u8(v >> 16); u8(v >> 8); u8(v); }
            function ascii(s) { var i; for (i = 0; i < s.length; i += 1) { u8(s.charCodeAt(i)); } }
            function chunk(type, body) {
                ascii(type); u32(body.length);
                var i; for (i = 0; i < body.length; i += 1) { b.push(body[i]); }
            }
            // Header: format 0, one track, 480 ticks per quarter.
            ascii("MThd"); u32(6); u8(0); u8(0); u8(0); u8(1); u8(1); u8(0xE0);
            var track = [];
            function tu8(v) { track.push(v & 0xFF); }
            function tvlq(v) {
                if (v < 128) { tu8(v); return; }
                tu8(0x80 | ((v >> 7) & 0x7F)); tu8(v & 0x7F);
            }
            // 120 BPM, then four one-beat notes back to back.
            tvlq(0); tu8(0xFF); tu8(0x51); tu8(3); tu8(0x07); tu8(0xA1); tu8(0x20);
            var pitches = [60, 62, 64, 65];
            var p;
            for (p = 0; p < pitches.length; p += 1) {
                tvlq(0); tu8(0x90); tu8(pitches[p]); tu8(96);
                tvlq(480); tu8(0x80); tu8(pitches[p]); tu8(0);
            }
            tvlq(0); tu8(0xFF); tu8(0x2F); tu8(0x00);
            chunk("MTrk", track);
            midiFile.encoding = "BINARY";
            if (!midiFile.open("w")) { throw new Error("cannot write " + midiFile.fsName); }
            var text = "";
            var i;
            for (i = 0; i < b.length; i += 1) { text += String.fromCharCode(b[i]); }
            midiFile.write(text);
            midiFile.close();
            wrote = true;
        });
        if (wrote) {
            var listed = null;
            attempt("ask the engine what is in the file", function () {
                listed = midiTracks(midiFile);
            });
            check(listed !== null && listed.tracks.length === 1,
                "the file has one track");
            check(listed !== null && listed.tracks[0].notes === 4,
                "the track has four notes");
            check(listed !== null && Math.abs(listed.bpm - 120) < 0.5,
                "the file's tempo came back as 120");

            var songComp = app.project.items.addComp("IC Song", 640, 360, 1, 30, 30);
            songComp.openInViewer();
            var imported = null;
            attempt("import the song", function () {
                imported = importSong(midiFile, 0, "一閃\n一閃", singSettings,
                    { markers: true, fitDuration: true, controllers: false, typeOn: false,
                      rigShared: false, rigCharacter: "" });
            });
            if (imported) {
                check(imported.count === 2, "two lyric lines became two layers");
                check(imported.extraNotes === 0 && imported.extraSyllables === 0,
                    "the lyric and the melody matched exactly");
                var sungLayers = [];
                var q;
                for (q = 1; q <= songComp.numLayers; q += 1) {
                    if (findNativeEffect(songComp.layer(q))) { sungLayers.push(songComp.layer(q)); }
                }
                sungLayers.sort(function (a, b) { return a.startTime - b.startTime; });
                check(sungLayers.length === 2, "both layers carry the effect");
                if (sungLayers.length === 2) {
                    // The second line's first note is two beats in: one second
                    // at 120 BPM. This is what "a song lands at its own times"
                    // means, and it is the reason Import MIDI ignores the gap.
                    var apart = sungLayers[1].startTime - sungLayers[0].startTime;
                    check(Math.abs(apart - 1.0) < 0.01,
                        "the second line starts at its own first note (" + apart.toFixed(4) + "s)");
                    check(melodyFromEffect(findNativeEffect(sungLayers[0])).length === 2,
                        "each line carries its own two notes");
                }
            }
            // With no lyric at all the melody sings its own note names, and
            // they arrive as the layer's real Source Text — which is why this
            // needed no new effect parameters.
            var namedComp = app.project.items.addComp("IC Note Names", 640, 360, 1, 30, 30);
            namedComp.openInViewer();
            var namedImport = null;
            attempt("import with no lyric at all", function () {
                namedImport = importSong(midiFile, 0, "", singSettings,
                    { markers: true, fitDuration: true, controllers: false, typeOn: false,
                      rigShared: false, rigCharacter: "" }, 0);
            });
            if (namedImport) {
                var namedLayer = null;
                var z;
                for (z = 1; z <= namedComp.numLayers; z += 1) {
                    if (findNativeEffect(namedComp.layer(z))) { namedLayer = namedComp.layer(z); }
                }
                check(namedLayer !== null, "the note-name layer carries the effect");
                if (namedLayer) {
                    var namedText = namedLayer.property("ADBE Text Properties")
                        .property("ADBE Text Document").value.text;
                    check(namedText === "do re mi fa",
                        "the layer says its note names (got \"" + namedText + "\")");
                    check(melodyFromEffect(findNativeEffect(namedLayer)).length === 4,
                        "the note-name layer carries all four notes");
                    check(namedLayer.property("ADBE Marker").numKeys === 4,
                        "one marker per note name");
                }
            }
            try { namedComp.remove(); } catch (namedCleanup) { log("named cleanup: " + namedCleanup.toString()); }
            try { songComp.remove(); } catch (songCleanup) { log("song cleanup: " + songCleanup.toString()); }
            try { midiFile.remove(); } catch (fileCleanup) { log("midi cleanup: " + fileCleanup.toString()); }
        }
        try { singComp.remove(); } catch (singCleanup) { log("sing cleanup: " + singCleanup.toString()); }

        try { importComp.remove(); } catch (importCleanup) { log("import cleanup: " + importCleanup.toString()); }
        comp.openInViewer();

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

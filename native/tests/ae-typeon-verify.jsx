// Extracts the real updateTypeOn() and its helpers from the repository panel,
// then exercises them on a live text layer: first apply, repeat apply, and
// repeat apply after the user has keyframed the properties it writes.
(function () {
    var root = new File($.fileName).parent.parent.parent.fsName.replace(/\\/g, "/");
    var out = new File(root + "/ae-typeon-verify-result.txt");
    var lines = [];
    function log(t) { lines.push(String(t)); }

    var comp = null;
    try {
        var panelFile = new File(root + "/native/panel/IslandChatterNativePanel.jsx");
        panelFile.encoding = "UTF-8";
        panelFile.open("r");
        var source = panelFile.read();
        panelFile.close();

        function take(name) {
            var start = source.indexOf("function " + name + "(");
            if (start < 0) { throw new Error("missing function " + name); }
            var depth = 0;
            for (var i = source.indexOf("{", start); i < source.length; i += 1) {
                if (source.charAt(i) === "{") { depth += 1; }
                else if (source.charAt(i) === "}") {
                    depth -= 1;
                    if (depth === 0) { return source.substring(start, i + 1); }
                }
            }
            throw new Error("unbalanced function " + name);
        }

        var names = ["valuesDiffer", "setPropertyValue", "clearKeys", "setHoldKey",
            "setEasedKey", "findNamedProperty", "findPropertyByMatchName",
            "setRevealSmoothness", "textFromLayer", "measureRevealWidths",
            "clamp", "typeOnCurve", "updateTypeOnCentering", "updateTypeOn"];
        var code = [];
        for (var n = 0; n < names.length; n += 1) { code.push(take(names[n])); }
        // Constants the extracted functions compare against.
        var centerStart = source.indexOf("var CENTER_ANIMATOR_NAME =");
        code.push(source.substring(centerStart, source.indexOf(";", centerStart) + 1));
        var influenceNames = ["MIN_INFLUENCE", "MAX_INFLUENCE",
            "ARRIVE_INFLUENCE", "DEFAULT_LEAVE_INFLUENCE", "DEFAULT_SMOOTHNESS"];
        var inf;
        for (inf = 0; inf < influenceNames.length; inf += 1) {
            var start = source.indexOf("var " + influenceNames[inf] + " =");
            code.push(source.substring(start, source.indexOf(";", start) + 1));
        }
        eval(code.join("\n"));
        log("extracted from the repository panel: " + names.join(", "));

        app.beginUndoGroup("Island Chatter Type-On verification");
        comp = app.project.items.addComp("IC TypeOn Verify", 640, 360, 1, 8, 30);
        var layer = comp.layers.addText("你好，島民！今天天氣真好。");

        var plan = { events: [] };
        for (var e = 0; e < 10; e += 1) {
            plan.events.push({ time: e * 0.2, duration: 0.188 });
        }

        function attempt(label) {
            try {
                updateTypeOn(layer, plan, 0, typeOnCurve(), 40);
                log("PASS  " + label);
                return true;
            } catch (err) {
                log("FAIL  " + label + " -> " + err.toString());
                return false;
            }
        }

        var ok = true;
        ok = attempt("first apply") && ok;
        ok = attempt("repeat apply") && ok;
        ok = attempt("third apply") && ok;

        // Verify the animator really was built and the reveal actually animates.
        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        log("animator count: " + animators.numProperties + " (expected 1, no duplicates)");
        var animator = null;
        for (var a = 1; a <= animators.numProperties; a += 1) {
            if (animators.property(a).name === "Island Chatter Type-On") { animator = animators.property(a); }
        }
        if (!animator) { throw new Error("animator was not created"); }
        var selectors = animator.property("ADBE Text Selectors");
        log("selector count: " + selectors.numProperties + " (expected 1, no duplicates)");
        var reveal = null;
        for (var s = 1; s <= selectors.numProperties; s += 1) {
            if (selectors.property(s).name === "Island Chatter Reveal") { reveal = selectors.property(s); }
        }
        var startProp = null, endProp = null;
        for (var d = 1; d <= reveal.numProperties; d += 1) {
            if (reveal.property(d).matchName === "ADBE Text Percent Start") { startProp = reveal.property(d); }
            if (reveal.property(d).matchName === "ADBE Text Percent End") { endProp = reveal.property(d); }
        }
        log("Percent End value: " + endProp.value + " (expected 100)");
        log("Percent Start keys: " + startProp.numKeys + " (expected 11)");
        log("Start at t=0: " + startProp.valueAtTime(0, false) +
            "  at t=2.5: " + startProp.valueAtTime(2.5, false) + " (expected to rise)");
        var opacity = null;
        var props = animator.property("ADBE Text Animator Properties");
        for (var p = 1; p <= props.numProperties; p += 1) {
            if (props.property(p).matchName === "ADBE Text Opacity") { opacity = props.property(p); }
        }
        log("Opacity value: " + opacity.value + " (expected 0)");

        var advanced = null;
        for (var v = 1; v <= reveal.numProperties; v += 1) {
            if (reveal.property(v).matchName === "ADBE Text Range Advanced") {
                advanced = reveal.property(v);
            }
        }
        var smoothness = null;
        if (advanced) {
            for (var w = 1; w <= advanced.numProperties; w += 1) {
                if (advanced.property(w).matchName === "ADBE Text Selector Smoothness") {
                    smoothness = advanced.property(w);
                }
            }
        }
        // Smoothness is a panel slider now, so every value must reach the host.
        var smoothOk = true;
        var wantSmooth;
        for (var sIndex = 0; sIndex < 4; sIndex += 1) {
            wantSmooth = [0, 25, 40, 100][sIndex];
            updateTypeOn(layer, plan, 0, typeOnCurve(), wantSmooth);
            if (Math.abs(smoothness.value - wantSmooth) > 0.01) {
                smoothOk = false;
                log("    smoothness " + wantSmooth + " read back as " + smoothness.value);
            }
        }
        log(smoothOk ? "PASS  every Smoothness value reaches the selector"
                     : "FAIL  Smoothness did not round-trip");
        if (!smoothOk) { ok = false; }

        // The reveal itself must follow the curve now, not hold.
        updateTypeOn(layer, plan, 0, typeOnCurve(0.1), 40);
        var revealEased =
            startProp.keyOutInterpolationType(1) === KeyframeInterpolationType.BEZIER;
        log(revealEased ? "PASS  the reveal keyframes follow the curve"
                        : "FAIL  the reveal keyframes are still held");
        if (!revealEased) { ok = false; }
        var revealKey = Math.min(2, startProp.numKeys);
        var revealOut = startProp.keyOutTemporalEase(revealKey)[0].influence;
        var revealIn = startProp.keyInTemporalEase(revealKey)[0].influence;
        log("reveal influence: out " + revealOut.toFixed(1) + ", in " + revealIn.toFixed(1) +
            " (expected 0.1 / " + ARRIVE_INFLUENCE + ")");
        if (Math.abs(revealOut - 0.1) > 1 || Math.abs(revealIn - ARRIVE_INFLUENCE) > 1) {
            ok = false;
            log("FAIL  the reveal curve does not match the Leave slider");
        } else {
            log("PASS  the reveal curve matches the Leave slider");
        }
        // The Leave slider must actually move the reveal, not just the glide.
        updateTypeOn(layer, plan, 0, typeOnCurve(70), 40);
        var movedOut = startProp.keyOutTemporalEase(revealKey)[0].influence;
        log(Math.abs(movedOut - 70) < 1
            ? "PASS  Leave 70 reaches the reveal (" + movedOut.toFixed(1) + ")"
            : "FAIL  Leave 70 did not reach the reveal (" + movedOut.toFixed(1) + ")");
        if (Math.abs(movedOut - 70) > 1) { ok = false; }
        updateTypeOn(layer, plan, 0, typeOnCurve(), 40);

        // Now the case the previous fix was aimed at: user keyframes the
        // properties the panel writes, then applies again.
        opacity.setValueAtTime(0, 0);
        opacity.setValueAtTime(1, 50);
        endProp.setValueAtTime(0, 100);
        log("user added keyframes: opacity=" + opacity.numKeys + " end=" + endProp.numKeys);
        ok = attempt("apply after user keyframed Opacity and End") && ok;

        // --- centring ---------------------------------------------------------
        var textDoc = layer.property("ADBE Text Properties").property("ADBE Text Document");
        var centred = textDoc.value;
        centred.justification = ParagraphJustification.CENTER_JUSTIFY;
        textDoc.setValue(centred);

        var counts = [1, 4, 8, String(textDoc.value.text).length];
        var widths = measureRevealWidths(comp, layer, counts);
        log("measured widths for " + counts.join("/") + " characters: " + widths.join(", "));
        var rising = true;
        for (var m = 1; m < widths.length; m += 1) {
            if (!(widths[m] > widths[m - 1])) { rising = false; }
        }
        if (!widths[widths.length - 1]) {
            ok = false;
            log("FAIL  sourceRectAtTime measured a zero width; centring cannot work");
        } else if (!rising) {
            ok = false;
            log("FAIL  measured widths do not grow with the character count");
        } else {
            log("PASS  partial text widths grow monotonically");
        }
        var layersAfterMeasure = comp.numLayers;

        try {
            updateTypeOnCentering(comp, layer, plan);
            log("PASS  centring applied");
        } catch (centerError) {
            ok = false;
            log("FAIL  centring threw -> " + centerError.toString());
        }
        if (comp.numLayers !== layersAfterMeasure) {
            ok = false;
            log("FAIL  the measuring probe layer was left behind");
        } else {
            log("PASS  no probe layer left in the composition");
        }

        var centerAnimator = null;
        var allAnimators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        for (var g = 1; g <= allAnimators.numProperties; g += 1) {
            if (allAnimators.property(g).name === CENTER_ANIMATOR_NAME) {
                centerAnimator = allAnimators.property(g);
            }
        }
        if (!centerAnimator) {
            ok = false;
            log("FAIL  the centring animator was not created");
        } else {
            var offsetProp = null;
            var centerProps = centerAnimator.property("ADBE Text Animator Properties");
            for (var h = 1; h <= centerProps.numProperties; h += 1) {
                if (centerProps.property(h).matchName === "ADBE Text Position 3D") {
                    offsetProp = centerProps.property(h);
                }
            }
            if (!offsetProp || offsetProp.numKeys === 0) {
                ok = false;
                log("FAIL  the centring offset has no keyframes");
            } else {
                var firstX = offsetProp.keyValue(1)[0];
                var lastX = offsetProp.keyValue(offsetProp.numKeys)[0];
                log("offset x: first " + firstX.toFixed(2) + ", last " + lastX.toFixed(2) +
                    " over " + offsetProp.numKeys + " keys");
                if (Math.abs(lastX) > 0.51) {
                    ok = false;
                    log("FAIL  the final offset is not zero; the last frame would be off-centre");
                } else {
                    log("PASS  the offset returns to zero, so the finished text sits where AE laid it out");
                }
                if (!(firstX > 1)) {
                    ok = false;
                    log("FAIL  the first offset does not push the opening text right");
                } else {
                    log("PASS  the reveal starts shifted right and glides back");
                }
                var eased = offsetProp.keyOutInterpolationType(1) === KeyframeInterpolationType.BEZIER;
                log(eased ? "PASS  keyframes are eased, not held"
                          : "FAIL  keyframes are not eased");
                if (!eased) { ok = false; }

                // The default must actually be fast-to-slow: leaving a key at
                // speed, arriving at the next one decelerating. Equal influence
                // on both sides would read as slow-fast-slow instead.
                var probeKey = Math.min(2, offsetProp.numKeys);
                var outInf = offsetProp.keyOutTemporalEase(probeKey)[0].influence;
                var inInf = offsetProp.keyInTemporalEase(probeKey)[0].influence;
                log("default curve influence: out " + outInf.toFixed(1) +
                    ", in " + inInf.toFixed(1));
                if (!(inInf > outInf * 5)) {
                    ok = false;
                    log("FAIL  the default curve is not fast-to-slow");
                } else {
                    log("PASS  the default curve decelerates into each position");
                }
            }
        }

        // Any pair of slider values must reach the host intact, including the
        // clamped ends of the range.
        var pairs = [[0.1], [25], [50], [100], [-5], [250]];
        var pairIndex;
        for (pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
            var wanted = typeOnCurve(pairs[pairIndex][0]);
            updateTypeOnCentering(comp, layer, plan, wanted);
            var animatorsNow = layer.property("ADBE Text Properties").property("ADBE Text Animators");
            var centerNow = null;
            var n;
            for (n = 1; n <= animatorsNow.numProperties; n += 1) {
                if (animatorsNow.property(n).name === CENTER_ANIMATOR_NAME) {
                    centerNow = animatorsNow.property(n);
                }
            }
            var propsNow = centerNow.property("ADBE Text Animator Properties");
            var offsetNow = null;
            for (n = 1; n <= propsNow.numProperties; n += 1) {
                if (propsNow.property(n).matchName === "ADBE Text Position 3D") {
                    offsetNow = propsNow.property(n);
                }
            }
            var key = Math.min(2, offsetNow.numKeys);
            var gotOut = offsetNow.keyOutTemporalEase(key)[0].influence;
            var gotIn = offsetNow.keyInTemporalEase(key)[0].influence;
            var matches = Math.abs(gotOut - wanted.outInfluence) < 1 &&
                Math.abs(gotIn - wanted.inInfluence) < 1;
            log((matches ? "PASS  " : "FAIL  ") + "leave " + pairs[pairIndex][0] +
                " -> out " + gotOut.toFixed(1) +
                ", in " + gotIn.toFixed(1) + " (wanted " + wanted.outInfluence +
                "/" + wanted.inInfluence + ")");
            if (!matches) { ok = false; }
        }

        // Restore the default for the repeat check below.
        updateTypeOnCentering(comp, layer, plan, typeOnCurve());
        if (true) {
            if (true) {
            }
        }

        // Re-running must not stack up animators or keyframes.
        var beforeRepeat = allAnimators.numProperties;
        updateTypeOnCentering(comp, layer, plan);
        log(layer.property("ADBE Text Properties").property("ADBE Text Animators").numProperties
                === beforeRepeat
            ? "PASS  repeat centring did not add another animator"
            : "FAIL  repeat centring duplicated the animator");

        log(ok ? "RESULT: all Type-On applies succeeded" : "RESULT: at least one apply FAILED");
    } catch (fatal) {
        log("FATAL: " + fatal.toString() + (fatal.line ? " (line " + fatal.line + ")" : ""));
    } finally {
        try { if (comp) { comp.remove(); } } catch (c) {}
        try { app.endUndoGroup(); } catch (u) {}
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
    }
}());

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
            "findNamedProperty", "findPropertyByMatchName", "updateTypeOn"];
        var code = [];
        for (var n = 0; n < names.length; n += 1) { code.push(take(names[n])); }
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
                updateTypeOn(layer, plan, 0);
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

        // Now the case the previous fix was aimed at: user keyframes the
        // properties the panel writes, then applies again.
        opacity.setValueAtTime(0, 0);
        opacity.setValueAtTime(1, 50);
        endProp.setValueAtTime(0, 100);
        log("user added keyframes: opacity=" + opacity.numKeys + " end=" + endProp.numKeys);
        ok = attempt("apply after user keyframed Opacity and End") && ok;

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

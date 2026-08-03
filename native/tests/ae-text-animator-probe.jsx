// Island Chatter Type-On diagnostic, pass 2: confirm canAddProperty() is the
// reliable way to tell an added animator property from a hidden placeholder.
(function () {
    var root = new File($.fileName).parent.parent.parent.fsName.replace(/\\/g, "/");
    var out = new File(root + "/ae-text-animator-probe-result.txt");
    var lines = [];
    function log(text) { lines.push(String(text)); }

    function trySet(label, prop, value) {
        if (!prop) { log("SET " + label + ": <null>"); return false; }
        try { prop.setValue(value); log("SET " + label + ": OK"); return true; }
        catch (err) { log("SET " + label + ": FAILED -> " + err.toString()); return false; }
    }

    var comp = null;
    try {
        app.beginUndoGroup("Island Chatter Type-On diagnostic 2");
        comp = app.project.items.addComp("IC TypeOn Diag 2", 320, 240, 1, 5, 30);
        var layer = comp.layers.addText("你好島民");
        var animator = layer.property("ADBE Text Properties")
            .property("ADBE Text Animators").addProperty("ADBE Text Animator");
        animator.name = "Island Chatter Type-On";

        var props = animator.property("ADBE Text Animator Properties");
        log("canAddProperty('ADBE Text Opacity') BEFORE add: " +
            props.canAddProperty("ADBE Text Opacity"));
        log("setValue BEFORE add:");
        trySet("  opacity placeholder", props.property("ADBE Text Opacity"), 0);

        var added = props.addProperty("ADBE Text Opacity");
        log("after addProperty, numProperties=" + props.numProperties);
        log("canAddProperty('ADBE Text Opacity') AFTER add: " +
            props.canAddProperty("ADBE Text Opacity"));
        trySet("  opacity via returned handle", added, 0);
        trySet("  opacity via property(matchName)", props.property("ADBE Text Opacity"), 0);

        // Where does the added one sit, and how do we recognise it later?
        var reProps = layer.property("ADBE Text Properties").property("ADBE Text Animators")
            .property(1).property("ADBE Text Animator Properties");
        log("re-looked-up numProperties=" + reProps.numProperties);
        log("canAddProperty after re-lookup: " + reProps.canAddProperty("ADBE Text Opacity"));
        trySet("  opacity after re-lookup", reProps.property("ADBE Text Opacity"), 0);

        // Selectors: empty until we add one.
        var sels = animator.property("ADBE Text Selectors");
        log("selectors numProperties=" + sels.numProperties +
            ", canAddProperty('ADBE Text Selector')=" + sels.canAddProperty("ADBE Text Selector"));
        var sel = sels.addProperty("ADBE Text Selector");
        sel.name = "Island Chatter Reveal";
        log("after adding selector, numProperties=" + sels.numProperties);
        log("selector children:");
        for (var i = 1; i <= sel.numProperties; i += 1) {
            log("   [" + i + "] name='" + sel.property(i).name +
                "' match='" + sel.property(i).matchName + "'");
        }
        trySet("  percent END", sel.property("ADBE Text Percent End"), 100);
        trySet("  percent START", sel.property("ADBE Text Percent Start"), 0);

        // Does adding twice duplicate it?
        log("adding opacity a second time...");
        try {
            reProps.addProperty("ADBE Text Opacity");
            log("  second addProperty OK, numProperties=" + reProps.numProperties);
        } catch (dup) {
            log("  second addProperty threw -> " + dup.toString());
        }
    } catch (fatal) {
        log("FATAL: " + fatal.toString() + (fatal.line ? " (line " + fatal.line + ")" : ""));
    } finally {
        try { if (comp) { comp.remove(); } } catch (e) {}
        try { app.endUndoGroup(); } catch (e2) {}
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
    }
}());

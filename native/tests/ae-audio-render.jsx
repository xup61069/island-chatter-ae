#target aftereffects

/*
 * Renders a Chinese text layer carrying the Island Chatter effect to a WAV via
 * the render queue, so the whole chain - panel, hidden parameters, Tone
 * bootstrap, PF_Cmd_AUDIO_RENDER - can be measured instead of assumed.
 * Removes its own composition and render-queue item afterwards.
 */
(function () {
    var root = new File($.fileName).parent.parent.parent.fsName.replace(/\\/g, "/");
    var out = new File(root + "/ae-audio-render-result.txt");
    var wavPath = root + "/ae-audio-render-output";
    var lines = [];
    function log(text) {
        lines.push(String(text));
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
    }

    var comp = null;
    var rqItem = null;
    try {
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
        eval(source.substring(bodyStart + 1, bodyEnd));

        var templates = app.project.renderQueue.numItems >= 0 ? [] : [];
        app.beginUndoGroup("Island Chatter audio render");

        comp = app.project.items.addComp("IC Audio Render", 320, 240, 1, 10, 30);
        comp.openInViewer();
        var layer = comp.layers.addText("你好，島民！今天天氣真好。");
        applyToTextLayer(comp, layer, "", {
            voice: 0, pitch: 1.0, speed: 1.0, volume: 0.9, consonant: 1.25,
            emotion: 0, characterSize: 2, clarity: 0.78, cuteness: 0.55, seed: 4242
        }, { markers: false, fitDuration: true, controllers: false, typeOn: false });
        log("layer duration after Fit Duration: " + (layer.outPoint - layer.inPoint).toFixed(3) + "s");
        comp.duration = Math.max(1, layer.outPoint);
        comp.workAreaStart = 0;
        comp.workAreaDuration = comp.duration;

        rqItem = app.project.renderQueue.items.add(comp);
        var om = rqItem.outputModule(1);
        log("available output module templates: " + om.templates.join(", "));

        // A stock After Effects install ships no WAV template, but "AIFF 48kHz"
        // is audio-only and uncompressed, which is all this measurement needs.
        var chosen = "";
        var wanted = ["WAV", "AIFF", "AUDIO"];
        for (var wi = 0; wi < wanted.length && !chosen; wi += 1) {
            for (var t = 0; t < om.templates.length; t += 1) {
                if (String(om.templates[t]).toUpperCase().indexOf(wanted[wi]) >= 0) {
                    chosen = om.templates[t];
                    break;
                }
            }
        }
        if (!chosen) { throw new Error("no WAV, AIFF or audio-only output module template is available"); }
        log("using output module template: " + chosen);
        om.applyTemplate(chosen);
        var wavFile = new File(wavPath);
        if (wavFile.exists) { wavFile.remove(); }
        om.file = wavFile;

        rqItem.render = true;
        for (var q = 1; q <= app.project.renderQueue.numItems; q += 1) {
            if (app.project.renderQueue.item(q) !== rqItem) { app.project.renderQueue.item(q).render = false; }
        }
        log("rendering...");
        app.project.renderQueue.render();
        log("render status: " + rqItem.status.toString());

        var produced = new File(wavPath);
        if (!produced.exists) {
            // Some templates append their own extension.
            var folder = new Folder(root);
            var candidates = folder.getFiles("ae-audio-render-output*");
            log("expected file missing; found: " +
                (candidates.length ? candidates.join(", ") : "nothing"));
            if (candidates.length) { produced = candidates[0]; }
        }
        if (produced.exists) {
            log("WAV written: " + produced.fsName + " (" + produced.length + " bytes)");
        } else {
            log("FAIL: no audio file was produced");
        }
    } catch (fatal) {
        log("FATAL: " + fatal.toString() + (fatal.line ? " (line " + fatal.line + ")" : ""));
    } finally {
        try { if (rqItem) { rqItem.remove(); } } catch (r) {}
        try { if (comp) { comp.remove(); } } catch (c) {}
        try { app.endUndoGroup(); } catch (u) {}
        log("done");
    }
}());

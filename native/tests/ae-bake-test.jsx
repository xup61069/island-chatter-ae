#target aftereffects

/*
 * Verifies the panel's Bake command end to end: island_chatter_bake writes a
 * WAV into "Island Chatter Audio" beside the project file, the panel imports it
 * as a layer at the right time, and the live effect is muted so the voice is
 * not heard twice.
 *
 * Bake needs a saved project, so this test refuses to run unless After Effects
 * is sitting on an empty untitled project. It saves to a temporary folder and
 * removes everything it created.
 */
(function () {
    var root = new File($.fileName).parent.parent.parent.fsName.replace(/\\/g, "/");
    var out = new File(root + "/ae-bake-test-result.txt");
    var lines = [];
    var failures = 0;

    function log(text) {
        lines.push(String(text));
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
    }
    function check(condition, label) {
        if (condition) { log("PASS  " + label); }
        else { failures += 1; log("FAIL  " + label); }
        return condition;
    }

    var workFolder = null;
    try {
        if (app.project && (app.project.file || app.project.numItems > 0)) {
            log("SKIP  an existing project is open; close it first so bake can save a test project");
            log("done");
            return;
        }

        var panelFile = new File(root + "/native/panel/IslandChatterNativePanel.jsx");
        panelFile.encoding = "UTF-8";
        panelFile.open("r");
        var source = panelFile.read();
        panelFile.close();
        var bodyStart = source.indexOf("{", source.indexOf("function islandChatterNativePanel("));
        var bodyEnd = source.indexOf("var panel = buildUI(thisObj);");
        eval(source.substring(bodyStart + 1, bodyEnd));
        log("loaded the real panel body");

        check(bakeToolFile() !== null,
            "island_chatter_bake.exe is installed beside the plug-in");

        app.newProject();
        workFolder = new Folder(Folder.temp.fsName + "/IslandChatterBakeTest");
        if (workFolder.exists) {
            var stale = workFolder.getFiles();
            for (var s = 0; s < stale.length; s += 1) {
                if (stale[s] instanceof Folder) {
                    var inner = stale[s].getFiles();
                    for (var t = 0; t < inner.length; t += 1) { inner[t].remove(); }
                    stale[s].remove();
                } else { stale[s].remove(); }
            }
        } else {
            workFolder.create();
        }
        var projectFile = new File(workFolder.fsName + "/bake-test.aep");
        app.project.save(projectFile);
        log("test project saved to " + projectFile.fsName);

        var comp = app.project.items.addComp("IC Bake", 640, 360, 1, 20, 30);
        comp.openInViewer();
        var layer = comp.layers.addText("你好，島民！今天天氣真好。");
        layer.name = "Bake Me";
        layer.startTime = 2;

        var settings = {
            voice: 0, pitch: 1.0, speed: 1.0, volume: 0.78, consonant: 1.25,
            emotion: 0, characterSize: 2, clarity: 0.78, cuteness: 0.55, seed: 4242,
            tempoLock: false
        };
        applyToTextLayer(comp, layer, "", settings,
            { markers: false, fitDuration: true, controllers: false, typeOn: false });
        var expected = planFromEngine(findNativeEffect(layer)).duration;

        var layersBefore = comp.numLayers;
        var folder = bakeFolder();
        check(folder.fsName.replace(/\\/g, "/") ===
            (workFolder.fsName.replace(/\\/g, "/") + "/Island Chatter Audio"),
            "the audio folder is created beside the project file");

        var produced = bakeToLayer(comp, layer, folder);
        check(produced.exists, "a WAV was written");
        check(produced.length > 10000, "the WAV is not empty (" + produced.length + " bytes)");
        // 16-bit mono at 48 kHz: 44 byte header plus two bytes per sample.
        var seconds = (produced.length - 44) / 2 / 48000;
        check(Math.abs(seconds - expected) < 0.05,
            "the WAV is " + seconds.toFixed(3) + "s, expected about " + expected.toFixed(3) + "s");

        check(comp.numLayers === layersBefore + 1, "exactly one audio layer was added");
        var baked = null;
        for (var i = 1; i <= comp.numLayers; i += 1) {
            if (comp.layer(i).name === "Bake Me (baked)") { baked = comp.layer(i); }
        }
        check(baked !== null, "the baked layer is present");
        if (baked) {
            check(Math.abs(baked.startTime - layer.inPoint) < 0.001,
                "the baked layer starts at the text layer's in point");
            check(baked.hasAudio, "the baked layer carries audio");
        }
        var effect = findNativeEffect(layer);
        check(effect && effect.enabled === false, "the live effect was muted");
        var tone = findToneBootstrap(layer);
        check(tone && tone.enabled === false, "the Tone bootstrap was muted");

        // Baking again must overwrite rather than pile up files.
        var filesBefore = folder.getFiles("*.wav").length;
        effect.enabled = true;
        bakeToLayer(comp, layer, folder);
        check(folder.getFiles("*.wav").length === filesBefore,
            "re-baking reused the same file instead of creating another");

        log("");
        log(failures === 0 ? "RESULT: PASS" : "RESULT: FAIL (" + failures + ")");
    } catch (fatal) {
        failures += 1;
        log("FATAL: " + fatal.toString() + (fatal.line ? " (line " + fatal.line + ")" : ""));
        log("RESULT: FAIL");
    } finally {
        try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (closeError) {}
        try {
            if (workFolder && workFolder.exists) {
                var left = workFolder.getFiles();
                for (var c = 0; c < left.length; c += 1) {
                    if (left[c] instanceof Folder) {
                        var kids = left[c].getFiles();
                        for (var k = 0; k < kids.length; k += 1) { kids[k].remove(); }
                        left[c].remove();
                    } else { left[c].remove(); }
                }
                workFolder.remove();
            }
        } catch (cleanupError) { log("cleanup: " + cleanupError.toString()); }
        log("done");
    }
}());

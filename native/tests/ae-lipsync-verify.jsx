/*
 * Island Chatter — does lip-sync from a recording actually work in the host?
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * The engine side of this is covered by analysis_tests.cpp, which can say to
 * the millisecond how well the syllables were found. What no portable test can
 * see is everything between the file and the face: whether After Effects hands
 * back a footage layer this recognises, whether the markers land, whether the
 * layer joins the rig, whether a trimmed layer really drops the events outside
 * the trim, and whether Rebuild finds an audio line at all — `rigMembers()`
 * accepted only text layers until 2.3.0 and would silently rebuild the rig
 * without this one in it.
 *
 * Builds its own composition and its own WAV, removes both, and saves nothing.
 * Writes each line as it goes, so a crash still leaves the evidence.
 */
(function aeLipSyncVerify() {
    var path = "G:/AICODE/island-chatter-ae/ae-lipsync-verify-result.txt";
    var checks = 0;
    var failures = 0;

    var first = new File(path);
    first.encoding = "UTF-8";
    first.open("w");
    first.write("verifying\n");
    first.close();

    function say(text) {
        var out = new File(path);
        out.encoding = "UTF-8";
        out.open("a");
        out.write(text + "\n");
        out.close();
    }

    function check(condition, what) {
        checks += 1;
        if (!condition) { failures += 1; }
        say((condition ? "PASS  " : "FAIL  ") + what);
    }

    var comp = null;
    var wavFile = null;
    try {
        var panelFile = new File(new File($.fileName).parent.parent.fsName +
            "/panel/IslandChatterNativePanel.jsx");
        panelFile.encoding = "UTF-8";
        panelFile.open("r");
        var source = panelFile.read();
        panelFile.close();
        var bodyStart = source.indexOf("{",
            source.indexOf("function islandChatterNativePanel("));
        var bodyEnd = source.indexOf("var panel = buildUI(thisObj);");
        eval(source.substring(bodyStart + 1, bodyEnd));
        say("panel body evaluated");

        // Its own recording, made by the tool that ships beside the plug-in, so
        // the test carries no audio of its own and also proves the tool is
        // where the panel thinks it is.
        var tool = bakeToolFile();
        check(tool !== null, "island_chatter_bake.exe is where the panel looks for it");
        if (!tool) { throw new Error("no engine tool; nothing further can run"); }

        var wavPath = Folder.temp.fsName.replace(/\\/g, "/") + "/ic-lipsync-test.wav";
        wavFile = new File(wavPath);
        if (wavFile.exists) { wavFile.remove(); }
        var baked = system.callSystem(quoted(tool.fsName) +
            " --out-hex " + hexUtf8(wavPath) +
            " --text " + hexUtf8("你好，歡迎來到小島！") +
            " --rate " + ENGINE_SAMPLE_RATE);
        wavFile = new File(wavPath);
        check(wavFile.exists, "the engine wrote a WAV to work from (" + baked + ")");
        if (!wavFile.exists) { throw new Error("no WAV to analyse"); }

        comp = app.project.items.addComp("Island Chatter Lip-sync Test", 640, 360, 1, 12, 30);
        comp.openInViewer();
        var imported = app.project.importFile(new ImportOptions(wavFile));
        var layer = comp.layers.add(imported);
        check(layerHasAudio(layer), "an imported WAV reads as a layer with audio");
        check(audioSourceFile(layer) !== null, "the file behind the layer is found");

        // What the engine says about the same recording, for comparison.
        var direct = planFromAudio(wavFile, { sensitivity: 0.5, vowels: true });
        check(direct.events.length > 0,
            "the analyser found " + direct.events.length + " syllables in it");
        check(direct.duration > 1.5 && direct.duration < 2.5,
            "the plan's duration is the file's, " + direct.duration.toFixed(3) + "s");

        var rigLayer = ensureRigLayer(comp, "Lip-sync Test");
        var plan = lipSyncLayer(comp, layer, { sensitivity: 0.5, vowels: true }, rigLayer);
        check(plan.events.length === direct.events.length,
            "an untrimmed layer keeps every event");
        check(isAudioLine(layer), "the layer is marked as an audio line");
        check(findNamedEffect(layer, "IC Audio Line").property(1).value === 50,
            "the sensitivity it was analysed with is recorded on the layer");
        check(rigTargetLayer(comp, layer) !== null &&
              rigTargetLayer(comp, layer).index === rigLayer.index,
            "the layer points at the rig");

        // The part that had to change: a rig walk that only knew about text.
        var members = rigMembers(comp, rigLayer);
        var found = false;
        var index;
        for (index = 0; index < members.length; index += 1) {
            if (members[index].index === layer.index) { found = true; }
        }
        check(found, "rigMembers() sees an audio line as a member");

        var merged = rebuildSharedRig(comp, rigLayer, null);
        check(merged.lines === 1, "the rebuilt rig has the one line in it");
        var mouth = findNamedEffect(rigLayer, "IC Mouth");
        check(mouth !== null, "the rig has an IC Mouth slider");
        check(mouth && mouth.property(1).numKeys > direct.events.length,
            "IC Mouth carries a key per shape and per close (" +
            (mouth ? mouth.property(1).numKeys : 0) + " keys for " +
            direct.events.length + " syllables)");

        // A mouth that never closes is the failure this would not otherwise
        // catch: every event would still be there and every key would be a
        // number, and the face would simply hang open.
        var closes = 0;
        var opens = 0;
        var keyAt;
        for (keyAt = 1; mouth && keyAt <= mouth.property(1).numKeys; keyAt += 1) {
            if (mouth.property(1).keyValue(keyAt) === 0) { closes += 1; } else { opens += 1; }
        }
        check(closes > 0 && opens > 0,
            "the mouth both opens and closes (" + opens + " open, " + closes + " shut)");

        // Silence between syllables is what closes it, so a recording with a
        // pause in it must close more often than one without. Nothing else in
        // the suite would notice if the pause rule stopped applying to audio.
        check(closes >= 2, "a spoken line closes the mouth more than once");

        // Trimming. The events outside the trim belong to audio nobody hears.
        layer.inPoint = layer.startTime + 1.0;
        var trimmed = planWithinLayer(direct, layer);
        check(trimmed.events.length < direct.events.length,
            "trimming drops the events before the in point (" +
            trimmed.events.length + " of " + direct.events.length + ")");
        var earliest = trimmed.events.length ? trimmed.events[0].time : 999;
        check(earliest >= 1.0 - 0.0001,
            "no event survives from before the trim, earliest is " + earliest.toFixed(3));
        layer.inPoint = layer.startTime;

        // Time stretch is refused rather than silently mistimed.
        layer.stretch = 50;
        var refused = "";
        try {
            lipSyncLayer(comp, layer, { sensitivity: 0.5, vowels: true }, rigLayer);
        } catch (stretchError) {
            refused = String(stretchError.message || stretchError);
        }
        check(refused.length > 0, "a time-stretched layer is refused: " + refused);
        layer.stretch = 100;

        // And a layer that is not audio at all.
        var solid = comp.layers.addSolid([1, 1, 1], "not audio", 100, 100, 1);
        var solidRefused = "";
        try {
            lipSyncLayer(comp, solid, { sensitivity: 0.5, vowels: true }, rigLayer);
        } catch (solidError) {
            solidRefused = String(solidError.message || solidError);
        }
        check(solidRefused.length > 0, "a solid is refused: " + solidRefused);
    } catch (error) {
        check(false, "the suite threw: " + error.toString() +
            (error.line ? " at line " + error.line : ""));
    } finally {
        try {
            if (comp) { comp.remove(); }
            // An imported WAV is only released by a purge (invariant 8g), and
            // this one is in the temp folder waiting to be deleted.
            app.purge(PurgeTarget.ALL_CACHES);
            if (wavFile && wavFile.exists) { wavFile.remove(); }
        } catch (cleanupError) { say("cleanup: " + cleanupError.toString()); }
        say("");
        say("checks: " + checks + "   failures: " + failures);
        say("RESULT: " + (failures === 0 ? "PASS" : "FAIL"));
        say("done");
    }
}());

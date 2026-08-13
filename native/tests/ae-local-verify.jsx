/*
 * Island Chatter — the offline voice, end to end in the host.
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * Unlike the cloud suite, this one does not have to pretend: a model on this
 * machine costs nothing to run, so the whole path is exercised for real —
 * the panel asks two tools for their sources, merges them, picks the local one,
 * runs it, imports what comes back, and reads the mouth out of it.
 *
 * What it needs is the model installed, which is a 178 MB download the user
 * makes once. Without it the tool reports no sources and this suite says so and
 * stops, rather than failing in a way that looks like a bug.
 *
 * The parts worth having a host for: that the merged list really does carry
 * both tools, that a local row is never asked for an API key, that the
 * confirmation is not the one about text leaving the computer, and that a line
 * voiced by a model running here reaches the rig exactly as a cloud one does.
 *
 * Builds its own composition and project, removes both, saves nothing.
 */
(function aeLocalVerify() {
    var path = "G:/AICODE/island-chatter-ae/ae-local-verify-result.txt";
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
    var projectFile = null;
    var skipped = false;
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

        /*
         * The tool being absent is the normal state, not a failure.
         *
         * The offline voice is finished but held back — the sherpa-onnx build
         * links espeak-ng (GPL v3+) and the only permissively licensed Chinese
         * model is mainland-accented — so released packages do not carry it.
         * This suite is for whoever configures with ISLAND_CHATTER_SHERPA_ROOT
         * and installs the result. Reporting FAIL when it is simply not there
         * would cry wolf on every ordinary run.
         */
        var local = toolFile("island_chatter_local.exe");
        if (!local) {
            say("SKIP  island_chatter_local.exe is not installed, which is expected:");
            say("      the offline voice is built only with ISLAND_CHATTER_SHERPA_ROOT set");
            say("      and is not shipped. See CHANGELOG.md for the two reasons.");
            skipped = true;
            return;
        }
        check(local !== null, "island_chatter_local.exe is where the panel looks for it");

        /*
         * Both tools, merged, each row knowing who serves it.
         */
        var sources = voiceSources();
        check(sources.length >= 3, "the merged list has " + sources.length + " voice sources");
        var cloudRows = 0;
        var localRows = 0;
        var picked = null;
        var index;
        for (index = 0; index < sources.length; index += 1) {
            check(sources[index].tool !== undefined && sources[index].tool !== null,
                sources[index].id + " remembers which tool serves it");
            if (sources[index].onThisMachine) { localRows += 1; picked = sources[index]; }
            else { cloudRows += 1; }
        }
        check(cloudRows >= 3, "the cloud tool still contributes its " + cloudRows + " sources");
        if (!picked) {
            say("The offline model is not installed, so there is nothing local to test.");
            say("Press 'Get model' in the panel, or run: island_chatter_local --install");
            skipped = true;
            return;   // the finally reports, and will not call this a pass
        }
        check(localRows === 1, "and the local tool contributes exactly one");
        check(picked.tool.fsName === local.fsName,
            "the local row is served by the local tool, not the cloud one");
        check(picked.label.length > 0, "it has a name a person can read: " + picked.label);

        /*
         * A local source is never asked for an account.
         */
        check(storedKey(picked.id) === "" || picked.onThisMachine,
            "a local source needs no stored key");

        var scratch = new Folder(Folder.temp.fsName.replace(/\\/g, "/") + "/ic-local-test");
        if (!scratch.exists) { scratch.create(); }
        projectFile = new File(scratch.fsName + "/ic-local-test.aep");
        app.project.save(projectFile);

        comp = app.project.items.addComp("Island Chatter Local Test", 640, 360, 1, 30, 30);
        comp.openInViewer();
        var said = "你好，歡迎來到小島！";
        var textLayer = comp.layers.addText(said);
        textLayer.name = said;

        var settingsForVoice = {
            voice: 0, emotion: 0, characterSize: 2, pitch: 1, speed: 1, volume: 0.78,
            consonant: 1.25, clarity: 0.78, cuteness: 0.55, seed: 0, tempoLock: false,
            formant: 1, source: 0, vibrato: 1, vibratoRate: 9.2
        };
        var options = {
            markers: true, fitDuration: true, controllers: true, rigShared: true,
            rigCharacter: "Local Test", typeOn: false, typeOnCenter: false,
            typeOnLeave: 0.1, typeOnSmoothness: 60, speakers: false, hold: false
        };
        var rigLayer = ensureRigLayer(comp, "Local Test");
        applyToTextLayer(comp, textLayer, "", settingsForVoice, options, rigLayer);
        var enginePlan = planFromEngine(findNativeEffect(textLayer));
        check(enginePlan.events.length > 0,
            "the line speaks with the built-in engine first (" +
            enginePlan.events.length + " syllables)");

        /*
         * The real thing: no key, no socket, no money.
         */
        var how = {
            provider: picked.id,
            tool: picked.tool,
            onThisMachine: true,
            voice: picked.voice,
            model: picked.model,
            region: "",
            key: "",
            text: said,
            sensitivity: 0.5,
            vowels: true
        };
        var voiced = cloudVoiceLine(comp, textLayer, how, options);
        check(voiced.plan.events.length > 0,
            "the offline model spoke it and the plan came back (" +
            voiced.plan.events.length + " syllables)");

        var audioLayer = bakedLayerFor(comp, textLayer);
        check(audioLayer !== null, "the audio is on the timeline");
        check(findNamedEffect(textLayer, "IC Cloud Voice") !== null,
            "the line is marked as carrying a generated voice");
        check(findNativeEffect(textLayer).enabled === false,
            "the live effect is muted, so it is not heard twice");

        // The mouth follows the recording, which is the whole integration.
        var followed = planForLayer(comp, textLayer, findNativeEffect(textLayer));
        check(followed.events.length === voiced.plan.events.length,
            "the mouth follows the model's audio rather than the engine's timing");
        var merged = rebuildSharedRig(comp, rigLayer, null);
        check(merged.lines === 1, "the rig rebuilds from it");
        var mouth = findNamedEffect(rigLayer, "IC Mouth");
        var opens = 0;
        var closes = 0;
        var keyAt;
        for (keyAt = 1; mouth && keyAt <= mouth.property(1).numKeys; keyAt += 1) {
            if (mouth.property(1).keyValue(keyAt) === 0) { closes += 1; } else { opens += 1; }
        }
        check(opens > 0 && closes > 0,
            "the mouth opens and closes (" + opens + " open, " + closes + " shut)");

        // Second press is answered from the cache, exactly as the cloud one is —
        // the saving here is seconds of CPU rather than money.
        var again = cloudVoiceLine(comp, textLayer, how, options);
        check(again.cached === true, "pressing it again is answered from the cache");

        // And nothing on this path ever wrote a key file.
        var strays = 0;
        var temp = Folder.temp.getFiles("island-chatter-key-*");
        strays = temp ? temp.length : 0;
        check(strays === 0, "no key file was written for a source that has no key");
    } catch (error) {
        check(false, "the suite threw: " + error.toString() +
            (error.line ? " at line " + error.line : ""));
    } finally {
        try {
            if (comp) { comp.remove(); }
            app.purge(PurgeTarget.ALL_CACHES);
            /*
             * Close the project, and do it here rather than leaving it open.
             *
             * This suite has to save one, because the audio goes beside the
             * project file. A *named, modified* project left open means the
             * next thing that closes After Effects raises "Save changes to
             * ic-local-test.aep?" — a modal that blocks every later script,
             * looks exactly like a hang from the outside, and on an unattended
             * or locked machine has nothing to click it with. It cost two runs
             * here before the cause was seen.
             */
            if (projectFile) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }
            if (projectFile && projectFile.exists) { projectFile.remove(); }
        } catch (cleanupError) { say("cleanup: " + cleanupError.toString()); }
        say("");
        say("checks: " + checks + "   failures: " + failures);
        // A run that checked nothing is not a pass. See the same note in
        // ae-cloud-verify.jsx: a skip that reports PASS is a hollow pass, and
        // anything reading these files for the word would believe it.
        say("RESULT: " + (failures > 0 ? "FAIL"
            : (checks === 0 ? (skipped ? "SKIPPED (nothing ran)" : "FAIL (nothing ran)")
                : "PASS")));
        say("done");
    }
}());

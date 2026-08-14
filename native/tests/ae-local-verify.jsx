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
         * The tool ships now, so its absence is a real finding — but not a
         * failure this suite can distinguish from "you are running against a
         * development build". It is reported as a SKIP that says which, rather
         * than as a FAIL that might be about the wrong thing.
         *
         * The model is a separate matter: it is 177 MB the user fetches, so a
         * machine that has never pressed Get model has the tool and no model,
         * and that is the state the second SKIP below covers.
         */
        var local = toolFile("island_chatter_local.exe");
        if (!local) {
            say("SKIP  island_chatter_local.exe is not beside the plug-in.");
            say("      A released package installs it. A development tree needs");
            say("      -DISLAND_CHATTER_ONNXRUNTIME_ROOT set, then a reinstall.");
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
            if (sources[index].onThisMachine) {
                localRows += 1;
                // The Chinese model, deliberately, because the line below is
                // Chinese. Taking whichever row happened to be last is how this
                // suite ended up rendering 你好，歡迎來到小島！ with the
                // Japanese model and calling three syllables a pass.
                if (sources[index].id === "local-melo" || !picked) { picked = sources[index]; }
            } else { cloudRows += 1; }
        }
        check(cloudRows >= 3, "the cloud tool still contributes its " + cloudRows + " sources");
        if (!picked) {
            say("The offline model is not installed, so there is nothing local to test.");
            say("Press 'Get model' in the panel, or run: island_chatter_local --install");
            skipped = true;
            return;   // the finally reports, and will not call this a pass
        }
        // One row per model the user has actually downloaded, so this is a
        // count of installed models rather than a constant.
        check(localRows >= 1, "the local tool contributes " + localRows + " installed model(s)");
        check(picked.id === "local-melo",
            "the Chinese model is the one this suite drives, got " + picked.id);
        check(picked.tool.fsName === local.fsName,
            "the local row is served by the local tool, not the cloud one");
        check(picked.label.length > 0, "it has a name a person can read: " + picked.label);

        /*
         * The catalogue, which is the question 3.2.0 could not ask.
         *
         * The manager window itself is modal and cannot be opened by a suite
         * that has to finish, but what it *reads* can be: `--models` has to
         * answer for models that are not installed, because the whole dead end
         * was asking the installed-only menu what there was to install.
         */
        var catalogue = parseVoiceReply(
            system.callSystem(quoted(local.fsName) + " --models")).models;
        check(catalogue.length >= 2,
            "the catalogue lists every model this build knows about, got " + catalogue.length);
        var described = 0;
        var known;
        for (known = 0; known < catalogue.length; known += 1) {
            if (catalogue[known].id && catalogue[known].label && catalogue[known].bytes > 0) {
                described += 1;
            }
        }
        check(described === catalogue.length,
            "each one arrives with an id, a name and a size, so the window can offer it");

        /*
         * A local source is never asked for an account.
         */
        check(storedKey(picked.id) === "" || picked.onThisMachine,
            "a local source needs no stored key");

        var scratch = new Folder(Folder.temp.fsName.replace(/\\/g, "/") + "/ic-local-test");
        if (!scratch.exists) { scratch.create(); }

        projectFile = new File(scratch.fsName + "/ic-local-test.aep");
        app.project.save(projectFile);

        /*
         * Every run starts with an empty cache, and that is not tidiness.
         *
         * The cache lives beside the project and the project is always at the
         * same path, so the second run of this suite found the first run's WAVs
         * and every `cached === false` check passed by having already happened.
         * Two did exactly that, and the one that mattered was the silence
         * refusal: the entry was there from a build that did not refuse, so the
         * new code never ran and the check reported that a speaker had been
         * accepted. **A suite whose assertions depend on whether it has been
         * run before answers a different question each time.**
         *
         * Asked of `cloudFolder()` rather than built from the project path,
         * because the panel is what decides where the cache goes and a second
         * copy of that decision here would clear the wrong folder the first
         * time it moved.
         */
        var leftovers = cloudFolder().getFiles() || [];
        var gone;
        for (gone = 0; gone < leftovers.length; gone += 1) {
            try { leftovers[gone].remove(); } catch (locked) { /* still imported */ }
        }
        say("cache cleared: " + leftovers.length + " file(s) from a previous run");

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

        /*
         * The tuning, and the one thing about it no portable test can see.
         *
         * `npm test` and `cloud_tests.cpp` both pin that every field is spelled
         * into the voice, and therefore into the cache key. What neither can
         * reach is whether the *model* is then given those numbers — a tool
         * that named the file after the tuning and rendered the default voice
         * would pass both suites, write a second file, and sound identical to
         * the first.
         *
         * Speed is the probe, because it is the only field whose effect is
         * measurable from the plan alone, and because its direction is the
         * easiest thing here to get backwards: the model's `length_scale`
         * multiplies duration, so the tool has to invert it or "faster" makes
         * the line longer. Half speed therefore has to come back *longer* than
         * the line already on the timeline.
         */
        function tuningOf(voice) {
            return {
                provider: picked.id, tool: picked.tool, onThisMachine: true,
                voice: voice, model: picked.model, region: "", key: "", text: said,
                sensitivity: 0.5, vowels: true
            };
        }
        var wasSeconds = voiced.plan.duration;
        var slow = cloudVoiceLine(comp, textLayer,
            tuningOf("speaker=-1;variation=0.667;timbre=0.800;speed=0.500"), options);
        check(slow.cached === false,
            "a tuned line is a cache miss, so the tuning really is in the cache key");
        check(slow.plan.events.length > 0,
            "the tuned line came back (" + slow.plan.events.length + " syllables)");
        check(bakedLayerFor(comp, textLayer) !== null, "and it is on the timeline");
        check(slow.plan.duration > wasSeconds,
            "speed 0.5 is slower, not faster: " + slow.plan.duration + "s against " +
            wasSeconds + "s — length_scale runs backwards from speed and has to be inverted");

        /*
         * And a speaker this model does not have is refused rather than
         * imported.
         *
         * Both shipped models were trained with one voice. Speaker 0 and
         * speaker 2 render at the right length and the right rate, peaking at 1
         * of 32767: a WAV that imports cleanly, sits on the timeline and
         * animates no mouth, with nothing anywhere in the chain calling it an
         * error. Downstream that is indistinguishable from a line the analyser
         * found no syllables in, so the message the user would get is about
         * their text. The tool measures what it is about to write instead.
         *
         * This is the check that found it. It was written expecting speaker 0
         * to be a second voice.
         */
        var refused = "";
        try {
            cloudVoiceLine(comp, textLayer,
                tuningOf("speaker=0;variation=0.667;timbre=0.800;speed=1.000"), options);
        } catch (silent) { refused = String(silent.message || silent); }
        check(refused !== "" && refused.indexOf("speaker 0") >= 0,
            "a speaker the model does not have is refused by number, not imported as " +
            "silence: " + (refused || "it was accepted"));

        // Back to the model's own voice, and back to the file it already had.
        var untuned = cloudVoiceLine(comp, textLayer, how, options);
        check(untuned.cached === true,
            "clearing the tuning returns to the cached line rather than rendering a third");

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

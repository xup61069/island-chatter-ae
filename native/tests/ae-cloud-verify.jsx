/*
 * Island Chatter — the cloud voice end to end in the host, without spending a
 * penny or opening a socket.
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * The trick this suite is built on is the cache. `island_chatter_voice
 * --cache-path` says where a given request's file *would* live and does nothing
 * else, so putting a WAV at that path — one the bake tool renders here, so no
 * audio ships with the repository — turns the next `--speak` into a cache hit.
 * A cache hit reads no key, opens no connection and bills nobody, and every
 * other line of the feature runs exactly as it does for real: the file is
 * imported, the layer is placed and pointed at, the live effect is muted, the
 * plan is read back out of the recording, the rig is rebuilt from it.
 *
 * So this covers everything except the HTTPS request itself, which is the one
 * part that cannot be covered without a paid account — and which cloud_tests.cpp
 * covers up to the moment the socket opens.
 *
 * What no portable test can see is the part that matters most here: that a
 * cloud-voiced line's mouth follows the *recording*, that going stale puts it
 * back on the engine, and that Apply does not quietly buy anything.
 *
 * **This one saves a project, which no other suite does**, because the cloud
 * folder lives beside the `.aep` and `bakeFolder()` will not guess. It saves to
 * a throwaway path in the temp folder, refuses to run if a project is already
 * open, and closes without saving on the way out.
 *
 * That last part is not tidiness. Leaving a *named, modified* project open makes
 * the next thing that closes After Effects put up "Save changes to …?", which is
 * a modal automation cannot answer — and on a locked workstation cannot even be
 * clicked. It cost a run to find out.
 */
(function aeCloudVerify() {
    var path = "G:/AICODE/island-chatter-ae/ae-cloud-verify-result.txt";
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
    var seeded = null;
    var skipped = false;
    try {
        // The same refusal ae-smoke-test.jsx makes, for the same reason: this
        // suite saves over whatever is open, and somebody's work is not ours to
        // replace.
        if (app.project && (app.project.file || app.project.numItems > 0)) {
            say("SKIP  an After Effects project is already open; nothing was changed.");
            skipped = true;
            return;   // the finally still reports, and will not say PASS
        }
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

        var voice = toolFile("island_chatter_voice.exe");
        check(voice !== null, "island_chatter_voice.exe is where the panel looks for it");
        if (!voice) { throw new Error("no voice tool; nothing further can run"); }

        // The table comes from the tool, which is the whole point of it living
        // there. A panel that had its own copy would pass this and still drift.
        // voiceSources(), not cloudProviders(): from 3.0.0 the panel merges the
        // cloud tool's list with the offline tool's, and this suite is about
        // the cloud half of it.
        var table = voiceSources();
        check(table.length >= 3,
            "the merged list has " + table.length + " voice sources");
        var provider = null;
        var at;
        for (at = 0; at < table.length; at += 1) {
            if (table[at].id === "openai") { provider = table[at]; }
        }
        check(provider !== null, "openai is among them");
        check(provider && provider.voice.length > 0 && provider.model.length > 0,
            "it arrives with a default voice and model, so a first press works");
        check(provider && provider.host.indexOf(".") > 0,
            "and a host the confirmation can name: " + (provider ? provider.host : "-"));

        /*
         * A project on disk, because the audio goes beside it.
         */
        var scratch = new Folder(Folder.temp.fsName.replace(/\\/g, "/") + "/ic-cloud-test");
        if (!scratch.exists) { scratch.create(); }
        projectFile = new File(scratch.fsName + "/ic-cloud-test.aep");
        app.project.save(projectFile);

        comp = app.project.items.addComp("Island Chatter Cloud Test", 640, 360, 1, 30, 30);
        comp.openInViewer();
        var said = "你好，歡迎來到小島！";
        var textLayer = comp.layers.addText(said);
        textLayer.name = said;

        var voiceSettings = {
            provider: "openai",
            voice: provider.voice,
            model: provider.model,
            region: "",
            key: "not-used-because-this-is-a-cache-hit",
            sensitivity: 0.5,
            vowels: true,
            text: said
        };

        // Where that request's file would go, according to the tool. Nothing
        // here computes a hash: a second copy of the thing that decides whether
        // money is spent is exactly what must not exist.
        var told = parseVoiceReply(system.callSystem(quoted(voice.fsName) +
            " --cache-path --provider openai" +
            " --text " + hexUtf8(said) +
            " --voice " + hexUtf8(voiceSettings.voice) +
            " --model " + hexUtf8(voiceSettings.model) +
            " --cache-dir " + hexUtf8(cloudFolder().fsName)));
        check(told.path.length > 0, "the tool says where the cache entry belongs");
        check(told.path.indexOf("openai-") > 0 && told.path.indexOf(".wav") > 0,
            "and names it after the provider and a hash");

        /*
         * Seed it with something the engine renders, so no audio ships in the
         * repository and the file is a real WAV rather than a fake one — but
         * with **different text from the line**, which is the part that makes
         * this test able to fail.
         *
         * A provider says a line in its own time, so a stand-in that was the
         * engine's own render of the same words would make "the mouth follows
         * the recording" and "the mouth follows the engine" produce the same
         * numbers, and the check would pass against an implementation that had
         * never looked at the file. Fourteen syllables of audio under an
         * eight-syllable line tells the two apart.
         */
        var stoodIn = "一二三四五六七八九十十一十二";
        var bake = requireEngineTool();
        seeded = new File(told.path);
        if (seeded.exists) { seeded.remove(); }
        system.callSystem(quoted(bake.fsName) +
            " --out-hex " + hexUtf8(told.path) +
            " --text " + hexUtf8(stoodIn) +
            " --rate " + ENGINE_SAMPLE_RATE);
        seeded = new File(told.path);
        check(seeded.exists, "a WAV was placed at that path to stand in for the provider");
        if (!seeded.exists) { throw new Error("could not seed the cache"); }

        // Everything from here runs the real path.
        var settingsForVoice = {
            voice: 0, emotion: 0, characterSize: 2, pitch: 1, speed: 1, volume: 0.78,
            consonant: 1.25, clarity: 0.78, cuteness: 0.55, seed: 0, tempoLock: false,
            formant: 1, source: 0, vibrato: 1, vibratoRate: 9.2
        };
        var options = {
            markers: true, fitDuration: true, controllers: true, rigShared: true,
            rigCharacter: "Cloud Test", typeOn: false, typeOnCenter: false,
            typeOnLeave: 0.1, typeOnSmoothness: 60, speakers: false, hold: false
        };
        var rigLayer = ensureRigLayer(comp, "Cloud Test");
        applyToTextLayer(comp, textLayer, "", settingsForVoice, options, rigLayer);
        var enginePlan = planFromEngine(findNativeEffect(textLayer));
        check(enginePlan.events.length > 0,
            "the line speaks with the built-in engine first (" +
            enginePlan.events.length + " syllables)");

        var voiced = cloudVoiceLine(comp, textLayer, voiceSettings, options);
        check(voiced.cached === true,
            "the request was answered from the cache, so nothing was sent and nothing billed");

        var audioLayer = bakedLayerFor(comp, textLayer);
        check(audioLayer !== null, "the returned audio is on the timeline");
        check(audioLayer && Math.abs(audioLayer.startTime - textLayer.inPoint) < 0.0001,
            "it starts where the line does");
        check(findNamedEffect(textLayer, "IC Cloud Voice") !== null,
            "the line is marked as carrying a cloud voice");
        var liveEffect = findNativeEffect(textLayer);
        check(liveEffect && liveEffect.enabled === false,
            "the live effect is muted, so the voice is not heard twice");

        /*
         * The heart of it: the mouth follows the recording, not the engine.
         */
        var followed = planForLayer(comp, textLayer, findNativeEffect(textLayer));
        check(followed.events.length > 0,
            "the line's plan is read back out of the recording (" +
            followed.events.length + " syllables)");
        check(followed.events.length !== enginePlan.events.length,
            "and it is the recording's plan, not the line's: " + followed.events.length +
            " syllables of audio against " + enginePlan.events.length + " of text");
        check(followed.duration > enginePlan.duration + 0.5,
            "the line is refitted to the audio, " + followed.duration.toFixed(3) +
            "s against the engine's " + enginePlan.duration.toFixed(3) + "s");
        check(Math.abs((textLayer.outPoint - textLayer.inPoint) - followed.duration) < 0.05,
            "and the layer really is that long on the timeline");

        // The rig is rebuilt once for the whole batch, which is what the button
        // does after its loop, so the suite does the same rather than expecting
        // cloudVoiceLine() to do it per line.
        var voicedRig = rebuildSharedRig(comp, rigLayer, null);
        check(voicedRig.lines === 1, "the rig rebuilds from the cloud-voiced line");
        var mouth = findNamedEffect(rigLayer, "IC Mouth");
        check(mouth !== null, "the rig has an IC Mouth slider");
        var closes = 0;
        var opens = 0;
        var keyAt;
        for (keyAt = 1; mouth && keyAt <= mouth.property(1).numKeys; keyAt += 1) {
            if (mouth.property(1).keyValue(keyAt) === 0) { closes += 1; } else { opens += 1; }
        }
        check(opens > 0 && closes > 0,
            "the mouth opens and closes on the cloud audio (" + opens + " open, " +
            closes + " shut)");
        // The count is the discriminating part: an implementation that had gone
        // to the engine instead would key the eight syllables of the text.
        check(opens === followed.events.length,
            "one open key per syllable of the recording (" + opens + " of " +
            followed.events.length + ")");

        /*
         * Going stale. The recording is muted and the built-in voice comes back,
         * so the plan has to go back to the engine at the same instant — or the
         * mouth animates to timings nobody can hear and nothing says why.
         */
        var became = markBakeStale(comp, textLayer);
        check(became === true, "editing the line marks the recording stale");
        check(audioLayer && audioLayer.audioEnabled === false, "the stale recording is muted");
        check(findNativeEffect(textLayer).enabled === true, "the built-in voice comes back");
        check(cloudVoiceLayer(comp, textLayer) === null,
            "and the panel stops treating it as the source of the plan");
        var afterStale = planForLayer(comp, textLayer, findNativeEffect(textLayer));
        check(afterStale.events.length === enginePlan.events.length &&
              Math.abs(afterStale.duration - enginePlan.duration) < 0.0001,
            "so the mouth is back on the engine's plan (" + afterStale.events.length +
            " syllables), which is what is now audible");

        // A rig rebuilt while stale must use the engine too, or the shared rig
        // and the per-line plan would disagree with each other.
        var merged = rebuildSharedRig(comp, rigLayer, null);
        check(merged.lines === 1, "the rebuilt rig still has the line in it");
        var staleOpens = 0;
        for (keyAt = 1; mouth && keyAt <= mouth.property(1).numKeys; keyAt += 1) {
            if (mouth.property(1).keyValue(keyAt) !== 0) { staleOpens += 1; }
        }
        check(staleOpens === enginePlan.events.length,
            "and the rig follows the engine again (" + staleOpens + " open keys for " +
            enginePlan.events.length + " syllables)");

        /*
         * And the rule that keeps a keystroke from costing money: Apply refits
         * the line, marks the bake stale, and does not fetch anything.
         */
        var beforeApply = seeded.modified ? seeded.modified.getTime() : 0;
        applyToTextLayer(comp, textLayer, "", settingsForVoice, options, rigLayer);
        var afterApply = new File(told.path);
        check(afterApply.exists && afterApply.modified.getTime() === beforeApply,
            "Apply did not re-fetch or rewrite the cached audio");

        /*
         * Pressing it a second time, which is the path that used to throw.
         *
         * `releasePreviousBake()` has to take the previous recording away
         * first, and until 2.4.0 it removed that layer and then went on asking
         * the removed object for its index on every remaining iteration —
         * "ReferenceError: Object is invalid". A *first* press has nothing to
         * release, so it never showed; a second press, and every regenerated
         * cloud voice, does.
         */
        var layersBefore = comp.numLayers;
        var again = cloudVoiceLine(comp, textLayer, voiceSettings, options);
        check(again.cached === true, "regenerating is still answered from the cache");
        check(comp.numLayers === layersBefore,
            "regenerating replaced the recording rather than stacking a second one (" +
            comp.numLayers + " layers)");
        check(bakedLayerFor(comp, textLayer) !== null,
            "and the line still points at the recording it got");
        check(findNativeEffect(textLayer).enabled === false,
            "with the live effect muted again");

        /*
         * A request that fails must leave the project exactly as it was.
         *
         * cloudVoiceToLayer() says so in a comment — "only after the file is in
         * hand" — and a comment is not a check. This asks for a provider that
         * does not exist, so the tool refuses without a socket, without a key
         * and without a penny, and every visible thing about the line has to be
         * unchanged afterwards: same layer count, same pointer, same audio.
         */
        var beforeLayers = comp.numLayers;
        var beforePointer = bakedLayerFor(comp, textLayer);
        var beforeName = beforePointer ? String(beforePointer.name) : "";
        var refused = "";
        var brokenSettings = {
            provider: "no-such-provider", voice: "", model: "", region: "",
            key: "unused", sensitivity: 0.5, vowels: true, text: said
        };
        try {
            cloudVoiceLine(comp, textLayer, brokenSettings, options);
        } catch (failure) {
            refused = String(failure.message || failure);
        }
        check(refused.length > 0, "an unknown provider is refused: " + refused);
        check(refused.indexOf("no-such-provider") >= 0,
            "and the refusal names what was asked for, rather than a generic failure");
        check(comp.numLayers === beforeLayers,
            "a failed request added no layers (" + comp.numLayers + ")");
        var afterPointer = bakedLayerFor(comp, textLayer);
        check(afterPointer !== null && String(afterPointer.name) === beforeName,
            "and left the line pointing at the recording it already had");
    } catch (error) {
        check(false, "the suite threw: " + error.toString() +
            (error.line ? " at line " + error.line : ""));
    } finally {
        try {
            if (comp) { comp.remove(); }
            // An imported WAV is only released by a purge (invariant 8g).
            app.purge(PurgeTarget.ALL_CACHES);
            // Closed here rather than left for ae-close-probe.jsx: this project
            // has a name and unsaved changes, and the next thing that tries to
            // close After Effects would ask about it in a modal.
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            if (seeded && seeded.exists) { seeded.remove(); }
            // Same reason as ae-local-verify.jsx: a named, modified project
            // left open turns the next script into a save prompt nobody can
            // click, and it reads as a hang.
            if (projectFile) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }
            if (projectFile && projectFile.exists) { projectFile.remove(); }
        } catch (cleanupError) { say("cleanup: " + cleanupError.toString()); }
        say("");
        say("checks: " + checks + "   failures: " + failures);
        /*
         * A run that checked nothing is not a pass.
         *
         * The skip above returned before any check and the report still said
         * RESULT: PASS — a hollow pass, which is the exact shape this project
         * keeps finding in its own guards: the test still ran, and still said
         * everything was fine. Anything reading these files for the word PASS
         * would have believed it.
         */
        say("RESULT: " + (failures > 0 ? "FAIL"
            : (checks === 0 ? (skipped ? "SKIPPED (nothing ran)" : "FAIL (nothing ran)")
                : "PASS")));
        say("done");
    }
}());

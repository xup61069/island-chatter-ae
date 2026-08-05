#target aftereffects

(function () {
    var scriptFile = new File($.fileName);
    var root = scriptFile.parent.parent.parent.fsName.replace(/\\/g, "/");
    var report = new File(root + "/ae-smoke-test-result.txt");
    var EFFECT_NAME = "Island Chatter Native";
    var TONE_MATCH_NAME = "ADBE Aud Tone";
    // 1 implicit input + 80 registered parameters. After Effects also reports a
    // trailing built-in group, so the scripted count matches by construction.
    var EXPECTED_PARAMETERS = 81;
    var EXPECTED_VERSION = "1.1.0";
    var ownsProject = false;

    function writeReport(message) {
        report.encoding = "UTF-8";
        if (report.open("w")) {
            report.write(message);
            report.close();
        }
    }

    function setText(effect, text) {
        var units = Math.min(text.length, 64);
        effect.property(6).setValue(units);
        var index;
        for (index = 0; index < 64; index += 1) {
            effect.property(7 + index).setValue(index < units ? text.charCodeAt(index) : 0);
        }
    }

    try {
        if (app.project && (app.project.file || app.project.numItems > 0)) {
            writeReport("SKIP\nAn existing After Effects project is open; no changes were made.");
            return;
        }
        if (!app.project) { app.newProject(); }
        ownsProject = true;

        var comp = app.project.items.addComp("Island Chatter 1.0 Smoke Test", 640, 360, 1, 6, 30);
        var layer = comp.layers.addText("你好，中文聲音測試！");
        layer.name = "Island Chatter Direct Text Audio";

        var effects = layer.property("ADBE Effect Parade");
        var tone = effects.addProperty(TONE_MATCH_NAME);
        tone.name = "Island Chatter Audio Bootstrap";
        tone.property(6).setValue(0);

        var effect = effects.addProperty(EFFECT_NAME);
        if (!effect || effect.numProperties !== EXPECTED_PARAMETERS) {
            throw new Error("Expected " + EXPECTED_PARAMETERS +
                " native parameters, received " + (effect ? effect.numProperties : 0) + ".");
        }
        effect.name = "Island Chatter Voice";

        // Voice, pitch, speed, volume, consonant emphasis.
        effect.property(1).setValue(1);
        effect.property(2).setValue(1.0);
        effect.property(3).setValue(1.0);
        effect.property(4).setValue(78.0);
        effect.property(5).setValue(1.25);
        setText(effect, "你好，中文聲音測試！");

        // Emotion, character size, clarity, cuteness, deterministic seed.
        effect.property(71).setValue(2);
        effect.property(72).setValue(3);
        effect.property(73).setValue(82.0);
        effect.property(74).setValue(62.0);
        effect.property(75).setValue(803);

        // Adding an effect invalidates previously acquired Property handles in AE.
        // Reacquire both effects before reading them for verification.
        effects = layer.property("ADBE Effect Parade");
        tone = effects.property(1);
        effect = effects.property(2);

        if (tone.propertyIndex >= effect.propertyIndex || tone.property(6).value !== 0) {
            throw new Error("Tone bootstrap is not immediately before the native audio effect.");
        }
        var sourceText = layer.property("ADBE Text Properties")
            .property("ADBE Text Document").value.text;
        if (sourceText !== "你好，中文聲音測試！") {
            throw new Error("Source Text changed during direct-audio setup.");
        }

        // AE scripting cannot read a plug-in's PiPL version, so confirming the
        // installed .aex really is this build stays a manual About-box check.
        var installed = null;
        var effectIndex;
        for (effectIndex = 0; effectIndex < app.effects.length; effectIndex += 1) {
            if (app.effects[effectIndex].matchName === EFFECT_NAME) {
                installed = app.effects[effectIndex];
                break;
            }
        }
        if (!installed) {
            throw new Error("Island Chatter Native is not registered with After Effects.");
        }

        writeReport(
            "PASS\n" +
            "Version (expected, verify in About): " + EXPECTED_VERSION + "\n" +
            "Layer: " + layer.name + "\n" +
            "Tone: " + tone.name + " (level 0)\n" +
            "Effect: " + effect.name + "\n" +
            "Parameters: " + effect.numProperties + "\n" +
            "External audio files: 0"
        );
    } catch (error) {
        writeReport("FAIL\n" + error.toString() +
            (error.line ? "\nLine: " + error.line : ""));
    } finally {
        if (ownsProject && app.project) {
            app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
            app.quit();
        }
    }
}());

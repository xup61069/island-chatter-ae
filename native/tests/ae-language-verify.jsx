/*
 * Island Chatter — interface language, verified in After Effects
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * tests/validate-script.js checks the message layer in Node. Node is not
 * ExtendScript: this panel is ES3, and the whole of 2.0 is the message layer,
 * so the one place it has to be right is the only engine that will ever run it.
 *
 * It builds the real panel, switches it through all three languages, and reads
 * the labels and tooltips back off the live controls. A translation that only
 * works in a sandbox is not a translation.
 *
 * Writes ae-language-verify-result.txt beside the repository. Closes its own
 * window and does not quit After Effects.
 */
(function aeLanguageVerify() {
    var lines = [];
    var checks = 0;
    var failures = 0;

    function note(text) { lines.push(text); }
    function check(condition, text) {
        checks += 1;
        if (!condition) { failures += 1; }
        lines.push((condition ? "PASS  " : "FAIL  ") + text);
    }

    function report() {
        note("");
        note("checks: " + checks + "   failures: " + failures);
        note("RESULT: " + (failures ? "FAIL" : "PASS"));
        var file = new File($.fileName).parent.parent.parent.fsName +
            "/ae-language-verify-result.txt";
        var out = new File(file);
        out.encoding = "UTF-8";
        out.open("w");
        out.write(lines.join("\n") + "\ndone");
        out.close();
    }

    var panelFile = new File(new File($.fileName).parent.parent.fsName +
        "/panel/IslandChatterNativePanel.jsx");
    panelFile.encoding = "UTF-8";
    panelFile.open("r");
    var source = panelFile.read();
    panelFile.close();

    // The same two markers the other host suites use, so this exercises the
    // shipped panel rather than a copy of it.
    var bodyStart = source.indexOf("{", source.indexOf("function islandChatterNativePanel("));
    var bodyEnd = source.indexOf("var panel = buildUI(thisObj);");
    if (bodyStart < 0 || bodyEnd < 0) {
        note("FAIL  could not find the panel body markers");
        failures += 1;
        checks += 1;
        report();
        return;
    }
    eval(source.substring(bodyStart + 1, bodyEnd));

    var language;
    var key;
    var id;

    // --- 1. Every translated string comes back in one language ---------------
    //
    // T() keeps one side of an "English / 中文" pair. A key it fails to split
    // reaches the user with both languages in it, which is the bug 2.0 exists
    // to fix, so the check is simply that no separator survives.
    var keys = [];
    for (key in IC_JAPANESE_UI) {
        if (IC_JAPANESE_UI.hasOwnProperty(key)) { keys.push(key); }
    }
    check(keys.length > 150, "the interface table has " + keys.length + " entries");

    var languages = ["zh", "en", "ja"];
    var bothLanguages = [];
    var empty = [];
    var placeholderLeft = [];
    var at;
    for (at = 0; at < languages.length; at += 1) {
        language = languages[at];
        UI_LANGUAGE = language;
        var index;
        for (index = 0; index < keys.length; index += 1) {
            var shown = T(keys[index]);
            if (typeof shown !== "string" || shown.length === 0) {
                empty.push(language + ": " + keys[index]);
            } else if (shown.indexOf(" / ") >= 0) {
                bothLanguages.push(language + ": " + shown);
            }
            // Two values is enough: no message takes more.
            var filled = M(keys[index], 3, 7);
            if (filled.indexOf("{0}") >= 0 || filled.indexOf("{1}") >= 0) {
                placeholderLeft.push(language + ": " + filled);
            }
        }
    }
    check(bothLanguages.length === 0,
        "no string reaches the user in two languages at once" +
        (bothLanguages.length ? " (" + bothLanguages[0] + ")" : ""));
    check(empty.length === 0,
        "no string comes back empty" + (empty.length ? " (" + empty[0] + ")" : ""));
    check(placeholderLeft.length === 0,
        "M() fills every placeholder" +
        (placeholderLeft.length ? " (" + placeholderLeft[0] + ")" : ""));

    // Japanese is a table lookup rather than a split, so check it took it.
    UI_LANGUAGE = "ja";
    check(M("Applied to {0} layer(s) / 已套用 {0} 個圖層", 4) === "4 レイヤーに適用しました",
        "a counted message reads as Japanese (" +
        M("Applied to {0} layer(s) / 已套用 {0} 個圖層", 4) + ")");
    UI_LANGUAGE = "en";
    check(M("Applied to {0} layer(s) / 已套用 {0} 個圖層", 4) === "Applied to 4 layer(s)",
        "and as English (" + M("Applied to {0} layer(s) / 已套用 {0} 個圖層", 4) + ")");

    // --- 2. Every tooltip has a body in every language ----------------------
    var tipIds = [];
    for (id in IC_HELP) {
        if (IC_HELP.hasOwnProperty(id)) { tipIds.push(id); }
    }
    check(tipIds.length >= 25, "the panel has " + tipIds.length + " tooltips");
    var thin = [];
    for (at = 0; at < languages.length; at += 1) {
        UI_LANGUAGE = languages[at];
        var which;
        for (which = 0; which < tipIds.length; which += 1) {
            var body = H(tipIds[which], "Island Chatter Audio");
            if (typeof body !== "string" || body.length < 10) {
                thin.push(languages[at] + ": " + tipIds[which]);
            }
            if (body.indexOf("{0}") >= 0) {
                thin.push(languages[at] + ": " + tipIds[which] + " kept its placeholder");
            }
        }
    }
    check(thin.length === 0,
        "every tooltip has a body in every language" + (thin.length ? " (" + thin[0] + ")" : ""));

    // --- 3. The real panel, built and switched -------------------------------
    //
    // Everything above runs against the functions. This runs against ScriptUI:
    // tip() writes helpTip while the panel is being built, before the stored
    // language has been read back, so buildUI has to put the tooltips right in
    // the same pass that localises the labels — and a language switch has to
    // reach both.
    var built = null;
    try {
        UI_LANGUAGE = "zh";
        built = buildUI(undefined);
        check(built !== null && built !== undefined, "the panel builds");

        var controls = [];
        function walk(node) {
            var step;
            if (node.type !== "edittext" && typeof node.text === "string" && node.text.length) {
                controls.push(node);
            }
            if (node.children) {
                for (step = 0; step < node.children.length; step += 1) { walk(node.children[step]); }
            }
        }
        walk(built);
        check(controls.length > 20, "the panel built " + controls.length + " labelled controls");

        var stillPaired = [];
        var step;
        for (step = 0; step < controls.length; step += 1) {
            if (controls[step].text.indexOf(" / ") >= 0) { stillPaired.push(controls[step].text); }
            if (typeof controls[step].helpTip === "string" &&
                controls[step].helpTip.indexOf(" / ") >= 0) {
                stillPaired.push("tip: " + controls[step].helpTip);
            }
        }
        check(stillPaired.length === 0,
            "no built control shows both languages" +
            (stillPaired.length ? " (" + stillPaired[0] + ")" : ""));

        // A tooltip must actually change when the language does. Find one that
        // carries a helpTip and read it in each language.
        var tipped = null;
        for (step = 0; step < controls.length; step += 1) {
            if (typeof controls[step].helpTip === "string" && controls[step].helpTip.length > 20) {
                tipped = controls[step];
                break;
            }
        }
        check(tipped !== null, "at least one built control carries a tooltip");
        if (tipped) {
            var seen = {};
            var distinct = 0;
            for (at = 0; at < languages.length; at += 1) {
                UI_LANGUAGE = languages[at];
                relabelUI();
                if (!seen[tipped.helpTip]) {
                    seen[tipped.helpTip] = true;
                    distinct += 1;
                }
            }
            check(distinct === 3,
                "switching the language rewrites the tooltip (" + distinct + " distinct bodies)");
        }

        // And the labels, through the registry localiseTree() actually filled,
        // rather than by hunting for a control by its size.
        check(localisedControls.length > 20,
            "localiseTree registered " + localisedControls.length + " labels");
        var applyButton = null;
        for (step = 0; step < localisedControls.length; step += 1) {
            if (localisedControls[step].literal ===
                "Apply to selected text layers / 套用到選取文字圖層") {
                applyButton = localisedControls[step].control;
            }
        }
        check(applyButton !== null, "the Apply button is registered for translation");
        if (applyButton) {
            UI_LANGUAGE = "en";
            relabelUI();
            var english = applyButton.text;
            UI_LANGUAGE = "ja";
            relabelUI();
            var japanese = applyButton.text;
            UI_LANGUAGE = "zh";
            relabelUI();
            var chinese = applyButton.text;
            note("Apply reads: en=" + english + " | ja=" + japanese + " | zh=" + chinese);
            check(english !== japanese && japanese !== chinese && english !== chinese,
                "the Apply button says something different in each language");
        }
        check(localisedTips.length >= 25,
            "tip() registered " + localisedTips.length + " tooltips for translation");

        /*
         * How wide the panel has to be, in the language that needs the most.
         *
         * The panel is a column of rows, so it is as wide as its widest row,
         * and a row is as wide as everything in it. The sing row held eleven
         * controls and wanted 817 px in Japanese against the 414 the text box
         * asks for — it had been the widest thing in the panel since 1.7.0 and
         * nothing measured it, so it only surfaced when Japanese added another
         * 55 px and After Effects started drawing labels as "中央ぞ…".
         *
         * The limit is what a docked column can reasonably be. Splitting a row
         * costs one line of height and is nearly always the answer; shortening
         * a translation is not, because the row was already too wide in Chinese.
         */
        var WIDEST_ROW = 460;
        var tooWide = [];
        var wideStep;
        var widestSeen = 0;
        var widestWhere = "";
        /*
         * The readouts are built empty, and an empty statictext collapses: the
         * preferredSize.width set beside them is silently ignored — which is a
         * bug in its own right, and means they measure as nothing here and as a
         * hundred-odd pixels the moment the panel says something. Fill them
         * with what they actually print before measuring, or this guard passes
         * a row that overflows the first time it is used.
         *
         * They are local to buildUI and cannot be named from here, so whatever
         * is still blank after the panel has set itself up gets a realistic
         * readout put in it. The tempo and gap readouts fill themselves during
         * the build and so are already measured honestly; the MIDI one does
         * not, because nothing has been loaded.
         */
        var blanks = [];
        function findBlanks(node) {
            var hunt;
            if (node.type === "statictext" && node.text === "") { blanks.push(node); }
            if (node.children) {
                for (hunt = 0; hunt < node.children.length; hunt += 1) {
                    findBlanks(node.children[hunt]);
                }
            }
        }
        findBlanks(built);
        note("readouts still blank after the build: " + blanks.length);

        for (at = 0; at < languages.length; at += 1) {
            UI_LANGUAGE = languages[at];
            relabelUI();
            // Recomputed per language: the whole question is how wide these get
            // in the language that needs the most room.
            var sample = M("{0} line(s) · {1} BPM / {0} 句・{1} BPM", 12, 120);
            var fillStep;
            for (fillStep = 0; fillStep < blanks.length; fillStep += 1) {
                blanks[fillStep].text = sample;
                blanks[fillStep].preferredSize = [-1, -1];
            }
            built.layout.layout(true);
            for (wideStep = 0; wideStep < built.children.length; wideStep += 1) {
                var rowNode = built.children[wideStep];
                if (!rowNode.children || !rowNode.children.length) { continue; }
                // preferredSize on the row itself reports the panel's own width,
                // because alignChildren stretches every row to fill; what decides
                // whether it fits is the sum of what is inside it.
                var content = 24;
                var kidStep;
                for (kidStep = 0; kidStep < rowNode.children.length; kidStep += 1) {
                    var kidWide = 0;
                    try { kidWide = rowNode.children[kidStep].preferredSize[0]; } catch (skip) { }
                    if (kidWide > 0) { content += kidWide; }
                }
                content += (rowNode.children.length - 1) * (rowNode.spacing || 0);
                if (content > widestSeen) {
                    widestSeen = content;
                    widestWhere = languages[at] + " row " + wideStep;
                }
                if (content > WIDEST_ROW) {
                    tooWide.push(languages[at] + " row " + wideStep + " needs " +
                        Math.round(content) + " px");
                }
            }
        }
        note("the widest row in any language is " + widestWhere + " at " +
            Math.round(widestSeen) + " px, against a limit of " + WIDEST_ROW);
        check(tooWide.length === 0,
            "no row needs more than " + WIDEST_ROW + " px in any language" +
            (tooWide.length ? " (" + tooWide[0] + ")" : ""));

        // And the control that changes the language has to stay put, or a
        // reader who switches to a longer language cannot switch back.
        check(built.children[0].alignment === null ||
            String(built.children[0].alignment).indexOf("right") < 0,
            "the language row is not right-aligned, so it cannot drift out of reach");
    } catch (error) {
        check(false, "building and switching the panel threw: " + error.toString());
    } finally {
        // Nothing to put back: the stored language is only written by the
        // picker's own onChange, and this drives UI_LANGUAGE directly.
        try {
            if (built && built.close) { built.close(); }
        } catch (ignored) { /* a docked Panel has no close(); a Window does */ }
    }

    report();
}());

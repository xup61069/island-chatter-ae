/*
 * Island Chatter — interface language, verified in After Effects
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * tests/validate-script.js checks the message layer in Node. Node is not
 * ExtendScript: this panel is ES3, and the whole of 2.0 is the message layer,
 * so the one place it has to be right is the only engine that will ever run it.
 *
 * It builds the real panel, switches it through all four languages, and reads
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

    var languages = ["zh", "cn", "en", "ja"];
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

    // 简体中文 is neither the table nor a plain split: it is made from the
    // Traditional half, so a character that was never mapped would arrive here
    // still Traditional and look almost right.
    UI_LANGUAGE = "cn";
    check(M("Applied to {0} layer(s) / 已套用 {0} 個圖層", 4) === "已应用 4 个图层",
        "a counted message reads as Simplified (" +
        M("Applied to {0} layer(s) / 已套用 {0} 個圖層", 4) + ")");
    check(M("Import script / 匯入劇本") === "导入剧本",
        "terminology is converted, not just the script (" +
        M("Import script / 匯入劇本") + ")");
    var stillTraditional = [];
    for (index = 0; index < keys.length; index += 1) {
        var simplified = T(keys[index]);
        var scan;
        for (scan = 0; scan < simplified.length; scan += 1) {
            if (typeof IC_SIMPLIFIED_CHARS[simplified.charAt(scan)] === "string") {
                stillTraditional.push(simplified);
                break;
            }
        }
    }
    check(stillTraditional.length === 0,
        "nothing in 简体中文 is still Traditional" +
        (stillTraditional.length ? " (" + stillTraditional[0] + ")" : ""));

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
            check(distinct === languages.length,
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
            var said = [];
            var saidSeen = {};
            var saidDistinct = 0;
            var lang;
            for (lang = 0; lang < languages.length; lang += 1) {
                UI_LANGUAGE = languages[lang];
                relabelUI();
                said.push(languages[lang] + "=" + applyButton.text);
                if (!saidSeen[applyButton.text]) {
                    saidSeen[applyButton.text] = true;
                    saidDistinct += 1;
                }
            }
            note("Apply reads: " + said.join(" | "));
            check(saidDistinct === languages.length,
                "the Apply button says something different in each language (" +
                saidDistinct + " distinct)");
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
        /*
         * And how tall.
         *
         * Nothing measured this until 2.2.0, by which point the panel was one
         * column of forty rows wanting 1354 px. A docked ScriptUI panel in
         * After Effects does not scroll, it clips, so on any ordinary dock the
         * bottom third was not there — and the bottom third was Apply, Re-sync,
         * Re-flow, Bake, Remove and the status line.
         *
         * Both limits used to come from what a dock can give. A 1080p screen
         * leaves After Effects roughly 900 px of column, so the panel stayed
         * under 800; a page was that less the strip of tab titles and the fixed
         * row of verbs underneath, which was 570. A page that would not fit was
         * split into another page — the same answer a row that will not fit
         * gets, and for the same reason: shortening the words never reaches the
         * number.
         *
         * **3.6.0 raised them, deliberately, and this is the record of what it
         * costs.** The panel was reorganised around one question — can you do
         * this anywhere else? — which puts every effect parameter on a second
         * page and everything else on the first. That is the right split and it
         * does not fit: the panel-only rows are 27 of the 40 and want 932 px on
         * their own. Splitting them again would put the answer back to three
         * pages, which is the arrangement being replaced.
         *
         * So the numbers below are now what the *panel needs* rather than what
         * a 1080p dock gives, and on a dock shorter than that the first page
         * clips. **What clips is the bottom of the first page**, currently the
         * voice-source rows; the verbs that 2.2.0 lost are outside the tabbed
         * panel and cannot be reached by this. That was the trade the limits
         * were raised for, and anyone lowering them again is choosing three
         * pages, not choosing tidiness.
         *
         * They are still limits and they are still measured. 3.6.0 wants
         * **968 px** for the first page, 396 for the second and 1196 for the
         * panel; these are those numbers plus ~40 px, which is one more row.
         * A second row is meant to fail here.
         */
        var TALLEST_PANEL = 1240;
        var TALLEST_PAGE = 1010;
        var tooWide = [];
        var tooTall = [];
        var widestSeen = 0;
        var widestWhere = "";
        var tallestSeen = 0;
        var tallestWhere = "";
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

        function sizeOn(node, axis) {
            var value = 0;
            try { value = node.preferredSize[axis]; } catch (skip) { value = 0; }
            return value > 0 ? value : 0;
        }
        // margins is a number where one was assigned and a Margins object where
        // ScriptUI made it; a group given none has neither.
        function margin(node, side) {
            var value = node.margins;
            if (value === undefined || value === null) { return 0; }
            if (typeof value === "number") { return value; }
            return typeof value[side] === "number" ? value[side] : 0;
        }
        function noteWidth(content, where, language) {
            if (content > widestSeen) {
                widestSeen = content;
                widestWhere = language + " " + where;
            }
            if (content > WIDEST_ROW) {
                tooWide.push(language + " " + where + " needs " +
                    Math.round(content) + " px");
            }
        }
        /*
         * Walked, not iterated once.
         *
         * From 2.2.0 a row sits two levels below the panel — panel, tabbedpanel,
         * tab, row. The version of this that looped over built.children would
         * have found a language row, a tabbed panel and three buttons, measured
         * those, found nothing over 460 and passed. It would have been checking
         * nothing, which is the same shape as every other guard in this project
         * that quietly stopped working: it still ran, and it still said yes.
         *
         * Returns how tall the column wants to be, and checks the width of every
         * row it holds on the way. A tabbed panel is not a row — it is several
         * columns behind one strip of titles, as tall as its tallest page and as
         * wide as the wider of that page and the strip. Measuring the control
         * itself is the only way the strip gets measured at all, and the strip
         * is a width that did not exist before there were tabs.
         */
        function measureColumn(column, where, language) {
            var height = margin(column, "top") + margin(column, "bottom");
            var index;
            for (index = 0; index < column.children.length; index += 1) {
                var child = column.children[index];
                height += sizeOn(child, 1);
                if (child.type === "tabbedpanel") {
                    var page;
                    for (page = 0; page < child.children.length; page += 1) {
                        var tab = child.children[page];
                        var title = String(tab.text);
                        var tall = measureColumn(tab, where + "[" + title + "]/", language);
                        if (tall > tallestSeen) {
                            tallestSeen = tall;
                            tallestWhere = language + " the " + title + " page";
                        }
                        if (tall > TALLEST_PAGE) {
                            tooTall.push(language + " the " + title + " page needs " +
                                Math.round(tall) + " px");
                        }
                    }
                    noteWidth(sizeOn(child, 0) + 24, where + index + " (the tabs)", language);
                    continue;
                }
                if (!child.children || !child.children.length) { continue; }
                // preferredSize on the row itself reports the column's own width,
                // because alignChildren stretches every row to fill; what decides
                // whether it fits is the sum of what is inside it.
                var content = 24;
                var kidStep;
                for (kidStep = 0; kidStep < child.children.length; kidStep += 1) {
                    content += sizeOn(child.children[kidStep], 0);
                }
                content += (child.children.length - 1) * (child.spacing || 0);
                noteWidth(content, where + index, language);
            }
            height += (column.children.length - 1) * (column.spacing || 0);
            return height;
        }

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
            var whole = measureColumn(built, "", languages[at]);
            if (whole > tallestSeen) {
                tallestSeen = whole;
                tallestWhere = languages[at] + " the panel";
            }
            if (whole > TALLEST_PANEL) {
                tooTall.push(languages[at] + " the panel needs " + Math.round(whole) + " px");
            }
        }
        note("the widest row in any language is " + widestWhere + " at " +
            Math.round(widestSeen) + " px, against a limit of " + WIDEST_ROW);
        check(tooWide.length === 0,
            "no row needs more than " + WIDEST_ROW + " px in any language" +
            (tooWide.length ? " (" + tooWide[0] + ")" : ""));
        note("the tallest thing in any language is " + tallestWhere + " at " +
            Math.round(tallestSeen) + " px, against " + TALLEST_PANEL +
            " for the panel and " + TALLEST_PAGE + " for a page");
        check(tooTall.length === 0,
            "the panel fits under " + TALLEST_PANEL + " px and every page under " +
            TALLEST_PAGE + (tooTall.length ? " (" + tooTall[0] + ")" : ""));

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

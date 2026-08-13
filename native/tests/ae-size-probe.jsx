/*
 * Island Chatter — how wide, and how tall, does the panel want to be?
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * A diagnostic, not a suite.
 *
 * Width, because ScriptUI sizes most controls to their text: a longer label
 * does not clip, it makes its row wider, and the widest row makes the panel
 * wider. Which rows those are, and by how much, is what decides whether the
 * answer to "English does not fit" is shorter words or a different layout.
 *
 * Height, because nothing had ever measured it. The panel grew to forty rows
 * one row at a time, and a docked ScriptUI panel in After Effects does not
 * scroll — it clips. What was falling off the bottom was Apply, Re-sync, Bake,
 * Remove and the status line, which is to say the controls people press.
 *
 * It walks rather than iterating once, because from 2.2.0 the real rows sit
 * two levels below the panel: panel -> tabbedpanel -> tab -> row. The version
 * that iterated `built.children` would have found four containers, measured
 * them, reported that everything fits, and checked nothing at all.
 *
 * Writes each line as it goes, so a crash still leaves the measurements.
 */
(function aeSizeProbe() {
    var path = "G:/AICODE/island-chatter-ae/ae-size-probe-result.txt";
    var first = new File(path);
    first.encoding = "UTF-8";
    first.open("w");
    first.write("measuring\n");
    first.close();

    function say(text) {
        var out = new File(path);
        out.encoding = "UTF-8";
        out.open("a");
        out.write(text + "\n");
        out.close();
    }

    function pad(text, width) {
        var out = String(text);
        while (out.length < width) { out += " "; }
        return out;
    }

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

        var built = buildUI(undefined);
        say("panel built");

        var languages = ["zh", "en", "ja"];

        function labelOf(node) {
            if (typeof node.text === "string" && node.text.length) { return node.text; }
            if (node.type === "dropdownlist" && node.selection) {
                return "[" + node.selection.text + "]";
            }
            return "(" + node.type + ")";
        }

        /*
         * An empty statictext collapses, and the preferredSize.width set beside
         * it is silently ignored, so the readouts measure as nothing here and as
         * a hundred-odd pixels the moment the panel says something. Fill them
         * before measuring or every number below is a lie about the first time
         * the panel is used.
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
        say("readouts still blank after the build: " + blanks.length);

        function sizeOf(node, axis) {
            var value = -1;
            try { value = Math.round(node.preferredSize[axis]); } catch (ignored) { }
            return value;
        }

        // margins is a number when it was assigned one and a Margins object
        // when ScriptUI made it, and a group that was never given any has none.
        function margin(node, side) {
            var value = node.margins;
            if (value === undefined || value === null) { return 0; }
            if (typeof value === "number") { return value; }
            return typeof value[side] === "number" ? value[side] : 0;
        }

        function isTabHost(node) {
            return node.type === "tabbedpanel";
        }

        /*
         * The same arithmetic the guard in ae-language-verify.jsx does, so the
         * two tell one story: a row's own preferredSize reports the panel's
         * width rather than its content, because alignChildren stretches it, and
         * 24 is both panel margins — the width a dock actually has to give.
         */
        function measureRow(row, where) {
            var wide = 0;
            var parts = [];
            if (row.children && row.children.length) {
                var at;
                for (at = 0; at < row.children.length; at += 1) {
                    var kid = row.children[at];
                    var kidWide = sizeOf(kid, 0);
                    if (kidWide > 0) { wide += kidWide; }
                    parts.push(labelOf(kid) + "=" + kidWide);
                }
                wide += (row.children.length - 1) * (row.spacing || 0);
            } else {
                wide = sizeOf(row, 0);
            }
            wide += 24;
            return { where: where, width: wide, height: sizeOf(row, 1),
                type: row.type, label: labelOf(row), parts: parts.join("  ") };
        }

        /*
         * Returns how tall the column wants to be, and pushes every row it
         * holds into `rows`. A tabbed panel is not a row: it is several columns
         * sharing one strip of titles, and it is as tall as its tallest page.
         * Its own preferredSize is what ScriptUI will act on, strip included,
         * so it is taken rather than guessed at.
         */
        function measureColumn(column, where, rows, columns) {
            var height = margin(column, "top") + margin(column, "bottom");
            var index;
            for (index = 0; index < column.children.length; index += 1) {
                var child = column.children[index];
                if (isTabHost(child)) {
                    var at;
                    for (at = 0; at < child.children.length; at += 1) {
                        var tab = child.children[at];
                        measureColumn(tab,
                            where + "[" + labelOf(tab) + "]/", rows, columns);
                    }
                    // The strip of tab titles is a width that did not exist
                    // before 2.2.0, and a tabbedpanel is as wide as the wider
                    // of it and its widest page. Recording the whole control
                    // is how the strip gets measured at all.
                    rows.push({ where: where + index, width: sizeOf(child, 0) + 24,
                        height: sizeOf(child, 1), type: "tabbedpanel",
                        label: "(widest page, or the strip of titles)", parts: "" });
                    height += sizeOf(child, 1);
                } else {
                    rows.push(measureRow(child, where + index));
                    height += sizeOf(child, 1);
                }
            }
            height += (column.children.length - 1) * (column.spacing || 0);
            columns.push({ where: where, height: height,
                rows: column.children.length });
            return height;
        }

        var measured = {};
        var pass;
        for (pass = 0; pass < languages.length; pass += 1) {
            UI_LANGUAGE = languages[pass];
            relabelUI();
            // Recomputed per language: the whole question is how much room
            // these want in the language that asks for the most.
            var sample = M("{0} line(s) · {1} BPM / {0} 句・{1} BPM", 12, 120);
            var fillStep;
            for (fillStep = 0; fillStep < blanks.length; fillStep += 1) {
                blanks[fillStep].text = sample;
                blanks[fillStep].preferredSize = [-1, -1];
            }
            built.layout.layout(true);
            var rows = [];
            var columns = [];
            var wanted = measureColumn(built, "", rows, columns);
            measured[languages[pass]] = { rows: rows, columns: columns, height: wanted };
            say("the panel wants " + sizeOf(built, 0) + " x " + sizeOf(built, 1) +
                " px in " + languages[pass] + " (columns add up to " +
                Math.round(wanted) + ")");
        }

        say("");
        say("=== how tall each column is ===");
        say(pad("zh", 7) + pad("en", 7) + pad("ja", 7) + pad("rows", 6) + "column");
        var columnCount = measured.zh.columns.length;
        var which;
        for (which = 0; which < columnCount; which += 1) {
            say(pad(String(Math.round(measured.zh.columns[which].height)), 7) +
                pad(String(Math.round(measured.en.columns[which].height)), 7) +
                pad(String(Math.round(measured.ja.columns[which].height)), 7) +
                pad(String(measured.zh.columns[which].rows), 6) +
                (measured.zh.columns[which].where === ""
                    ? "(the panel itself)" : measured.zh.columns[which].where));
        }

        say("");
        say("=== every row, width then height ===");
        say(pad("where", 12) + pad("zh", 6) + pad("en", 6) + pad("ja", 6) +
            pad("grow", 7) + pad("tall", 6) + "what");
        var count = measured.zh.rows.length;
        var ranked = [];
        for (which = 0; which < count; which += 1) {
            var zh = measured.zh.rows[which].width;
            var en = measured.en.rows[which].width;
            var ja = measured.ja.rows[which].width;
            var grow = Math.max(en, ja) - zh;
            ranked.push({ index: which, grow: grow, widest: Math.max(zh, en, ja) });
            say(pad(measured.zh.rows[which].where, 12) +
                pad(String(zh), 6) + pad(String(en), 6) + pad(String(ja), 6) +
                pad((grow > 0 ? "+" : "") + grow, 7) +
                pad(String(measured.zh.rows[which].height), 6) +
                measured.zh.rows[which].type + " " + measured.zh.rows[which].label);
        }

        say("");
        say("=== the rows that grow most, control by control ===");
        ranked.sort(function (a, b) { return b.grow - a.grow; });
        var shown;
        for (shown = 0; shown < 6 && shown < ranked.length; shown += 1) {
            which = ranked[shown].index;
            say("");
            say(measured.zh.rows[which].where + "  grows " + ranked[shown].grow +
                " px, widest " + ranked[shown].widest);
            say("  zh " + pad(String(measured.zh.rows[which].width), 6) +
                measured.zh.rows[which].parts);
            say("  en " + pad(String(measured.en.rows[which].width), 6) +
                measured.en.rows[which].parts);
            say("  ja " + pad(String(measured.ja.rows[which].width), 6) +
                measured.ja.rows[which].parts);
        }

        say("");
        say("=== the tallest rows ===");
        ranked.sort(function (a, b) {
            return measured.zh.rows[b.index].height - measured.zh.rows[a.index].height;
        });
        for (shown = 0; shown < 8 && shown < ranked.length; shown += 1) {
            which = ranked[shown].index;
            say(pad(measured.zh.rows[which].where, 12) +
                pad(String(measured.zh.rows[which].height), 6) +
                measured.zh.rows[which].type + " " + measured.zh.rows[which].label);
        }

        // Put the panel back into the language it was found in before closing,
        // so nothing about the user's own preference depends on this having run.
        UI_LANGUAGE = "zh";
        relabelUI();
        try { built.close(); } catch (ignored3) { }
        say("");
        say("done");
    } catch (error) {
        say("");
        say("THREW: " + error.toString() + " at line " + error.line);
        say("done");
    }
}());

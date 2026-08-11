/*
 * Island Chatter — how wide does the panel want to be, in each language?
 * SPDX-License-Identifier: LicenseRef-IslandChatter-Source-Available-1.0
 *
 * A diagnostic, not a suite. ScriptUI sizes most controls to their text, so a
 * longer label does not clip: it makes its row wider, and the widest row makes
 * the panel wider. Which rows those are, and by how much, is what decides
 * whether the answer to "English does not fit" is shorter words or a different
 * layout.
 *
 * Writes each line as it goes, so a crash still leaves the measurements.
 */
(function aeWidthProbe() {
    var path = "G:/AICODE/island-chatter-ae/ae-width-probe-result.txt";
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
        var measured = {};
        var pass;

        function labelOf(node) {
            if (typeof node.text === "string" && node.text.length) { return node.text; }
            if (node.type === "dropdownlist" && node.selection) {
                return "[" + node.selection.text + "]";
            }
            return "(" + node.type + ")";
        }

        for (pass = 0; pass < languages.length; pass += 1) {
            UI_LANGUAGE = languages[pass];
            relabelUI();
            built.layout.layout(true);
            var rows = [];
            var index;
            for (index = 0; index < built.children.length; index += 1) {
                var row = built.children[index];
                /*
                 * The panel's alignChildren is ["fill", "top"], so every row is
                 * stretched to the panel's width and preferredSize reports the
                 * stretch rather than the content. What decides whether a row
                 * fits a dock is the sum of what is in it, plus the gaps.
                 */
                var wide = 0;
                var parts = [];
                if (row.children && row.children.length) {
                    var at;
                    for (at = 0; at < row.children.length; at += 1) {
                        var kid = row.children[at];
                        var kidWide = -1;
                        try { kidWide = Math.round(kid.preferredSize[0]); } catch (skip) { }
                        if (kidWide > 0) { wide += kidWide; }
                        parts.push(labelOf(kid) + "=" + kidWide);
                    }
                    wide += (row.children.length - 1) * (row.spacing || 0);
                } else {
                    try { wide = Math.round(row.preferredSize[0]); } catch (ignored) { wide = -1; }
                }
                // Both panel margins, so this is the width the dock has to give.
                wide += 24;
                rows.push({ width: wide, type: row.type, label: labelOf(row),
                    parts: parts.join("  ") });
            }
            measured[languages[pass]] = rows;
            var whole = -1;
            try { whole = Math.round(built.preferredSize[0]); } catch (ignored2) { }
            say("the panel wants " + whole + " px in " + languages[pass]);
        }

        say("");
        say(pad("row", 5) + pad("zh", 6) + pad("en", 6) + pad("ja", 6) + pad("grow", 7) + "what");
        var count = measured.zh.length;
        var ranked = [];
        var which;
        for (which = 0; which < count; which += 1) {
            var zh = measured.zh[which].width;
            var en = measured.en[which].width;
            var ja = measured.ja[which].width;
            var grow = Math.max(en, ja) - zh;
            ranked.push({ index: which, grow: grow, widest: Math.max(zh, en, ja) });
            say(pad(String(which), 5) + pad(String(zh), 6) + pad(String(en), 6) +
                pad(String(ja), 6) + pad((grow > 0 ? "+" : "") + grow, 7) +
                measured.zh[which].type + " " + measured.zh[which].label);
        }

        say("");
        say("=== the rows that grow most, control by control ===");
        ranked.sort(function (a, b) { return b.grow - a.grow; });
        var shown;
        for (shown = 0; shown < 6 && shown < ranked.length; shown += 1) {
            which = ranked[shown].index;
            say("");
            say("row " + which + "  grows " + ranked[shown].grow +
                " px, widest " + ranked[shown].widest);
            say("  zh " + pad(String(measured.zh[which].width), 6) + measured.zh[which].parts);
            say("  en " + pad(String(measured.en[which].width), 6) + measured.en[which].parts);
            say("  ja " + pad(String(measured.ja[which].width), 6) + measured.ja[which].parts);
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

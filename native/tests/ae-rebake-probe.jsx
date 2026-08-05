// Diagnostic: what actually holds an imported WAV open in After Effects?
//
// Baking the same layer twice fails with "cannot open the output file for
// writing". A first run established that removing the layer and the footage
// item are both insufficient and only app.purge() releases the handle. This
// version asks which purge target is enough, because PurgeTarget.ALL_CACHES
// also throws away the user's RAM preview.
(function () {
    var root = new File($.fileName).parent.parent.parent.fsName.replace(/\\/g, "/");
    var out = new File(root + "/ae-rebake-probe-result.txt");
    var lines = [];
    function log(text) { lines.push(String(text)); }

    function hexUtf8(text) {
        var hex = "";
        for (var i = 0; i < text.length; i += 1) {
            var code = text.charCodeAt(i);
            var bytes = code <= 0x7F ? [code] :
                (code <= 0x7FF ? [0xC0 | (code >> 6), 0x80 | (code & 0x3F)] :
                    [0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)]);
            for (var b = 0; b < bytes.length; b += 1) {
                var pair = bytes[b].toString(16);
                hex += pair.length < 2 ? "0" + pair : pair;
            }
        }
        return hex;
    }

    try {
        if (app.project) { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); }
        app.newProject();
        var work = new Folder(Folder.temp.fsName + "/IslandChatterRebakeProbe");
        if (!work.exists) { work.create(); }
        app.project.save(new File(work.fsName + "/probe.aep"));
        var comp = app.project.items.addComp("probe", 320, 180, 1, 5, 30);
        var tool = new File(Folder.startup.fsName +
            "/Plug-ins/Island Chatter/island_chatter_bake.exe");

        // Each target gets a fresh file, import and placement, so the results
        // cannot leak into one another.
        var targets = [
            ["UNDO_CACHES", PurgeTarget.UNDO_CACHES],
            ["SNAPSHOT_CACHES", PurgeTarget.SNAPSHOT_CACHES],
            ["IMAGE_CACHES", PurgeTarget.IMAGE_CACHES],
            ["ALL_CACHES", PurgeTarget.ALL_CACHES]
        ];
        var index;
        for (index = 0; index < targets.length; index += 1) {
            var wav = new File(work.fsName + "/probe" + index + ".wav");
            system.callSystem('"' + tool.fsName + '" --out-hex ' + hexUtf8(wav.fsName) +
                " --text " + hexUtf8("你好") + " --rate 48000");
            var item = app.project.importFile(new ImportOptions(wav));
            var placed = comp.layers.add(item);
            placed.remove();
            item.remove();
            app.purge(targets[index][1]);
            var probe = new File(wav.fsName);
            log(targets[index][0] + ": released = " + (probe.exists ? probe.remove() : true));
        }
        log("RESULT: done");
    } catch (error) {
        log("FATAL: " + error.toString() + (error.line ? " (line " + error.line + ")" : ""));
        log("RESULT: error");
    } finally {
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
        try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (closeError) {}
    }
}());

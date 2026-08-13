#target aftereffects

/*
 * Diagnostic for the preview's playback command.
 *
 * The first run of this probe found the thing worth writing down: inside After
 * Effects, `system.callSystem()` returns an **empty string** for every
 * PowerShell command, including `powershell -NoProfile -Command "'ALIVE'"` —
 * while the same call from a PowerShell prompt prints ALIVE, and while
 * callSystem captures island_chatter_bake's stdout perfectly well. So "the
 * reply is empty" does not mean "nothing ran", and a check written against the
 * reply fails on a preview that played fine.
 *
 * What this establishes: whether PowerShell runs at all, and whether it can
 * report back through a file when it cannot report back through stdout.
 */
(function () {
    var out = new File("G:/AICODE/island-chatter-ae/ae-preview-probe-result.txt");
    var lines = [];
    function say(text) {
        lines.push(String(text));
        out.encoding = "UTF-8";
        if (out.open("w")) { out.write(lines.join("\n")); out.close(); }
    }

    var name = "island-chatter-preview.wav";
    var stamp = "island-chatter-preview-result.txt";
    var temp = Folder.temp.fsName.replace(/\\/g, "/");
    var target = new File(temp + "/" + name);
    var answer = new File(temp + "/" + stamp);
    var shell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

    say("Folder.temp   : " + Folder.temp.fsName);
    say("preview exists: " + target.exists + "  (" + (target.exists ? target.length : 0) + " bytes)");
    say("powershell.exe: " + new File(shell).exists);
    say("");

    function readable(reply) {
        var printable = "";
        var at;
        for (at = 0; at < reply.length; at += 1) {
            var code = reply.charCodeAt(at);
            printable += (code >= 32 && code < 127) ? reply.charAt(at) : ("<" + code + ">");
        }
        return printable;
    }

    function run(label, command) {
        say("--- " + label);
        say("    command: " + command);
        if (answer.exists) { answer.remove(); }
        var reply = "";
        var started = new Date().getTime();
        try { reply = String(system.callSystem(command)); }
        catch (error) { reply = "THREW " + error.toString(); }
        var took = new Date().getTime() - started;
        say("    reply  : [" + readable(reply) + "]  (" + took + " ms)");
        if (answer.exists) {
            answer.encoding = "UTF-8";
            answer.open("r");
            var written = answer.read();
            answer.close();
            say("    file   : [" + readable(written) + "]");
        } else {
            say("    file   : (nothing written)");
        }
        say("");
    }

    run("does callSystem capture anything at all", "cmd /c echo HELLO-FROM-CMD");
    run("powershell by name, to stdout",
        'powershell -NoProfile -Command "\'ALIVE\'"');
    run("powershell by full path, to stdout",
        '"' + shell + '" -NoProfile -Command "\'ALIVE\'"');
    run("powershell by full path, to a file",
        '"' + shell + '" -NoProfile -Command "\'ALIVE\' | Set-Content -Encoding UTF8 ' +
        "([IO.Path]::Combine($env:TEMP,'" + stamp + "'))\"");
    run("play it, and report through the file",
        '"' + shell + '" -NoProfile -Command "' +
        "$r = try { (New-Object Media.SoundPlayer ([IO.Path]::Combine($env:TEMP,'" + name +
        "'))).PlaySync(); 'PLAYED' } catch { 'FAILED ' + $_.Exception.Message }; " +
        "$r | Set-Content -Encoding UTF8 ([IO.Path]::Combine($env:TEMP,'" + stamp + "'))\"");
    run("play it by name rather than by full path, reporting through the file",
        'powershell -NoProfile -Command "' +
        "$r = try { (New-Object Media.SoundPlayer ([IO.Path]::Combine($env:TEMP,'" + name +
        "'))).PlaySync(); 'PLAYED' } catch { 'FAILED ' + $_.Exception.Message }; " +
        "$r | Set-Content -Encoding UTF8 ([IO.Path]::Combine($env:TEMP,'" + stamp + "'))\"");

    say("done");
}());

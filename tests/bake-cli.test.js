// Exercises island_chatter_bake against the case that broke the first release
// of the Bake command: a path the console code page cannot represent.
//
// system.callSystem() hands the command line over as code-page text, so a
// Chinese layer name or project folder arrives as "?" and the write fails. The
// path must travel as hex UTF-8 and be opened through the wide filesystem API.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const candidates = fs
  .readdirSync(path.resolve(__dirname, "..", "native"))
  .filter((name) => name.startsWith("build"))
  .flatMap((name) => [
    path.resolve(__dirname, "..", "native", name, "Release", "island_chatter_bake.exe"),
    path.resolve(__dirname, "..", "native", name, "island_chatter_bake"),
    path.resolve(__dirname, "..", "native", name, "island_chatter_bake.exe"),
  ])
  .filter((candidate) => fs.existsSync(candidate));

if (candidates.length === 0) {
  console.log("bake CLI not built; skipping (build the native targets to run this test)");
  process.exit(0);
}
const tool = candidates[0];
const hex = (value) => Buffer.from(value, "utf8").toString("hex");

// A folder with a space, and a file name outside any single-byte code page.
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "island chatter bake "));
const folder = path.join(workRoot, "Island Chatter Audio");
fs.mkdirSync(folder, { recursive: true });
const text = "你好，歡迎來到動態島實驗室！";
const target = path.join(folder, `${text}.wav`);

let failures = 0;
const check = (condition, label) => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}`);
  if (!condition) failures += 1;
};

try {
  const stdout = execFileSync(
    tool,
    ["--out-hex", hex(target), "--text", hex(text), "--rate", "48000", "--seed", "4242"],
    { encoding: "utf8" });
  check(stdout.startsWith("OK "), `the tool reported success: ${stdout.trim()}`);
  check(fs.existsSync(target), "the file exists at the exact non-ASCII path requested");

  const written = fs.readdirSync(folder);
  check(written.length === 1 && written[0] === `${text}.wav`,
    `the name on disk is unmangled: ${JSON.stringify(written)}`);

  const wav = fs.readFileSync(target);
  check(wav.toString("ascii", 0, 4) === "RIFF" && wav.toString("ascii", 8, 12) === "WAVE",
    "the output is a valid WAV container");
  const channels = wav.readUInt16LE(22);
  const rate = wav.readUInt32LE(24);
  const bits = wav.readUInt16LE(34);
  const dataBytes = wav.readUInt32LE(40);
  check(channels === 1 && rate === 48000 && bits === 16,
    `format is mono 16-bit 48 kHz (got ${channels}ch ${bits}bit ${rate}Hz)`);
  check(dataBytes === wav.length - 44, "the declared data length matches the file");

  let peak = 0;
  for (let offset = 44; offset + 1 < wav.length; offset += 2) {
    peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  }
  check(peak > 1000, `the audio is not silent (peak ${peak})`);
  check(peak < 32767, "the audio does not clip");

  // Passing the path as plain text is what used to fail; it must still fail
  // loudly rather than writing to a mangled name.
  let plainFailed = false;
  try {
    execFileSync(tool, ["--out", target, "--text", hex(text)], { stdio: "pipe" });
  } catch (error) {
    plainFailed = true;
  }
  check(plainFailed || fs.readdirSync(folder).length === 1,
    "a plain-text path either fails or writes nowhere unexpected");
} finally {
  fs.rmSync(workRoot, { recursive: true, force: true });
}

// --plan is what the panel uses instead of reimplementing the engine's text
// planning in ExtendScript. Markers, the rig, Type-On and Fit Duration are all
// built from these numbers, so a wrong plan mis-sizes layers silently.
const planOf = (text, extra = []) => {
  const lines = execFileSync(
    tool, ["--plan", "--text", hex(text), "--rate", "48000", ...extra], { encoding: "utf8" })
    .split(/\r?\n/).filter(Boolean);
  const field = (name) => Number((lines.find((l) => l.startsWith(`${name} `)) || "").split(" ")[1]);
  const events = lines.filter((l) => l.startsWith("E ")).map((l) => {
    const parts = l.split(" ");
    return {
      start: Number(parts[1]),
      length: Number(parts[2]),
      reading: parts[3],
      characters: String.fromCodePoint(...parts.slice(4).map(Number)),
    };
  });
  return { rate: field("RATE"), samples: field("SAMPLES"), declared: field("END"), events, lines };
};

{
  const plan = planOf("你好，歡迎光臨！");
  check(plan.lines[0] === "PLAN 1", "the plan declares its format version");
  check(plan.declared === plan.events.length,
    `END agrees with the number of E lines (${plan.declared} vs ${plan.events.length})`);
  check(plan.events.length === 6, `六個字算出六個音節 (got ${plan.events.length})`);
  check(plan.events.map((e) => e.characters).join("") === "你好歡迎光臨",
    "the characters round-trip as decimal codepoints");
  // 你 is third tone before another third tone, so the engine speaks it as ni2.
  check(plan.events[0].reading === "ni2", `sandhi is applied in the plan (got ${plan.events[0].reading})`);
  check(plan.events.every((e, i) => i === 0 || e.start >= plan.events[i - 1].start),
    "events are in time order");
  check(plan.events.every((e) => e.start + e.length <= plan.samples),
    "no event runs past the end of the utterance");
  check(plan.lines.every((line) => /^[\x20-\x7E]*$/.test(line)),
    "every line is ASCII, so the console code page cannot corrupt it");

  // The whole point of asking the engine: these are the cases the panel's own
  // planner got wrong. It counted the brackets and the pinyin letters as
  // characters and planned twelve and seven syllables respectively.
  check(planOf("[重|chong2]新開始").events.length === 4,
    "an inline pronunciation override plans the four syllables that are spoken");
  check(planOf("ni3 hao3 ma5").events.length === 3,
    "tone-number pinyin plans three syllables, not one per letter");
  check(planOf("ㄋㄧˇ ㄏㄠˇ").events.length === 2, "Zhuyin plans one syllable per group");

  // The plan has to describe the audio, not an idealised version of it.
  // workRoot is already gone, so this gets its own directory.
  const planRoot = fs.mkdtempSync(path.join(os.tmpdir(), "island-chatter-plan-"));
  try {
    const rendered = path.join(planRoot, "plan-check.wav");
    execFileSync(tool, ["--out-hex", hex(rendered), "--text", hex("你好，歡迎光臨！"),
      "--rate", "48000"], { stdio: "pipe" });
    const renderedFrames = (fs.statSync(rendered).size - 44) / 2;
    check(renderedFrames === plan.samples,
      `the plan's length matches the rendered audio (${plan.samples} vs ${renderedFrames})`);
  } finally {
    fs.rmSync(planRoot, { recursive: true, force: true });
  }

  // Tempo lock exists so syllables land on the beat; the plan must show that.
  const locked = planOf("一二三四五六七八", ["--tempo-lock", "1", "--speed", "0.8"]);
  const stride = 0.2 / 0.8 * 48000;
  check(locked.events.every((e, i) => Math.abs(e.start - i * stride) <= 1),
    "under tempo lock every syllable starts exactly one slot after the last");
}

// Every timbre flag must actually reach the engine. A flag that is silently
// ignored, or that expects a different unit from the one the panel sends, looks
// exactly like a control that does nothing — which is how --formant was first
// wired, taking a percentage where the engine wanted a multiplier.
{
  const timbreRoot = fs.mkdtempSync(path.join(os.tmpdir(), "island-chatter-timbre-"));
  try {
    const render = (name, extra) => {
      const file = path.join(timbreRoot, `${name}.wav`);
      execFileSync(tool, ["--out-hex", hex(file), "--text", hex("你好，島民！"),
        "--rate", "48000", ...extra], { stdio: "pipe" });
      return fs.readFileSync(file);
    };
    const baseline = render("baseline", []);
    for (const [label, extra] of [
      ["--source 1 (reed)", ["--source", "1"]],
      ["--source 2 (chip)", ["--source", "2"]],
      ["--source 3 (metallic)", ["--source", "3"]],
      ["--source 4 (granular)", ["--source", "4"]],
      ["--source 5 (growl)", ["--source", "5"]],
      ["--formant 0.6", ["--formant", "0.6"]],
      ["--formant 1.6", ["--formant", "1.6"]],
      ["--vibrato 0", ["--vibrato", "0"]],
      ["--vibrato-rate 2", ["--vibrato-rate", "2"]],
    ]) {
      check(!render(label.replace(/\W+/g, "-"), extra).equals(baseline),
        `${label} changes the audio`);
    }
    // ...and the documented defaults must be exactly the untouched voice, or an
    // older project would not sound the way it did.
    check(render("defaults", ["--source", "0", "--formant", "1.0",
      "--vibrato", "1.0", "--vibrato-rate", "9.2"]).equals(baseline),
      "the timbre defaults reproduce the untouched voice");
  } finally {
    fs.rmSync(timbreRoot, { recursive: true, force: true });
  }
}

// --- MIDI ------------------------------------------------------------------
//
// The panel does not open the file, so these three modes are the whole of the
// boundary between a MIDI file and a singing layer. The path travels as hex for
// the same reason the output path does.
{
  const vlq = (value) => {
    const bytes = [value & 0x7f];
    let rest = value >> 7;
    while (rest > 0) { bytes.unshift((rest & 0x7f) | 0x80); rest >>= 7; }
    return bytes;
  };
  const chunk = (type, bytes) => Buffer.concat([
    Buffer.from(type, "ascii"),
    Buffer.from([(bytes.length >> 24) & 0xff, (bytes.length >> 16) & 0xff,
      (bytes.length >> 8) & 0xff, bytes.length & 0xff]),
    Buffer.from(bytes),
  ]);
  const TICKS = 480;
  const microseconds = Math.round(60000000 / 96);
  const tempoTrack = chunk("MTrk", [
    ...vlq(0), 0xff, 0x51, 0x03,
    (microseconds >> 16) & 0xff, (microseconds >> 8) & 0xff, microseconds & 0xff,
    ...vlq(0), 0xff, 0x2f, 0x00,
  ]);
  const events = [...vlq(0), 0xff, 0x03, 6, ...Buffer.from("Melody", "ascii")];
  for (const [at, pitch] of [60, 60, 67, 67].entries()) {
    events.push(...vlq(at === 0 ? 0 : 40), 0x90, pitch, 96);
    events.push(...vlq(TICKS - 40), 0x80, pitch, 0);
  }
  events.push(...vlq(0), 0xff, 0x2f, 0x00);
  const midi = Buffer.concat([
    chunk("MThd", [0, 1, 0, 2, (TICKS >> 8) & 0xff, TICKS & 0xff]),
    tempoTrack,
    chunk("MTrk", events),
  ]);

  // A folder outside any single-byte code page, like the output path test.
  const songRoot = fs.mkdtempSync(path.join(os.tmpdir(), "island chatter midi "));
  const midiPath = path.join(songRoot, "小星星.mid");
  fs.writeFileSync(midiPath, midi);
  try {
    const tracks = execFileSync(tool,
      ["--list-tracks", "--midi-hex", hex(midiPath)], { encoding: "utf8" });
    check(/^T 1 4 4d656c6f6479$/m.test(tracks),
      "--list-tracks reports the melody track, its note count and its name as hex");
    check(/^BPM 96$/m.test(tracks), "--list-tracks reports the file's tempo");

    const song = execFileSync(tool,
      ["--dump-song", "--midi-hex", hex(midiPath), "--track", "1",
        "--lyrics", hex("一閃\n一閃")], { encoding: "utf8" });
    const lines = song.split(/\r?\n/).filter(Boolean);
    check(lines[lines.length - 1] === "END 2", "--dump-song ends with the line count");
    check(lines.some((line) => line.startsWith("X 0 19968 38275")),
      "--dump-song hands the lyric back as decimal codepoints");
    const notes = (lines.find((line) => line.startsWith("N 0 ")) || "").split(" ").slice(2);
    check(notes.length >= 2 && Number(notes[0]) >> 9 === 60,
      `--dump-song encodes pitch and length in one slot (got ${notes.join(",")})`);
    // The second line begins at its own first note: two beats at 96 BPM.
    check(/^L 1 1\.25 /m.test(song),
      "--dump-song places a line at the time of its first note");
    check(/^EXTRA \d+ \d+ \d+ \d+$/m.test(song),
      "--dump-song reports leftovers, dropped chord notes and splits");

    // With no lyrics the melody sings its own note names, and they come back as
    // the text for the layer — which is what makes the feature need no new
    // effect parameters at all.
    {
        const named = execFileSync(tool,
          ["--dump-song", "--midi-hex", hex(midiPath), "--track", "1", "--lyrics", ""],
          { encoding: "utf8" });
        const text = (named.split(/\r?\n/).find((line) => line.startsWith("X 0 ")) || "")
          .split(" ").slice(2).map((code) => String.fromCodePoint(Number(code))).join("");
        check(text === "do do sol sol", `the note names are sung (got ${JSON.stringify(text)})`);
        const inG = execFileSync(tool,
          ["--dump-song", "--midi-hex", hex(midiPath), "--track", "1", "--lyrics", "",
            "--tonic", "7"], { encoding: "utf8" });
        const moved = (inG.split(/\r?\n/).find((line) => line.startsWith("X 0 ")) || "")
          .split(" ").slice(2).map((code) => String.fromCodePoint(Number(code))).join("");
        check(moved === "fa fa do do", `--tonic moves the note names (got ${JSON.stringify(moved)})`);
    }

    // A melody has to change the audio, and the plan has to follow it.
    const sung = execFileSync(tool,
      ["--plan", "--text", hex("一閃"), "--rate", "48000",
        "--melody", `${60 * 512 + 24},${67 * 512 + 48}`, "--melody-bpm", "120"],
      { encoding: "utf8" });
    check(/^E 0 24000 /m.test(sung), "a one-beat note at 120 BPM plans as half a second");
    check(/^E 24000 48000 /m.test(sung), "a two-beat note plans as one second");
    check(/^END 2$/m.test(sung), "a sung plan reports one event per syllable");

    let refused = false;
    try {
      execFileSync(tool, ["--list-tracks", "--midi-hex", hex(path.join(songRoot, "nope.mid"))],
        { stdio: "pipe" });
    } catch (error) { refused = true; }
    check(refused, "a missing MIDI file is refused rather than ignored");

    refused = false;
    try {
      const broken = path.join(songRoot, "broken.mid");
      fs.writeFileSync(broken, Buffer.from("not a midi file at all", "ascii"));
      execFileSync(tool, ["--list-tracks", "--midi-hex", hex(broken)], { stdio: "pipe" });
    } catch (error) { refused = true; }
    check(refused, "a file that is not a MIDI file is refused rather than crashing");
  } finally {
    fs.rmSync(songRoot, { recursive: true, force: true });
  }
}

if (failures > 0) {
  throw new Error(`${failures} bake CLI check(s) failed`);
}
console.log("bake CLI handles non-ASCII output paths, MIDI import and a correct timing plan.");

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

if (failures > 0) {
  throw new Error(`${failures} bake CLI check(s) failed`);
}
console.log("bake CLI handles non-ASCII output paths and reports a correct timing plan.");

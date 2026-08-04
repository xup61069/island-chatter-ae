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

if (failures > 0) {
  throw new Error(`${failures} bake CLI check(s) failed`);
}
console.log("bake CLI handles non-ASCII output paths correctly.");

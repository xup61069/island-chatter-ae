const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "IslandChatter.jsx");
const source = fs.readFileSync(scriptPath, "utf8");
const JavaScriptWithoutDirectives = source.replace(/^#.*$/gm, "");

const compiled = new vm.Script(JavaScriptWithoutDirectives, { filename: "IslandChatter.jsx" });
const sandbox = { module: { exports: {} } };
compiled.runInNewContext(sandbox);
const core = sandbox.module.exports;

const nativePanelPath = path.join(root, "native", "panel", "IslandChatterNativePanel.jsx");
const nativePanelSource = fs.readFileSync(nativePanelPath, "utf8").replace(/^#.*$/gm, "");
new vm.Script(nativePanelSource, { filename: "IslandChatterNativePanel.jsx" });
const aeReadingsSource = fs.readFileSync(
  path.join(root, "native", "panel", "IslandChatterMandarinReadings.jsxinc"), "utf8");
const aeReadingsContext = {};
new vm.Script(aeReadingsSource, { filename: "IslandChatterMandarinReadings.jsxinc" })
  .runInNewContext(aeReadingsContext);
if (aeReadingsContext.islandChatterMandarinReading("你".charCodeAt(0)) !== "ni3") {
  throw new Error("AE Mandarin reading table is not synchronized with Unihan data");
}

const nativePluginSource = fs.readFileSync(
  path.join(root, "native", "plugin", "IslandChatterNative.cpp"), "utf8");
const nativeVersionSource = fs.readFileSync(
  path.join(root, "native", "plugin", "IslandChatterVersion.h"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const installerSource = fs.readFileSync(
  path.join(root, "installer", "Install-IslandChatter.ps1"), "utf8");
const aeSmokeSource = fs.readFileSync(
  path.join(root, "native", "tests", "ae-smoke-test.jsx"), "utf8");
if (!nativePluginSource.includes("dest_snd.num_samples")) {
  throw new Error("Native plug-in must bound writes by PF_SoundWorld.num_samples");
}
if (nativePluginSource.includes("PF_OutFlag2_SUPPORTS_THREADED_RENDERING")) {
  throw new Error("Native audio effect must not opt into AE threaded rendering without host stress tests");
}
if (!nativeVersionSource.includes("ISLAND_CHATTER_AE_VERSION 524289")) {
    throw new Error("Unexpected native/PiPL version encoding");
}
if (packageJson.version !== "1.0.0" ||
    !nativeVersionSource.includes("ISLAND_CHATTER_VERSION_MAJOR 1")) {
  throw new Error("Release and native versions are not synchronized");
}
if (nativePluginSource.includes("PF_OutFlag_I_SYNTHESIZE_AUDIO")) {
  throw new Error("AE 26 crashes before third-party synthesized-audio callbacks on text layers");
}
if (nativePluginSource.includes("PF_ParamFlag_CANNOT_TIME_VARY")) {
  throw new Error("Hidden native text parameters must allow linked expressions");
}
if (!nativePluginSource.includes('"Emotion / 情緒"') ||
    !nativePluginSource.includes('"Clarity / 清晰度"') ||
    !nativePluginSource.includes('"Cuteness / 可愛度"') ||
    !nativePluginSource.includes('"Seed / 種子"')) {
  throw new Error("Creative voice controls are missing from the native parameter ABI");
}
for (const fragment of [
  'DISPLAY_NAME = "Island Chatter Voice"',
  'TONE_MATCH_NAME = "ADBE Aud Tone"',
  "tone.property(6).setValue(0)",
  "tone.moveTo(effect.propertyIndex)",
  "effect = findNativeEffect(textLayer)",
  'addProperty(EFFECT_NAME)',
  "charCodeAt(",
  "Edit text, then apply",
  "characterPreset",
  "Random / 隨機",
  'new MarkerValue("IC:',
  '"IC Mouth"',
  '"IC Head Bounce"',
  '"Island Chatter Type-On"',
]) {
  if (!nativePanelSource.includes(fragment)) {
    throw new Error(`Missing text-layer controller fragment: ${fragment}`);
  }
}
if (nativePanelSource.includes("app.scheduleTask")) {
  throw new Error("Native panel must not poll while AE modal dialogs are open");
}
for (const releaseFile of [
  "IslandChatterNative.aex",
  "IslandChatterNativePanel.jsx",
  "IslandChatterMandarinReadings.jsxinc",
]) {
  if (!installerSource.includes(releaseFile)) {
    throw new Error(`Installer is missing release payload: ${releaseFile}`);
  }
}
for (const smokeFragment of [
  'comp.layers.addText("你好，中文聲音測試！")',
  'effects.addProperty(TONE_MATCH_NAME)',
  'effects.addProperty(EFFECT_NAME)',
  "EXPECTED_PARAMETERS = 76",
  '"External audio files: 0"',
]) {
  if (!aeSmokeSource.includes(smokeFragment)) {
    throw new Error(`AE direct-text smoke test is missing: ${smokeFragment}`);
  }
}

const requiredFragments = [
  '"RIFF"',
  '"WAVE"',
  '"fmt "',
  '"data"',
  "SAMPLE_RATE = 44100",
  "app.project.importFile",
  "new ImportOptions(file)",
  "instanceof Panel",
  "CONSONANT_SIBILANT",
  "makeVowelProfile",
];

for (const fragment of requiredFragments) {
  if (!source.includes(fragment)) {
    throw new Error(`Missing required implementation fragment: ${fragment}`);
  }
}

const sequence = core.buildEvents("ba de si mo lu", 1, 1, core.voices[0]);
if (sequence.events.length !== 5) {
  throw new Error(`Expected 5 CV syllables, received ${sequence.events.length}`);
}
const vowelNames = new Set(sequence.events.map((event) => event.vowel.name));
const consonantKinds = new Set(sequence.events.map((event) => event.consonant.kind));
if (vowelNames.size < 5) throw new Error("CV synthesis did not preserve distinct vowels");
if (consonantKinds.size < 4) throw new Error("CV synthesis did not preserve distinct consonant classes");

const chunks = [];
const mockFile = {
  encoding: null,
  open: () => true,
  write: (chunk) => chunks.push(Buffer.from(chunk, "latin1")),
  close: () => {},
};
core.writeWav(mockFile, "ba se mi", {
  voice: core.voices[0],
  speed: 1,
  pitch: 1,
  volume: 0.78,
  consonant: 1.65,
});
const wav = Buffer.concat(chunks);
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
  throw new Error("Generated audio does not have a valid WAV container header");
}
if (wav.readUInt32LE(40) !== wav.length - 44) {
  throw new Error("Generated WAV data length does not match its header");
}
let peak = 0;
for (let offset = 44; offset < wav.length; offset += 2) {
  peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
}
if (peak < 1000) throw new Error("Generated CV speech is unexpectedly silent");
if (peak >= 32767) throw new Error("Generated CV speech clips at full scale");

for (const voice of core.voices) {
  const voiceChunks = [];
  core.writeWav(
    {
      encoding: null,
      open: () => true,
      write: (chunk) => voiceChunks.push(Buffer.from(chunk, "latin1")),
      close: () => {},
    },
    "ba se mi no lu",
    { voice, speed: 1, pitch: 1, volume: 1, consonant: 2.5 },
  );
  const voiceWav = Buffer.concat(voiceChunks);
  let voicePeak = 0;
  for (let offset = 44; offset < voiceWav.length; offset += 2) {
    voicePeak = Math.max(voicePeak, Math.abs(voiceWav.readInt16LE(offset)));
  }
  if (voicePeak >= 32767) throw new Error(`${voice.name} clips at full volume`);
}

const forbiddenExtensions = new Set([".wav", ".mp3", ".aif", ".aiff", ".m4a", ".ogg"]);
const filesToVisit = [root];
while (filesToVisit.length) {
  const current = filesToVisit.pop();
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" ||
        entry.name === "preview.wav" || entry.name === "native-preview.wav" ||
        entry.name === "mandarin-preview.wav" ||
        /^build/.test(entry.name)) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) filesToVisit.push(fullPath);
    if (entry.isFile() && forbiddenExtensions.has(path.extname(entry.name).toLowerCase())) {
      throw new Error(`Binary audio asset found: ${path.relative(root, fullPath)}`);
    }
  }
}

console.log("IslandChatter.jsx passed syntax, CV phoneme, WAV, and project-integrity checks.");

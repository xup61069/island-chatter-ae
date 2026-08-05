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
// The panel gets its timing plan from island_chatter_bake --plan, so it must not
// grow a second implementation of the engine's text planning again. Two copies
// could not agree even in principle — the engine varies syllable lengths by a
// seeded random amount — and the copy knew nothing about inline overrides,
// Zhuyin, tone-number pinyin or the 64-unit limit.
for (const [symbol, what] of [
  ["islandChatterMandarinReading", "a copy of the Mandarin reading table"],
  ["IC_PHRASE_READINGS", "a copy of the phrase table"],
  ["function buildSpeechUnits", "a copy of build_speech_units()"],
  ["function estimateSpeech", "a second planner"],
  ["function applySandhi", "a copy of tone sandhi"],
  ["function punctuationSeconds", "a copy of punctuation_pause()"],
]) {
  if (nativePanelSource.includes(symbol)) {
    throw new Error(
      `The panel carries ${what} (${symbol}). Ask the engine with --plan instead.`);
  }
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
// Release synchronization. CLAUDE.md lists the files that carry the version;
// every one of them is checked here so a bump cannot half-land.
const version = packageJson.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json version is not a plain semver triple: ${version}`);
}
const [major, minor, bug] = version.split(".").map(Number);
for (const [macro, expected] of [
  ["ISLAND_CHATTER_VERSION_MAJOR", major],
  ["ISLAND_CHATTER_VERSION_MINOR", minor],
  ["ISLAND_CHATTER_VERSION_BUG", bug],
]) {
  if (!new RegExp(`#define ${macro} ${expected}\\b`).test(nativeVersionSource)) {
    throw new Error(`${macro} does not match package.json version ${version}`);
  }
}
const stageMatch = nativeVersionSource.match(/#define ISLAND_CHATTER_VERSION_STAGE (\d+)/);
const buildMatch = nativeVersionSource.match(/#define ISLAND_CHATTER_VERSION_BUILD (\d+)/);
if (!stageMatch || !buildMatch) {
  throw new Error("Version stage or build macro is missing");
}
const stage = Number(stageMatch[1]);
const build = Number(buildMatch[1]);
if (stage !== 3) {
  throw new Error(
    "A published build must use PF_Stage_RELEASE (3); After Effects compares the encoded stage");
}
// PF_VERSION packs the version into one 32-bit word with very small fields, and
// it masks rather than complains. 1.0.16 would encode identically to 1.0.0 and
// After Effects would treat an upgrade as a downgrade, so refuse to ship a
// number that does not fit. Bug is the field that will run out first.
for (const [label, value, bits] of [
  ["major", major, 3], ["minor", minor, 4], ["bug", bug, 4], ["build", build, 9],
]) {
  if (value > (1 << bits) - 1) {
    throw new Error(
      `PF_VERSION has only ${bits} bits for ${label}; ${value} would wrap and ` +
      `make this build look older than it is. Roll the next field instead.`);
  }
}
// Mirrors PF_VERSION() in the After Effects SDK.
const encodedVersion =
  (((major & 0x7) << 19) | ((minor & 0xf) << 15) | ((bug & 0xf) << 11) |
   ((stage & 0x3) << 9) | (build & 0x1ff)) >>> 0;
if (!new RegExp(`#define ISLAND_CHATTER_AE_VERSION ${encodedVersion}\\b`).test(nativeVersionSource)) {
  throw new Error(
    `ISLAND_CHATTER_AE_VERSION should be ${encodedVersion} for ${version} stage ${stage} build ${build}`);
}
for (const [label, filePath, pattern] of [
  ["native/CMakeLists.txt", path.join(root, "native", "CMakeLists.txt"),
    new RegExp(`project\\(IslandChatterNative VERSION ${version.replace(/\./g, "\\.")}\\b`)],
  ["native/tests/ae-smoke-test.jsx", path.join(root, "native", "tests", "ae-smoke-test.jsx"),
    new RegExp(`EXPECTED_VERSION = "${version.replace(/\./g, "\\.")}"`)],
  ["tools/package-release.ps1", path.join(root, "tools", "package-release.ps1"),
    new RegExp(`\\$Version = "${version.replace(/\./g, "\\.")}"`)],
  ["installer/Install-IslandChatter.ps1", path.join(root, "installer", "Install-IslandChatter.ps1"),
    new RegExp(`\\$IslandChatterVersion = "${version.replace(/\./g, "\\.")}"`)],
  ["CHANGELOG.md", path.join(root, "CHANGELOG.md"),
    new RegExp(`^## ${version.replace(/\./g, "\\.")} `, "m")],
]) {
  if (!pattern.test(fs.readFileSync(filePath, "utf8"))) {
    throw new Error(`${label} is not synchronized with package.json version ${version}`);
  }
}
// The About box must derive its text from the macros instead of hardcoding it.
if (/Island Chatter Native v\d/.test(nativePluginSource)) {
  throw new Error("About text hardcodes a version; use ISLAND_CHATTER_VERSION_TEXT");
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
  "if (level.numKeys > 0) { clearKeys(level); }",
  "if (slider.numKeys === 0 && valuesDiffer(slider.value, defaultValue))",
  "property.setValueAtTime(time, value)",
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
// Bake hands a path to an external tool through system.callSystem(), which
// converts the command line to the console code page. A path passed as plain
// text loses every character outside it, so it must go over as hex UTF-8.
if (!nativePanelSource.includes("--out-hex ")) {
  throw new Error("Bake must pass the output path as hex UTF-8 (--out-hex), not plain text");
}
if (/--out [^-]/.test(nativePanelSource)) {
  throw new Error("Bake passes a plain-text output path; use --out-hex");
}

if (nativePanelSource.includes("app.scheduleTask")) {
  throw new Error("Native panel must not poll while AE modal dialogs are open");
}

// ExtendScript is ES3, whose future-reserved words are far wider than modern
// JavaScript's. Node parses `var native = ...` happily; After Effects rejects
// the whole file with "Illegal use of reserved word" in a modal dialog, which
// is invisible to automation. Catch it here instead.
const es3ReservedWords = [
  "abstract", "boolean", "byte", "char", "class", "const", "debugger", "double", "enum",
  "export", "extends", "final", "float", "goto", "implements", "import", "int", "interface",
  "long", "native", "package", "private", "protected", "public", "short", "static", "super",
  "synchronized", "throws", "transient", "volatile",
];
const extendScriptFiles = [
  path.join(root, "IslandChatter.jsx"),
  path.join(root, "native", "panel", "IslandChatterNativePanel.jsx"),
  ...fs.readdirSync(path.join(root, "native", "tests"))
    .filter((name) => name.endsWith(".jsx"))
    .map((name) => path.join(root, "native", "tests", name)),
];
for (const filePath of extendScriptFiles) {
  // Strip comments and string literals so prose and messages do not trip this.
  const code = fs.readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  for (const word of es3ReservedWords) {
    const declared = new RegExp(`\\b(?:var|function)\\s+${word}\\b`);
    const assigned = new RegExp(`[,(]\\s*${word}\\s*(?:=[^=]|[,)])`);
    const member = new RegExp(`\\.\\s*${word}\\b`);
    if (declared.test(code) || assigned.test(code) || member.test(code)) {
      throw new Error(
        `${path.relative(root, filePath)} uses the ES3 reserved word "${word}" as an ` +
        "identifier; After Effects will refuse to run the file");
    }
  }
}

// The parameter ABI is split across three files. Keep them in lockstep.
const paramsHeader = fs.readFileSync(
  path.join(root, "native", "plugin", "params.hpp"), "utf8");
if (!/static_assert\(kParamCount == 145/.test(paramsHeader)) {
  throw new Error("params.hpp no longer asserts the published parameter count");
}
if (!/static_assert\(kParamSeed == 75/.test(paramsHeader)) {
  throw new Error("params.hpp must pin the published indices so appends cannot shift them");
}
for (const [constant, index] of [
  ["PARAM_VOICE", 1], ["PARAM_PITCH", 2], ["PARAM_SPEED", 3], ["PARAM_VOLUME", 4],
  ["PARAM_CONSONANT", 5], ["PARAM_TEXT_LENGTH", 6], ["PARAM_TEXT_FIRST", 7],
  ["PARAM_EMOTION", 71], ["PARAM_CHARACTER_SIZE", 72], ["PARAM_CLARITY", 73],
  ["PARAM_CUTENESS", 74], ["PARAM_SEED", 75], ["PARAM_TEMPO_LOCK", 76],
  ["PARAM_FORMANT", 77], ["PARAM_SOURCE", 78], ["PARAM_VIBRATO", 79],
  ["PARAM_VIBRATO_RATE", 80],
]) {
  if (!new RegExp(`var ${constant} = ${index};`).test(nativePanelSource)) {
    throw new Error(`Panel ${constant} must stay at published index ${index}`);
  }
  // Index 7 opens the 64 text-unit block, which the plug-in registers in a loop.
  const registered = index === 7
    ? /PF_ADD_SLIDER\("Text code unit"[^;]*?static_cast<A_long>\(7 \+ index\)\);/s
    : new RegExp(`PF_ADD_[A-Z_]+\\([^;]*?[ ,]${index}\\);`, "s");
  if (!registered.test(nativePluginSource)) {
    throw new Error(`Native plug-in does not register a parameter with id ${index}`);
  }
}
// The transport is two blocks of sixty-four UTF-16 units: 0-63 at index 7 and
// 64-127 at index 81, because the indices in between were already published.
// Both sides must agree on the block size or the second half is read as noise.
if (!/var TEXT_UNITS_PER_BLOCK = 64;/.test(nativePanelSource) ||
    !/kTextUnitsPerBlock = 64;/.test(paramsHeader)) {
  throw new Error("The UTF-16 transport block size is not synchronized");
}
if (!/var PARAM_TEXT_SECOND_FIRST = 81;/.test(nativePanelSource) ||
    !/static_assert\(kParamTextSecondFirst == 81/.test(paramsHeader)) {
  throw new Error("The second text block must stay at its published index 81");
}
// Reading or writing a unit must go through the helper that knows about both
// blocks; PARAM_TEXT_FIRST + index silently walks off the end of the first one
// and into the creative controls.
if (/PARAM_TEXT_FIRST \+ index\)/.test(
  nativePanelSource.replace(/function textUnitProperty[\s\S]*?\n    \}/, ""))) {
  throw new Error("The panel indexes text units without going through textUnitProperty()");
}
// Each registration loop fills one block, so both must be bounded by the block
// size. Bounding the first one by the total instead overruns its ids into the
// creative controls, and After Effects then refuses to add the effect at all
// with "parameter count mismatch" — which reads as the plug-in not being
// installed, nowhere near the actual mistake.
{
  const loops = [...nativePluginSource.matchAll(
    /for \(std::size_t index = 0; index < island_chatter::ae::(\w+); \+\+index\) \{[\s\S]{0,400}?PF_ADD_SLIDER\("Text code unit"/g)];
  if (loops.length !== 2) {
    throw new Error(`Expected two text-unit registration loops, found ${loops.length}`);
  }
  for (const loop of loops) {
    if (loop[1] !== "kTextUnitsPerBlock") {
      throw new Error(
        `A text-unit loop is bounded by ${loop[1]}; each block registers kTextUnitsPerBlock`);
    }
  }
}

const dspSource = fs.readFileSync(path.join(root, "native", "src", "dsp.cpp"), "utf8");

// apply_character_style() scales Speed again; the panel must use the same
// numbers or Fit Duration and every marker drift away from the audio.
for (const [label, expected] of [
  ["tiny", "1.08"], ["young", "1.04"], ["giant", "0.91"],
  ["happy", "1.08"], ["angry", "1.12"], ["scared", "1.14"],
  ["sleepy", "0.78"], ["robot", "0.96"],
]) {
  if (!new RegExp(`settings\\.speed \\*= ${expected.replace(".", "\\.")};`).test(dspSource)) {
    throw new Error(`Native speed multiplier for ${label} (${expected}) changed`);
  }
  if (!new RegExp(`factor \\*= ${expected.replace(".", "\\.")};`).test(nativePanelSource)) {
    throw new Error(`Panel styleSpeedMultiplier() is missing the ${label} multiplier ${expected}`);
  }
}
// A tempo fixes the effective speed, but the Speed slider holds the value before
// the engine applies the style multiplier, so speedForTempo() must divide it out.
// Without that the tempo drifts with emotion and character size: Sleepy ran 28%
// slow while Neutral looked exact, because Neutral's multiplier is 1.
if (!/return target \/ styleSpeedMultiplier\(emotion, characterSize\);/.test(nativePanelSource)) {
  throw new Error("speedForTempo() must divide out the style multiplier, or BPM drifts per emotion");
}
if (!/emotion\.onChange = refreshTempo;/.test(nativePanelSource) ||
    !/characterSize\.onChange = refreshTempo;/.test(nativePanelSource)) {
  throw new Error("Changing emotion or character size must recompute the tempo-derived Speed");
}
// Syllable lengths and punctuation rests live only in the engine now. Tempo mode
// is the one timing calculation the panel still does for itself, because it
// converts BPM to a Speed before anything has been written to the effect, so
// there is nothing to ask the engine about yet.
if ((dspSource.match(/kSyllableStride = ([\d.]+);/) || [])[1] !==
    (nativePanelSource.match(/var SYLLABLE_STRIDE = ([\d.]+);/) || [])[1]) {
  throw new Error("SYLLABLE_STRIDE differs between the engine and the panel; BPM would drift");
}

// The panel's ScriptUI sliders must span the same range as the effect
// parameters, and its Speed clamp must equal the engine's or the timings it
// plans stop matching the audio at the ends of the range.
for (const [label, pluginPattern, panelPattern] of [
  ["Pitch", /PF_ADD_FLOAT_SLIDERX\("Pitch[^"]*", 0\.10, 4\.00,/,
    /addSlider\(panel, "Pitch[^"]*", 0\.10, 4\.00,/],
  ["Speed", /PF_ADD_FLOAT_SLIDERX\("Speed[^"]*", 0\.10, 10\.00,/,
    /addSlider\(panel, "Speed[^"]*", 0\.10, 10\.00,/],
  ["Volume", /PF_ADD_FLOAT_SLIDERX\("Volume[^"]*", 0\.0, 200\.0,/,
    /addSlider\(panel, "Volume[^"]*", 0\.00, 2\.00,/],
  ["Consonant", /PF_ADD_FLOAT_SLIDERX\("Initial[^"]*", 0\.00, 6\.00,/,
    /addSlider\(panel, "Consonant[^"]*", 0\.00, 6\.00,/],
]) {
  if (!pluginPattern.test(nativePluginSource)) {
    throw new Error(`${label} parameter range changed in the plug-in without updating the panel`);
  }
  if (!panelPattern.test(nativePanelSource)) {
    throw new Error(`${label} slider range in the panel does not match the plug-in parameter`);
  }
}
// Pull individual functions out of the panel so they can be exercised here. The
// panel is one big closure meant for ScriptUI, so there is nothing to require.
const planner = { Math, String, parseInt, parseFloat, isNaN, Error };
vm.createContext(planner);
const takeFunction = (name) => {
  const start = nativePanelSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Panel planner is missing ${name}()`);
  let depth = 0;
  for (let cursor = nativePanelSource.indexOf("{", start); cursor < nativePanelSource.length; cursor += 1) {
    if (nativePanelSource[cursor] === "{") depth += 1;
    else if (nativePanelSource[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return nativePanelSource.slice(start, cursor + 1);
    }
  }
  throw new Error(`Panel planner function ${name}() is unbalanced`);
};
const takeVariable = (name) => {
  const start = nativePanelSource.indexOf(`var ${name} =`);
  if (start < 0) throw new Error(`Panel planner is missing ${name}`);
  return nativePanelSource.slice(start, nativePanelSource.indexOf(";\n", start) + 1);
};
vm.runInContext([
  takeVariable("SYLLABLE_STRIDE"),
  takeVariable("ENGINE_SAMPLE_RATE"),
  ...["clamp", "mouthForReading", "readingTone", "characterFromCode", "trim",
    "parseEnginePlan", "styleSpeedMultiplier", "effectiveSpeed", "speedForTempo"].map(takeFunction),
].join("\n"), planner);

// Tempo mode across every emotion and character size. The original version only
// divided the tempo by the syllable slot and ignored the multiplier the engine
// applies on top, so the beat drifted with the character: Sleepy ran 28% slow.
// Neutral and Question were the only combinations that looked right, and those
// were the two the first version of this test happened to use.
for (const bpm of [60, 90, 120, 174]) {
  for (const perBeat of [1, 2, 4]) {
    for (let emotion = 0; emotion < 7; emotion += 1) {
      for (let size = 0; size < 4; size += 1) {
        const slider = vm.runInContext(
          `speedForTempo(${bpm}, ${perBeat}, ${emotion}, ${size})`, planner);
        const effective = vm.runInContext(
          `effectiveSpeed({ speed: ${slider}, emotion: ${emotion}, characterSize: ${size} })`,
          planner);
        // 0.188 s of voice plus a 0.012 s gap, divided by the effective speed.
        const perSyllable = 0.2 / effective;
        const target = 60 / bpm / perBeat;
        if (Math.abs(perSyllable - target) > target * 0.001) {
          throw new Error(
            `tempo drift at ${bpm} BPM, ${perBeat}/beat, emotion ${emotion}, size ${size}: ` +
            `${perSyllable.toFixed(5)}s per syllable, expected ${target.toFixed(5)}s`);
        }
      }
    }
  }
}

// The interface language layer. The panel is written throughout as
// "English / 中文" and translated in one pass, so the Japanese table is keyed by
// those literals — and a renamed label would leave its translation stranded
// with nothing to say so.
{
  const table = nativePanelSource.match(/var IC_JAPANESE_UI = \{([\s\S]*?)\n    \};/);
  if (!table) throw new Error("The panel has no Japanese interface table");
  const keys = [...table[1].matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1]);
  if (keys.length < 40) {
    throw new Error(`Only ${keys.length} interface strings are translated; the panel has far more`);
  }
  // Everything outside the table itself, so a key cannot match its own entry.
  const panelWithoutTable = nativePanelSource.replace(table[0], "");
  for (const key of keys) {
    if (!panelWithoutTable.includes(key)) {
      throw new Error(
        `The Japanese interface table translates "${key}", which the panel no longer says`);
    }
    if (key.indexOf(" / ") <= 0) {
      throw new Error(`Interface key "${key}" is not in the "English / 中文" form T() expects`);
    }
  }
  const localiser = { String };
  vm.createContext(localiser);
  vm.runInContext([
    takeVariable("UI_LANGUAGE"),
    nativePanelSource.slice(nativePanelSource.indexOf("var IC_JAPANESE_UI = {")).slice(
      0, nativePanelSource.slice(nativePanelSource.indexOf("var IC_JAPANESE_UI = {"))
        .indexOf("\n    };") + 7),
    takeFunction("T"),
  ].join("\n"), localiser);
  for (const [language, literal, expected] of [
    ["zh", "Pitch / 音高", "音高"],
    ["en", "Pitch / 音高", "Pitch"],
    ["ja", "Pitch / 音高", "ピッチ"],
    // Not in the table: Japanese has to fall back rather than show nothing.
    ["ja", "Nonsense / 亂寫", "Nonsense"],
    // No separator at all: left alone in every language.
    ["ja", "IC Mouth", "IC Mouth"],
    ["zh", "IC Mouth", "IC Mouth"],
    // Every object inherits these names; the table must not answer for them.
    ["ja", "constructor", "constructor"],
    ["ja", "toString / 字串", "toString"],
  ]) {
    localiser.UI_LANGUAGE = language;
    const got = vm.runInContext(`T(${JSON.stringify(literal)})`, localiser);
    if (got !== expected) {
      throw new Error(`T("${literal}") in ${language} returned "${got}", expected "${expected}"`);
    }
  }
}

// Decoding the engine's plan. The plan itself is covered against the real tool
// in tests/bake-cli.test.js and against the engine in native/tests/dsp_tests.cpp;
// what is checked here is that the panel reads it correctly, including the cases
// where reading it wrongly would silently mis-size a layer.
const samplePlan = [
  "PLAN 1",
  "RATE 48000",
  "SAMPLES 96000",
  "E 0 9600 ni2 20320",
  "E 10176 9600 hao3 22909",
  // No Mandarin syllable, and a latin consonant that swallowed the vowel after
  // it, so the event speaks two input characters.
  "E 20352 7104 - 98 97",
  // Outside the BMP: the panel has to rebuild the surrogate pair.
  "E 28032 7104 - 131083",
  "END 4",
].join("\r\n");
const parsed = vm.runInContext(`parseEnginePlan(${JSON.stringify(samplePlan)})`, planner);
if (parsed.events.length !== 4) {
  throw new Error(`parseEnginePlan read ${parsed.events.length} events, expected 4`);
}
if (Math.abs(parsed.duration - 2.0) > 1e-9) {
  throw new Error(`parseEnginePlan read ${parsed.duration}s, expected 2.0s`);
}
if (Math.abs(parsed.events[1].time - 10176 / 48000) > 1e-9 ||
    Math.abs(parsed.events[1].duration - 0.2) > 1e-9) {
  throw new Error("parseEnginePlan did not convert samples to seconds");
}
if (parsed.events[2].character !== "ba") {
  throw new Error(
    `parseEnginePlan built "${parsed.events[2].character}" from two codepoints, expected "ba"`);
}
if (parsed.events[3].character !== "\u{2000B}") {
  throw new Error("parseEnginePlan did not rebuild a surrogate pair");
}
// "-" has always been spoken as an invented syllable; the marker text and the
// mouth shape must not change because the transport now spells it differently.
if (parsed.events[2].reading !== "a5" || parsed.events[2].mouth !== 1 ||
    parsed.events[2].tone !== 5) {
  throw new Error("parseEnginePlan mishandled a syllable with no Mandarin reading");
}
if (parsed.events[0].mouth !== 2 || parsed.events[0].tone !== 2) {
  throw new Error("parseEnginePlan derived the wrong mouth or tone from a reading");
}
// callSystem() reports no exit status. A tool that died halfway would otherwise
// read as a short utterance and quietly shorten the layer.
for (const [label, broken] of [
  ["truncated output", samplePlan.split("\r\n").slice(0, 5).join("\r\n")],
  ["missing header", samplePlan.split("\r\n").slice(2).join("\r\n")],
  ["tool wrote nothing", ""],
]) {
  let threw = false;
  try {
    vm.runInContext(`parseEnginePlan(${JSON.stringify(broken)})`, planner);
  } catch (error) {
    threw = true;
  }
  if (!threw) throw new Error(`parseEnginePlan accepted ${label}`);
}
// Builds are sold, so the licence and the README have to point at the same
// storefront. A link that rots in one place and not the other sends buyers
// somewhere that no longer sells anything.
const purchaseUrls = new Set();
for (const doc of ["LICENSE", "README.md"]) {
  const found = fs.readFileSync(path.join(root, doc), "utf8")
    .match(/https:\/\/[a-z0-9.-]*gumroad\.com\/[^\s)"'`;,]+/gi) || [];
  if (found.length === 0) {
    throw new Error(`${doc} does not say where to buy a build`);
  }
  found.forEach((url) => purchaseUrls.add(url.replace(/[.,]$/, "")));
}
if (purchaseUrls.size !== 1) {
  throw new Error(
    `LICENSE and README point at different storefronts: ${[...purchaseUrls].join(", ")}`);
}

// The project is source-available, not MIT: builds are sold, so nothing may
// re-grant redistribution rights. A stray MIT header would do exactly that.
const licenseText = fs.readFileSync(path.join(root, "LICENSE"), "utf8");
if (!/Island Chatter AE Source-Available License/.test(licenseText)) {
  throw new Error("LICENSE is not the source-available licence");
}
if (/^MIT License/m.test(licenseText)) {
  throw new Error("LICENSE reverted to MIT; builds are sold under a source-available licence");
}
for (const licensed of [
  "IslandChatter.jsx",
  path.join("native", "panel", "IslandChatterNativePanel.jsx"),
]) {
  const header = fs.readFileSync(path.join(root, licensed), "utf8").slice(0, 800);
  if (/SPDX-License-Identifier:\s*MIT/.test(header)) {
    throw new Error(`${licensed} still declares SPDX MIT`);
  }
}
if (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).license === "MIT") {
  throw new Error("package.json still declares MIT");
}

// Windows PowerShell 5.1 reads a .ps1 as the system ANSI codepage unless the
// file starts with a UTF-8 BOM, which turns any non-ASCII message into mojibake
// and can break the parse outright.
// The double-click launchers are what a buyer actually runs, so the packager
// must place them at the top of the extracted folder, not bury them.
const packager = fs.readFileSync(path.join(root, "tools", "package-release.ps1"), "utf8");
for (const launcher of ["Install.bat", "Uninstall.bat"]) {
  if (!fs.existsSync(path.join(root, "installer", launcher))) {
    throw new Error(`installer/${launcher} is missing`);
  }
  if (!new RegExp(`Join-Path \\$stageRoot "${launcher}"`).test(packager)) {
    throw new Error(`${launcher} is not staged at the root of the release package`);
  }
  // The payload moved into resources\, so a launcher that only knows the old
  // installer\ layout would find nothing and report a missing script.
  const launcherScript = `${launcher.replace(/\.bat$/, "")}-IslandChatter.ps1`;
  if (!new RegExp(`%~dp0resources\\\\${launcherScript.replace(/\./g, "\\.")}`).test(
    fs.readFileSync(path.join(root, "installer", launcher), "ascii"))) {
    throw new Error(`installer/${launcher} does not look in resources\\ for its script`);
  }
  // A .bat is read in the console code page, so non-ASCII would arrive mangled.
  const bytes = fs.readFileSync(path.join(root, "installer", launcher));
  if (!bytes.every((byte) => byte < 0x80)) {
    throw new Error(`installer/${launcher} must stay ASCII; a .bat has no BOM to declare UTF-8`);
  }
  // cmd.exe can mis-handle labels and goto in a .bat with LF endings, and both
  // launchers use goto for their error paths. .gitattributes pins this, so a
  // failure here means that pin was lost.
  const text = bytes.toString("ascii");
  if (/goto/.test(text) && text.indexOf("\r\n") < 0) {
    throw new Error(`installer/${launcher} has LF endings; a .bat using goto needs CRLF`);
  }
  if (!/net session/.test(text)) {
    throw new Error(`installer/${launcher} must elevate; Program Files is not user-writable`);
  }
  if (!/pause/.test(text)) {
    throw new Error(`installer/${launcher} must pause, or errors vanish with the window`);
  }
}

// What a buyer sees on extracting the ZIP. Anything that is not a decision
// belongs in resources\; a stray .aex or .jsx at the top is what made the old
// package unreadable to a first-time installer.
for (const [file, staged] of [
  ["README.txt", "$stageRoot"],
  ["LICENSE", "$stageRoot"],
  ["IslandChatterNative.aex", "$resources"],
  ["island_chatter_bake.exe", "$resources"],
  ["IslandChatterNativePanel.jsx", "$resources"],
  ["Install-IslandChatter.ps1", "$resources"],
  ["Uninstall-IslandChatter.ps1", "$resources"],
  ["THIRD_PARTY_NOTICES.md", "$resources"],
]) {
  const wanted = new RegExp(`Join-Path \\${staged} "${file.replace(/\./g, "\\.")}"`);
  if (!wanted.test(packager)) {
    throw new Error(`${file} is not staged into ${staged} by tools/package-release.ps1`);
  }
  const wrong = staged === "$resources" ? "$stageRoot" : "$resources";
  if (new RegExp(`Join-Path \\${wrong} "${file.replace(/\./g, "\\.")}"`).test(packager)) {
    throw new Error(`${file} is staged into ${wrong} as well; the package root must stay minimal`);
  }
}
// Notepad is what opens this file, and it is the only instruction a buyer gets.
{
  const readme = fs.readFileSync(path.join(root, "installer", "README.txt"));
  if (!(readme[0] === 0xef && readme[1] === 0xbb && readme[2] === 0xbf)) {
    throw new Error("installer/README.txt needs a UTF-8 BOM or Notepad shows mojibake");
  }
  const readmeText = readme.toString("utf8");
  if (readmeText.indexOf("\r\n") < 0) {
    throw new Error("installer/README.txt has LF endings; .gitattributes should pin it to CRLF");
  }
  for (const mention of ["Install.bat", "Uninstall.bat", "resources", "LICENSE"]) {
    if (!readmeText.includes(mention)) {
      throw new Error(`installer/README.txt does not mention ${mention}`);
    }
  }
}
// The installer used to hardcode "payload is one level up". It now ships beside
// its payload, so it has to search instead of assume.
if (/\$payloadRoot\s*=\s*Split-Path/.test(installerSource)) {
  throw new Error(
    "Install-IslandChatter.ps1 assumes a fixed payload location; it must search for the files");
}
if (!installerSource.includes("$payloadCandidates")) {
  throw new Error("Install-IslandChatter.ps1 must try every known payload layout");
}

for (const scriptName of ["installer/Install-IslandChatter.ps1",
  "installer/Uninstall-IslandChatter.ps1", "tools/package-release.ps1"]) {
  const bytes = fs.readFileSync(path.join(root, scriptName));
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const isAscii = bytes.every((byte) => byte < 0x80);
  if (!isAscii && !hasBom) {
    throw new Error(`${scriptName} has non-ASCII text but no UTF-8 BOM; ` +
      "Windows PowerShell 5.1 will mis-decode it");
  }
}

for (const releaseFile of [
  "IslandChatterNative.aex",
  "island_chatter_bake.exe",
  "IslandChatterNativePanel.jsx",
]) {
  if (!installerSource.includes(releaseFile)) {
    throw new Error(`Installer is missing release payload: ${releaseFile}`);
  }
}
for (const smokeFragment of [
  'comp.layers.addText("你好，中文聲音測試！")',
  'effects.addProperty(TONE_MATCH_NAME)',
  'effects.addProperty(EFFECT_NAME)',
  "EXPECTED_PARAMETERS = 145",
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
    // Locally generated previews and the transient output of
    // native/tests/ae-audio-render.jsx. Everything else must stay asset-free:
    // this check is what keeps the repository and release free of third-party
    // audio. All of these are also in .gitignore.
    if (entry.name === ".git" || entry.name === "node_modules" ||
        entry.name === "preview.wav" || entry.name === "native-preview.wav" ||
        entry.name === "mandarin-preview.wav" ||
        entry.name === "ae-audio-render-output.aif" ||
        /^build/.test(entry.name)) continue;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) filesToVisit.push(fullPath);
    if (entry.isFile() && forbiddenExtensions.has(path.extname(entry.name).toLowerCase())) {
      throw new Error(`Binary audio asset found: ${path.relative(root, fullPath)}`);
    }
  }
}

console.log("IslandChatter.jsx passed syntax, CV phoneme, WAV, and project-integrity checks.");

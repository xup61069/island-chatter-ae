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

/*
 * Blank out comments, strings and regex literals in one pass.
 *
 * The obvious version is four chained replaces, and it was wrong for two
 * releases without anyone noticing. The panel writes a generated expression
 * containing the literal "// Island Chatter mouth switch"; stripping line
 * comments first ate that string's closing quote, every quote after it paired
 * up one out of step, and most of the file was blanked before the search ever
 * ran. The reserved-word check below silently stopped checking anything past
 * the middle of the panel — which is how `var byte` reached After Effects.
 *
 * A single left-to-right scan cannot get out of step, because it only ever
 * leaves a construct through the delimiter it entered on. Regex literals are
 * included because bakeFileName() matches a quote inside one.
 */
function stripLiterals(source) {
  let out = "";
  let index = 0;
  // Whether a / here begins a regex literal or is a division sign. The usual
  // heuristic: after a value it divides, after an operator it opens a regex.
  let previous = "";
  while (index < source.length) {
    const here = source[index];
    const next = source[index + 1];
    if (here === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") { index += 1; }
      out += " ";
    } else if (here === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      out += " ";
    } else if (here === '"' || here === "'") {
      index += 1;
      while (index < source.length && source[index] !== here) {
        index += source[index] === "\\" ? 2 : 1;
      }
      index += 1;
      out += here + here;
      previous = "x";
    } else if (here === "/" && /[(,=:[!&|?{};+\-*%~^<>]|^$/.test(previous)) {
      index += 1;
      let inClass = false;
      while (index < source.length) {
        const letter = source[index];
        if (letter === "\\") { index += 2; continue; }
        if (letter === "[") { inClass = true; }
        else if (letter === "]") { inClass = false; }
        else if (letter === "/" && !inClass) { break; }
        else if (letter === "\n") { break; }
        index += 1;
      }
      index += 1;
      out += "/x/";
      previous = "x";
    } else {
      out += here;
      if (!/\s/.test(here)) { previous = here; }
      index += 1;
    }
  }
  return out;
}

for (const filePath of extendScriptFiles) {
  const code = stripLiterals(fs.readFileSync(filePath, "utf8"));
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
if (!/static_assert\(kParamCount == 279/.test(paramsHeader)) {
  throw new Error("params.hpp no longer asserts the published parameter count");
}
for (const pinned of [
  /static_assert\(kParamSeed == 75/,
  /static_assert\(kParamTempoLock == 76/,
  /static_assert\(kParamTextSecondFirst == 81/,
  /static_assert\(kParamMelodyLength == 145/,
  /static_assert\(kParamMelodyFirst == 151/,
  /static_assert\(kParamMelodyDetailFirst == 215/,
]) {
  if (!pinned.test(paramsHeader)) {
    throw new Error("params.hpp must pin the published indices so appends cannot shift them");
  }
}
for (const [constant, index] of [
  ["PARAM_VOICE", 1], ["PARAM_PITCH", 2], ["PARAM_SPEED", 3], ["PARAM_VOLUME", 4],
  ["PARAM_CONSONANT", 5], ["PARAM_TEXT_LENGTH", 6], ["PARAM_TEXT_FIRST", 7],
  ["PARAM_EMOTION", 71], ["PARAM_CHARACTER_SIZE", 72], ["PARAM_CLARITY", 73],
  ["PARAM_CUTENESS", 74], ["PARAM_SEED", 75], ["PARAM_TEMPO_LOCK", 76],
  ["PARAM_FORMANT", 77], ["PARAM_SOURCE", 78], ["PARAM_VIBRATO", 79],
  ["PARAM_VIBRATO_RATE", 80],
  // The melody transport, appended in 1.7.0.
  ["PARAM_MELODY_LENGTH", 145], ["PARAM_MELODY_BPM", 146],
  ["PARAM_MELODY_TRANSPOSE", 147], ["PARAM_TONE_BLEND", 148],
  ["PARAM_PORTAMENTO", 149], ["PARAM_VIBRATO_DELAY", 150],
  ["PARAM_MELODY_FIRST", 151], ["PARAM_MELODY_DETAIL_FIRST", 215],
]) {
  if (!new RegExp(`var ${constant} = ${index};`).test(nativePanelSource)) {
    throw new Error(`Panel ${constant} must stay at published index ${index}`);
  }
  // Most ids are written out at the call. The two transports are registered in
  // a loop, and the melody's own controls go through the enum, so each of those
  // is matched by the name the plug-in actually uses. Matching "any kParam"
  // would let one of them register twice and the other not at all.
  const named = {
    7: /PF_ADD_SLIDER\("Text code unit"[^;]*?static_cast<A_long>\(7 \+ index\)\);/s,
    145: /PF_ADD_SLIDER\("Melody length"[^;]*?ae::kParamMelodyLength\);/s,
    146: /PF_ADD_FLOAT_SLIDERX\("Melody BPM[^;]*?ae::kParamMelodyBpm\);/s,
    147: /PF_ADD_SLIDER\("Transpose[^;]*?ae::kParamMelodyTranspose\);/s,
    148: /PF_ADD_FLOAT_SLIDERX\("Tone Blend[^;]*?ae::kParamToneBlend\);/s,
    149: /PF_ADD_FLOAT_SLIDERX\("Portamento[^;]*?ae::kParamPortamento\);/s,
    150: /PF_ADD_FLOAT_SLIDERX\("Vibrato Delay[^;]*?ae::kParamVibratoDelay\);/s,
    151: /PF_ADD_SLIDER\("Melody note"[^;]*?ae::kParamMelodyFirst \+ index\)\);/s,
    215: /PF_ADD_SLIDER\("Melody detail"[^;]*?ae::kParamMelodyDetailFirst \+ index\)\);/s,
  }[index];
  const registered = named || new RegExp(`PF_ADD_[A-Z_]+\\([^;]*?[ ,]${index}\\);`, "s");
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
  // The melody transport is one loop of kMelodySlots, and it has the same
  // failure mode: a wrong bound walks its ids past num_params and After Effects
  // refuses the whole effect with "parameter count mismatch".
  for (const which of ["Melody note", "Melody detail"]) {
    const melodyLoops = [...nativePluginSource.matchAll(new RegExp(
      "for \\(std::size_t index = 0; index < island_chatter::ae::(\\w+); \\+\\+index\\) \\{" +
      `[\\s\\S]{0,400}?PF_ADD_SLIDER\\("${which}"`,
      "g"))];
    if (melodyLoops.length !== 1) {
      throw new Error(`Expected one ${which} registration loop, found ${melodyLoops.length}`);
    }
    if (melodyLoops[0][1] !== "kMelodySlots") {
      throw new Error(
        `The ${which} loop is bounded by ${melodyLoops[0][1]}; it registers kMelodySlots`);
    }
  }
}

// The melody transport size is written down in three places and all three have
// to agree, or the plug-in reads notes the panel never wrote.
{
  const dspHeader = fs.readFileSync(
    path.join(root, "native", "include", "island_chatter", "dsp.hpp"), "utf8");
  if (!/kMelodySlots = 64;/.test(paramsHeader) ||
      !/kMelodySlots = 64;/.test(dspHeader) ||
      !/var MELODY_SLOTS = 64;/.test(nativePanelSource)) {
    throw new Error("The melody transport size is not synchronized");
  }
  // pitch * 512 + ticks is what makes a note fit one 0-65535 slider. If the
  // stride and the tick ceiling ever disagree, notes silently collide.
  if (!/kMelodySlotStride = 512;/.test(dspHeader) ||
      !/kMelodyCoarseStride = 4;/.test(dspHeader) ||
      !/var MELODY_SLOT_STRIDE = 512;/.test(nativePanelSource)) {
    throw new Error("The melody slot encoding is not synchronized");
  }
  // The tick unit is written down in both places and decides what a stored
  // melody means; a mismatch would play every note at the wrong length.
  if (!/kMelodyTicksPerBeat = 96;/.test(dspHeader) ||
      !/var MELODY_TICKS_PER_BEAT = 96;/.test(nativePanelSource)) {
    throw new Error("The melody tick unit is not synchronized");
  }
}

// Reading or writing a melody slot must go through the one helper that knows
// where the block starts, for the same reason text units do.
if (/PARAM_MELODY_FIRST \+ index\)/.test(
  nativePanelSource.replace(/function melodySlotProperty[\s\S]*?\n    \}/, ""))) {
  throw new Error("The panel indexes melody slots without going through melodySlotProperty()");
}

// The panel must not parse MIDI itself, for the same reason it must not plan
// its own timings: ExtendScript is ES3, a binary parser written there cannot be
// tested, and two implementations of the same format drift apart. The engine
// reads the file and the panel reads the engine's answer.
for (const symbol of ["MThd", "MTrk", "0x2F", "runningStatus", "variableLength",
  "ticksPerQuarter", "readVlq"]) {
  if (nativePanelSource.includes(symbol)) {
    throw new Error(`The panel appears to parse MIDI itself (${symbol}); ask the engine instead`);
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
    "parseEnginePlan", "styleSpeedMultiplier", "effectiveSpeed", "speedForTempo",
    "utf8FromHex", "parseTrackList", "parseSong"].map(takeFunction),
].join("\n"), planner);

// --- Reading what the engine says about a MIDI file -------------------------
//
// The panel never opens the file itself, so these two parsers are the whole of
// its MIDI knowledge. Both check the END count on the way in, because
// callSystem() reports no exit status: a tool that died halfway would otherwise
// read as a file with fewer tracks, or a song with fewer lines, and the import
// would quietly build half a scene.
{
  const tracks = vm.runInContext(`parseTrackList(${JSON.stringify(
    "TRACKS 1\nBPM 96\nT 0 0 -\nT 1 14 4d656c6f6479\nEND 2\n")})`, planner);
  if (tracks.tracks.length !== 2 || tracks.bpm !== 96) {
    throw new Error("parseTrackList() did not read the track list");
  }
  if (tracks.tracks[1].name !== "Melody" || tracks.tracks[1].notes !== 14) {
    throw new Error("parseTrackList() did not decode a track name");
  }
  if (tracks.tracks[0].name !== "") {
    throw new Error("parseTrackList() invented a name for an unnamed track");
  }
  // A track name has no declared encoding in the format. Anything that is not
  // UTF-8 has to come back empty so the caller can number the track instead of
  // showing mojibake.
  if (vm.runInContext(`utf8FromHex("8081")`, planner) !== "" ||
      vm.runInContext(`utf8FromHex("e6bc")`, planner) !== "") {
    throw new Error("utf8FromHex() should decline bytes that are not UTF-8");
  }
  if (vm.runInContext(`utf8FromHex("e6bca2")`, planner) !== "漢") {
    throw new Error("utf8FromHex() did not decode a three-byte character");
  }
  let refused = false;
  try {
    vm.runInContext(`parseTrackList(${JSON.stringify("TRACKS 1\nT 0 4 -\nEND 9\n")})`, planner);
  } catch (error) { refused = true; }
  if (!refused) throw new Error("parseTrackList() accepted a truncated reply");

  const song = vm.runInContext(`parseSong(${JSON.stringify(
    "SONG 1\nBPM 96\nEXTRA 1 2 3 4\n" +
    "L 0 0 96 7 7 0\nX 0 19968 38275\nN 0 30742 2 30742\n" +
    "L 1 5 96 7 7 1\nX 1 28415\nN 1 33302\nEND 2\n")})`, planner);
  if (song.lines.length !== 2 || song.bpm !== 96) {
    throw new Error("parseSong() did not read the song");
  }
  if (song.extraNotes !== 1 || song.extraSyllables !== 2 || song.dropped !== 3 ||
      song.split !== 4) {
    throw new Error("parseSong() dropped the counts the panel reports to the user");
  }
  if (song.lines[0].text !== "一閃" || song.lines[0].melody.length !== 3) {
    throw new Error("parseSong() did not read a line's text and melody");
  }
  if (song.lines[1].start !== 5 || song.lines[1].continued !== true) {
    throw new Error("parseSong() did not read where a line starts or that it continues");
  }
  refused = false;
  try {
    vm.runInContext(`parseSong(${JSON.stringify(
      "SONG 1\nBPM 96\nEXTRA 0 0 0 0\nL 0 0 96 1 1 0\nX 0 19968\nN 0 30742\nEND 4\n")})`, planner);
  } catch (error) { refused = true; }
  if (!refused) throw new Error("parseSong() accepted a truncated reply");
  // An EXTRA line from before the split count existed still reads, with the
  // count it does not carry defaulting to zero rather than to NaN.
  const older = vm.runInContext(`parseSong(${JSON.stringify(
    "SONG 1\nBPM 96\nEXTRA 0 0 0\nL 0 0 96 1 1 0\nX 0 19968\nN 0 30742\nEND 1\n")})`, planner);
  if (older.split !== 0) {
    throw new Error("parseSong() should read a shorter EXTRA line as no splits");
  }
}

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
/*
 * The animation rig.
 *
 * mergeRigTimeline() decides every number a rig carries, for one line and for
 * twenty, and nothing downstream of it knows anything except how to write a
 * hold key. So it is the whole mechanism, and it is checked here rather than in
 * After Effects: the host suite can only see that keys exist, which is the kind
 * of guard this project has been caught by three times.
 *
 * The numbers below are written out rather than recomputed, because a test that
 * derives them the same way the code does agrees with any bug the code has.
 */
vm.runInContext([
  takeVariable("MOUTH_CLOSE_FRAMES"),
  takeVariable("SUNG_BOUNCE_SECONDS"),
  takeFunction("tonePitch"),
  takeFunction("mergeRigTimeline"),
].join("\n"), planner);

const rigLine = (name, start, count, step) => {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    events.push({
      mouth: (index % 5) + 1,
      tone: (index % 4) + 1,
      time: index * step,
      duration: step,
    });
  }
  return { name, start, order: 0, plan: { events, duration: count * step } };
};
const mergeRig = (lines, baseline) =>
  vm.runInContext(`mergeRigTimeline(${JSON.stringify(lines)}, ${baseline})`, planner);
// Floating point: 0.2 * 3 is not 0.6000000000000001 for the purposes of a
// keyframe time, and neither the host nor a reader cares about the difference.
const keyTimes = (track) => [...track].map((key) => Number(Number(key.time).toFixed(6)));
const keyValues = (track) => [...track].map((key) => Number(key.value));
const sameNumbers = (got, want) =>
  got.length === want.length && got.every((value, at) => Math.abs(value - want[at]) < 1e-6);
const pinTrack = (label, track, wantTimes, wantValues) => {
  if (!sameNumbers(keyTimes(track), wantTimes)) {
    throw new Error(
      `rig ${label} keys land at [${keyTimes(track)}], expected [${wantTimes}]`);
  }
  if (!sameNumbers(keyValues(track), wantValues)) {
    throw new Error(
      `rig ${label} holds [${keyValues(track)}], expected [${wantValues}]`);
  }
};

// One line, which is what every project built before the shared rig has. This
// pins the per-layer rig exactly as 1.3.0 wrote it: reopening an old project
// and pressing Apply must not move a single key.
{
  const one = mergeRig([rigLine("A", 0, 3, 0.2)], 0);
  if (one.overlaps.length) throw new Error("a single line cannot overlap anything");
  // Mouth shapes 1, 2, 3 held for 82% of each syllable, closed in between.
  pinTrack("mouth", one.tracks.mouth,
    [0, 0, 0.164, 0.2, 0.364, 0.4, 0.564], [0, 1, 0, 2, 0, 3, 0]);
  // Tones 1, 2, 3 through tonePitch(); 100 is the resting pitch.
  pinTrack("pitch", one.tracks.pitch,
    [0, 0, 0.164, 0.2, 0.364, 0.4, 0.564], [100, 110, 100, 92, 100, 78, 100]);
  pinTrack("volume", one.tracks.volume,
    [0, 0, 0.164, 0.2, 0.364, 0.4, 0.564], [0, 82, 0, 82, 0, 82, 0]);
  // The head is thrown the other way on each syllable and settles at 38%.
  pinTrack("bounce", one.tracks.bounce,
    [0, 0, 0.076, 0.2, 0.276, 0.4, 0.476], [0, 55, 0, -55, 0, 55, 0]);
  // Three syllables is too few to blink: the first blink is on the fifth.
  pinTrack("blink", one.tracks.blink, [0], [0]);
  // Only a shared rig writes these, but they are decided in the same place.
  pinTrack("speaking", one.tracks.speaking, [0, 0, 0.6], [0, 100, 0]);
  pinTrack("line", one.tracks.lineIndex, [0, 0, 0.6], [0, 1, 0]);
}

// A per-layer rig on a layer that does not start at zero rests at its own in
// point, not at the start of the composition.
{
  const late = mergeRig([rigLine("A", 3, 2, 0.2)], 3);
  for (const name of ["mouth", "volume", "pitch", "bounce", "blink", "speaking", "lineIndex"]) {
    if (Math.abs(late.tracks[name][0].time - 3) > 1e-9) {
      throw new Error(`rig ${name} rests at ${late.tracks[name][0].time}s, expected the line's 3s`);
    }
  }
}

// Two lines, and the reason the counter is not per line. Restarting it at every
// line throws the head the same way at the start of each one and puts a blink on
// the fifth syllable of every line, which reads as a tic rather than a face.
{
  const two = mergeRig([rigLine("A", 0, 5, 0.2), rigLine("B", 2, 6, 0.2)], 0);
  if (two.overlaps.length) throw new Error("lines a second apart do not overlap");
  // Syllables 0-4 are A, 5-10 are B, so the blinks are B's first and last but
  // one. Counted per line they would be at 3.0 alone.
  pinTrack("blink", two.tracks.blink, [0, 2, 2.065, 3, 3.065], [0, 100, 0, 100, 0]);
  // B's first syllable is the sixth overall, so the head goes the other way.
  // Counted per line it would be the first, and go the same way A started.
  const firstOfB = [...two.tracks.bounce].filter((key) => Math.abs(key.time - 2) < 1e-9);
  if (firstOfB.length !== 1 || firstOfB[0].value !== -55) {
    throw new Error(
      `the sixth syllable overall bounces ${firstOfB.map((key) => key.value)}, expected -55`);
  }
  pinTrack("line", two.tracks.lineIndex, [0, 0, 1, 2, 3.2], [0, 1, 0, 2, 0]);
}

// Lines arrive in whatever order the composition holds them, which is not
// timeline order. IC Line has to count along the timeline.
{
  const swapped = mergeRig([rigLine("B", 2, 2, 0.2), rigLine("A", 0, 2, 0.2)], 0);
  pinTrack("line", swapped.tracks.lineIndex, [0, 0, 0.4, 2, 2.4], [0, 1, 0, 2, 0]);
}

// Overlap. The later line wins from the moment it starts; the earlier one is cut
// there rather than left to close the mouth halfway through the later one.
{
  const clash = mergeRig([rigLine("A", 0, 5, 0.2), rigLine("B", 0.5, 3, 0.2)], 0);
  if (clash.overlaps.join(",") !== "A,B") {
    throw new Error(`overlapping lines reported as [${clash.overlaps}], expected A and B`);
  }
  // A's syllables at 0.6 and 0.8 are masked, and the one at 0.4 closes at the
  // cut instead of 0.564. Without the cut the mouth would shut at 0.764, in the
  // middle of B's first word.
  pinTrack("mouth", clash.tracks.mouth,
    [0, 0, 0.164, 0.2, 0.364, 0.4, 0.5, 0.5, 0.664, 0.7, 0.864, 0.9, 1.064],
    [0, 1, 0, 2, 0, 3, 0, 1, 0, 2, 0, 3, 0]);
  // Exactly one hand-off, at the cut.
  pinTrack("speaking", clash.tracks.speaking, [0, 0, 0.5, 0.5, 1.1], [0, 100, 0, 100, 0]);
  // Masked syllables are not spoken by the face, so they do not advance the
  // count: B opens on the fourth.
  const firstOfB = [...clash.tracks.bounce].filter((key) => Math.abs(key.time - 0.5) < 1e-9);
  if (firstOfB.length !== 1 || firstOfB[0].value !== -55) {
    throw new Error(
      `after masking, B's first syllable bounces ${firstOfB.map((key) => key.value)}, expected -55`);
  }
}

/*
 * A sung line is legato, and its mouth must not flicker.
 *
 * Speaking, the closed span runs from 82% of a syllable to the start of the
 * next, which in dialogue includes the gap and any rest — long enough to read.
 * Sung notes butt straight together, so the same rule leaves only the 18% bite:
 * on a real song line that was 36 closes in 5.4 seconds, 24 of them shorter
 * than a frame at 30 fps. Hold keys are sampled per frame, so which ones landed
 * was arbitrary and the mouth twitched rather than closed.
 */
{
  const sungLine = (start, count, step, gapAfter) => {
    const events = [];
    for (let index = 0; index < count; index += 1) {
      events.push({
        mouth: (index % 5) + 1,
        tone: 5,
        time: index * (step + (gapAfter || 0)),
        duration: step,
      });
    }
    const span = count * (step + (gapAfter || 0));
    return { name: "S", start, order: 0, sung: true, plan: { events, duration: span } };
  };
  const frame = 1 / 30;
  const mergeSung = (lines, baseline) =>
    vm.runInContext(
      `mergeRigTimeline(${JSON.stringify(lines)}, ${baseline}, ${frame})`, planner);

  // Six notes back to back. The mouth changes shape five times and shuts once,
  // at the end of the line.
  const legato = mergeSung([sungLine(0, 6, 0.155, 0)], 0);
  const shuts = [...legato.tracks.mouth].filter((key) => key.value === 0);
  // One at the baseline, one at the end of the line, and nothing in between.
  if (shuts.length !== 2) {
    throw new Error(
      `a legato sung line shuts the mouth ${shuts.length} times, expected 2 ` +
      `(the rest position and the end of the line)`);
  }
  if (Math.abs(shuts[1].time - 6 * 0.155) > 1e-6) {
    throw new Error(`the sung line should shut at its end, not at ${shuts[1].time}`);
  }
  // And no closed span may be shorter than the threshold, which is the whole
  // point: a close nobody can see is a close that flickers.
  const closedSpans = (track, until) => {
    const keys = [...track].sort((a, b) => a.time - b.time);
    const spans = [];
    for (let at = 0; at < keys.length; at += 1) {
      if (keys[at].value !== 0) continue;
      const ends = at + 1 < keys.length ? keys[at + 1].time : until;
      if (ends > keys[at].time) spans.push(ends - keys[at].time);
    }
    return spans;
  };
  for (const span of closedSpans(legato.tracks.mouth, 6 * 0.155)) {
    if (span < 2 * frame - 1e-9) {
      throw new Error(`a sung line left a ${(span * 1000).toFixed(0)} ms close, under two frames`);
    }
  }

  // A real silence between notes still closes the mouth: holding it open
  // through a rest is the opposite mistake.
  const breathing = mergeSung([sungLine(0, 4, 0.3, 0.4)], 0);
  const breathShuts = [...breathing.tracks.mouth].filter((key) => key.value === 0);
  if (breathShuts.length !== 5) {
    throw new Error(
      `a sung line with rests shuts ${breathShuts.length} times, expected 5`);
  }

  // A held note does not lean slowly to one side for most of its length.
  const held = mergeSung([sungLine(0, 1, 2.0, 0)], 0);
  const bounceBack = [...held.tracks.bounce].filter((key) => key.value === 0 && key.time > 0);
  if (!bounceBack.length ||
      Math.abs(bounceBack[0].time - vm.runInContext("SUNG_BOUNCE_SECONDS", planner)) > 1e-6) {
    throw new Error(
      `a two-second note bounces for ${bounceBack.length ? bounceBack[0].time : "?"}s, ` +
      "expected the sung cap");
  }
  // The same note spoken keeps the old proportional bounce, untouched.
  const spokenHeld = mergeRig([rigLine("A", 0, 1, 2.0)], 0);
  const spokenBack = [...spokenHeld.tracks.bounce].filter((key) => key.value === 0 && key.time > 0);
  if (!spokenBack.length || Math.abs(spokenBack[0].time - 0.76) > 1e-6) {
    throw new Error("the spoken bounce moved; only the sung path was meant to change");
  }
}

// A rig with no lines left — every one of them removed — must still rest, not
// keep the keys of layers that are gone.
{
  const empty = mergeRig([], 0);
  pinTrack("mouth", empty.tracks.mouth, [0], [0]);
  pinTrack("pitch", empty.tracks.pitch, [0], [100]);
}

/*
 * Cutting an imported line down to what the transport carries.
 *
 * Apply on a layer the user typed truncates and says so. An imported script has
 * no typist to tell, so a long line becomes several layers instead of losing its
 * second half — which only helps if the cut lands somewhere that survives it.
 */
vm.runInContext([
  takeVariable("TEXT_UNITS_PER_BLOCK"),
  takeVariable("MAX_TEXT_UNITS"),
  takeVariable("BREAK_AFTER"),
  takeFunction("splitForTransport"),
].join("\n"), planner);
const splitScript = (text) =>
  [...vm.runInContext(`splitForTransport(${JSON.stringify(text)})`, planner)];
const LIMIT = vm.runInContext("MAX_TEXT_UNITS", planner);
{
  // Short enough is left entirely alone.
  if (splitScript("你好，歡迎來到小島！").join("|") !== "你好，歡迎來到小島！") {
    throw new Error("splitForTransport() cut a line that already fits");
  }
  if (splitScript("").length !== 0) {
    throw new Error("splitForTransport() invented a chunk out of nothing");
  }
  // Exactly at the limit is still one layer; one over is two.
  if (splitScript("島".repeat(LIMIT)).length !== 1) {
    throw new Error(`a line of exactly ${LIMIT} units must stay one layer`);
  }
  if (splitScript("島".repeat(LIMIT + 1)).length !== 2) {
    throw new Error(`a line of ${LIMIT + 1} units must become two layers`);
  }
  // The cut goes to the last rest before the limit, not to the limit itself.
  {
    const rested = `${"島".repeat(40)}。${"民".repeat(LIMIT)}`;
    const chunks = splitScript(rested);
    if (chunks[0] !== `${"島".repeat(40)}。`) {
      throw new Error(
        `splitForTransport() cut at ${chunks[0].length} units instead of the punctuation at 41`);
    }
  }
  // A pronunciation override is one token. Cutting through it breaks both
  // halves: "[重" is spoken literally and "chong2]" is nonsense.
  {
    const marked = `${"島".repeat(LIMIT - 3)}[重|chong2]新開始`;
    for (const chunk of splitScript(marked)) {
      const opens = (chunk.match(/\[/g) || []).length;
      const closes = (chunk.match(/\]/g) || []).length;
      if (opens !== closes) {
        throw new Error(`splitForTransport() cut through an override: "${chunk}"`);
      }
    }
  }
  // A surrogate pair is one character. Half of one is not a character at all.
  //
  // The odd-length prefix is the whole point of this case. Astral characters
  // alone put every pair on an even boundary, so the limit lands between two
  // whole characters and a splitter that knows nothing about surrogates looks
  // correct. One BMP character in front shifts them, and the limit falls
  // between the two halves of the sixty-fourth pair.
  {
    const outside = "\u{2000B}";
    for (const sample of [outside.repeat(LIMIT), `A${outside.repeat(LIMIT)}`,
      `${"島".repeat(3)}${outside.repeat(LIMIT)}`]) {
      for (const chunk of splitScript(sample)) {
        if (/[\uD800-\uDBFF]$/.test(chunk) || /^[\uDC00-\uDFFF]/.test(chunk)) {
          throw new Error(
            `splitForTransport() stranded half a surrogate pair in a ${sample.length}-unit line`);
        }
      }
    }
  }
  // Nothing may be lost, and nothing may exceed the transport. Whitespace at a
  // break is deliberately dropped, so compare with it removed.
  for (const sample of [
    "島".repeat(LIMIT * 3 + 7),
    `${"Hello world ".repeat(40)}done`,
    `${"島民，".repeat(60)}。`,
    `[今日|きょう]はいい[天気|てんき]${"です".repeat(90)}`,
    "\u{2000B}".repeat(LIMIT + 3),
    // Pathological: one override longer than the entire transport. It cannot
    // be kept whole, but it must still terminate.
    `[${"重".repeat(LIMIT * 2)}|chong2]`,
  ]) {
    const chunks = splitScript(sample);
    for (const chunk of chunks) {
      if (chunk.length > LIMIT) {
        throw new Error(`splitForTransport() left a ${chunk.length}-unit chunk, limit is ${LIMIT}`);
      }
      if (!chunk.length) throw new Error("splitForTransport() produced an empty layer");
    }
    const strip = (value) => value.replace(/\s+/g, "");
    if (strip(chunks.join("")) !== strip(sample)) {
      throw new Error(`splitForTransport() lost or duplicated text in "${sample.slice(0, 24)}..."`);
    }
  }
}

/*
 * Laying lines out on the beat.
 *
 * The gap is stated in beats and is a minimum, not a distance: the next line
 * starts on a beat. Converting beats to seconds and adding them would put
 * nothing on the grid, because a line is only a whole number of beats long when
 * Tempo Lock is on — and that is exactly the case where the two agree, so a test
 * that only checks tempo-locked lengths cannot tell them apart.
 */
vm.runInContext([
  takeFunction("beatDuration"),
  takeFunction("gridStep"),
  takeFunction("snapForward"),
  takeFunction("nextLineStart"),
  takeFunction("splitSpeaker"),
  takeVariable("SPEAKER_NAME_LIMIT"),
].join("\n"), planner);
const nextStart = (previousEnd, gapBeats, bpm) =>
  vm.runInContext(`nextLineStart(${previousEnd}, ${gapBeats}, ${bpm})`, planner);
const stepFor = (gapBeats, bpm) =>
  vm.runInContext(`gridStep(${gapBeats}, ${bpm})`, planner);
{
  const beat = 0.5; // 120 BPM
  // A line that ends on the grid: one beat of gap is exactly one beat.
  if (Math.abs(nextStart(2 * beat, 1, 120) - 3 * beat) > 1e-9) {
    throw new Error(`a line ending on a beat should resume one beat later, got ${nextStart(1, 1, 120)}`);
  }
  // A line that ends off the grid — which is every line without Tempo Lock.
  // Adding the gap gives 2.85s; the next beat after that is 3.0s.
  if (Math.abs(nextStart(2.35, 1, 120) - 3.0) > 1e-9) {
    throw new Error(
      `an off-grid line should resume on the next beat (3.0s), got ${nextStart(2.35, 1, 120)}`);
  }

  /*
   * The gap is a note value, and the grid has to be as fine as it asks for.
   *
   * Snapping every line to a whole beat regardless makes a fractional gap
   * indistinguishable from a whole one: at 120 BPM a line ending at 0.3s lands
   * at 1.0s under 0.5 and under 1 alike, which is what "decimals do nothing"
   * looked like from the outside. These three numbers are the difference.
   */
  for (const [gapBeats, expected, note] of [
    [0.25, 0.5, "semiquaver"],
    [0.5, 0.75, "quaver"],
    [1, 1.0, "crotchet"],
    [2, 1.5, "minim gap, crotchet grid"],
  ]) {
    const got = nextStart(0.3, gapBeats, 120);
    if (Math.abs(got - expected) > 1e-9) {
      throw new Error(
        `a ${note} gap after a line ending at 0.3s should resume at ${expected}s, got ${got}s`);
    }
  }
  // A gap of a beat or more still lands on ordinary beats: "leave two beats"
  // means any beat two beats away, not only every second beat.
  if (Math.abs(stepFor(2, 120) - beat) > 1e-9 || Math.abs(stepFor(4, 120) - beat) > 1e-9) {
    throw new Error("a gap of a beat or more must still use the plain beat grid");
  }
  // Zero asks for no grid at all: the lines run straight on.
  if (Math.abs(nextStart(2.35, 0, 120) - 2.35) > 1e-9) {
    throw new Error(`a zero gap should run straight on, got ${nextStart(2.35, 0, 120)}`);
  }

  // Every result is on the grid the gap asked for, at any tempo, however
  // awkward the line's length. This is the property the whole feature is for.
  for (const bpm of [60, 90, 120, 137, 174]) {
    for (const gapBeats of [0.25, 0.5, 1, 1.5, 2, 4]) {
      const step = stepFor(gapBeats, bpm);
      for (const end of [0, 0.001, 1.37, 2.5, 9.87654]) {
        const start = nextStart(end, gapBeats, bpm);
        const steps = start / step;
        if (Math.abs(steps - Math.round(steps)) > 1e-6) {
          throw new Error(
            `${end}s + ${gapBeats} beats at ${bpm} BPM lands at ${steps} steps, off the grid`);
        }
        if (start < end - 1e-9) {
          throw new Error(`a line was placed before the one it follows (${start} < ${end})`);
        }
        // Snapping a time already on the grid must not move it. This is what
        // makes Re-flow idempotent: its first line is snapped every time it
        // runs, and without the tolerance floating-point dust would push the
        // whole scene one step later on each press.
        const again = vm.runInContext(`snapForward(${start}, ${step})`, planner);
        if (Math.abs(again - start) > 1e-9) {
          throw new Error(
            `snapping ${start}s at ${bpm} BPM again moved it to ${again}s; Re-flow would creep`);
        }
      }
    }
  }
  // Straight through the arithmetic the layout actually does, for a long scene.
  // A whole number of steps reached by adding steps is where the dust collects.
  for (const bpm of [60, 90, 110, 120, 137, 174, 200]) {
    for (const gapBeats of [0.5, 1]) {
      const step = stepFor(gapBeats, bpm);
      let at = 0;
      for (let line = 0; line < 200; line += 1) {
        at = nextStart(at, gapBeats, bpm);
        const again = vm.runInContext(`snapForward(${at}, ${step})`, planner);
        if (Math.abs(again - at) > 1e-9) {
          throw new Error(
            `at ${bpm} BPM, line ${line} sits at ${at}s but snapping again gives ${again}s`);
        }
      }
    }
  }
}

/*
 * The interface translator keeps one side of anything containing " / ", which
 * is fine for a label written as "English / 中文" and wrong for a value that
 * happens to have a slash in it. "1 / beat" through "4 / beat" all collapsed to
 * the single word "beat", so the tempo subdivision menu showed four identical
 * entries in Chinese and four bare numbers in English. Nothing noticed for four
 * releases, because the control still worked.
 */
{
  const tableAt = nativePanelSource.indexOf("var IC_JAPANESE_UI = {");
  const menuLocaliser = { String };
  vm.createContext(menuLocaliser);
  vm.runInContext([
    takeVariable("UI_LANGUAGE"),
    nativePanelSource.slice(tableAt, nativePanelSource.indexOf("\n    };", tableAt) + 7),
    takeFunction("T"),
  ].join("\n"), menuLocaliser);
  const menus = [...nativePanelSource.matchAll(
    /add\("dropdownlist", undefined,\s*(\[[^\]]*\])/g)];
  if (menus.length < 6) {
    throw new Error(`Found ${menus.length} dropdown menus in the panel; expected at least 6`);
  }
  for (const menu of menus) {
    const items = [...menu[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    if (!items.length) continue;
    for (const language of ["zh", "en", "ja"]) {
      menuLocaliser.UI_LANGUAGE = language;
      const shown = items.map((item) =>
        vm.runInContext(`T(${JSON.stringify(item)})`, menuLocaliser));
      const seen = new Set();
      for (let at = 0; at < shown.length; at += 1) {
        if (seen.has(shown[at])) {
          throw new Error(
            `In ${language} the menu [${items.join(", ")}] shows "${shown[at]}" more than once; ` +
            "a value with a slash in it is being read as an \"English / 中文\" label");
        }
        seen.add(shown[at]);
        if (!shown[at].length) {
          throw new Error(`In ${language} the menu item "${items[at]}" localises to nothing`);
        }
      }
    }
  }
}

/*
 * A speaker's name in front of a line.
 */
{
  const speaker = (line) =>
    vm.runInContext(`splitSpeaker(${JSON.stringify(line)})`, planner);
  for (const [line, name, said] of [
    ["咪咪：你好嗎", "咪咪", "你好嗎"],
    ["咪咪: 你好嗎", "咪咪", "你好嗎"],
    ["Mimi: hello there", "Mimi", "hello there"],
    // No colon at all.
    ["你好嗎", "", "你好嗎"],
    // A colon with nothing after it is a line that ends in one.
    ["結論：", "", "結論："],
    // Too far in to be a name.
    [`${"島".repeat(30)}：真的`, "", `${"島".repeat(30)}：真的`],
    // Override syntax in the name means it was never a name.
    ["[重|chong2]新：開始", "", "[重|chong2]新：開始"],
  ]) {
    const got = speaker(line);
    if (got.speaker !== name || got.text !== said) {
      throw new Error(
        `splitSpeaker("${line}") read speaker "${got.speaker}" text "${got.text}", ` +
        `expected "${name}" / "${said}"`);
    }
  }
  // The ambiguity this is gated behind a checkbox for. It parses — which is
  // precisely why it must never run unless the user says the script has
  // speakers in it, or "注意" becomes a character and leaves the line.
  if (speaker("注意：這裡很危險").speaker !== "注意") {
    throw new Error("splitSpeaker() is expected to be ambiguous; the checkbox is the guard");
  }
}

/*
 * How the rig is wired, which no unit test can see.
 */
{
  const panelRig = nativePanelSource;
  // The pointer from a line to its rig is a Layer Control, not a name. Names are
  // the user's to change and layers are theirs to reorder; a Layer Control
  // survives both, and reads as "None" when the rig is deleted, which is the
  // only way to notice an orphan.
  if (!/addProperty\("ADBE Layer Control"\)/.test(panelRig)) {
    throw new Error("The rig pointer must be a Layer Control, so renaming cannot break it");
  }
  // An orphan has to be recognised: a pointer at nothing, at a layer that has
  // been deleted, or at some other layer entirely.
  const target = takeFunction("rigTargetLayer");
  if (!/at < 1 \|\| at > comp\.numLayers/.test(target) || !/isRigLayer\(target\)/.test(target)) {
    throw new Error("rigTargetLayer() must reject a dangling or non-rig pointer");
  }
  // The face reaches the rig through that same pointer. Reaching it by layer
  // name would put the rig's name into six expressions, where renaming the
  // character silently breaks every one of them.
  const mouth = takeFunction("mouthShapeSource");
  if (/thisComp\.layer\(/.test(mouth)) {
    throw new Error("The mouth expression names a layer; renaming the rig would break the face");
  }
  if (!/catch/.test(mouth)) {
    throw new Error("The mouth expression must survive a missing rig rather than error");
  }
  // Remove has to take the pointer with it, or the line stays a member of a rig
  // it no longer speaks for.
  if (!/RIG_TRACK_NAMES\.concat\(\[RIG_TARGET_NAME, BAKE_POINTER_NAME\]\)/
    .test(takeFunction("removeFromLayer"))) {
    throw new Error("removeFromLayer() must strip the shared-rig and bake pointers as well");
  }
  // Removing effects invalidates every Property handle taken before it, so the
  // native effect must not be touched again after the rig block.
  const applying = takeFunction("applyToTextLayer");
  const rigBlock = applying.indexOf("removePerLayerRig(textLayer)");
  if (rigBlock < 0) throw new Error("applyToTextLayer() no longer switches rigs");
  if (/\beffect\b/.test(applying.slice(rigBlock))) {
    throw new Error(
      "applyToTextLayer() uses the effect handle after removing effects; AE has invalidated it");
  }
  // One rebuild per rig. Rebuilding twice in a pass would read back the keys the
  // first pass has already replaced.
  if (!/touched = uniqueLayers\(touched\)/.test(takeFunction("createOrUpdate"))) {
    throw new Error("createOrUpdate() must collapse a rig that the selection reaches twice");
  }

  // Importing a script.
  const importing = takeFunction("importScript");
  // Laying lines end to end means knowing where each one ends, and only the
  // plan knows. Honouring an unticked Fit Duration would stack every line of a
  // twenty-line script on top of the first.
  if (!/fitDuration: true/.test(importing)) {
    throw new Error("importScript() must force Fit Duration; sequencing needs each line's length");
  }
  // Grown before the layer is placed. Fit Duration clamps to the end of the
  // composition, so a line placed past it is silently squashed to nothing.
  const growAt = importing.indexOf("comp.duration = cursor + IMPORT_HEADROOM");
  const placeAt = importing.indexOf("layer.startTime = cursor");
  if (growAt < 0 || placeAt < 0 || growAt > placeAt) {
    throw new Error("importScript() must extend the composition before it places a line");
  }
  // One rebuild for the whole script, not one per line: each rebuild re-plans
  // every member, so per-line would be quadratic in engine calls.
  if ((importing.match(/rebuildSharedRig\(/g) || []).length !== 1) {
    throw new Error("importScript() must rebuild the shared rig exactly once");
  }
  // The panel forgetting everything on restart is what this replaced.
  const restoring = takeFunction("restoreState");
  for (const field of ["markers", "fitDuration", "controllers", "rigShared", "typeOn",
    "pitch", "speed", "volume", "seed", "gapBeats", "speakers"]) {
    if (!new RegExp(`"${field}"`).test(restoring)) {
      throw new Error(`restoreState() does not bring back ${field}`);
    }
  }
  // Restoring Speed writes the slider, and an unguarded write reads as the user
  // dragging it, which switches tempo mode straight back off.
  if (!/writingSpeed = true;[\s\S]{0,200}setSliderValue\(speed/.test(restoring)) {
    throw new Error("restoreState() must guard the Speed write, or tempo mode is lost on restart");
  }
  // Chained, not assigned: several of these controls already carry a handler.
  if (/\.onChange = remember/.test(panelRig)) {
    throw new Error("Saving state must chain onto existing handlers, not replace them");
  }

  /*
   * Re-sync. The entire point is that it does not touch the voice, so the one
   * thing worth pinning is where the settings it writes come from.
   */
  const resync = takeFunction("resyncLayer");
  if (!/settingsFromEffect\(effect\)/.test(resync)) {
    throw new Error("resyncLayer() must read the voice off the layer, not take one from the panel");
  }
  // Reaching the panel's settings here is the bug it exists to prevent: a
  // selection spanning two characters would be repainted into one voice.
  if (/\boptions\.(voice|pitch|speed|volume|consonant|emotion|seed|formant)\b/.test(resync) ||
      /currentSettings\(/.test(resync)) {
    throw new Error("resyncLayer() takes a voice setting from the panel; it must use the layer's own");
  }
  // Only what the layer already has is rebuilt. Honouring the panel's
  // checkboxes here would add markers to a layer that deliberately has none.
  for (const [what, guard] of [
    ["markers", "hadMarkers"], ["its own rig", "hadOwnRig"], ["Type-On", "hadTypeOn"],
  ]) {
    if (!new RegExp(`if \\(${guard}\\)`).test(resync)) {
      throw new Error(`resyncLayer() must only rebuild ${what} when the layer already had it`);
    }
  }
  if (/options\.markers|options\.controllers|options\.typeOn\b/.test(resync)) {
    throw new Error("resyncLayer() must not take what to rebuild from the panel's checkboxes");
  }
  // An edit that lengthens a line can push it past the end of the composition,
  // where After Effects clamps the out point and the line is squashed to
  // whatever room was left — which is the shape of every timing bug this
  // feature exists to remove.
  if (/Math\.min\(comp\.duration/.test(resync)) {
    throw new Error("resyncLayer() clamps the refitted line to the composition instead of growing it");
  }
  const grewAt = resync.indexOf("comp.duration = layer.inPoint + plan.duration");
  const fitAt = resync.indexOf("layer.outPoint =");
  if (grewAt < 0 || fitAt < 0 || grewAt > fitAt) {
    throw new Error("resyncLayer() must make room before it refits the line");
  }

  /*
   * Re-flow moves layers. Keyframes do not follow, and neither does baked audio.
   */
  const reflow = takeFunction("reflowLayers");
  if (!/rebuildSharedRig\(/.test(reflow)) {
    throw new Error("reflowLayers() must rebuild the rigs of the lines it moved");
  }
  if (!/audioLayer\.startTime = audioLayer\.startTime \+ shift/.test(reflow)) {
    throw new Error("reflowLayers() must move baked audio with its line, or the sound desyncs");
  }
  // startTime, not inPoint: assigning inPoint would silently untrim a line the
  // user had trimmed.
  if (!/layer\.startTime = layer\.startTime \+ shift/.test(reflow)) {
    throw new Error("reflowLayers() must shift startTime so a trimmed line keeps its trim");
  }

  /*
   * A bake that no longer matches its line.
   */
  const stale = takeFunction("markBakeStale");
  // Muting the recording is only half of it: the live effect has to come back
  // on, or the layer goes silent instead of correct.
  if (!/audioEnabled = false/.test(stale) || !/effect\.enabled = true/.test(stale)) {
    throw new Error("markBakeStale() must mute the recording and re-enable the live effect");
  }
  // Re-baking here would be the obvious move and would throw away the undo
  // history on every Apply, because releasing the imported WAV needs app.purge().
  if (/bakeToLayer\(|bakeLayer\(/.test(stale) ||
      /bakeToLayer\(|bakeLayer\(/.test(takeFunction("applyToTextLayer"))) {
    throw new Error("Apply must not re-bake; app.purge() would discard the undo history");
  }
  // Found by pointer first. The name changes whenever the line is renamed, and
  // Import names every layer after its own text.
  if (!/findNamedEffect\(layer, BAKE_POINTER_NAME\)/.test(takeFunction("bakedLayerFor"))) {
    throw new Error("bakedLayerFor() must use the Layer Control, not only the layer name");
  }
}

// Builds are sold, so the licence and the README have to point at the same
// storefront. A link that rots in one place and not the other sends buyers
// somewhere that no longer sells anything.
const readmes = ["README.md", "README.en.md", "README.ja.md"];
const purchaseUrls = new Set();
for (const doc of ["LICENSE", ...readmes]) {
  const found = fs.readFileSync(path.join(root, doc), "utf8")
    .match(/https:\/\/[a-z0-9.-]*gumroad\.com\/[^\s)"'`;,]+/gi) || [];
  if (found.length === 0) {
    throw new Error(`${doc} does not say where to buy a build`);
  }
  found.forEach((url) => purchaseUrls.add(url.replace(/[.,]$/, "")));
}
if (purchaseUrls.size !== 1) {
  throw new Error(
    `The licence and the READMEs point at different storefronts: ${[...purchaseUrls].join(", ")}`);
}
// Each translation has to link to the other two, or a reader lands on one and
// never learns the others exist. The one it is written in is not a link.
for (const doc of readmes) {
  const text = fs.readFileSync(path.join(root, doc), "utf8");
  for (const other of readmes) {
    const linked = text.includes(`(${other})`);
    if (other === doc && linked) {
      throw new Error(`${doc} links to itself in its language switcher`);
    }
    if (other !== doc && !linked) {
      throw new Error(`${doc} does not link to ${other}`);
    }
  }
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
  "EXPECTED_PARAMETERS = 279",
  '"External audio files: 0"',
]) {
  if (!aeSmokeSource.includes(smokeFragment)) {
    throw new Error(`AE direct-text smoke test is missing: ${smokeFragment}`);
  }
}
// The host suite counts the parameters too. A stale number there costs a
// three-minute host run to discover; here it costs a second.
{
  const hostRegressionSource = fs.readFileSync(
    path.join(root, "native", "tests", "ae-host-regression.jsx"), "utf8");
  if (!hostRegressionSource.includes("chatter.numProperties === 279")) {
    throw new Error("ae-host-regression.jsx no longer checks the published parameter count");
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

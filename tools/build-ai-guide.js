/*
 * Fills the generated tables in AI-GUIDE.md from the panel itself.
 *
 * The guide exists so that someone can hand the repository URL to an assistant
 * and ask it questions, and the most common question is "which control do I
 * press" — asked by someone whose panel might be in any of three languages.
 * An answer naming a control that no longer exists is worse than no answer, so
 * the tables of labels and messages are generated rather than written, and
 * tests/validate-script.js fails if the committed file is out of date.
 *
 *   node tools/build-ai-guide.js          rewrite AI-GUIDE.md in place
 *   node tools/build-ai-guide.js --check  exit 1 if it would change
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const panelPath = path.join(root, "native", "panel", "IslandChatterNativePanel.jsx");
const guidePath = path.join(root, "AI-GUIDE.md");
const source = fs.readFileSync(panelPath, "utf8");

// --- Reading the panel's own translator -------------------------------------
//
// The same trick the tests use: lift T() and its table out of the panel and run
// them, rather than reimplementing the split and getting it subtly wrong.
function takeFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`The panel has no ${name}()`);
  let depth = 0;
  for (let cursor = source.indexOf("{", start); cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  throw new Error(`${name}() is unbalanced`);
}

const tableStart = source.indexOf("var IC_JAPANESE_UI = {");
const tableEnd = source.indexOf("\n    };", tableStart) + 7;
const context = { String };
vm.createContext(context);
function takeVariable(name) {
  const start = source.indexOf(`var ${name} =`);
  if (start < 0) throw new Error(`The panel has no ${name}`);
  return source.slice(start, source.indexOf(";\n", start) + 1);
}

vm.runInContext([
  'var UI_LANGUAGE = "zh";',
  source.slice(tableStart, tableEnd),
  takeVariable("IC_SIMPLIFIED_TERMS"),
  takeVariable("IC_SIMPLIFIED_CHARS"),
  takeFunction("simplify"),
  takeFunction("T"),
  takeFunction("fill"),
  takeFunction("M"),
].join("\n"), context);

const LANGUAGES = ["en", "zh", "cn", "ja"];

function inEveryLanguage(literal) {
  return LANGUAGES.map((language) => {
    context.UI_LANGUAGE = language;
    return vm.runInContext(`T(${JSON.stringify(literal)})`, context);
  });
}

// --- What the panel says -----------------------------------------------------
//
// The source between quotes keeps its escapes, so "\n" arrives here as two
// characters and would never match a table key. JSON.parse puts it back.
function unescapeLiteral(raw) {
  try { return JSON.parse(`"${raw}"`); } catch (error) { return raw; }
}

const body = source.slice(tableEnd);
const labels = [];
const seenLabel = {};
function rememberLabel(literal) {
  if (literal.indexOf(" / ") <= 0 || seenLabel[literal]) return;
  seenLabel[literal] = true;
  labels.push(literal);
}
for (const match of body.matchAll(
  /add\("(?:button|checkbox|radiobutton|statictext)", undefined,\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
  rememberLabel(unescapeLiteral(match[1]));
}
for (const match of body.matchAll(/add\("dropdownlist", undefined,\s*(\[[^\]]*\])/g)) {
  for (const item of match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    rememberLabel(unescapeLiteral(item[1]));
  }
}
for (const match of body.matchAll(/addSlider\([^,]+,\s*"((?:[^"\\]|\\.)*)"/g)) {
  rememberLabel(unescapeLiteral(match[1]));
}

const messages = [];
const seenMessage = {};
for (const match of body.matchAll(/\bM\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
  const literal = unescapeLiteral(match[1]);
  if (seenLabel[literal] || seenMessage[literal]) continue;
  seenMessage[literal] = true;
  messages.push(literal);
}

// --- Rendering ---------------------------------------------------------------

function cell(text) {
  // A newline inside a table cell ends the row; a pipe starts a new one.
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ⏎ ");
}

function table(literals) {
  const rows = literals.map(inEveryLanguage)
    .sort((first, second) => (first[0] < second[0] ? -1 : first[0] > second[0] ? 1 : 0))
    .map((shown) => `| ${shown.map(cell).join(" | ")} |`);
  return [
    "| English | 繁體中文 | 简体中文 | 日本語 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

const blocks = {
  LABELS: table(labels),
  MESSAGES: table(messages),
  COUNTS: [
    `- Controls and menu entries with a label: **${labels.length}**`,
    `- Distinct messages the panel can print: **${messages.length}**`,
    `- Languages: **${LANGUAGES.length}** (繁體中文, 简体中文, English, 日本語), ` +
      "switched by the dropdown at the top left",
  ].join("\n"),
};

let guide = fs.readFileSync(guidePath, "utf8");
const before = guide;
for (const name of Object.keys(blocks)) {
  // Written to match an empty block too, so the markers can be committed on
  // consecutive lines and filled in by the first run.
  const pattern = new RegExp(`<!-- BEGIN ${name} -->[\\s\\S]*?<!-- END ${name} -->`);
  if (!pattern.test(guide)) throw new Error(`AI-GUIDE.md has no ${name} block`);
  guide = guide.replace(pattern,
    `<!-- BEGIN ${name} -->\n${blocks[name]}\n<!-- END ${name} -->`);
}

if (process.argv.indexOf("--check") >= 0) {
  if (guide !== before) {
    console.error(
      "AI-GUIDE.md is out of date with the panel. Run: node tools/build-ai-guide.js");
    process.exit(1);
  }
  console.log("AI-GUIDE.md is up to date.");
} else {
  fs.writeFileSync(guidePath, guide);
  console.log(`AI-GUIDE.md updated: ${labels.length} labels, ${messages.length} messages.`);
}

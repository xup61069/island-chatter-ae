#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const input = path.join(root, "generated", "mandarin_readings.hpp");
const output = path.join(root, "panel", "IslandChatterMandarinReadings.jsxinc");
const source = fs.readFileSync(input, "utf8");

const syllableBlock = source.match(/kMandarinSyllables\{\{([\s\S]*?)\}\};/);
const entryBlock = source.match(/kMandarinReadings\{\{([\s\S]*?)\}\};/);
if (!syllableBlock || !entryBlock) {
  throw new Error("Unable to parse generated Mandarin header");
}

const syllables = [...syllableBlock[1].matchAll(/"([a-z0-9]+)"/g)].map((match) => match[1]);
const entries = [...entryBlock[1].matchAll(/\{0x([0-9A-F]+)U,\s*(\d+)U\}/g)]
  .map((match) => [Number.parseInt(match[1], 16), Number.parseInt(match[2], 10)]);

const lines = [
  "/* Generated from Unicode Unihan kMandarin. Do not edit. */",
  `var IC_MANDARIN_SYLLABLES = ${JSON.stringify(syllables)};`,
  `var IC_MANDARIN_ENTRIES = ${JSON.stringify(entries.flat())};`,
  "function islandChatterMandarinReading(codepoint) {",
  "    var low = 0;",
  "    var high = IC_MANDARIN_ENTRIES.length / 2 - 1;",
  "    while (low <= high) {",
  "        var middle = Math.floor((low + high) / 2);",
  "        var value = IC_MANDARIN_ENTRIES[middle * 2];",
  "        if (value === codepoint) {",
  "            return IC_MANDARIN_SYLLABLES[IC_MANDARIN_ENTRIES[middle * 2 + 1]];",
  "        }",
  "        if (value < codepoint) { low = middle + 1; } else { high = middle - 1; }",
  "    }",
  "    return \"\";",
  "}",
  "",
];

fs.writeFileSync(output, lines.join("\n"), "utf8");
console.log(`Wrote ${entries.length} AE Mandarin readings to ${output}`);

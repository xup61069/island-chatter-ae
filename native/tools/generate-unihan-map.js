const fs = require("node:fs");
const path = require("node:path");

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  throw new Error("usage: node generate-unihan-map.js Unihan_Readings.txt output.hpp");
}

const toneForMark = new Map([
  ["\u0304", 1],
  ["\u0301", 2],
  ["\u030c", 3],
  ["\u0300", 4],
]);

function normalizeReading(reading) {
  let tone = 5;
  let result = "";
  for (const character of reading.toLowerCase().normalize("NFD")) {
    if (toneForMark.has(character)) {
      tone = toneForMark.get(character);
    } else if (character === "\u0308") {
      if (result.endsWith("u")) result = `${result.slice(0, -1)}v`;
    } else if (!/\p{M}/u.test(character) && /[a-zv]/.test(character)) {
      result += character;
    }
  }
  if (!result) return null;
  return `${result}${tone}`;
}

const readings = [];
for (const line of fs.readFileSync(inputPath, "utf8").split(/\r?\n/)) {
  const match = /^U\+([0-9A-F]+)\tkMandarin\t([^\s]+)/.exec(line);
  if (!match) continue;
  const syllable = normalizeReading(match[2]);
  if (syllable) readings.push({ codepoint: Number.parseInt(match[1], 16), syllable });
}

readings.sort((a, b) => a.codepoint - b.codepoint);
const syllables = [...new Set(readings.map(({ syllable }) => syllable))].sort();
const syllableIds = new Map(syllables.map((syllable, index) => [syllable, index]));

const lines = [
  "// Generated from Unicode 18.0.0 Unihan kMandarin data.",
  "// See THIRD_PARTY_NOTICES.md. Do not edit by hand.",
  "#pragma once",
  "",
  "#include <array>",
  "#include <cstdint>",
  "#include <string_view>",
  "",
  "namespace island_chatter::generated {",
  "",
  "struct MandarinReadingEntry {",
  "    std::uint32_t codepoint;",
  "    std::uint16_t syllable_index;",
  "};",
  "",
  `inline constexpr std::array<std::string_view, ${syllables.length}> kMandarinSyllables{{`,
  ...syllables.map((syllable) => `    "${syllable}",`),
  "}};",
  "",
  `inline constexpr std::array<MandarinReadingEntry, ${readings.length}> kMandarinReadings{{`,
  ...readings.map(({ codepoint, syllable }) =>
    `    MandarinReadingEntry{0x${codepoint.toString(16).toUpperCase()}U, ${syllableIds.get(syllable)}U},`),
  "}};",
  "",
  "}  // namespace island_chatter::generated",
  "",
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));
console.log(`Generated ${readings.length} readings and ${syllables.length} syllables.`);

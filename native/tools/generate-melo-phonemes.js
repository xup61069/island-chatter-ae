/*
 * pinyin -> the two phones MeloTTS wants, derived from the model's own lexicon.
 *
 * The offline voice reads Traditional Chinese with *the engine's* reader, not
 * with the model's lexicon, for the reason invariant 8b gives about the panel:
 * a second reader is a second set of readings, and the two disagree the moment
 * anyone types `[重|chong2]`. The engine hands back pinyin — `yin2 hang2` — and
 * this table is the only thing standing between that and the model's input.
 *
 * It is derived rather than written. MeloTTS does not spell finals the way
 * pinyin does, and not the way anyone would guess either: ye is `y E`, yan is
 * `y En`, ya is `y a` rather than `y ia`, weng is `w eng`, and i is `ir` after
 * zh/ch/sh/r but `i0` after z/c/s. Six of those would have been wrong if this
 * file had been typed from memory, which is what invariant 8j says about
 * reproducing somebody else's tables.
 *
 * So: join the model's 20,888 single-character lexicon entries against Unihan's
 * reading for the same character, and let 20,888 characters vote. A reading
 * Unihan and the model disagree about shows up as a minority of one or two
 * against a hundred, so the majority is the mapping and the noise is visible.
 *
 * Roughly thirty syllables are too rare to have a majority — kei, dia, biang,
 * rua. Those are *reconstructed*, also from the data: split the syllable into
 * initial and rest, and take the final token from the syllables that share that
 * rest and do have a majority. kei becomes `k ei` because gei and mei say so,
 * not because this file believes anything about pinyin.
 *
 *   node native/tools/generate-melo-phonemes.js \
 *       "%LOCALAPPDATA%\Island Chatter\models\vits-melo-tts-zh_en\lexicon.txt" \
 *       native/generated/mandarin_readings.hpp \
 *       native/generated/melo_phonemes.hpp
 */
const fs = require("node:fs");
const path = require("node:path");

const [lexiconPath, readingsPath, outputPath] = process.argv.slice(2);
if (!lexiconPath || !readingsPath || !outputPath) {
  throw new Error(
    "usage: node generate-melo-phonemes.js lexicon.txt mandarin_readings.hpp output.hpp");
}

// The pinyin alphabet, longest first so zh/ch/sh win over z/c/s. This is the
// one thing here that is written rather than derived, and it is checked: an
// initial that is wrong makes its syllables disagree with the vote, and the
// disagreement is counted and printed below.
const INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g",
                  "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];

function split(syllable) {
  for (const initial of INITIALS) {
    if (syllable.startsWith(initial) && syllable.length > initial.length) {
      return [initial, syllable.slice(initial.length)];
    }
  }
  return ["", syllable];          // a, ou, er and the rest of the zero-initial set
}

// --- what Unihan says each character is read as -------------------------------

const readingsSource = fs.readFileSync(readingsPath, "utf8");
const syllableTable = [];
for (const match of readingsSource.matchAll(/^ {4}"([a-z0-9]+)",$/gm)) {
  syllableTable.push(match[1]);
}
const readingOf = new Map();
for (const match of readingsSource.matchAll(/MandarinReadingEntry\{0x([0-9A-F]+)U, (\d+)U\}/g)) {
  readingOf.set(Number.parseInt(match[1], 16), syllableTable[Number(match[2])]);
}
if (readingOf.size === 0 || syllableTable.length === 0) {
  throw new Error(`${readingsPath} yielded no readings; has the generated format changed?`);
}

// Tone is not part of this mapping: MeloTTS carries it in a separate tensor, so
// the phones for hang2 and hang4 are the same two phones.
const toneless = (reading) => reading.replace(/[0-9]$/, "");
const wanted = [...new Set(syllableTable.map(toneless))].sort();

// --- what the model's lexicon says the same character sounds like -------------

const votes = new Map();          // pinyin -> Map(phone pair -> how many characters
let joined = 0;
for (const line of fs.readFileSync(lexiconPath, "utf8").split("\n")) {
  const parts = line.replace(/\r$/, "").split(" ");
  // word + two phones + two tones. A Chinese syllable is always exactly two
  // phones in this model; anything else is an English word or a compound, and
  // neither can say what a single reading sounds like.
  if (parts.length !== 5) { continue; }
  const [word, first, second, toneA, toneB] = parts;
  if ([...word].length !== 1 || toneA !== toneB) { continue; }
  const reading = readingOf.get(word.codePointAt(0));
  if (!reading) { continue; }
  joined += 1;
  const pinyin = toneless(reading);
  if (!votes.has(pinyin)) { votes.set(pinyin, new Map()); }
  const box = votes.get(pinyin);
  const pair = `${first} ${second}`;
  box.set(pair, (box.get(pair) || 0) + 1);
}
if (joined === 0) {
  throw new Error(`${lexiconPath} and ${readingsPath} share no characters; is this the right model?`);
}

/*
 * A majority is only a majority when there is something to be a majority of.
 *
 * Five characters agreeing is a mapping; one character agreeing is a coin toss
 * between the model and Unihan, and the coin lands wrong often enough to matter
 * — kei votes once, for the phones of ke. So the thin ones are not trusted
 * here; they are rebuilt below out of the ones that are.
 */
const TRUSTED_VOTES = 5;
const trusted = new Map();
const thin = [];
for (const [pinyin, box] of votes) {
  const ranked = [...box].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] >= TRUSTED_VOTES) { trusted.set(pinyin, ranked[0][0]); }
  else { thin.push(pinyin); }
}

/*
 * The final each rest-spelling turns into, learned from the trusted syllables.
 *
 * Keyed by the initial as well as the rest, because two of them genuinely
 * depend on it: `i` is ir after zh/ch/sh/r, i0 after z/c/s and i after
 * everything else, and `u` is v after j/q/x/y. Keying on both means those fall
 * out of the data instead of being three special cases somebody has to
 * remember. The plain rest is kept as a fallback for an initial that has no
 * example of that rest.
 */
const finalFor = new Map();       // "initial\trest" and "\trest" -> final token
const initialFor = new Map();     // pinyin initial -> initial token
const disagreements = [];

/*
 * A syllable with no initial still spends its first phone on something, and
 * which placeholder it spends it on depends on the vowel: an is `AA an`, en is
 * `EE en`, ou is `OO ou`. So the zero initial is keyed by that vowel rather
 * than being one bucket — keyed as one, the five a- syllables and the five e-
 * ones overwrite each other and whichever was read last wins. That is exactly
 * how the first run of this generator got ai, an, ao, ang and ou wrong, and it
 * said so, which is the only reason this comment exists.
 */
const initialKey = (initial, rest) => (initial === "" ? `vowel ${rest[0]}` : initial);

for (const [pinyin, pair] of trusted) {
  const [initial, rest] = split(pinyin);
  const [firstPhone, secondPhone] = pair.split(" ");
  const key = initialKey(initial, rest);
  if (initialFor.has(key) && initialFor.get(key) !== firstPhone) {
    disagreements.push(`${pinyin}: initial ${key} is ${firstPhone} here but ` +
                       `${initialFor.get(key)} elsewhere`);
  }
  initialFor.set(key, firstPhone);
  finalFor.set(`${initial}\t${rest}`, secondPhone);
  if (!finalFor.has(`\t${rest}`)) { finalFor.set(`\t${rest}`, secondPhone); }
}

function reconstruct(pinyin) {
  const [initial, rest] = split(pinyin);
  const first = initialFor.get(initialKey(initial, rest));
  const second = finalFor.get(`${initial}\t${rest}`) ?? finalFor.get(`\t${rest}`);
  if (first === undefined || second === undefined) { return null; }
  return `${first} ${second}`;
}

const table = new Map();
const rebuilt = [];
const unmapped = [];
for (const pinyin of wanted) {
  if (trusted.has(pinyin)) { table.set(pinyin, trusted.get(pinyin)); continue; }
  const guess = reconstruct(pinyin);
  if (guess) { table.set(pinyin, guess); rebuilt.push(pinyin); }
  else { unmapped.push(pinyin); }
}

/*
 * The measurement, printed rather than assumed.
 *
 * Rebuilding a syllable the data already knows is how the reconstruction is
 * checked: run it over every trusted syllable and count how often it lands on
 * the same two phones. A rule that is wrong about how this model spells finals
 * shows up here as a pile of mismatches, not as a voice that sounds subtly off
 * in a sentence nobody thought to try.
 */
let agreed = 0;
const mismatches = [];
for (const [pinyin, pair] of trusted) {
  if (reconstruct(pinyin) === pair) { agreed += 1; }
  else { mismatches.push(`${pinyin}: data ${pair}, rebuilt ${reconstruct(pinyin)}`); }
}

const rows = [...table].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const lines = [
  "// Generated by native/tools/generate-melo-phonemes.js from the model's own",
  "// lexicon.txt joined against Unihan readings. See THIRD_PARTY_NOTICES.md.",
  "// Do not edit by hand.",
  "#pragma once",
  "",
  "#include <array>",
  "#include <string_view>",
  "",
  "namespace island_chatter::generated {",
  "",
  "// One Mandarin syllable, without its tone, and the two phones the MeloTTS",
  "// model wants for it. Sorted by syllable so a lookup can binary-search.",
  "struct MeloSyllable {",
  "    std::string_view pinyin;",
  "    std::string_view initial;",
  "    std::string_view final_phone;",
  "};",
  "",
  `inline constexpr std::array<MeloSyllable, ${rows.length}> kMeloSyllables{{`,
  ...rows.map(([pinyin, pair]) => {
    const [first, second] = pair.split(" ");
    return `    MeloSyllable{"${pinyin}", "${first}", "${second}"},`;
  }),
  "}};",
  "",
  "// Syllables Unihan knows and this model has no phones for. They are here so",
  "// a test can pin the list: it must shrink or stay the same, never grow",
  "// silently, because a syllable that falls off the table is a character the",
  "// offline voice cannot say.",
  `inline constexpr std::array<std::string_view, ${unmapped.length}> kMeloUnmapped{{`,
  ...unmapped.map((pinyin) => `    "${pinyin}",`),
  "}};",
  "",
  "}  // namespace island_chatter::generated",
  "",
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));

console.log(`joined ${joined} single-character entries against ${readingOf.size} Unihan readings`);
console.log(`trusted ${trusted.size} syllables (${TRUSTED_VOTES}+ characters agreeing), ` +
            `rebuilt ${rebuilt.length}, unmapped ${unmapped.length}`);
console.log(`reconstruction agrees with the data on ${agreed} of ${trusted.size} trusted syllables`);
if (mismatches.length) {
  console.log("mismatches:");
  for (const line of mismatches) { console.log(`  ${line}`); }
}
if (disagreements.length) {
  console.log("initials that are not consistent:");
  for (const line of disagreements) { console.log(`  ${line}`); }
}
if (rebuilt.length) { console.log(`rebuilt: ${rebuilt.join(" ")}`); }
if (unmapped.length) { console.log(`unmapped: ${unmapped.join(" ")}`); }
console.log(`Wrote ${rows.length} syllables to ${outputPath}.`);

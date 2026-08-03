const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs
  .readFileSync(path.join(root, "IslandChatter.jsx"), "utf8")
  .replace(/^#.*$/gm, "");
const sandbox = { module: { exports: {} } };
new vm.Script(source, { filename: "IslandChatter.jsx" }).runInNewContext(sandbox);
const core = sandbox.module.exports;

const outputPath = path.resolve(process.argv[2] || path.join(root, "preview.wav"));
const text = process.argv.slice(3).join(" ") || "Ba be bi bo bu. Sa ze mi no lu. 你好，島民！";
const chunks = [];
const mockFile = {
  encoding: null,
  open: () => true,
  write: (chunk) => chunks.push(Buffer.from(chunk, "latin1")),
  close: () => {},
};

const duration = core.writeWav(mockFile, text, {
  voice: core.voices[0],
  pitch: 1,
  speed: 0.92,
  volume: 0.78,
  consonant: 1.65,
});
fs.writeFileSync(outputPath, Buffer.concat(chunks));
console.log(`Rendered ${duration.toFixed(2)}s preview to ${outputPath}`);

const fs = require("fs");

const aiffPath = "G:/AICODE/island-chatter-ae/ae-audio-render-output.aif";
const rawPath = process.argv[2];

// --- parse the AIFF After Effects produced -------------------------------
const buf = fs.readFileSync(aiffPath);
if (buf.toString("ascii", 0, 4) !== "FORM" || buf.toString("ascii", 8, 12) !== "AIFF") {
  throw new Error("not an AIFF file");
}
let offset = 12;
let channels = 0;
let frames = 0;
let bits = 0;
let rate = 0;
let samples = null;
while (offset + 8 <= buf.length) {
  const id = buf.toString("ascii", offset, offset + 4);
  const size = buf.readUInt32BE(offset + 4);
  const body = offset + 8;
  if (id === "COMM") {
    channels = buf.readUInt16BE(body);
    frames = buf.readUInt32BE(body + 2);
    bits = buf.readUInt16BE(body + 6);
    // 80-bit IEEE extended sample rate
    const exponent = buf.readUInt16BE(body + 8);
    const mantissa = Number(buf.readBigUInt64BE(body + 10));
    rate = Math.round(mantissa * Math.pow(2, exponent - 16383 - 63));
  } else if (id === "SSND") {
    const dataStart = body + 8 + buf.readUInt32BE(body); // skip offset/blockSize
    samples = buf.subarray(dataStart, body + size);
  }
  offset = body + size + (size % 2);
}
console.log(`AE AIFF : ${channels}ch ${bits}bit ${rate}Hz ${frames} frames ` +
  `(${(frames / rate).toFixed(4)}s)`);

// --- decode to mono float ------------------------------------------------
const bytesPerSample = bits / 8;
const ae = new Float64Array(frames);
for (let i = 0; i < frames; i += 1) {
  let sum = 0;
  for (let c = 0; c < channels; c += 1) {
    const at = (i * channels + c) * bytesPerSample;
    if (at + bytesPerSample > samples.length) break;
    sum += bits === 16 ? samples.readInt16BE(at) / 32768 : samples.readInt32BE(at) / 2147483648;
  }
  ae[i] = sum / channels;
}

// --- the DSP's own render at the same settings ---------------------------
const rawBuf = fs.readFileSync(rawPath);
const dsp = new Float64Array(rawBuf.length / 4);
for (let i = 0; i < dsp.length; i += 1) dsp[i] = rawBuf.readFloatLE(i * 4);
console.log(`DSP     : 1ch float 48000Hz ${dsp.length} frames (${(dsp.length / 48000).toFixed(4)}s)`);

const stat = (a, n) => {
  let peak = 0, energy = 0;
  for (let i = 0; i < n; i += 1) { peak = Math.max(peak, Math.abs(a[i])); energy += a[i] * a[i]; }
  return { peak, rms: Math.sqrt(energy / n) };
};
const n = Math.min(ae.length, dsp.length);
const aeStat = stat(ae, n);
const dspStat = stat(dsp, n);
console.log(`AE  peak=${aeStat.peak.toFixed(4)} rms=${aeStat.rms.toFixed(5)}`);
console.log(`DSP peak=${dspStat.peak.toFixed(4)} rms=${dspStat.rms.toFixed(5)}`);

// --- alignment: best normalised cross-correlation over a small lag -------
let best = { lag: 0, score: -2 };
for (let lag = -240; lag <= 240; lag += 1) {
  let dot = 0, ea = 0, ed = 0;
  for (let i = 2000; i < n - 2000; i += 7) {
    const a = ae[i + lag] || 0;
    const d = dsp[i];
    dot += a * d; ea += a * a; ed += d * d;
  }
  const score = dot / Math.sqrt(ea * ed || 1);
  if (score > best.score) best = { lag, score };
}
console.log(`best correlation ${best.score.toFixed(4)} at lag ${best.lag} samples ` +
  `(${(best.lag / 48).toFixed(2)} ms)`);

// --- syllable count from the energy envelope -----------------------------
const countBursts = (a, len) => {
  const win = 480;
  const env = [];
  for (let i = 0; i + win < len; i += win) {
    let e = 0;
    for (let j = 0; j < win; j += 1) e += a[i + j] * a[i + j];
    env.push(Math.sqrt(e / win));
  }
  const peak = Math.max(...env);
  const gate = peak * 0.18;
  let bursts = 0, on = false;
  for (const v of env) {
    if (!on && v > gate) { bursts += 1; on = true; }
    else if (on && v < gate * 0.6) { on = false; }
  }
  return bursts;
};
console.log(`syllable bursts: AE=${countBursts(ae, n)}  DSP=${countBursts(dsp, n)} (expected 10)`);

const verdict = aeStat.peak > 0.05 && best.score > 0.9;
console.log(verdict
  ? "\nRESULT: After Effects rendered the plug-in's own audio (correlated, non-silent)"
  : "\nRESULT: MISMATCH - the rendered audio is not what the engine produces");
process.exit(verdict ? 0 : 1);

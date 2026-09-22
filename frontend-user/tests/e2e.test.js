// 端到端：读取 public/test-guqin.wav（16bit PCM），跑 FFT + 双路基频 + 音色判定
import fs from 'node:fs';
import { AudioAnalyzer } from '../src/modules/audioAnalyzer.js';
import { TimbreJudge, TIMBRE_TIERS, TIER_LABELS } from '../src/modules/timbreJudge.js';
import { Logger } from '../src/utils/logger.js';

// 测试输出保持干净
for (const m of ['info', 'warn', 'error', 'debug']) {
  Logger.prototype[m] = () => {};
}

function readWavMono(path) {
  const buf = fs.readFileSync(path);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  let offset = 12;
  // 找到 data chunk
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') { offset += 8; break; }
    offset += 8 + size;
  }
  const frameBytes = bitsPerSample / 8;
  const totalFrames = Math.floor((buf.length - offset) / (frameBytes * numChannels));
  const data = new Float32Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const p = offset + (i * numChannels + ch) * frameBytes;
      sum += buf.readInt16LE(p) / 32768;
    }
    data[i] = sum / numChannels;
  }
  return { sampleRate, data };
}

const { sampleRate, data } = readWavMono(new URL('../public/test-guqin.wav', import.meta.url));
console.log(`WAV: ${sampleRate} Hz, ${(data.length / sampleRate).toFixed(2)}s, ${data.length} samples`);

const analyzer = new AudioAnalyzer(null);
const fftSize = 8192;
// 取中间 0.8s 稳定段
const start = Math.floor(sampleRate * 1.0);
const seg = data.slice(start, start + Math.floor(sampleRate * 0.8));
const result = await analyzer.analyze(seg, sampleRate, fftSize);

console.log('\n=== 基频检测 ===');
console.log('自相关法:', result.autocorrFreq.toFixed(2), 'Hz');
console.log('峰值检测:', result.peakFreq.toFixed(2), 'Hz');
console.log('综合基频:', result.fundamentalFreq.toFixed(2), 'Hz');
console.log('RMS:', result.rms.toFixed(4));

const judge = new TimbreJudge();
const v = judge.judge({
  autocorrFreq: result.autocorrFreq,
  peakFreq: result.peakFreq,
  frequencies: result.rawFrequencies,
  magnitudes: result.rawMagnitudes,
  resolution: result.frequencyResolution,
  rms: result.rms
});

console.log('\n=== 音色判定 ===');
console.log('综合:', TIER_LABELS[v.tier]);
for (const [key, label] of [['autocorrelation', '自相关法'], ['peak', '峰值检测']]) {
  const m = v.methods[key];
  if (m.valid) {
    console.log(`${label}: ${TIER_LABELS[m.tier]} | f0=${m.f0.toFixed(2)}Hz 近${m.note.name} ${m.note.cents >= 0 ? '+' : ''}${m.note.cents.toFixed(0)}音分 | 斜率=${m.slope.toFixed(1)}dB/oct (${TIER_LABELS[m.decayTier]}) | 可测谐波 ${m.detectedCount}/6`);
  } else {
    console.log(`${label}: ${m.reason}`);
  }
}
console.log('两路基频差:', v.agreementCents !== null ? `${v.agreementCents.toFixed(0)} 音分` : '—', v.mutual ? '(互证)' : '(不一致)');
console.log('\n判定依据:');
v.reasons.forEach(r => console.log(' -', r));
if (v.insufficient) v.suggestions.forEach(s => console.log(' #', s));

console.log('\n口径说明:');
judge.describeCriteria().forEach((t, i) => console.log(` ${i + 1}. ${t}`));

// 再取一段静音/极弱段，验证"数据不足"
const silentSeg = data.slice(0, Math.floor(sampleRate * 0.05)); // 文件开头大概率是起振前弱信号
const r2 = await analyzer.analyze(silentSeg, sampleRate, 4096);
const v2 = judge.judge({
  autocorrFreq: r2.autocorrFreq, peakFreq: r2.peakFreq,
  frequencies: r2.rawFrequencies, magnitudes: r2.rawMagnitudes,
  resolution: r2.frequencyResolution, rms: r2.rms
});
console.log('\n=== 极短/弱信号段 ===');
console.log('RMS:', r2.rms.toFixed(5), '-> 判定:', TIER_LABELS[v2.tier]);
v2.reasons.forEach(r => console.log(' -', r));

if (v.tier === TIMBRE_TIERS.INSUFFICIENT) {
  console.error('\n意外：稳定段被判为数据不足');
  process.exit(1);
}
console.log('\n端到端验证通过 ✅');

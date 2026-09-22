// 判定引擎冒烟测试：合成频谱，验证三档、互证、数据不足、口径持久化
import { TimbreJudge, TIMBRE_TIERS } from '../src/modules/timbreJudge.js';

const SR = 44100;
const FFT = 8192;
const RES = SR / FFT;

// 构造一个线性频谱（freq/mag 数组），在指定频率放峰
function makeSpectrum(peaks) {
  const frequencies = [];
  const magnitudes = [];
  for (let i = 1; i < FFT / 2; i++) {
    const f = i * RES;
    if (f < 20 || f > 20000) continue;
    let mag = 0.0001;
    for (const [pf, amp] of peaks) {
      const df = (f - pf) / RES;
      mag += amp * Math.exp(-df * df / 2); // 高斯峰
    }
    frequencies.push(f);
    magnitudes.push(mag);
  }
  return { frequencies, magnitudes };
}

// 谐波幅度：以 dB/倍频程 slope 衰减
function harmonicPeaks(f0, slopeDbPerOctave, noise = false) {
  const peaks = [];
  for (let n = 1; n <= 10; n++) {
    const db = slopeDbPerOctave * Math.log2(n);
    let amp = Math.pow(10, db / 20);
    if (noise && n >= 3) amp = 0; // 3~8 谐波消失，模拟数据不足
    peaks.push([f0 * n, Math.max(amp, 0.00001)]);
  }
  return peaks;
}

let pass = 0;
let fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name); }
}

// --- 1. 理想情况：双路一致、音准准、衰减合格 -> 合格
{
  console.log('用例1：理想信号 -> 合格');
  const judge = new TimbreJudge();
  const f0 = 130.81; // C3 附近
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0, -10));
  const v = judge.judge({ autocorrFreq: f0, peakFreq: f0, frequencies, magnitudes, resolution: RES, rms: 0.1 });
  assert(v.tier === TIMBRE_TIERS.PASS, `综合判定 = ${v.tier}`);
  assert(v.mutual === true, '两路互相印证');
  assert(v.slope !== null && v.slope < -8 && v.slope > -12, `拟合斜率≈-10（实得 ${v.slope?.toFixed(1)}）`);
}

// --- 2. 音准偏 40 音分 + 双路一致 -> 不合格
{
  console.log('用例2：音准偏40音分 -> 不合格');
  const judge = new TimbreJudge();
  const f0 = 130.81 * Math.pow(2, 40 / 1200);
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0, -10));
  const v = judge.judge({ autocorrFreq: f0, peakFreq: f0, frequencies, magnitudes, resolution: RES, rms: 0.1 });
  assert(v.pitchTier === TIMBRE_TIERS.FAIL, `音准档 = ${v.pitchTier}`);
  assert(v.tier === TIMBRE_TIERS.FAIL, `综合判定 = ${v.tier}`);
}

// --- 3. 两路不一致（80音分差），单看都合格 -> 降为存疑（保守档）
{
  console.log('用例3：两路不一致 -> 合格降存疑');
  const judge = new TimbreJudge();
  const f0a = 130.81;
  const f0b = 130.81 * Math.pow(2, 80 / 1200);
  // 频谱以自相关 f0 构造，使峰值路虽偏但谐波仍可测
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0a, -10));
  const v = judge.judge({ autocorrFreq: f0a, peakFreq: f0b, frequencies, magnitudes, resolution: RES, rms: 0.1 });
  assert(v.mutual === false, '互证=false');
  assert(v.tier === TIMBRE_TIERS.DOUBT, `综合判定 = ${v.tier}（应存疑）`);
}

// --- 4. 谐波能量太弱 -> 数据不足，不判不合格
{
  console.log('用例4：谐波缺失 -> 数据不足');
  const judge = new TimbreJudge();
  const f0 = 130.81;
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0, -10, true));
  const v = judge.judge({ autocorrFreq: f0, peakFreq: f0, frequencies, magnitudes, resolution: RES, rms: 0.1 });
  assert(v.tier === TIMBRE_TIERS.INSUFFICIENT, `综合判定 = ${v.tier}`);
  assert(v.suggestions.length > 0, '给出重选区间建议');
}

// --- 5. 电平过低 -> 数据不足
{
  console.log('用例5：RMS过低 -> 数据不足');
  const judge = new TimbreJudge();
  const f0 = 130.81;
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0, -10));
  const v = judge.judge({ autocorrFreq: f0, peakFreq: f0, frequencies, magnitudes, resolution: RES, rms: 0.0001 });
  assert(v.tier === TIMBRE_TIERS.INSUFFICIENT, `综合判定 = ${v.tier}`);
}

// --- 6. 单路失效 -> 封顶存疑
{
  console.log('用例6：仅自相关一路有效 -> 存疑');
  const judge = new TimbreJudge();
  const f0 = 130.81;
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0, -10));
  const v = judge.judge({ autocorrFreq: f0, peakFreq: 0, frequencies, magnitudes, resolution: RES, rms: 0.1 });
  assert(v.tier === TIMBRE_TIERS.DOUBT, `综合判定 = ${v.tier}`);
}

// --- 7. 衰减超出范围 -> 不合格（衰减过缓，斜率 -1）
{
  console.log('用例7：衰减过缓 -> 不合格');
  const judge = new TimbreJudge();
  const f0 = 130.81;
  const { frequencies, magnitudes } = makeSpectrum(harmonicPeaks(f0, -1));
  const v = judge.judge({ autocorrFreq: f0, peakFreq: f0, frequencies, magnitudes, resolution: RES, rms: 0.1 });
  assert(v.decayTier === TIMBRE_TIERS.FAIL, `衰减档 = ${v.decayTier}`);
  assert(v.tier === TIMBRE_TIERS.FAIL, `综合判定 = ${v.tier}`);
}

// --- 8. 口径持久化（模拟 localStorage）
{
  console.log('用例8：口径保存/重载');
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }
  };
  const j1 = new TimbreJudge();
  j1.saveCriteria({ pitchPassCents: 25, minRms: 0.01 });
  const j2 = new TimbreJudge();
  assert(j2.criteria.pitchPassCents === 25, '新实例读到保存的口径');
  assert(j2.criteria.minRms === 0.01, 'minRms 已保存');
  assert(j2.criteria.pitchDoubtCents === 30, '未修改字段保留');
}

// --- 9. 口径归一化：存疑范围包住合格范围
{
  console.log('用例9：口径归一化');
  const judge = new TimbreJudge();
  judge.saveCriteria({ decayPassMin: -6, decayPassMax: -18, decayDoubtMin: -10, decayDoubtMax: -15 });
  assert(judge.criteria.decayPassMin === -18 && judge.criteria.decayPassMax === -6, '合格端点自动排序');
  assert(judge.criteria.decayDoubtMin <= -18, '存疑下限包住合格下限');
  assert(judge.criteria.decayDoubtMax >= -6, '存疑上限包住合格上限');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);

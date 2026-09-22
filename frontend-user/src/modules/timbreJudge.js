import { Logger } from '../utils/logger.js';

const logger = new Logger('TimbreJudge');

/**
 * 音色判定档位
 */
export const TIMBRE_TIERS = {
  PASS: 'pass',         // 合格
  DOUBT: 'doubt',       // 存疑
  FAIL: 'fail',         // 不合格
  INSUFFICIENT: 'insufficient' // 数据不足（不等于不合格）
};

export const TIER_LABELS = {
  pass: '合格',
  doubt: '存疑',
  fail: '不合格',
  insufficient: '数据不足'
};

/**
 * 判定口径默认值
 * - pitch*：检测基频相对最近十二平均律音的偏差（音分）
 * - decay*：第 3~8 谐波相对基频能量(dB)对谐波序号（倍频程）线性拟合的斜率
 * - minHarmonics：3~8 谐波中可测（高于噪声门槛）的最少个数
 * - agreementCents：自相关法与峰值检测基频互证的最大偏差（音分）
 * - noiseFloorDb：谐波可测门槛（低于基频能量多少 dB 视为测不到）
 * - minRms：区间整体最低电平，低于则数据不足
 */
export const DEFAULT_CRITERIA = {
  pitchPassCents: 15,
  pitchDoubtCents: 30,
  decayPassMin: -18,
  decayPassMax: -6,
  decayDoubtMin: -24,
  decayDoubtMax: -3,
  minHarmonics: 3,
  agreementCents: 50,
  noiseFloorDb: 60,
  minRms: 0.005
};

export const HARMONIC_NUMBERS = [3, 4, 5, 6, 7, 8];

const STORAGE_KEY = 'guqin_timbre_criteria';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const TIER_RANK = { pass: 0, doubt: 1, fail: 2, insufficient: 3 };

/**
 * 音色判定器
 * 按谐波说话：基频对十二平均律的偏差 + 第3~8谐波能量衰减，
 * 自相关法与峰值检测分别下结论，不一致时取更保守的一档。
 * 判定口径持久化在 localStorage，更换音频文件后原样保留。
 */
export class TimbreJudge {
  constructor() {
    this.criteria = this.loadCriteria();
  }

  /**
   * 读取持久化口径（换文件、刷新页面后仍保留上一次设置）
   */
  loadCriteria() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          return this.normalizeCriteria({ ...DEFAULT_CRITERIA, ...JSON.parse(raw) });
        }
      }
    } catch (error) {
      logger.warn('判定口径读取失败，回退默认口径', error);
    }
    return { ...DEFAULT_CRITERIA };
  }

  /**
   * 保存口径并持久化
   * @param {Object} partial - 部分口径字段
   * @returns {Object} 归一化后的完整口径
   */
  saveCriteria(partial = {}) {
    this.criteria = this.normalizeCriteria({ ...this.criteria, ...partial });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.criteria));
      }
    } catch (error) {
      logger.warn('判定口径保存失败', error);
    }
    return this.criteria;
  }

  resetCriteria() {
    this.criteria = this.normalizeCriteria({ ...DEFAULT_CRITERIA });
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.criteria));
      }
    } catch (error) {
      logger.warn('判定口径重置失败', error);
    }
    return this.criteria;
  }

  /**
   * 口径归一化：存疑范围必须包住合格范围，字段必须为有限数
   */
  normalizeCriteria(c) {
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const out = {
      pitchPassCents: num(c.pitchPassCents, DEFAULT_CRITERIA.pitchPassCents),
      pitchDoubtCents: num(c.pitchDoubtCents, DEFAULT_CRITERIA.pitchDoubtCents),
      decayPassMin: num(c.decayPassMin, DEFAULT_CRITERIA.decayPassMin),
      decayPassMax: num(c.decayPassMax, DEFAULT_CRITERIA.decayPassMax),
      decayDoubtMin: num(c.decayDoubtMin, DEFAULT_CRITERIA.decayDoubtMin),
      decayDoubtMax: num(c.decayDoubtMax, DEFAULT_CRITERIA.decayDoubtMax),
      minHarmonics: Math.round(num(c.minHarmonics, DEFAULT_CRITERIA.minHarmonics)),
      agreementCents: num(c.agreementCents, DEFAULT_CRITERIA.agreementCents),
      noiseFloorDb: num(c.noiseFloorDb, DEFAULT_CRITERIA.noiseFloorDb),
      minRms: num(c.minRms, DEFAULT_CRITERIA.minRms)
    };

    // 合格斜率区间端点顺序
    if (out.decayPassMin > out.decayPassMax) {
      [out.decayPassMin, out.decayPassMax] = [out.decayPassMax, out.decayPassMin];
    }
    // 存疑区间必须包住合格区间
    out.decayDoubtMin = Math.min(out.decayDoubtMin, out.decayPassMin);
    out.decayDoubtMax = Math.max(out.decayDoubtMax, out.decayPassMax);
    // 音准阈值
    if (out.pitchPassCents > out.pitchDoubtCents) {
      [out.pitchPassCents, out.pitchDoubtCents] = [out.pitchDoubtCents, out.pitchPassCents];
    }
    out.pitchPassCents = Math.max(1, out.pitchPassCents);
    out.pitchDoubtCents = Math.max(out.pitchPassCents, out.pitchDoubtCents);
    out.minHarmonics = Math.min(6, Math.max(1, out.minHarmonics));
    out.agreementCents = Math.max(1, out.agreementCents);
    out.noiseFloorDb = Math.max(10, out.noiseFloorDb);
    out.minRms = Math.max(0, out.minRms);
    return out;
  }

  /**
   * 两档取更保守（差）的一档
   */
  static worseTier(a, b) {
    return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
  }

  /**
   * 音准分档：基频对最近十二平均律音的绝对偏差（音分）
   */
  pitchTier(absCents) {
    const c = this.criteria;
    if (absCents <= c.pitchPassCents) return TIMBRE_TIERS.PASS;
    if (absCents <= c.pitchDoubtCents) return TIMBRE_TIERS.DOUBT;
    return TIMBRE_TIERS.FAIL;
  }

  /**
   * 衰减分档：dB/倍频程 斜率落在参考范围的哪一档
   */
  decayTier(slope) {
    const c = this.criteria;
    if (slope <= c.decayPassMax && slope >= c.decayPassMin) return TIMBRE_TIERS.PASS;
    if (slope <= c.decayDoubtMax && slope >= c.decayDoubtMin) return TIMBRE_TIERS.DOUBT;
    return TIMBRE_TIERS.FAIL;
  }

  /**
   * 找距离频率最近的十二平均律音
   * @returns {{midi:number, name:string, freq:number, cents:number, absCents:number}}
   */
  nearestNote(freq) {
    const midiFloat = 69 + 12 * Math.log2(freq / 440);
    const midi = Math.round(midiFloat);
    const noteFreq = 440 * Math.pow(2, (midi - 69) / 12);
    const cents = 1200 * Math.log2(freq / noteFreq);
    const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    return { midi, name, freq: noteFreq, cents, absCents: Math.abs(cents) };
  }

  /**
   * 从线性频谱中提取指定谐波附近的峰值能量
   * 窗口取 ±2% 与 ±1.5 个 FFT bin 的较小者，避免在高频处盖到相邻谐波；
   * 要求窗口内为局部极大值，并做抛物线插值提高频率精度。
   * @returns {{magnitude:number, freq:number}}
   */
  peakAt(target, frequencies, magnitudes, resolution) {
    // 窗半宽：±2% 与 ±1.5 bin 的较小者，再封顶为 45% 目标频率（不越过相邻谐波）
    const halfWidth = Math.min(
      Math.max(1.5 * resolution, target * 0.02),
      target * 0.45
    );
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < frequencies.length - 1; i++) {
      const dist = Math.abs(frequencies[i] - target);
      if (dist <= halfWidth
        && magnitudes[i] >= magnitudes[i - 1]
        && magnitudes[i] >= magnitudes[i + 1]
        && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) return { magnitude: 0, freq: target };

    // 抛物线插值
    const y0 = magnitudes[bestIdx - 1];
    const y1 = magnitudes[bestIdx];
    const y2 = magnitudes[bestIdx + 1];
    const denom = y0 - 2 * y1 + y2;
    const delta = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    const peakFreq = frequencies[bestIdx] + delta * resolution;
    const interpMag = denom !== 0
      ? y1 - 0.25 * (y0 - y2) * delta
      : y1;

    return { magnitude: interpMag, freq: peakFreq };
  }

  /**
   * 提取基频及第 3~8 谐波的相对能量（dB，以基频为 0 dB）
   */
  extractHarmonicLevels(f0, frequencies, magnitudes, resolution) {
    const ref = this.peakAt(f0, frequencies, magnitudes, resolution);
    const floor = Math.pow(10, -this.criteria.noiseFloorDb / 20);
    const levels = HARMONIC_NUMBERS.map((n) => {
      const target = f0 * n;
      const peak = this.peakAt(target, frequencies, magnitudes, resolution);
      const ratio = ref.magnitude > 0 ? peak.magnitude / ref.magnitude : 0;
      const levelDb = ref.magnitude > 0 && peak.magnitude > 0
        ? 20 * Math.log10(peak.magnitude / ref.magnitude)
        : -Infinity;
      return {
        n,
        targetFreq: target,
        peakFreq: peak.freq,
        magnitude: peak.magnitude,
        ratio,
        levelDb: Number.isFinite(levelDb) ? levelDb : -this.criteria.noiseFloorDb,
        detected: ratio >= floor && peak.magnitude > 0
      };
    });
    return {
      refMagnitude: ref.magnitude,
      detectedCount: levels.filter(l => l.detected).length,
      levels
    };
  }

  /**
   * 对可测谐波做线性拟合，返回斜率（dB/倍频程）
   * x = log2(谐波序号)，y = 相对基频的 dB 值
   */
  fitDecaySlope(levels) {
    const pts = levels.filter(l => l.detected).map(l => ({ x: Math.log2(l.n), y: l.levelDb }));
    if (pts.length < 2) return null;
    const meanX = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    let cov = 0;
    let varX = 0;
    for (const p of pts) {
      cov += (p.x - meanX) * (p.y - meanY);
      varX += (p.x - meanX) ** 2;
    }
    return varX > 0 ? cov / varX : null;
  }

  /**
   * 单路检测方法（自相关 / 峰值）下结论
   */
  evaluateMethod(method, f0, frequencies, magnitudes, resolution, lowLevel) {
    const base = {
      method,
      f0,
      valid: false,
      reason: '',
      note: null,
      pitchTier: TIMBRE_TIERS.INSUFFICIENT,
      levels: [],
      detectedCount: 0,
      slope: null,
      decayTier: TIMBRE_TIERS.INSUFFICIENT,
      tier: TIMBRE_TIERS.INSUFFICIENT
    };

    if (!Number.isFinite(f0) || f0 <= 0) {
      return { ...base, reason: '未检测到有效基频' };
    }
    if (lowLevel) {
      return { ...base, f0, reason: `区间电平过低（RMS 低于 ${this.criteria.minRms}）` };
    }

    const note = this.nearestNote(f0);
    const { refMagnitude, detectedCount, levels } = this.extractHarmonicLevels(
      f0, frequencies, magnitudes, resolution
    );

    if (refMagnitude <= 0) {
      return { ...base, f0, note, reason: '基频处无显著能量' };
    }
    if (detectedCount < this.criteria.minHarmonics) {
      return {
        ...base, f0, note, levels, detectedCount,
        reason: `第3~8谐波仅 ${detectedCount}/6 个可测（要求≥${this.criteria.minHarmonics}），谐波能量太弱`
      };
    }

    const slope = this.fitDecaySlope(levels);
    if (slope === null) {
      return { ...base, f0, note, levels, detectedCount, reason: '谐波衰减无法拟合' };
    }

    const pTier = this.pitchTier(note.absCents);
    const dTier = this.decayTier(slope);
    return {
      ...base,
      valid: true,
      note,
      pitchTier: pTier,
      levels,
      detectedCount,
      slope,
      decayTier: dTier,
      // 音准与衰减逐项取更保守一档，作为本方法结论
      tier: TimbreJudge.worseTier(pTier, dTier)
    };
  }

  /**
   * 综合判定
   * @param {Object} input
   * @param {number} input.autocorrFreq - 自相关法基频
   * @param {number} input.peakFreq - 峰值检测基频
   * @param {number[]} input.frequencies - 线性频谱频率
   * @param {number[]} input.magnitudes - 线性频谱幅值
   * @param {number} [input.resolution] - FFT 频率分辨率
   * @param {number} input.rms - 区间 RMS 电平
   * @returns {Object} 判定结果
   */
  judge({ autocorrFreq, peakFreq, frequencies, magnitudes, resolution, rms }) {
    const c = this.criteria;
    const res = resolution
      || (frequencies.length > 1 ? frequencies[1] - frequencies[0] : 1);
    const lowLevel = Number.isFinite(rms) && rms < c.minRms;

    const auto = this.evaluateMethod(
      'autocorrelation', autocorrFreq, frequencies, magnitudes, res, lowLevel
    );
    const peak = this.evaluateMethod(
      'peak', peakFreq, frequencies, magnitudes, res, lowLevel
    );

    const reasons = [];
    const suggestions = [];
    if (!auto.valid) reasons.push(`自相关法：${auto.reason}`);
    if (!peak.valid) reasons.push(`峰值检测：${peak.reason}`);

    let agreementCents = null;
    let mutual = false;
    if (auto.f0 > 0 && peak.f0 > 0) {
      agreementCents = Math.abs(1200 * Math.log2(auto.f0 / peak.f0));
      mutual = agreementCents <= c.agreementCents;
    }

    // 两路都数据不足 -> 不判不合格，直接说明数据不足
    const bothInsufficient = !auto.valid && !peak.valid;
    let tier;
    if (bothInsufficient) {
      tier = TIMBRE_TIERS.INSUFFICIENT;
      suggestions.push('谐波能量太弱，当前区间无法按谐波判定音色，请重选包含稳定持续音的区间（避开空白段、散音起振噪声）后再试。');
    } else {
      const validMethods = [auto, peak].filter(m => m.valid);
      // 只有一路能下结论时，无法互证，结论封顶存疑
      let combined = validMethods.reduce(
        (worst, m) => TimbreJudge.worseTier(worst, m.tier),
        TIMBRE_TIERS.PASS
      );
      if (validMethods.length === 1) {
        combined = TimbreJudge.worseTier(combined, TIMBRE_TIERS.DOUBT);
        reasons.push(`仅 ${validMethods[0] === auto ? '自相关法' : '峰值检测'} 单路数据充分，无法互相印证，结论按存疑处理`);
      } else if (!mutual) {
        // 双路基频不一致：按更保守的一档走，合格也要降到存疑
        combined = TimbreJudge.worseTier(combined, TIMBRE_TIERS.DOUBT);
        reasons.push(
          `自相关法(${auto.f0.toFixed(1)}Hz) 与峰值检测(${peak.f0.toFixed(1)}Hz) 基频相差 ${agreementCents.toFixed(0)} 音分（>${c.agreementCents}），不能互相印证，已按更保守的一档处理`
        );
      } else {
        reasons.push(
          `自相关法与峰值检测基频相差 ${agreementCents.toFixed(0)} 音分（≤${c.agreementCents}），结论互相印证`
        );
      }
      // 分项越限说明
      for (const m of validMethods) {
        const label = m.method === 'autocorrelation' ? '自相关法' : '峰值检测';
        if (m.pitchTier === TIMBRE_TIERS.FAIL) {
          reasons.push(`${label}音准偏差 ${m.note.cents.toFixed(0)} 音分，超出存疑参考范围（±${c.pitchDoubtCents} 音分）`);
        }
        if (m.decayTier === TIMBRE_TIERS.FAIL) {
          reasons.push(`${label}谐波衰减斜率 ${m.slope.toFixed(1)} dB/倍频程，超出存疑参考范围（${c.decayDoubtMin}~${c.decayDoubtMax}）`);
        }
      }
      tier = combined;
    }

    // 对比表用的保守汇总量
    const validForSummary = [auto, peak].filter(m => m.valid);
    const pitchCents = validForSummary.length
      ? Math.max(...validForSummary.map(m => m.note.absCents))
      : null;
    const primary = this.pickPrimaryMethod(auto, peak);

    return {
      tier,
      insufficient: bothInsufficient,
      methods: { autocorrelation: auto, peak },
      primaryMethod: primary ? primary.method : null,
      pitchCents,
      pitchTier: pitchCents === null ? TIMBRE_TIERS.INSUFFICIENT : this.pitchTier(pitchCents),
      slope: primary ? primary.slope : null,
      decayTier: primary ? primary.decayTier : TIMBRE_TIERS.INSUFFICIENT,
      detectedCounts: { autocorrelation: auto.detectedCount, peak: peak.detectedCount },
      agreementCents,
      mutual,
      reasons,
      suggestions,
      lowLevel,
      criteria: { ...c },
      judgedAt: Date.now()
    };
  }

  /**
   * 选出更保守的一路作为展示依据：档位差者优先，同档偏差大者优先
   */
  pickPrimaryMethod(auto, peak) {
    if (!auto.valid && !peak.valid) return null;
    if (!auto.valid) return peak;
    if (!peak.valid) return auto;
    if (auto.tier !== peak.tier) {
      return TIER_RANK[auto.tier] > TIER_RANK[peak.tier] ? auto : peak;
    }
    return auto.note.absCents >= peak.note.absCents ? auto : peak;
  }

  /**
   * 判定口径文字（随结果展示，数值与当前口径实时同步）
   * @returns {string[]}
   */
  describeCriteria(criteria = this.criteria) {
    return TimbreJudge.describeCriteriaStatic(criteria);
  }

  /**
   * 按给定口径生成口径说明文字（可用于历史记录中的口径快照）
   * @returns {string[]}
   */
  static describeCriteriaStatic(criteria) {
    const c = criteria || DEFAULT_CRITERIA;
    return [
      `音准：检测基频对最近十二平均律音的偏差 |Δ| ≤ ${c.pitchPassCents} 音分为合格，≤ ${c.pitchDoubtCents} 音分为存疑，超过为不合格；自相关法、峰值检测分别计算。`,
      `谐波衰减：第3~8谐波相对基频的能量(dB)对谐波序号线性拟合，斜率在 ${c.decayPassMin}~${c.decayPassMax} dB/倍频程为合格，落在 ${c.decayDoubtMin}~${c.decayDoubtMax} 为存疑，超出参考范围为不合格。`,
      `互证：两种方法结论逐项取更保守的一档；两者基频相差 ≤ ${c.agreementCents} 音分视为互相印证，不一致时合格降为存疑。`,
      `数据不足：第3~8谐波中可测（不低于基频能量 -${c.noiseFloorDb} dB）个数 < ${c.minHarmonics}，或区间 RMS < ${c.minRms} 时，不判不合格，提示重选区间。`
    ];
  }
}

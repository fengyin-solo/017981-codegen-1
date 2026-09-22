import { Logger } from '../utils/logger.js';

const logger = new Logger('TimbreAssessor');

/**
 * 判定档位定义
 * 0 = 合格, 1 = 存疑, 2 = 不合格
 */
export const GRADES = [
  { key: 'pass', label: '合格' },
  { key: 'suspect', label: '存疑' },
  { key: 'fail', label: '不合格' }
];

/**
 * 音色判定器 - 按谐波特征判定古琴音色
 *
 * 判定口径：
 * 1. 音准：检测基频与十二平均律最近音的偏差（音分）
 * 2. 衰减：第 3 ~ 8 次谐波相对基频的能量衰减斜率（dB/谐波）
 * 3. 印证：自相关法与峰值检测分别得出档位，不一致时取更保守（更差）的一档
 * 4. 数据不足：谐波能量太弱时不判不合格，标记"数据不足"并提示重选区间
 *
 * 判定口径（阈值）持久化在 localStorage，更换音频文件后原样保留。
 */
export class TimbreAssessor {
  constructor() {
    this.STORAGE_KEY = 'guqin_timbre_criteria';
    this.DEFAULT_CRITERIA = {
      pitchGoodCents: 15,     // 音准偏差 ≤ 此值判合格（音分）
      pitchWarnCents: 35,     // 音准偏差 ≤ 此值判存疑，超出判不合格（音分）
      decayGoodMin: -5,       // 谐波衰减合格下限（dB/谐波）
      decayGoodMax: -1,       // 谐波衰减合格上限（dB/谐波）
      decayWarnMin: -8,       // 谐波衰减存疑下限（dB/谐波）
      decayWarnMax: -0.5,     // 谐波衰减存疑上限（dB/谐波）
      minHarmonicRatioPct: 5, // 3~8 次谐波总能量 / 基频能量 低于此百分比判数据不足
      minDetectableCount: 3   // 3~8 次谐波中可检测数量少于此值判数据不足
    };
    this.criteria = this.loadCriteria();
  }

  /**
   * 从 localStorage 加载判定口径，缺失字段用默认值补齐
   */
  loadCriteria() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const saved = JSON.parse(data);
        const criteria = { ...this.DEFAULT_CRITERIA, ...saved };
        logger.info('加载判定口径成功', criteria);
        return criteria;
      }
    } catch (error) {
      logger.error('加载判定口径失败', error);
    }
    return { ...this.DEFAULT_CRITERIA };
  }

  /**
   * 保存判定口径到 localStorage
   */
  saveCriteria() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.criteria));
      logger.info('保存判定口径成功', this.criteria);
    } catch (error) {
      logger.error('保存判定口径失败', error);
    }
  }

  /**
   * 更新判定口径（自动修正不一致的阈值后保存）
   * @param {Object} patch - 要更新的字段
   * @returns {Object} 修正后的完整口径
   */
  updateCriteria(patch) {
    const next = { ...this.criteria };
    for (const key of Object.keys(this.DEFAULT_CRITERIA)) {
      if (patch[key] !== undefined) {
        const value = parseFloat(patch[key]);
        if (!isNaN(value)) {
          next[key] = value;
        }
      }
    }

    // 保证合格档不宽于存疑档
    next.pitchGoodCents = Math.max(1, next.pitchGoodCents);
    next.pitchWarnCents = Math.max(next.pitchGoodCents, next.pitchWarnCents);
    next.decayGoodMin = Math.max(next.decayWarnMin, next.decayGoodMin);
    next.decayGoodMax = Math.min(next.decayWarnMax, next.decayGoodMax);
    next.minHarmonicRatioPct = Math.max(0, next.minHarmonicRatioPct);
    next.minDetectableCount = Math.min(6, Math.max(1, Math.round(next.minDetectableCount)));

    this.criteria = next;
    this.saveCriteria();
    return this.criteria;
  }

  /**
   * 恢复默认判定口径
   */
  resetCriteria() {
    this.criteria = { ...this.DEFAULT_CRITERIA };
    this.saveCriteria();
    logger.info('判定口径已恢复默认');
    return this.criteria;
  }

  /**
   * 计算频率与十二平均律最近音的偏差
   * @param {number} freq - 频率 (Hz)
   * @returns {Object} { name, freq, cents, midi }
   */
  nearestNote(freq) {
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    const noteFreq = 440 * Math.pow(2, (midi - 69) / 12);
    const cents = 1200 * Math.log2(freq / noteFreq);
    const name = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
    return { name, freq: noteFreq, cents, midi };
  }

  /**
   * 音准偏差分档
   */
  gradePitch(absCents, criteria) {
    if (absCents <= criteria.pitchGoodCents) return 0;
    if (absCents <= criteria.pitchWarnCents) return 1;
    return 2;
  }

  /**
   * 谐波衰减分档
   */
  gradeDecay(slope, criteria) {
    if (slope >= criteria.decayGoodMin && slope <= criteria.decayGoodMax) return 0;
    if (slope >= criteria.decayWarnMin && slope <= criteria.decayWarnMax) return 1;
    return 2;
  }

  /**
   * 计算第 3 ~ 8 次谐波相对基频的能量衰减斜率（dB/谐波，最小二乘拟合）
   * @param {Array} harmonics - 谐波能量数组 [{ n, freq, magnitude, detectable }]
   * @returns {number|null} 斜率，数据不够时返回 null
   */
  decaySlope(harmonics) {
    const e1 = harmonics.find(h => h.n === 1)?.magnitude || 0;
    if (e1 <= 0) return null;

    const points = harmonics
      .filter(h => h.n >= 3 && h.n <= 8 && h.detectable && h.magnitude > 0)
      .map(h => ({ x: h.n, y: 20 * Math.log10(h.magnitude / e1) }));

    if (points.length < 2) return null;

    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return null;

    return (n * sumXY - sumX * sumY) / denominator;
  }

  /**
   * 第 3 ~ 8 次谐波总能量与基频能量的比值
   */
  harmonicEnergyRatio(harmonics) {
    const e1 = harmonics.find(h => h.n === 1)?.magnitude || 0;
    if (e1 <= 0) return 0;
    const sum = harmonics
      .filter(h => h.n >= 3 && h.n <= 8)
      .reduce((s, h) => s + h.magnitude, 0);
    return sum / e1;
  }

  /**
   * 对单个基频候选（自相关法或峰值检测）做完整判定
   */
  evaluateMethod(methodData, criteria) {
    const note = this.nearestNote(methodData.fundamental);
    const slope = this.decaySlope(methodData.harmonics);
    const pitchGrade = this.gradePitch(Math.abs(note.cents), criteria);
    // 衰减斜率拟合不出时按存疑处理，不轻易放过也不直接判不合格
    const decayGrade = slope === null ? 1 : this.gradeDecay(slope, criteria);
    return {
      fundamental: methodData.fundamental,
      note,
      slope,
      pitchGrade,
      decayGrade,
      grade: Math.max(pitchGrade, decayGrade)
    };
  }

  /**
   * 判定一个区间的音色
   * @param {Object} segmentAnalysis - AudioAnalyzer.analyzeSegmentForAssessment 的结果
   * @param {Object} context - { startMs, endMs }
   * @returns {Object} 判定结果
   */
  assess(segmentAnalysis, context) {
    const criteria = { ...this.criteria };
    const finalMethod = segmentAnalysis.methods.final;

    // ---- 数据不足检查（谐波能量太弱时不判不合格）----
    const insufficientReasons = [];
    const e1 = finalMethod.harmonics.find(h => h.n === 1)?.magnitude || 0;
    const ratio = this.harmonicEnergyRatio(finalMethod.harmonics);
    const detectableCount = finalMethod.harmonics
      .filter(h => h.n >= 3 && h.n <= 8 && h.detectable).length;

    if (segmentAnalysis.rms < 0.001) {
      insufficientReasons.push('区间响度过低，接近静音');
    }
    if (e1 <= segmentAnalysis.noiseFloor * 3) {
      insufficientReasons.push('基频能量低于噪声底，无法确认发音');
    }
    if (detectableCount < criteria.minDetectableCount) {
      insufficientReasons.push(
        `第 3~8 次谐波中仅 ${detectableCount} 个可检测（不足 ${criteria.minDetectableCount} 个）`
      );
    }
    if (ratio * 100 < criteria.minHarmonicRatioPct) {
      insufficientReasons.push(
        `第 3~8 次谐波总能量仅为基频的 ${(ratio * 100).toFixed(1)}%（低于 ${criteria.minHarmonicRatioPct}%）`
      );
    }

    const base = {
      startMs: context.startMs,
      endMs: context.endMs,
      criteria,
      criteriaText: this.buildCriteriaText(criteria)
    };

    if (insufficientReasons.length > 0) {
      logger.info('判定结果：数据不足', insufficientReasons);
      return {
        ...base,
        status: 'insufficient',
        grade: null,
        insufficientReasons,
        fundamental: finalMethod.fundamental
      };
    }

    // ---- 两种检测方法分别判定，互相印证 ----
    const autocorrResult = this.evaluateMethod(segmentAnalysis.methods.autocorr, criteria);
    const peakResult = this.evaluateMethod(segmentAnalysis.methods.peak, criteria);
    const agreed = autocorrResult.grade === peakResult.grade;
    // 不一致时按更保守（更差）的一档走
    const finalGrade = Math.max(autocorrResult.grade, peakResult.grade);

    const result = {
      ...base,
      status: 'graded',
      grade: finalGrade,
      agreed,
      methods: {
        autocorr: autocorrResult,
        peak: peakResult
      }
    };

    logger.info('判定结果', {
      区间: `${context.startMs}-${context.endMs}ms`,
      自相关法: GRADES[autocorrResult.grade].label,
      峰值检测: GRADES[peakResult.grade].label,
      最终: GRADES[finalGrade].label
    });

    return result;
  }

  /**
   * 生成判定口径说明文字（随当前口径动态生成，展示在结果旁）
   */
  buildCriteriaText(criteria = this.criteria) {
    const c = criteria;
    return `判定口径：音准偏差 ≤${c.pitchGoodCents} 音分合格、≤${c.pitchWarnCents} 音分存疑、超出不合格；` +
      `第 3~8 次谐波衰减 ${c.decayGoodMin}~${c.decayGoodMax} dB/谐波合格、` +
      `${c.decayWarnMin}~${c.decayWarnMax} dB/谐波存疑、超出不合格；` +
      `自相关法与峰值检测分别判定，不一致时取较保守档；` +
      `谐波总能量不足基频 ${c.minHarmonicRatioPct}% 或可检测谐波少于 ${c.minDetectableCount} 个时判数据不足，不判不合格。`;
  }
}

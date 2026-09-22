import { Logger } from '../utils/logger.js';

const logger = new Logger('AudioAnalyzer');

/**
 * 音频分析器 - 负责音频的频谱分析、基频检测和倍频计算
 */
export class AudioAnalyzer {
  constructor(audioContext) {
    this.audioContext = audioContext;
  }

  /**
   * 分析音频数据
   * @param {Float32Array} audioData - 音频采样数据
   * @param {number} sampleRate - 采样率
   * @param {number} fftSize - FFT 大小
   * @returns {Object} 分析结果
   */
  async analyze(audioData, sampleRate, fftSize = 8192) {
    logger.info('开始频谱分析', { dataLength: audioData.length, sampleRate, fftSize });

    // 执行 FFT 分析
    const frequencyData = this.performFFT(audioData, fftSize);
    
    // 计算频率分辨率
    const frequencyResolution = sampleRate / fftSize;
    
    // 生成频率数组
    const frequencies = [];
    const magnitudes = [];
    const binCount = fftSize / 2;
    
    for (let i = 0; i < binCount; i++) {
      const freq = i * frequencyResolution;
      if (freq > 20 && freq < 20000) { // 人耳可听范围
        frequencies.push(freq);
        magnitudes.push(frequencyData[i]);
      }
    }

    // 检测基频（同时保留自相关法、峰值检测两路结果，供音色判定互证）
    const detection = this.detectFundamentalFrequency(audioData, sampleRate, frequencies, magnitudes);
    const fundamentalFreq = detection.freq;

    // 计算倍频 (最大13倍)
    const harmonics = this.calculateHarmonics(fundamentalFreq, 13);
    
    // 过滤只保留基频和倍频附近的数据
    const filteredData = this.filterHarmonics(frequencies, magnitudes, fundamentalFreq, harmonics);
    
    // 计算频率区域数据
    const frequencyBands = this.calculateFrequencyBands(fundamentalFreq, harmonics, filteredData);
    
    // 计算声强随时间变化的热力图数据
    const heatmapData = this.calculateHeatmapData(audioData, sampleRate, fftSize, fundamentalFreq, harmonics);

    // 找出频率范围
    const minFreq = fundamentalFreq * 0.8;
    const maxFreq = Math.min(fundamentalFreq * 13.5, 20000);

    return {
      fundamentalFreq,
      autocorrFreq: detection.autocorrFreq,
      peakFreq: detection.peakFreq,
      rms: this.calculateRMS(audioData),
      frequencyResolution,
      harmonics,
      frequencies: filteredData.frequencies,
      magnitudes: filteredData.magnitudes,
      frequencyBands,
      heatmapData,
      minFreq,
      maxFreq,
      rawFrequencies: frequencies,
      rawMagnitudes: magnitudes
    };
  }

  /**
   * 计算区间 RMS 电平（用于判定数据是否过弱）
   */
  calculateRMS(audioData) {
    if (!audioData || audioData.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    return Math.sqrt(sum / audioData.length);
  }

  /**
   * 执行 FFT 变换
   */
  performFFT(audioData, fftSize) {
    // 使用 Web Audio API 的 AnalyserNode 进行 FFT
    // 这里我们手动实现简化版 FFT
    const paddedData = new Float32Array(fftSize);
    const copyLength = Math.min(audioData.length, fftSize);
    
    // 应用汉宁窗
    for (let i = 0; i < copyLength; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (copyLength - 1)));
      paddedData[i] = audioData[i] * window;
    }

    // 执行 FFT
    const fftResult = this.fft(paddedData);
    
    // 计算幅度谱
    const magnitudes = new Float32Array(fftSize / 2);
    for (let i = 0; i < fftSize / 2; i++) {
      const real = fftResult.real[i];
      const imag = fftResult.imag[i];
      magnitudes[i] = Math.sqrt(real * real + imag * imag);
    }

    return magnitudes;
  }

  /**
   * FFT 实现 (Cooley-Tukey 算法)
   */
  fft(data) {
    const n = data.length;
    
    if (n <= 1) {
      return { real: [data[0] || 0], imag: [0] };
    }

    // 位反转排序
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    
    for (let i = 0; i < n; i++) {
      real[i] = data[i];
      imag[i] = 0;
    }

    // 迭代 FFT
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const step = n / size;
      
      for (let i = 0; i < n; i += size) {
        for (let j = 0; j < halfSize; j++) {
          const angle = -2 * Math.PI * j * step / n;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          
          const idx1 = i + j;
          const idx2 = i + j + halfSize;
          
          const tReal = real[idx2] * cos - imag[idx2] * sin;
          const tImag = real[idx2] * sin + imag[idx2] * cos;
          
          real[idx2] = real[idx1] - tReal;
          imag[idx2] = imag[idx1] - tImag;
          real[idx1] = real[idx1] + tReal;
          imag[idx1] = imag[idx1] + tImag;
        }
      }
    }

    return { real, imag };
  }

  /**
   * 检测基频 - 使用自相关法和峰值检测
   * @returns {{freq:number, autocorrFreq:number, peakFreq:number, autocorrConfidence:number}}
   * freq 为综合两路后的最终基频；两路原始结果一并返回，供音色判定互证
   */
  detectFundamentalFrequency(audioData, sampleRate, frequencies, magnitudes) {
    // 方法1: 自相关法
    const { freq: autocorrFreq, confidence: autocorrConfidence } = this.autocorrelation(audioData, sampleRate);

    // 方法2: 峰值检测法
    const peakFreq = this.findDominantPeak(frequencies, magnitudes);

    // 综合判断 - 优先使用自相关法的结果，因为它对古琴这类乐器更准确
    let fundamentalFreq = autocorrFreq;

    // 如果自相关法结果不合理，使用峰值检测
    if (fundamentalFreq < 50 || fundamentalFreq > 2000) {
      fundamentalFreq = peakFreq;
    }

    // 验证：检查是否可能是倍频被误检为基频
    let possibleFundamental = this.verifyFundamental(fundamentalFreq, frequencies, magnitudes);

    // 两路都未检出有效基频时给一个保守占位值，保证后续图表流程不中断
    if (!Number.isFinite(possibleFundamental) || possibleFundamental <= 0) {
      possibleFundamental = 65.4; // C2，古琴最低音附近
    }

    logger.info('基频检测结果', { autocorrFreq, peakFreq, final: possibleFundamental });

    return {
      freq: possibleFundamental,
      autocorrFreq,
      peakFreq,
      autocorrConfidence
    };
  }

  /**
   * 自相关法检测基频
   * @returns {{freq:number, confidence:number}} confidence 为归一化自相关峰值
   */
  autocorrelation(audioData, sampleRate) {
    const minPeriod = Math.floor(sampleRate / 2000); // 最高频率 2000Hz
    const maxPeriod = Math.floor(sampleRate / 50);   // 最低频率 50Hz
    const dataLength = Math.min(audioData.length, sampleRate); // 最多分析1秒

    let energy = 0;
    for (let i = 0; i < dataLength; i++) {
      energy += audioData[i] * audioData[i];
    }

    let maxCorr = 0;
    let bestPeriod = minPeriod;

    for (let period = minPeriod; period < maxPeriod && period < dataLength / 2; period++) {
      let corr = 0;
      let count = 0;

      for (let i = 0; i < dataLength - period; i++) {
        corr += audioData[i] * audioData[i + period];
        count++;
      }

      corr /= count;

      if (corr > maxCorr) {
        maxCorr = corr;
        bestPeriod = period;
      }
    }

    // 归一化置信度（0~1），过低表示周期性弱
    const confidence = energy > 0 ? Math.max(0, Math.min(1, maxCorr / (energy / dataLength))) : 0;

    return { freq: sampleRate / bestPeriod, confidence };
  }

  /**
   * 峰值检测法
   * 不再直接取最强峰（古琴高次谐波常强于基频，会把谐波误当基频），
   * 而是在基频候选范围内对每个谱峰计算"谐波支持度"：
   * 若其 2~8 倍频位置也存在显著能量，则更可能是真正的基频。
   */
  findDominantPeak(frequencies, magnitudes) {
    // 收集合理基频范围内的局部峰
    const peaks = [];
    let globalMax = 0;
    for (let i = 1; i < frequencies.length - 1; i++) {
      if (frequencies[i] >= 50 && frequencies[i] <= 1000) {
        if (magnitudes[i] > globalMax) globalMax = magnitudes[i];
        if (magnitudes[i] >= magnitudes[i - 1] && magnitudes[i] >= magnitudes[i + 1] && magnitudes[i] > 0) {
          peaks.push({ freq: frequencies[i], mag: magnitudes[i] });
        }
      }
    }
    if (peaks.length === 0 || globalMax === 0) return 0;

    let best = null;
    let bestScore = -Infinity;
    // 频率分辨率：谐波匹配只接受落在分辨率附近的命中，避免杂峰蹭支持度
    const resolution = frequencies.length > 1 ? frequencies[1] - frequencies[0] : 5;
    for (const cand of peaks) {
      // 整数倍频处的能量支持（计显著命中数，而非能量总和，避免高次峰刷分）
      let support = 0;
      for (let n = 2; n <= 8; n++) {
        const target = cand.freq * n;
        // 容差取频率分辨率与目标频率 1% 的较小值，最多不超过半音
        const tol = Math.min(Math.max(2 * resolution, target * 0.01), target * 0.03);
        let localMax = 0;
        for (let i = 0; i < frequencies.length; i++) {
          const f = frequencies[i];
          if (f < target - tol) continue;
          if (f > target + tol) break;
          if (magnitudes[i] > localMax) localMax = magnitudes[i];
        }
        if (localMax > 0.15 * globalMax) support += 1;
      }

      // 若候选的低次分谐波（f/2、f/3）处也有显著能量，它更可能是高次谐波而非基频
      let subPenalty = 0;
      for (const div of [2, 3]) {
        const sub = cand.freq / div;
        if (sub < 50) continue;
        const tol = sub * 0.03;
        let subMax = 0;
        for (let i = 0; i < frequencies.length; i++) {
          const f = frequencies[i];
          if (f < sub - tol) continue;
          if (f > sub + tol) break;
          if (magnitudes[i] > subMax) subMax = magnitudes[i];
        }
        if (subMax > 0.15 * globalMax) subPenalty += 1;
      }

      const selfScore = cand.mag / globalMax;
      // 要求基频候选自身有可观测能量，极弱峰不与强峰同台竞争
      const selfGate = selfScore < 0.03 ? -2 : 0;
      // 低频小幅优先：古琴基频多在 60~500Hz，频率越高越是谐波的可能性越大
      const lowBias = 1 - (cand.freq - 50) / 950;
      const score = support * 1.0 + lowBias * 0.35 + selfScore * 0.15 - subPenalty * 1.2 + selfGate;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    return best ? best.freq : 0;
  }

  /**
   * 验证基频 - 检查是否有更低的基频
   */
  verifyFundamental(freq, frequencies, magnitudes) {
    // 检查 freq/2, freq/3 等是否也有显著能量
    const possibleFundamentals = [freq, freq / 2, freq / 3];
    
    for (const possibleFreq of possibleFundamentals) {
      if (possibleFreq < 50) continue;
      
      // 检查该频率附近是否有能量
      const tolerance = possibleFreq * 0.05; // 5% 容差
      let hasEnergy = false;
      
      for (let i = 0; i < frequencies.length; i++) {
        if (Math.abs(frequencies[i] - possibleFreq) < tolerance) {
          if (magnitudes[i] > 0.1 * Math.max(...magnitudes)) {
            hasEnergy = true;
            break;
          }
        }
      }
      
      if (hasEnergy && possibleFreq < freq) {
        return possibleFreq;
      }
    }
    
    return freq;
  }

  /**
   * 计算倍频
   */
  calculateHarmonics(fundamentalFreq, maxHarmonic = 13) {
    const harmonics = [];
    for (let i = 2; i <= maxHarmonic; i++) {
      harmonics.push(fundamentalFreq * i);
    }
    return harmonics;
  }

  /**
   * 过滤只保留基频和倍频的数据
   */
  filterHarmonics(frequencies, magnitudes, fundamentalFreq, harmonics) {
    const allHarmonics = [fundamentalFreq, ...harmonics];
    const filteredFreqs = [];
    const filteredMags = [];
    const tolerance = fundamentalFreq * 0.1; // 10% 容差
    
    for (let i = 0; i < frequencies.length; i++) {
      const freq = frequencies[i];
      
      // 检查是否接近任何一个谐波
      for (const harmonic of allHarmonics) {
        if (Math.abs(freq - harmonic) < tolerance) {
          filteredFreqs.push(freq);
          filteredMags.push(magnitudes[i]);
          break;
        }
      }
    }
    
    return { frequencies: filteredFreqs, magnitudes: filteredMags };
  }

  /**
   * 计算频率区域数据
   */
  calculateFrequencyBands(fundamentalFreq, harmonics, filteredData) {
    const allHarmonics = [fundamentalFreq, ...harmonics];
    
    // 低频区: 基频 ~ 4倍频
    const lowFreqRange = { min: fundamentalFreq * 0.9, max: fundamentalFreq * 4.5 };
    // 中频区: 5倍频 ~ 8倍频
    const midFreqRange = { min: fundamentalFreq * 4.5, max: fundamentalFreq * 8.5 };
    // 高频区: 9倍频 ~ 13倍频
    const highFreqRange = { min: fundamentalFreq * 8.5, max: fundamentalFreq * 13.5 };

    const extractBandData = (range) => {
      const freqs = [];
      const mags = [];
      
      for (let i = 0; i < filteredData.frequencies.length; i++) {
        const freq = filteredData.frequencies[i];
        if (freq >= range.min && freq <= range.max) {
          freqs.push(freq);
          mags.push(filteredData.magnitudes[i]);
        }
      }
      
      // 为每个倍频创建数据点
      const bandHarmonics = allHarmonics.filter(h => h >= range.min && h <= range.max);
      const harmonicData = bandHarmonics.map(h => {
        // 找到最接近的实际数据点
        let closestMag = 0;
        let minDist = Infinity;
        
        for (let i = 0; i < freqs.length; i++) {
          const dist = Math.abs(freqs[i] - h);
          if (dist < minDist) {
            minDist = dist;
            closestMag = mags[i];
          }
        }
        
        return { frequency: h, magnitude: closestMag };
      });
      
      return harmonicData;
    };

    return {
      low: extractBandData(lowFreqRange),
      mid: extractBandData(midFreqRange),
      high: extractBandData(highFreqRange)
    };
  }

  /**
   * 计算热力图数据 - 声强随时间变化
   */
  calculateHeatmapData(audioData, sampleRate, fftSize, fundamentalFreq, harmonics) {
    const allHarmonics = [fundamentalFreq, ...harmonics];
    const windowSize = Math.min(fftSize, 2048);
    const hopSize = windowSize / 4;
    const numFrames = Math.floor((audioData.length - windowSize) / hopSize) + 1;
    
    // 限制帧数以提高性能
    const maxFrames = 100;
    const frameStep = Math.max(1, Math.floor(numFrames / maxFrames));
    const actualFrames = Math.ceil(numFrames / frameStep);
    
    const heatmapData = [];
    const timeLabels = [];
    const freqLabels = allHarmonics.map((h, i) => i === 0 ? '基频' : `${i + 1}倍频`);
    
    for (let frame = 0; frame < numFrames; frame += frameStep) {
      const startSample = frame * hopSize;
      const endSample = startSample + windowSize;
      
      if (endSample > audioData.length) break;
      
      const frameData = audioData.slice(startSample, endSample);
      const fftResult = this.performFFT(frameData, windowSize);
      const freqResolution = sampleRate / windowSize;
      
      // 提取每个谐波的能量
      const frameEnergies = allHarmonics.map(harmonic => {
        const binIndex = Math.round(harmonic / freqResolution);
        if (binIndex >= 0 && binIndex < fftResult.length) {
          return fftResult[binIndex];
        }
        return 0;
      });
      
      heatmapData.push(frameEnergies);
      timeLabels.push((startSample / sampleRate * 1000).toFixed(0));
    }
    
    // 归一化
    const maxVal = Math.max(...heatmapData.flat());
    const normalizedData = heatmapData.map(row => 
      row.map(val => maxVal > 0 ? val / maxVal : 0)
    );
    
    return {
      data: normalizedData,
      timeLabels,
      freqLabels
    };
  }
}

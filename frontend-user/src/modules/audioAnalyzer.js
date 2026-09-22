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

    // 检测基频（同时保留自相关法与峰值检测两个候选，供音色判定互相印证）
    const fundamentalCandidates = this.getFundamentalCandidates(audioData, sampleRate, frequencies, magnitudes);
    const fundamentalFreq = fundamentalCandidates.final;
    
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
      fundamentalCandidates,
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
    const bits = Math.round(Math.log2(n));

    for (let i = 0; i < n; i++) {
      let reversed = 0;
      for (let b = 0; b < bits; b++) {
        reversed = (reversed << 1) | ((i >> b) & 1);
      }
      real[reversed] = data[i];
      imag[reversed] = 0;
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
   */
  detectFundamentalFrequency(audioData, sampleRate, frequencies, magnitudes) {
    return this.getFundamentalCandidates(audioData, sampleRate, frequencies, magnitudes).final;
  }

  /**
   * 获取基频候选 - 自相关法与峰值检测的结果都保留，供互相印证
   * @returns {Object} { autocorr, peak, final }
   */
  getFundamentalCandidates(audioData, sampleRate, frequencies, magnitudes) {
    // 方法1: 自相关法
    const autocorrFreq = this.autocorrelation(audioData, sampleRate);

    // 方法2: 峰值检测法
    const peakFreq = this.findDominantPeak(frequencies, magnitudes);

    // 综合判断 - 优先使用自相关法的结果，因为它对古琴这类乐器更准确
    let fundamentalFreq = autocorrFreq;

    // 如果自相关法结果不合理，使用峰值检测
    if (fundamentalFreq < 50 || fundamentalFreq > 2000) {
      fundamentalFreq = peakFreq;
    }

    // 验证：检查是否可能是倍频被误检为基频
    const possibleFundamental = this.verifyFundamental(fundamentalFreq, frequencies, magnitudes);

    logger.info('基频检测结果', { autocorrFreq, peakFreq, final: possibleFundamental });

    return { autocorr: autocorrFreq, peak: peakFreq, final: possibleFundamental };
  }

  /**
   * 自相关法检测基频（峰值位置做抛物线插值细化，达到音分级精度）
   */
  autocorrelation(audioData, sampleRate) {
    const minPeriod = Math.floor(sampleRate / 2000); // 最高频率 2000Hz
    const maxPeriod = Math.floor(sampleRate / 50);   // 最低频率 50Hz
    const dataLength = Math.min(audioData.length, sampleRate); // 最多分析1秒

    let maxCorr = 0;
    const corrs = new Float64Array(maxPeriod + 1);

    for (let period = minPeriod; period < maxPeriod && period < dataLength / 2; period++) {
      let corr = 0;
      let count = 0;

      for (let i = 0; i < dataLength - period; i++) {
        corr += audioData[i] * audioData[i + period];
        count++;
      }

      corr /= count;
      corrs[period] = corr;

      if (corr > maxCorr) {
        maxCorr = corr;
      }
    }

    // 取"第一个足够高的局部峰"对应的周期，避免把 2 倍周期（低八度）误判为基频
    const threshold = maxCorr * 0.9;
    const lastPeriod = Math.min(maxPeriod - 1, Math.floor(dataLength / 2) - 1);
    let bestPeriod = minPeriod;
    let found = false;
    for (let period = minPeriod + 1; period < lastPeriod; period++) {
      if (corrs[period] >= threshold &&
          corrs[period] >= corrs[period - 1] &&
          corrs[period] >= corrs[period + 1]) {
        bestPeriod = period;
        found = true;
        break;
      }
    }
    if (!found) {
      // 没有满足条件的局部峰时退回到最大相关位置
      let maxVal = -Infinity;
      for (let period = minPeriod; period <= lastPeriod; period++) {
        if (corrs[period] > maxVal) {
          maxVal = corrs[period];
          bestPeriod = period;
        }
      }
    }

    // 抛物线插值细化周期，减小采样量化带来的音分误差
    if (bestPeriod > minPeriod && bestPeriod < maxPeriod - 1) {
      const y1 = corrs[bestPeriod - 1];
      const y2 = corrs[bestPeriod];
      const y3 = corrs[bestPeriod + 1];
      const denominator = y1 - 2 * y2 + y3;
      if (denominator !== 0) {
        const shift = 0.5 * (y1 - y3) / denominator;
        if (Math.abs(shift) < 1) {
          return sampleRate / (bestPeriod + shift);
        }
      }
    }

    return sampleRate / bestPeriod;
  }

  /**
   * 峰值检测法（峰值频率做对数幅值抛物线插值细化，达到音分级精度）
   */
  findDominantPeak(frequencies, magnitudes) {
    let maxMag = 0;
    let peakIndex = -1;

    // 在合理的基频范围内寻找最大峰值 (古琴基频通常在 60-500Hz)
    for (let i = 0; i < frequencies.length; i++) {
      if (frequencies[i] >= 50 && frequencies[i] <= 1000) {
        if (magnitudes[i] > maxMag) {
          maxMag = magnitudes[i];
          peakIndex = i;
        }
      }
    }

    if (peakIndex === -1) {
      return 100;
    }

    // 对数幅值抛物线插值，细化到频点间隔以内
    if (peakIndex > 0 && peakIndex < magnitudes.length - 1) {
      const y1 = Math.log(Math.max(magnitudes[peakIndex - 1], 1e-12));
      const y2 = Math.log(Math.max(magnitudes[peakIndex], 1e-12));
      const y3 = Math.log(Math.max(magnitudes[peakIndex + 1], 1e-12));
      const denominator = y1 - 2 * y2 + y3;
      if (denominator !== 0) {
        const shift = 0.5 * (y1 - y3) / denominator;
        if (Math.abs(shift) < 1 && peakIndex + 1 < frequencies.length) {
          const resolution = frequencies[peakIndex + 1] - frequencies[peakIndex];
          return frequencies[peakIndex] + shift * resolution;
        }
      }
    }

    return frequencies[peakIndex];
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

  /**
   * 为音色判定分析区间 - 轻量分析，只算判定需要的数据
   * @param {Float32Array} audioData - 区间音频采样数据
   * @param {number} sampleRate - 采样率
   * @param {number} fftSize - FFT 大小
   * @returns {Object} 判定用分析数据（基频候选、各方法谐波能量、噪声底、响度）
   */
  analyzeSegmentForAssessment(audioData, sampleRate, fftSize = 8192) {
    logger.info('开始音色判定分析', { dataLength: audioData.length, sampleRate, fftSize });

    const frequencyData = this.performFFT(audioData, fftSize);
    const frequencyResolution = sampleRate / fftSize;

    const frequencies = [];
    const magnitudes = [];
    for (let i = 0; i < fftSize / 2; i++) {
      const freq = i * frequencyResolution;
      if (freq > 20 && freq < 20000) {
        frequencies.push(freq);
        magnitudes.push(frequencyData[i]);
      }
    }

    // 两种方法各自检测基频
    const candidates = this.getFundamentalCandidates(audioData, sampleRate, frequencies, magnitudes);

    // 区间响度 (RMS)
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
      sumSquares += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sumSquares / audioData.length);

    // 噪声底：用频谱幅值中位数估计
    const noiseFloor = this.estimateNoiseFloor(magnitudes);

    // 按每个候选基频分别提取 1~8 次谐波能量
    const extractFor = (f0) => ({
      fundamental: f0,
      harmonics: this.extractHarmonicEnergies(frequencies, magnitudes, f0, 8, frequencyResolution, noiseFloor)
    });

    return {
      rms,
      noiseFloor,
      candidates,
      methods: {
        autocorr: extractFor(candidates.autocorr),
        peak: extractFor(candidates.peak),
        final: extractFor(candidates.final)
      }
    };
  }

  /**
   * 提取指定基频下 1 ~ maxHarmonic 次谐波的能量
   * @param {Array} frequencies - 频率数组
   * @param {Array} magnitudes - 幅值数组
   * @param {number} fundamentalFreq - 基频
   * @param {number} maxHarmonic - 最大谐波次数
   * @param {number} frequencyResolution - 频率分辨率
   * @param {number} noiseFloor - 噪声底
   * @returns {Array} [{ n, freq, magnitude, detectable }]
   */
  extractHarmonicEnergies(frequencies, magnitudes, fundamentalFreq, maxHarmonic = 8, frequencyResolution = 1, noiseFloor = 0) {
    const harmonics = [];
    const detectThreshold = Math.max(noiseFloor * 3, 1e-6);

    for (let n = 1; n <= maxHarmonic; n++) {
      const target = fundamentalFreq * n;
      if (target > 20000) {
        harmonics.push({ n, freq: target, magnitude: 0, detectable: false });
        continue;
      }

      // 在目标频率附近找峰值（容差取 3% 或 1.5 个频点的较大者）
      const tolerance = Math.max(target * 0.03, frequencyResolution * 1.5);
      let peakMag = 0;
      for (let i = 0; i < frequencies.length; i++) {
        if (Math.abs(frequencies[i] - target) <= tolerance) {
          if (magnitudes[i] > peakMag) {
            peakMag = magnitudes[i];
          }
        }
      }

      harmonics.push({
        n,
        freq: target,
        magnitude: peakMag,
        detectable: peakMag > detectThreshold
      });
    }

    return harmonics;
  }

  /**
   * 用中位数估计频谱噪声底
   */
  estimateNoiseFloor(magnitudes) {
    if (!magnitudes || magnitudes.length === 0) return 0;
    const sorted = [...magnitudes].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}

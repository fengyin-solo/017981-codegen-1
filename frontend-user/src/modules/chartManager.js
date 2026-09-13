import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Logger } from '../utils/logger.js';

Chart.register(annotationPlugin);

const logger = new Logger('ChartManager');

/**
 * 图表管理器 - 负责所有图表的创建和更新
 */
export class ChartManager {
  constructor() {
    this.charts = {
      waveform: null,
      spectrum: null,
      heatmap: null,
      lowFreq: null,
      midFreq: null,
      highFreq: null
    };
  }

  /**
   * 更新所有图表
   */
  updateAllCharts(analysisResult, audioData, sampleRate) {
    logger.info('更新所有图表');
    
    this.updateWaveformChart(audioData, sampleRate);
    this.updateSpectrumChart(analysisResult);
    this.updateHeatmapChart(analysisResult.heatmapData);
    this.updateFrequencyBandCharts(analysisResult);
  }

  /**
   * 清除所有图表
   */
  clearAllCharts() {
    Object.values(this.charts).forEach(chart => {
      if (chart) {
        chart.destroy();
      }
    });
    this.charts = {
      waveform: null,
      spectrum: null,
      heatmap: null,
      lowFreq: null,
      midFreq: null,
      highFreq: null
    };
  }

  /**
   * 更新波形图
   */
  updateWaveformChart(audioData, sampleRate) {
    const canvas = document.getElementById('waveformChart');
    const ctx = canvas.getContext('2d');

    if (this.charts.waveform) {
      this.charts.waveform.destroy();
    }

    // 降采样以提高性能
    const maxPoints = 2000;
    const step = Math.max(1, Math.floor(audioData.length / maxPoints));
    const labels = [];
    const data = [];

    for (let i = 0; i < audioData.length; i += step) {
      labels.push((i / sampleRate * 1000).toFixed(1));
      data.push(audioData[i]);
    }

    this.charts.waveform = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: '振幅',
          data,
          borderColor: '#8B4513',
          backgroundColor: 'rgba(139, 69, 19, 0.1)',
          borderWidth: 1,
          pointRadius: 0,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            title: { display: true, text: '时间 (ms)' },
            ticks: { maxTicksLimit: 10 }
          },
          y: {
            title: { display: true, text: '振幅' }
          }
        },
        animation: false
      }
    });
  }

  /**
   * 更新频谱图
   */
  updateSpectrumChart(analysisResult) {
    const canvas = document.getElementById('spectrumChart');
    const ctx = canvas.getContext('2d');

    if (this.charts.spectrum) {
      this.charts.spectrum.destroy();
    }

    const { fundamentalFreq, harmonics, frequencies, magnitudes, minFreq, maxFreq } = analysisResult;
    const allHarmonics = [fundamentalFreq, ...harmonics];

    // 创建用于显示的数据点
    const chartData = [];
    const chartLabels = [];

    // 为每个谐波创建数据点
    allHarmonics.forEach((harmonic, index) => {
      // 找到最接近的实际数据
      let closestMag = 0;
      let minDist = Infinity;

      for (let i = 0; i < frequencies.length; i++) {
        const dist = Math.abs(frequencies[i] - harmonic);
        if (dist < minDist) {
          minDist = dist;
          closestMag = magnitudes[i];
        }
      }

      chartLabels.push(index === 0 ? `基频\n${harmonic.toFixed(0)}Hz` : `${index + 1}倍频\n${harmonic.toFixed(0)}Hz`);
      chartData.push(closestMag);
    });

    // 归一化
    const maxMag = Math.max(...chartData);
    const normalizedData = chartData.map(v => maxMag > 0 ? (v / maxMag) * 100 : 0);

    // 创建颜色数组 - 基频用特殊颜色
    const colors = normalizedData.map((_, i) => 
      i === 0 ? '#D2691E' : '#8B4513'
    );

    this.charts.spectrum = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartLabels,
        datasets: [{
          label: '相对强度 (%)',
          data: normalizedData,
          backgroundColor: colors,
          borderColor: colors.map(c => c),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `强度: ${context.raw.toFixed(1)}%`
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: '频率' }
          },
          y: {
            title: { display: true, text: '相对强度 (%)' },
            min: 0,
            max: 100
          }
        }
      }
    });
  }

  /**
   * 更新热力图
   */
  updateHeatmapChart(heatmapData) {
    const canvas = document.getElementById('heatmapChart');
    const ctx = canvas.getContext('2d');

    if (this.charts.heatmap) {
      this.charts.heatmap.destroy();
    }

    const { data, timeLabels, freqLabels } = heatmapData;

    // 绘制热力图
    const width = canvas.parentElement.clientWidth - 40;
    const height = 200;
    canvas.width = width;
    canvas.height = height;

    const cellWidth = width / data.length;
    const cellHeight = height / freqLabels.length;

    // 清除画布
    ctx.clearRect(0, 0, width, height);

    // 绘制热力图单元格
    data.forEach((frame, x) => {
      frame.forEach((value, y) => {
        const color = this.getHeatmapColor(value);
        ctx.fillStyle = color;
        ctx.fillRect(x * cellWidth, (freqLabels.length - 1 - y) * cellHeight, cellWidth + 1, cellHeight + 1);
      });
    });

    // 绘制频率标签
    ctx.fillStyle = '#333';
    ctx.font = '10px Arial';
    ctx.textAlign = 'right';
    freqLabels.forEach((label, i) => {
      const y = (freqLabels.length - 1 - i) * cellHeight + cellHeight / 2 + 3;
      // 标签绘制在左侧
    });

    // 绘制时间轴标签
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.floor(timeLabels.length / 10));
    for (let i = 0; i < timeLabels.length; i += labelStep) {
      const x = i * cellWidth + cellWidth / 2;
      ctx.fillText(timeLabels[i] + 'ms', x, height - 5);
    }
  }

  /**
   * 获取热力图颜色
   */
  getHeatmapColor(value) {
    // 使用科学可视化常用的颜色映射
    const colors = [
      { pos: 0, r: 49, g: 54, b: 149 },    // 深蓝
      { pos: 0.25, r: 69, g: 117, b: 180 }, // 蓝
      { pos: 0.5, r: 255, g: 255, b: 191 }, // 黄
      { pos: 0.75, r: 253, g: 174, b: 97 }, // 橙
      { pos: 1, r: 165, g: 0, b: 38 }       // 红
    ];

    // 找到对应的颜色区间
    let lower = colors[0];
    let upper = colors[colors.length - 1];

    for (let i = 0; i < colors.length - 1; i++) {
      if (value >= colors[i].pos && value <= colors[i + 1].pos) {
        lower = colors[i];
        upper = colors[i + 1];
        break;
      }
    }

    // 线性插值
    const range = upper.pos - lower.pos;
    const t = range > 0 ? (value - lower.pos) / range : 0;

    const r = Math.round(lower.r + (upper.r - lower.r) * t);
    const g = Math.round(lower.g + (upper.g - lower.g) * t);
    const b = Math.round(lower.b + (upper.b - lower.b) * t);

    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * 更新频率区域图表
   */
  updateFrequencyBandCharts(analysisResult) {
    const { frequencyBands, fundamentalFreq } = analysisResult;

    // 低频区图表
    this.updateBandChart('lowFreqChart', 'lowFreq', frequencyBands.low, '低频区', fundamentalFreq, 1);
    
    // 中频区图表
    this.updateBandChart('midFreqChart', 'midFreq', frequencyBands.mid, '中频区', fundamentalFreq, 5);
    
    // 高频区图表
    this.updateBandChart('highFreqChart', 'highFreq', frequencyBands.high, '高频区', fundamentalFreq, 9);
  }

  /**
   * 更新单个频率区域图表
   */
  updateBandChart(canvasId, chartKey, bandData, title, fundamentalFreq, startHarmonic) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');

    if (this.charts[chartKey]) {
      this.charts[chartKey].destroy();
    }

    if (bandData.length === 0) {
      // 显示空状态
      this.charts[chartKey] = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['无数据'],
          datasets: [{
            data: [0],
            backgroundColor: '#E0E0E0'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } }
        }
      });
      return;
    }

    const labels = bandData.map((d, i) => {
      const harmonicNum = startHarmonic + i;
      return harmonicNum === 1 ? '基频' : `${harmonicNum}倍频`;
    });

    const data = bandData.map(d => d.magnitude);
    
    // 归一化
    const maxVal = Math.max(...data);
    const normalizedData = data.map(v => maxVal > 0 ? (v / maxVal) * 100 : 0);

    // 根据区域设置不同颜色
    const colorMap = {
      lowFreq: '#4CAF50',   // 绿色
      midFreq: '#2196F3',   // 蓝色
      highFreq: '#9C27B0'   // 紫色
    };

    this.charts[chartKey] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '相对强度 (%)',
          data: normalizedData,
          backgroundColor: colorMap[chartKey],
          borderColor: colorMap[chartKey],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: (context) => {
                const harmonicNum = startHarmonic + context.dataIndex;
                const freq = fundamentalFreq * harmonicNum;
                return `频率: ${freq.toFixed(1)} Hz`;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: false }
          },
          y: {
            title: { display: true, text: '强度 (%)' },
            min: 0,
            max: 100
          }
        }
      }
    });
  }
}

import { AudioAnalyzer } from './modules/audioAnalyzer.js';
import { ChartManager } from './modules/chartManager.js';
import { UIController } from './modules/uiController.js';
import { RecordManager } from './modules/recordManager.js';
import { TimbreJudge } from './modules/timbreJudge.js';
import { VerdictView } from './modules/verdictView.js';
import { Logger } from './utils/logger.js';

// 初始化日志
const logger = new Logger('Main');

// 应用初始化
class App {
  constructor() {
    this.audioAnalyzer = null;
    this.chartManager = null;
    this.uiController = null;
    this.recordManager = null;
    this.timbreJudge = null;
    this.verdictView = null;
    this.audioBuffer = null;
    this.audioContext = null;
    this.currentAnalysisResult = null;
    this.currentFileName = '';
    this.selectedRecordId = null;
    // 同一段音频多个区间依次判定，并排进对比列表
    this.segments = [];
    this.activeSegmentId = null;
    this.segmentSeq = 0;
  }

  async init() {
    logger.info('应用初始化开始');

    try {
      // 初始化 AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // 初始化模块
      this.audioAnalyzer = new AudioAnalyzer(this.audioContext);
      this.chartManager = new ChartManager();
      this.uiController = new UIController();
      this.recordManager = new RecordManager();
      this.timbreJudge = new TimbreJudge();
      this.verdictView = new VerdictView();

      // 绑定事件
      this.bindEvents();
      this.bindCriteriaEvents();

      // 判定口径面板按持久化值回填（不依赖当前是否已加载文件）
      this.fillCriteriaForm();

      // 加载历史记录列表
      this.updateRecordsList();

      logger.info('应用初始化完成');
    } catch (error) {
      logger.error('应用初始化失败', error);
      alert('应用初始化失败，请刷新页面重试');
    }
  }

  bindEvents() {
    // 文件上传
    const uploadArea = document.getElementById('uploadArea');
    const audioInput = document.getElementById('audioInput');
    const removeFile = document.getElementById('removeFile');

    uploadArea.addEventListener('click', () => audioInput.click());
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) this.handleFileUpload(file);
    });

    audioInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleFileUpload(file);
    });

    removeFile.addEventListener('click', () => this.removeAudioFile());

    // 区间选择
    const startTime = document.getElementById('startTime');
    const endTime = document.getElementById('endTime');
    startTime.addEventListener('input', () => this.updateRangeSlider());
    endTime.addEventListener('input', () => this.updateRangeSlider());

    // 范围滑块拖拽
    this.initRangeSlider();

    // 分析按钮
    const analyzeBtn = document.getElementById('analyzeBtn');
    analyzeBtn.addEventListener('click', () => this.analyzeAudio());

    // 记录相关事件
    this.bindRecordEvents();
  }

  async handleFileUpload(file) {
    // 验证文件类型
    if (!file.type.startsWith('audio/')) {
      alert('请上传有效的音频文件');
      return;
    }

    this.currentFileName = file.name;
    logger.info('开始加载音频文件', { name: file.name, size: file.size });

    try {
      // 显示加载状态
      this.uiController.showLoading('正在加载音频...');

      // 读取文件
      const arrayBuffer = await file.arrayBuffer();
      
      // 解码音频
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // 更新 UI
      const duration = this.audioBuffer.duration;
      const durationMs = Math.floor(duration * 1000);

      document.getElementById('fileName').textContent = file.name;
      document.getElementById('fileInfo').style.display = 'flex';
      document.getElementById('uploadArea').style.display = 'none';

      // 设置音频播放器
      const audioPlayer = document.getElementById('audioPlayer');
      audioPlayer.src = URL.createObjectURL(file);
      document.getElementById('audioPlayerSection').style.display = 'block';
      document.getElementById('totalDuration').textContent = duration.toFixed(3);

      // 设置区间选择
      document.getElementById('startTime').value = 0;
      document.getElementById('startTime').max = durationMs;
      document.getElementById('endTime').value = durationMs;
      document.getElementById('endTime').max = durationMs;

      this.updateRangeSlider();

      // 换一个文件重新进入：清空多区间对比结果，但判定口径原样保留
      this.resetSegments();

      // 启用分析按钮
      document.getElementById('analyzeBtn').disabled = false;

      logger.info('音频文件加载成功', { duration, sampleRate: this.audioBuffer.sampleRate });
    } catch (error) {
      logger.error('音频文件加载失败', error);
      alert('音频文件加载失败，请确保文件格式正确');
    } finally {
      this.uiController.hideLoading();
    }
  }

  removeAudioFile() {
    this.audioBuffer = null;
    this.currentAnalysisResult = null;
    this.currentFileName = '';
    this.resetSegments();
    document.getElementById('audioInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('audioPlayerSection').style.display = 'none';
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('chartContainer').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('fundamentalInfo').style.display = 'none';
    document.getElementById('saveRecordSection').style.display = 'none';

    // 清除图表
    this.chartManager.clearAllCharts();

    logger.info('音频文件已移除');
  }

  /**
   * 清空多区间对比列表（判定口径不在此重置，换文件后保持原样）
   */
  resetSegments() {
    this.segments = [];
    this.activeSegmentId = null;
    this.currentAnalysisResult = null;
    this.verdictView.hideVerdictCard();
    this.verdictView.renderComparisonTable([], null);
  }

  initRangeSlider() {
    const track = document.getElementById('rangeTrack');
    const handleStart = document.getElementById('handleStart');
    const handleEnd = document.getElementById('handleEnd');
    let isDragging = null;

    const updateFromSlider = (clientX) => {
      const rect = track.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const maxMs = parseInt(document.getElementById('endTime').max) || 1000;
      const value = Math.round(percent * maxMs);

      if (isDragging === 'start') {
        const endValue = parseInt(document.getElementById('endTime').value);
        if (value < endValue) {
          document.getElementById('startTime').value = value;
        }
      } else if (isDragging === 'end') {
        const startValue = parseInt(document.getElementById('startTime').value);
        if (value > startValue) {
          document.getElementById('endTime').value = value;
        }
      }

      this.updateRangeSlider();
    };

    handleStart.addEventListener('mousedown', () => isDragging = 'start');
    handleEnd.addEventListener('mousedown', () => isDragging = 'end');

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        updateFromSlider(e.clientX);
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = null;
    });
  }

  updateRangeSlider() {
    let startTime = parseInt(document.getElementById('startTime').value) || 0;
    let endTime = parseInt(document.getElementById('endTime').value) || 0;
    const maxTime = parseInt(document.getElementById('endTime').max) || 1000;

    // 确保起始时间不大于结束时间
    if (startTime > endTime) {
      // 交换值
      const temp = startTime;
      startTime = endTime;
      endTime = temp;
      document.getElementById('startTime').value = startTime;
      document.getElementById('endTime').value = endTime;
    }

    // 确保值在有效范围内
    startTime = Math.max(0, Math.min(startTime, maxTime));
    endTime = Math.max(0, Math.min(endTime, maxTime));

    const startPercent = (startTime / maxTime) * 100;
    const endPercent = (endTime / maxTime) * 100;

    document.getElementById('handleStart').style.left = `${startPercent}%`;
    document.getElementById('handleEnd').style.left = `${endPercent}%`;
    document.getElementById('rangeSelected').style.left = `${startPercent}%`;
    document.getElementById('rangeSelected').style.width = `${Math.max(0, endPercent - startPercent)}%`;

    const durationSec = Math.max(0, endTime - startTime) / 1000;
    document.getElementById('selectedDuration').textContent = durationSec.toFixed(3);
  }

  async analyzeAudio() {
    if (!this.audioBuffer) {
      alert('请先上传音频文件');
      return;
    }

    const startMs = parseInt(document.getElementById('startTime').value) || 0;
    const endMs = parseInt(document.getElementById('endTime').value) || 0;

    if (startMs >= endMs) {
      alert('请选择有效的时间区间');
      return;
    }

    logger.info('开始分析音频', { startMs, endMs });

    try {
      this.uiController.showLoading('正在分析音频...');

      // 获取 FFT 大小
      const fftSize = parseInt(document.getElementById('fftSize').value);

      // 提取选定区间的音频数据
      const startSample = Math.floor((startMs / 1000) * this.audioBuffer.sampleRate);
      const endSample = Math.floor((endMs / 1000) * this.audioBuffer.sampleRate);
      const channelData = this.audioBuffer.getChannelData(0);
      const selectedData = channelData.slice(startSample, endSample);

      // 分析音频
      const analysisResult = await this.audioAnalyzer.analyze(selectedData, this.audioBuffer.sampleRate, fftSize);

      logger.info('音频分析完成', {
        fundamentalFreq: analysisResult.fundamentalFreq,
        harmonicsCount: analysisResult.harmonics.length
      });

      // 按谐波说话的音色判定（自相关法 + 峰值检测互证）
      const verdict = this.timbreJudge.judge({
        autocorrFreq: analysisResult.autocorrFreq,
        peakFreq: analysisResult.peakFreq,
        frequencies: analysisResult.rawFrequencies,
        magnitudes: analysisResult.rawMagnitudes,
        resolution: analysisResult.frequencyResolution,
        rms: analysisResult.rms
      });
      analysisResult.verdict = verdict;

      // 保存当前分析结果
      this.currentAnalysisResult = analysisResult;

      // 更新图表
      this.chartManager.updateAllCharts(analysisResult, selectedData, this.audioBuffer.sampleRate);

      // 更新基频信息
      this.updateFundamentalInfo(analysisResult);

      // 该区间进入多区间对比列表（依次追加，并排比较）
      this.addSegment({
        startMs,
        endMs,
        fftSize,
        audioData: selectedData,
        sampleRate: this.audioBuffer.sampleRate,
        analysisResult,
        verdict
      });

      if (verdict.insufficient) {
        this.uiController.showToast('该区间谐波数据不足，请重选持续稳定的区间，未判为不合格', 'warning');
      } else {
        const labelMap = { pass: '合格', doubt: '存疑', fail: '不合格' };
        this.uiController.showToast(`音色判定：${labelMap[verdict.tier]}`, verdict.tier === 'fail' ? 'error' : verdict.tier === 'doubt' ? 'warning' : 'success');
      }

    } catch (error) {
      logger.error('音频分析失败', error);
      alert('音频分析失败: ' + error.message);
    } finally {
      this.uiController.hideLoading();
    }
  }

  updateFundamentalInfo(result) {
    document.getElementById('fundamentalInfo').style.display = 'block';
    document.getElementById('fundamentalFreq').textContent = result.fundamentalFreq.toFixed(2);

    const harmonicsList = document.getElementById('harmonicsList');
    harmonicsList.innerHTML = result.harmonics.map((h, i) => `
      <div class="harmonic-item">
        <span class="harmonic-label">${i + 2}倍频</span>
        <span class="harmonic-freq">${h.toFixed(1)} Hz</span>
      </div>
    `).join('');
  }

  /**
   * 追加一个已判定区间，并渲染对比表与判定卡
   */
  addSegment(segment) {
    // 同区间重复分析时替换旧记录，避免堆积
    const existingIndex = this.segments.findIndex(s =>
      s.startMs === segment.startMs && s.endMs === segment.endMs);
    const id = existingIndex >= 0
      ? this.segments[existingIndex].id
      : `seg-${Date.now()}-${++this.segmentSeq}`;

    const stored = { id, ...segment };
    if (existingIndex >= 0) {
      this.segments[existingIndex] = stored;
    } else {
      const MAX_SEGMENTS = 20;
      if (this.segments.length >= MAX_SEGMENTS) {
        this.segments.shift();
        this.uiController.showToast(`对比区间最多保留 ${MAX_SEGMENTS} 段，已移除最早的一段`, 'warning');
      }
      this.segments.push(stored);
    }
    this.activeSegmentId = id;
    this.activateSegment(id);
  }

  /**
   * 激活某段：恢复该段图表、结果与判定卡
   */
  activateSegment(id) {
    const seg = this.segments.find(s => s.id === id);
    if (!seg) return;
    this.activeSegmentId = id;
    this.currentAnalysisResult = seg.analysisResult;

    document.getElementById('startTime').value = seg.startMs;
    document.getElementById('endTime').value = seg.endMs;
    this.updateRangeSlider();

    this.chartManager.updateAllCharts(seg.analysisResult, seg.audioData, seg.sampleRate);
    this.updateFundamentalInfo(seg.analysisResult);
    this.verdictView.renderVerdictCard(seg, this.timbreJudge);
    this.verdictView.renderComparisonTable(this.segments, this.activeSegmentId);

    document.getElementById('chartContainer').style.display = 'flex';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('saveRecordSection').style.display = 'block';
    document.getElementById('recordName').value = `${this.currentFileName} ${(seg.startMs / 1000).toFixed(2)}s-${(seg.endMs / 1000).toFixed(2)}s - ${this.recordManager.formatTimestamp()}`;
    document.getElementById('recordNote').value = '';
  }

  removeSegment(id) {
    const idx = this.segments.findIndex(s => s.id === id);
    if (idx === -1) return;
    this.segments.splice(idx, 1);

    if (this.activeSegmentId === id) {
      const next = this.segments[0] || null;
      if (next) {
        this.activateSegment(next.id);
        return;
      }
      this.activeSegmentId = null;
      this.currentAnalysisResult = null;
      this.verdictView.hideVerdictCard();
      document.getElementById('chartContainer').style.display = 'none';
      document.getElementById('saveRecordSection').style.display = 'none';
      document.getElementById('emptyState').style.display = 'flex';
    }
    this.verdictView.renderComparisonTable(this.segments, this.activeSegmentId);
  }

  bindCompareEvents() {
    document.getElementById('clearCompareBtn').addEventListener('click', () => {
      this.resetSegments();
      document.getElementById('chartContainer').style.display = 'none';
      document.getElementById('saveRecordSection').style.display = 'none';
      document.getElementById('emptyState').style.display = 'flex';
      this.uiController.showToast('已清空对比区间（判定口径保留）', 'info');
    });

    this.verdictView.compareBody.addEventListener('click', (e) => {
      const loadBtn = e.target.closest('.btn-row-load');
      const removeBtn = e.target.closest('.btn-row-remove');
      const row = e.target.closest('.compare-row');
      if (loadBtn) {
        this.activateSegment(loadBtn.dataset.id);
      } else if (removeBtn) {
        this.removeSegment(removeBtn.dataset.id);
      } else if (row) {
        this.activateSegment(row.dataset.id);
      }
    });
  }

  /**
   * 判定口径面板：回填、保存、重判
   */
  fillCriteriaForm() {
    const c = this.timbreJudge.criteria;
    document.getElementById('criteriaPitchPass').value = c.pitchPassCents;
    document.getElementById('criteriaPitchDoubt').value = c.pitchDoubtCents;
    document.getElementById('criteriaDecayPassMin').value = c.decayPassMin;
    document.getElementById('criteriaDecayPassMax').value = c.decayPassMax;
    document.getElementById('criteriaDecayDoubtMin').value = c.decayDoubtMin;
    document.getElementById('criteriaDecayDoubtMax').value = c.decayDoubtMax;
    document.getElementById('criteriaMinHarmonics').value = c.minHarmonics;
    document.getElementById('criteriaAgreement').value = c.agreementCents;
    document.getElementById('criteriaNoiseFloor').value = c.noiseFloorDb;
    document.getElementById('criteriaMinRms').value = c.minRms;
  }

  readCriteriaForm() {
    const num = (id) => {
      const v = parseFloat(document.getElementById(id).value);
      return Number.isFinite(v) ? v : undefined;
    };
    return {
      pitchPassCents: num('criteriaPitchPass'),
      pitchDoubtCents: num('criteriaPitchDoubt'),
      decayPassMin: num('criteriaDecayPassMin'),
      decayPassMax: num('criteriaDecayPassMax'),
      decayDoubtMin: num('criteriaDecayDoubtMin'),
      decayDoubtMax: num('criteriaDecayDoubtMax'),
      minHarmonics: num('criteriaMinHarmonics'),
      agreementCents: num('criteriaAgreement'),
      noiseFloorDb: num('criteriaNoiseFloor'),
      minRms: num('criteriaMinRms')
    };
  }

  saveCriteriaFromForm() {
    const partial = this.readCriteriaForm();
    this.timbreJudge.saveCriteria(partial);
    this.fillCriteriaForm(); // 用归一化后的值回填，修正越界/端点倒置
    this.rejudgeSegments();
  }

  /**
   * 口径变更后用新口径重判所有对比区间
   */
  rejudgeSegments() {
    if (this.segments.length === 0) return;
    for (const seg of this.segments) {
      const r = seg.analysisResult;
      const verdict = this.timbreJudge.judge({
        autocorrFreq: r.autocorrFreq,
        peakFreq: r.peakFreq,
        frequencies: r.rawFrequencies,
        magnitudes: r.rawMagnitudes,
        resolution: r.frequencyResolution,
        rms: r.rms
      });
      seg.verdict = verdict;
      r.verdict = verdict;
    }
    if (this.activeSegmentId) {
      const seg = this.segments.find(s => s.id === this.activeSegmentId);
      if (seg) this.verdictView.renderVerdictCard(seg, this.timbreJudge);
    }
    this.verdictView.renderComparisonTable(this.segments, this.activeSegmentId);
    this.uiController.showToast('已按新口径重判全部对比区间', 'success');
  }

  bindCriteriaEvents() {
    const fieldIds = [
      'criteriaPitchPass', 'criteriaPitchDoubt',
      'criteriaDecayPassMin', 'criteriaDecayPassMax',
      'criteriaDecayDoubtMin', 'criteriaDecayDoubtMax',
      'criteriaMinHarmonics', 'criteriaAgreement',
      'criteriaNoiseFloor', 'criteriaMinRms'
    ];
    fieldIds.forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.saveCriteriaFromForm());
    });

    document.getElementById('resetCriteriaBtn').addEventListener('click', () => {
      this.timbreJudge.resetCriteria();
      this.fillCriteriaForm();
      this.rejudgeSegments();
      this.uiController.showToast('判定口径已恢复默认', 'info');
    });

    this.bindCompareEvents();
  }

  bindRecordEvents() {
    // 保存记录按钮
    document.getElementById('saveRecordBtn').addEventListener('click', () => this.saveRecord());

    // 展开/收起记录列表
    document.getElementById('toggleRecordsBtn').addEventListener('click', () => this.toggleRecordsPanel());

    // 关闭模态框
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeRecordModal());
    document.getElementById('recordDetailModal').addEventListener('click', (e) => {
      if (e.target.id === 'recordDetailModal') {
        this.closeRecordModal();
      }
    });

    // 应用记录
    document.getElementById('applyRecordBtn').addEventListener('click', () => this.applyRecord());

    // 删除记录
    document.getElementById('deleteRecordBtn').addEventListener('click', () => this.deleteRecord());
  }

  saveRecord() {
    if (!this.currentAnalysisResult) {
      this.uiController.showToast('没有可保存的分析结果', 'warning');
      return;
    }

    const name = document.getElementById('recordName').value.trim();
    const note = document.getElementById('recordNote').value.trim();
    const startMs = parseInt(document.getElementById('startTime').value) || 0;
    const endMs = parseInt(document.getElementById('endTime').value) || 0;

    const harmonicIntensities = this.extractHarmonicIntensities(this.currentAnalysisResult);

    try {
      const record = this.recordManager.createRecord({
        fileName: this.currentFileName,
        startMs,
        endMs,
        fundamentalFreq: this.currentAnalysisResult.fundamentalFreq,
        harmonics: this.currentAnalysisResult.harmonics,
        harmonicIntensities,
        analysisResult: this.currentAnalysisResult,
        verdict: this.currentAnalysisResult.verdict || null,
        name: name
      });

      if (note) {
        this.recordManager.updateRecord(record.id, { note });
      }

      this.uiController.showToast('记录保存成功', 'success');
      this.updateRecordsList();
    } catch (error) {
      this.uiController.showToast(error.message, 'error');
    }
  }

  extractHarmonicIntensities(analysisResult) {
    const { fundamentalFreq, harmonics, frequencies, magnitudes } = analysisResult;
    const allHarmonics = [fundamentalFreq, ...harmonics];
    const intensities = {};

    allHarmonics.forEach((harmonic, index) => {
      let closestMag = 0;
      let minDist = Infinity;

      for (let i = 0; i < frequencies.length; i++) {
        const dist = Math.abs(frequencies[i] - harmonic);
        if (dist < minDist) {
          minDist = dist;
          closestMag = magnitudes[i];
        }
      }

      const key = index === 0 ? 'fundamental' : `harmonic${index + 1}`;
      intensities[key] = closestMag;
    });

    const maxMag = Math.max(...Object.values(intensities));
    const normalizedIntensities = {};
    Object.keys(intensities).forEach(key => {
      normalizedIntensities[key] = maxMag > 0 ? (intensities[key] / maxMag) * 100 : 0;
    });

    return normalizedIntensities;
  }

  updateRecordsList() {
    const records = this.recordManager.getAllRecords();
    const recordsList = document.getElementById('recordsList');
    const recordsEmpty = document.getElementById('recordsEmpty');

    if (records.length === 0) {
      recordsList.style.display = 'none';
      recordsEmpty.style.display = 'flex';
      return;
    }

    recordsList.style.display = 'block';
    recordsEmpty.style.display = 'none';

    recordsList.innerHTML = records.map(record => `
      <div class="record-item" data-id="${record.id}">
        <div class="record-main">
          <span class="record-name" title="${record.name}">${this.truncateText(record.name, 25)}</span>
          <span class="record-freq">${record.fundamentalFreq.toFixed(1)} Hz</span>
          ${record.verdict ? this.verdictView.badgeHtml(record.verdict.tier, 'badge-sm') : ''}
        </div>
        <div class="record-meta">
          <span class="record-file" title="${record.fileName}">${this.truncateText(record.fileName, 20)}</span>
          <span class="record-time">${this.recordManager.formatDate(record.createdAt)}</span>
        </div>
      </div>
    `).join('');

    recordsList.querySelectorAll('.record-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        this.showRecordDetail(id);
      });
    });
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  toggleRecordsPanel() {
    const content = document.getElementById('recordsContent');
    const btn = document.getElementById('toggleRecordsBtn');
    
    if (content.style.display === 'none') {
      content.style.display = 'block';
      btn.textContent = '▼';
    } else {
      content.style.display = 'none';
      btn.textContent = '▶';
    }
  }

  showRecordDetail(recordId) {
    const record = this.recordManager.getRecord(recordId);
    if (!record) return;

    this.selectedRecordId = recordId;

    const modalBody = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = record.name;

    modalBody.innerHTML = `
      <div class="record-detail">
        <div class="detail-section">
          <h4>基本信息</h4>
          <div class="detail-grid">
            <div class="detail-item">
              <span class="detail-label">文件名</span>
              <span class="detail-value">${record.fileName}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">创建时间</span>
              <span class="detail-value">${this.recordManager.formatTimestampFull(record.createdAt)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">分析区间</span>
              <span class="detail-value">${record.startMs}ms - ${record.endMs}ms (${(record.durationMs / 1000).toFixed(3)}s)</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">基频</span>
              <span class="detail-value highlight">${record.fundamentalFreq.toFixed(2)} Hz</span>
            </div>
          </div>
        </div>
        
        <div class="detail-section">
          <h4>倍频与强度</h4>
          <div class="harmonics-table">
            <div class="table-header">
              <span>谐波</span>
              <span>频率</span>
              <span>相对强度</span>
            </div>
            <div class="table-row">
              <span>基频</span>
              <span>${record.fundamentalFreq.toFixed(1)} Hz</span>
              <span>
                <div class="intensity-bar">
                  <div class="intensity-fill" style="width: ${record.harmonicIntensities?.fundamental || 100}%"></div>
                  <span class="intensity-text">${(record.harmonicIntensities?.fundamental || 100).toFixed(1)}%</span>
                </div>
              </span>
            </div>
            ${record.harmonics.map((h, i) => {
              const intensityKey = `harmonic${i + 2}`;
              const intensity = record.harmonicIntensities?.[intensityKey] || 0;
              return `
                <div class="table-row">
                  <span>${i + 2}倍频</span>
                  <span>${h.toFixed(1)} Hz</span>
                  <span>
                    <div class="intensity-bar">
                      <div class="intensity-fill" style="width: ${intensity}%"></div>
                      <span class="intensity-text">${intensity.toFixed(1)}%</span>
                    </div>
                  </span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        ${record.verdict ? this.verdictView.renderModalVerdict(record.verdict) : ''}

        ${record.note ? `
          <div class="detail-section">
            <h4>备注</h4>
            <p class="record-note">${record.note}</p>
          </div>
        ` : ''}
      </div>
    `;

    document.getElementById('recordDetailModal').style.display = 'flex';
  }

  closeRecordModal() {
    document.getElementById('recordDetailModal').style.display = 'none';
    this.selectedRecordId = null;
  }

  applyRecord() {
    if (!this.selectedRecordId) return;

    const record = this.recordManager.getRecord(this.selectedRecordId);
    if (!record) return;

    if (!record.analysisResult) {
      this.uiController.showToast('该记录不包含完整的分析数据', 'warning');
      return;
    }

    this.currentAnalysisResult = record.analysisResult;

    const fakeAudioData = new Float32Array(1000).fill(0);
    const sampleRate = 44100;
    this.chartManager.updateAllCharts(record.analysisResult, fakeAudioData, sampleRate);
    this.updateFundamentalInfo(record.analysisResult);

    // 历史记录里的判定结果（携带判定时的口径快照）
    if (record.analysisResult.verdict) {
      this.verdictView.renderVerdictCard(
        { verdict: record.analysisResult.verdict },
        this.timbreJudge
      );
    } else {
      this.verdictView.hideVerdictCard();
    }

    document.getElementById('chartContainer').style.display = 'flex';
    document.getElementById('emptyState').style.display = 'none';

    this.closeRecordModal();
    this.uiController.showToast('记录已应用', 'success');
  }

  deleteRecord() {
    if (!this.selectedRecordId) return;

    if (confirm('确定要删除这条记录吗？此操作不可恢复。')) {
      const success = this.recordManager.deleteRecord(this.selectedRecordId);
      if (success) {
        this.updateRecordsList();
        this.closeRecordModal();
        this.uiController.showToast('记录已删除', 'success');
      } else {
        this.uiController.showToast('删除失败', 'error');
      }
    }
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});

import { AudioAnalyzer } from './modules/audioAnalyzer.js';
import { ChartManager } from './modules/chartManager.js';
import { UIController } from './modules/uiController.js';
import { RecordManager } from './modules/recordManager.js';
import { TimbreAssessor, GRADES } from './modules/timbreAssessor.js';
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
    this.timbreAssessor = null;
    this.audioBuffer = null;
    this.audioContext = null;
    this.currentAnalysisResult = null;
    this.currentFileName = '';
    this.selectedRecordId = null;
    this.assessments = [];
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
      this.timbreAssessor = new TimbreAssessor();

      // 绑定事件
      this.bindEvents();

      // 初始化判定口径表单（口径持久化，跨文件保留）
      this.initCriteriaForm();

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

    // 音色判定按钮
    document.getElementById('assessBtn').addEventListener('click', () => this.assessCurrentSegment());

    // 清空判定列表
    document.getElementById('clearAssessmentsBtn').addEventListener('click', () => this.clearAssessments());

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

      // 启用分析与判定按钮
      document.getElementById('analyzeBtn').disabled = false;
      document.getElementById('assessBtn').disabled = false;

      // 更换文件后清空区间判定列表（判定口径保留不变）
      this.resetAssessments();

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
    document.getElementById('audioInput').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('audioPlayerSection').style.display = 'none';
    document.getElementById('analyzeBtn').disabled = true;
    document.getElementById('assessBtn').disabled = true;
    document.getElementById('chartContainer').style.display = 'none';
    document.getElementById('emptyState').style.display = 'flex';
    document.getElementById('fundamentalInfo').style.display = 'none';
    document.getElementById('saveRecordSection').style.display = 'none';

    // 清空区间判定列表（判定口径保留不变）
    this.resetAssessments();
    
    // 清除图表
    this.chartManager.clearAllCharts();

    logger.info('音频文件已移除');
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

      // 保存当前分析结果
      this.currentAnalysisResult = analysisResult;

      // 更新图表
      this.chartManager.updateAllCharts(analysisResult, selectedData, this.audioBuffer.sampleRate);

      // 更新基频信息
      this.updateFundamentalInfo(analysisResult);

      // 显示图表区域
      document.getElementById('chartContainer').style.display = 'flex';
      document.getElementById('emptyState').style.display = 'none';

      // 显示保存记录区域
      document.getElementById('saveRecordSection').style.display = 'block';
      document.getElementById('recordName').value = `${this.currentFileName} - ${this.recordManager.formatTimestamp()}`;
      document.getElementById('recordNote').value = '';

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
   * 初始化判定口径表单 - 口径存 localStorage，更换文件后原样保留
   */
  initCriteriaForm() {
    this.fillCriteriaForm(this.timbreAssessor.criteria);

    // 展开/收起口径表单
    document.getElementById('criteriaToggle').addEventListener('click', () => {
      const form = document.getElementById('criteriaForm');
      const icon = document.getElementById('criteriaToggleIcon');
      const collapsed = form.style.display === 'none';
      form.style.display = collapsed ? 'block' : 'none';
      icon.textContent = collapsed ? '▼' : '▶';
    });

    // 口径修改即保存
    const fieldMap = {
      critPitchGood: 'pitchGoodCents',
      critPitchWarn: 'pitchWarnCents',
      critDecayGoodMin: 'decayGoodMin',
      critDecayGoodMax: 'decayGoodMax',
      critDecayWarnMin: 'decayWarnMin',
      critDecayWarnMax: 'decayWarnMax',
      critMinRatio: 'minHarmonicRatioPct',
      critMinCount: 'minDetectableCount'
    };

    Object.entries(fieldMap).forEach(([elementId, key]) => {
      document.getElementById(elementId).addEventListener('change', (e) => {
        const updated = this.timbreAssessor.updateCriteria({ [key]: e.target.value });
        // 自动修正（如合格档宽于存疑档）后回显
        this.fillCriteriaForm(updated);
        logger.info('判定口径已更新', updated);
      });
    });

    // 恢复默认口径
    document.getElementById('resetCriteriaBtn').addEventListener('click', () => {
      const defaults = this.timbreAssessor.resetCriteria();
      this.fillCriteriaForm(defaults);
      this.uiController.showToast('判定口径已恢复默认', 'success');
    });
  }

  /**
   * 把口径值填进表单
   */
  fillCriteriaForm(criteria) {
    document.getElementById('critPitchGood').value = criteria.pitchGoodCents;
    document.getElementById('critPitchWarn').value = criteria.pitchWarnCents;
    document.getElementById('critDecayGoodMin').value = criteria.decayGoodMin;
    document.getElementById('critDecayGoodMax').value = criteria.decayGoodMax;
    document.getElementById('critDecayWarnMin').value = criteria.decayWarnMin;
    document.getElementById('critDecayWarnMax').value = criteria.decayWarnMax;
    document.getElementById('critMinRatio').value = criteria.minHarmonicRatioPct;
    document.getElementById('critMinCount').value = criteria.minDetectableCount;
  }

  /**
   * 判定当前选中区间的音色，结果追加进对比列表
   */
  async assessCurrentSegment() {
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

    logger.info('开始音色判定', { startMs, endMs });

    try {
      this.uiController.showLoading('正在判定音色...');

      const fftSize = parseInt(document.getElementById('fftSize').value);
      const startSample = Math.floor((startMs / 1000) * this.audioBuffer.sampleRate);
      const endSample = Math.floor((endMs / 1000) * this.audioBuffer.sampleRate);
      const channelData = this.audioBuffer.getChannelData(0);
      const selectedData = channelData.slice(startSample, endSample);

      // 轻量分析 + 判定
      const segmentAnalysis = this.audioAnalyzer.analyzeSegmentForAssessment(
        selectedData, this.audioBuffer.sampleRate, fftSize
      );
      const result = this.timbreAssessor.assess(segmentAnalysis, { startMs, endMs });
      result.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);

      // 追加进对比列表
      this.assessments.push(result);

      // 渲染当前结果与对比列表
      this.renderAssessmentCurrent(result);
      this.renderAssessmentList();

      document.getElementById('assessmentContainer').style.display = 'block';
      document.getElementById('emptyState').style.display = 'none';

      if (result.status === 'insufficient') {
        this.uiController.showToast('数据不足：谐波能量太弱，请重新选择区间', 'warning');
      } else {
        const label = GRADES[result.grade].label;
        const toastType = result.grade === 0 ? 'success' : (result.grade === 1 ? 'warning' : 'error');
        this.uiController.showToast(`音色判定：${label}`, toastType);
      }
    } catch (error) {
      logger.error('音色判定失败', error);
      alert('音色判定失败: ' + error.message);
    } finally {
      this.uiController.hideLoading();
    }
  }

  /**
   * 渲染当前区间的判定结果（判定口径写在结果旁）
   */
  renderAssessmentCurrent(result) {
    const container = document.getElementById('assessmentCurrent');

    if (result.status === 'insufficient') {
      container.innerHTML = `
        <div class="assessment-card grade-insufficient">
          <div class="assessment-grade-badge">数据不足</div>
          <div class="assessment-details">
            <div class="assessment-row">
              <span class="assessment-label">区间</span>
              <span class="assessment-value">${result.startMs} – ${result.endMs} ms</span>
            </div>
            <div class="assessment-row">
              <span class="assessment-label">说明</span>
              <span class="assessment-value">谐波能量太弱，无法可靠判定音色，不作不合格处理。请重新选择包含稳定发音的区间后再判定。</span>
            </div>
            <div class="assessment-row">
              <span class="assessment-label">原因</span>
              <span class="assessment-value">${result.insufficientReasons.join('；')}</span>
            </div>
          </div>
          <p class="assessment-criteria">${result.criteriaText}</p>
        </div>
      `;
      return;
    }

    const grade = GRADES[result.grade];
    const a = result.methods.autocorr;
    const p = result.methods.peak;
    const agreeText = result.agreed
      ? `自相关法与峰值检测结论一致（均为${grade.label}）`
      : `自相关法判${GRADES[a.grade].label}、峰值检测判${GRADES[p.grade].label}，不一致，按较保守档定为${grade.label}`;

    container.innerHTML = `
      <div class="assessment-card grade-${grade.key}">
        <div class="assessment-grade-badge">${grade.label}</div>
        <div class="assessment-details">
          <div class="assessment-row">
            <span class="assessment-label">区间</span>
            <span class="assessment-value">${result.startMs} – ${result.endMs} ms</span>
          </div>
          <div class="assessment-row">
            <span class="assessment-label">音准偏差</span>
            <span class="assessment-value">自相关 ${this.formatCents(a.note.cents)}（最近音 ${a.note.name}），峰值 ${this.formatCents(p.note.cents)}（最近音 ${p.note.name}）</span>
          </div>
          <div class="assessment-row">
            <span class="assessment-label">谐波衰减</span>
            <span class="assessment-value">自相关 ${this.formatSlope(a.slope)}，峰值 ${this.formatSlope(p.slope)}（第 3~8 次谐波）</span>
          </div>
          <div class="assessment-row">
            <span class="assessment-label">相互印证</span>
            <span class="assessment-value">${agreeText}</span>
          </div>
        </div>
        <p class="assessment-criteria">${result.criteriaText}</p>
      </div>
    `;
  }

  /**
   * 渲染区间对比列表，超出参考范围的行单独标出
   */
  renderAssessmentList() {
    const tbody = document.getElementById('assessmentTableBody');
    const wrapper = document.getElementById('assessmentTableWrapper');
    const empty = document.getElementById('assessmentEmpty');
    document.getElementById('assessmentCount').textContent = this.assessments.length;

    if (this.assessments.length === 0) {
      wrapper.style.display = 'none';
      empty.style.display = 'flex';
      return;
    }

    wrapper.style.display = 'block';
    empty.style.display = 'none';

    tbody.innerHTML = this.assessments.map((r, i) => {
      if (r.status === 'insufficient') {
        return `
          <tr class="out-of-range grade-insufficient" title="${r.insufficientReasons.join('；')}">
            <td>${i + 1}</td>
            <td>${r.startMs} – ${r.endMs}</td>
            <td>${r.fundamental ? r.fundamental.toFixed(1) : '—'}</td>
            <td>—</td>
            <td>—</td>
            <td><span class="grade-tag grade-insufficient">数据不足</span></td>
          </tr>
        `;
      }

      const grade = GRADES[r.grade];
      const a = r.methods.autocorr;
      const p = r.methods.peak;
      // 合格在参考范围内，其余档位（存疑/不合格）单独标出
      const rowClass = r.grade === 0 ? '' : `out-of-range grade-${grade.key}`;
      const flag = r.grade === 0 ? '' : '<span class="range-flag" title="超出参考范围">⚠</span>';

      return `
        <tr class="${rowClass}">
          <td>${i + 1}</td>
          <td>${r.startMs} – ${r.endMs}</td>
          <td>${a.fundamental.toFixed(1)} / ${p.fundamental.toFixed(1)}</td>
          <td>${this.formatCents(a.note.cents)} / ${this.formatCents(p.note.cents)}</td>
          <td>${this.formatSlope(a.slope)} / ${this.formatSlope(p.slope)}</td>
          <td>${flag}<span class="grade-tag grade-${grade.key}">${grade.label}</span></td>
        </tr>
      `;
    }).join('');
  }

  /**
   * 清空判定列表（换文件或点清空时调用，不影响判定口径）
   */
  resetAssessments() {
    this.assessments = [];
    document.getElementById('assessmentContainer').style.display = 'none';
    document.getElementById('assessmentCurrent').innerHTML = '';
    this.renderAssessmentList();
  }

  clearAssessments() {
    this.resetAssessments();
    this.uiController.showToast('判定列表已清空', 'info');
    logger.info('判定列表已清空');
  }

  /**
   * 格式化音分偏差（带正负号）
   */
  formatCents(cents) {
    const sign = cents >= 0 ? '+' : '−';
    return `${sign}${Math.abs(cents).toFixed(1)}`;
  }

  /**
   * 格式化衰减斜率
   */
  formatSlope(slope) {
    if (slope === null || slope === undefined) return '—';
    return `${slope.toFixed(1)}`;
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

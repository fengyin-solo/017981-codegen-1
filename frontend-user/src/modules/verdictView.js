import { Logger } from '../utils/logger.js';
import { TIER_LABELS, TIMBRE_TIERS, TimbreJudge } from './timbreJudge.js';

const logger = new Logger('VerdictView');

/**
 * 判定结果视图 - 判定卡、多区间对比表、记录详情中的判定摘要
 * 纯渲染模块，不持有业务状态
 */
export class VerdictView {
  constructor() {
    this.verdictCard = document.getElementById('verdictCard');
    this.verdictBadge = document.getElementById('verdictBadge');
    this.verdictBody = document.getElementById('verdictBody');
    this.verdictCriteria = document.getElementById('verdictCriteria');
    this.compareSection = document.getElementById('compareSection');
    this.compareBody = document.getElementById('compareBody');
    this.compareCount = document.getElementById('compareCount');
  }

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  badgeHtml(tier, extraClass = '') {
    return `<span class="verdict-badge tier-${tier} ${extraClass}">${TIER_LABELS[tier] || '—'}</span>`;
  }

  metricCellHtml(tier, content) {
    const cls = tier === TIMBRE_TIERS.FAIL
      ? 'metric-fail'
      : tier === TIMBRE_TIERS.DOUBT ? 'metric-doubt' : 'metric-pass';
    return `<span class="${cls}">${content}</span>`;
  }

  /**
   * 渲染单段判定卡（"判定口径写在结果旁"）
   */
  renderVerdictCard(segment, judge) {
    const verdict = segment.verdict;
    this.verdictCard.style.display = 'block';
    this.verdictBadge.className = `verdict-badge-large tier-${verdict.tier}`;
    this.verdictBadge.textContent = TIER_LABELS[verdict.tier];

    const c = verdict.criteria;
    // 判定口径始终随结果一起展示
    this.verdictCriteria.innerHTML = `
      <div class="criteria-title">判定口径（当前生效）</div>
      <ul class="criteria-list">
        ${judge.describeCriteria(c).map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}
      </ul>`;

    if (verdict.insufficient) {
      this.verdictBody.innerHTML = `
        <div class="verdict-insufficient">
          <p class="insufficient-title">数据不足，暂不判不合格</p>
          <ul class="reason-list">
            ${verdict.reasons.map(r => `<li>${this.escapeHtml(r)}</li>`).join('')}
          </ul>
          <p class="suggestion">${verdict.suggestions.map(s => this.escapeHtml(s)).join('')}</p>
          <div class="method-mini-grid">
            ${this.methodSummaryHtml(verdict.methods.autocorrelation, '自相关法')}
            ${this.methodSummaryHtml(verdict.methods.peak, '峰值检测')}
          </div>
        </div>`;
      return;
    }

    const primary = verdict.methods.autocorrelation.valid
      && verdict.methods.peak.valid
      ? verdict.methods[verdict.primaryMethod]
      : (verdict.methods.autocorrelation.valid
        ? verdict.methods.autocorrelation
        : verdict.methods.peak);

    this.verdictBody.innerHTML = `
      <div class="verdict-summary-grid">
        <div class="summary-item">
          <span class="summary-label">音准偏差</span>
          <span class="summary-value ${this.tierTextClass(verdict.pitchTier)}">
            ${verdict.pitchCents === null ? '—' : `${verdict.pitchCents.toFixed(0)} 音分`}
          </span>
          <span class="summary-ref">合格≤${c.pitchPassCents} / 存疑≤${c.pitchDoubtCents}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">谐波衰减</span>
          <span class="summary-value ${this.tierTextClass(verdict.decayTier)}">
            ${verdict.slope === null ? '—' : `${verdict.slope.toFixed(1)} dB/倍频程`}
          </span>
          <span class="summary-ref">合格 ${c.decayPassMin}~${c.decayPassMax} / 存疑 ${c.decayDoubtMin}~${c.decayDoubtMax}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">两路基频差</span>
          <span class="summary-value ${verdict.mutual ? 'tier-text-pass' : 'tier-text-doubt'}">
            ${verdict.agreementCents === null ? '—' : `${verdict.agreementCents.toFixed(0)} 音分`}
          </span>
          <span class="summary-ref">互证阈值 ≤${c.agreementCents} 音分 · ${verdict.mutual ? '已互相印证' : '不一致，按保守档'}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">最近律音</span>
          <span class="summary-value">${primary && primary.note ? this.escapeHtml(primary.note.name) : '—'}</span>
          <span class="summary-ref">十二平均律 ${primary && primary.note ? `${primary.note.freq.toFixed(1)} Hz` : ''}</span>
        </div>
      </div>

      <div class="method-columns">
        ${this.methodColumnHtml(verdict.methods.autocorrelation, '自相关法', c)}
        ${this.methodColumnHtml(verdict.methods.peak, '峰值检测', c)}
      </div>

      ${verdict.reasons.length ? `
        <ul class="reason-list">
          ${verdict.reasons.map(r => `<li>${this.escapeHtml(r)}</li>`).join('')}
        </ul>` : ''}
    `;
  }

  methodSummaryHtml(method, label) {
    return `
      <div class="method-mini">
        <span class="method-mini-name">${label}</span>
        <span class="method-mini-text">${this.escapeHtml(method.reason || `${method.detectedCount}/6 谐波可测`)}</span>
      </div>`;
  }

  methodColumnHtml(method, label, c) {
    if (!method.valid) {
      return `
        <div class="method-column method-invalid">
          <div class="method-column-head">
            <span class="method-name">${label}</span>
            ${this.badgeHtml(TIMBRE_TIERS.INSUFFICIENT)}
          </div>
          <p class="method-reason">${this.escapeHtml(method.reason)}</p>
          <p class="method-f0">基频 ${Number.isFinite(method.f0) && method.f0 > 0 ? `${method.f0.toFixed(1)} Hz` : '未检出'}</p>
        </div>`;
    }
    const miniBars = method.levels.map(l => `
      <div class="mini-bar-row" title="${l.n}倍频 ${l.peakFreq.toFixed(1)}Hz，${l.levelDb.toFixed(1)}dB">
        <span class="mini-bar-label">${l.n}次</span>
        <span class="mini-bar-track">
          <span class="mini-bar-fill ${l.detected ? '' : 'undetectable'}"
            style="width:${l.detected ? Math.max(2, Math.min(100, (1 + l.levelDb / c.noiseFloorDb) * 100)) : 0}%"></span>
        </span>
        <span class="mini-bar-val">${l.detected ? `${l.levelDb.toFixed(0)}dB` : '—'}</span>
      </div>`).join('');

    return `
      <div class="method-column">
        <div class="method-column-head">
          <span class="method-name">${label}</span>
          ${this.badgeHtml(method.tier)}
        </div>
        <p class="method-f0">
          基频 <strong>${method.f0.toFixed(1)} Hz</strong>
          · 近 ${this.escapeHtml(method.note.name)} (${method.note.freq.toFixed(1)}Hz)
          · ${method.note.cents >= 0 ? '+' : ''}${method.note.cents.toFixed(0)}音分
        </p>
        <div class="method-tiers">
          <span>音准 ${this.badgeHtml(method.pitchTier)}</span>
          <span>衰减 ${this.badgeHtml(method.decayTier)}</span>
          <span class="slope-val">斜率 ${method.slope.toFixed(1)}</span>
          <span class="slope-val">可测 ${method.detectedCount}/6</span>
        </div>
        <div class="mini-bars">${miniBars}</div>
      </div>`;
  }

  tierTextClass(tier) {
    if (tier === TIMBRE_TIERS.FAIL) return 'tier-text-fail';
    if (tier === TIMBRE_TIERS.DOUBT) return 'tier-text-doubt';
    if (tier === TIMBRE_TIERS.PASS) return 'tier-text-pass';
    return '';
  }

  /**
   * 渲染多区间对比表（段与段并排，超出参考范围的档位单独标出）
   * @param {Array} segments - 已判定的区间列表
   * @param {number} activeId - 当前选中的区间
   */
  renderComparisonTable(segments, activeId) {
    if (!segments || segments.length === 0) {
      this.compareSection.style.display = 'none';
      return;
    }
    this.compareSection.style.display = 'block';
    this.compareCount.textContent = segments.length;

    this.compareBody.innerHTML = segments.map((seg) => {
      const v = seg.verdict;
      const c = v.criteria;
      const isActive = seg.id === activeId;
      const rangeText = `${this.fmtMs(seg.startMs)}–${this.fmtMs(seg.endMs)}`;
      const duration = ((seg.endMs - seg.startMs) / 1000).toFixed(2);

      let pitchCell;
      let decayCell;
      let agreeCell;
      if (v.insufficient) {
        pitchCell = '<span class="metric-na">—</span>';
        decayCell = '<span class="metric-na">—</span>';
        agreeCell = '<span class="metric-na">—</span>';
      } else {
        pitchCell = this.metricCellHtml(v.pitchTier,
          `${v.pitchCents === null ? '—' : v.pitchCents.toFixed(0)}音分`);
        decayCell = this.metricCellHtml(v.decayTier,
          `${v.slope === null ? '—' : `${v.slope.toFixed(1)}dB`}`);
        agreeCell = v.mutual
          ? '<span class="metric-pass">互证</span>'
          : '<span class="metric-doubt">不一致</span>';
      }

      const autoCell = this.badgeHtml(v.methods.autocorrelation.tier, 'badge-sm');
      const peakCell = this.badgeHtml(v.methods.peak.tier, 'badge-sm');

      return `
        <tr class="compare-row ${isActive ? 'active' : ''}" data-id="${seg.id}">
          <td class="cell-range">
            <span class="range-text">${rangeText}</span>
            <span class="range-duration">${duration}s</span>
          </td>
          <td>${this.badgeHtml(v.tier)}</td>
          <td>${autoCell}</td>
          <td>${peakCell}</td>
          <td class="cell-metric">${pitchCell}</td>
          <td class="cell-metric">${decayCell}</td>
          <td class="cell-metric">${agreeCell}</td>
          <td class="cell-actions">
            <button class="btn-row-load" data-id="${seg.id}">查看</button>
            <button class="btn-row-remove" data-id="${seg.id}" title="移出对比">✕</button>
          </td>
        </tr>`;
    }).join('');

    // 口径范围脚注（超出范围的判定以红/橙底标出）
    const first = segments[0].verdict.criteria;
    const footnote = document.getElementById('compareFootnote');
    if (footnote) {
      footnote.innerHTML = `参考范围：音准偏差 合格≤${first.pitchPassCents}音分 / 存疑≤${first.pitchDoubtCents}音分；
        衰减斜率 合格 ${first.decayPassMin}~${first.decayPassMax} / 存疑 ${first.decayDoubtMin}~${first.decayDoubtMax} dB·倍频程⁻¹；
        两路基频差 ≤${first.agreementCents}音分视为互证。
        <span class="legend-item"><span class="metric-pass swatch"></span>合格档内</span>
        <span class="legend-item"><span class="metric-doubt swatch"></span>超合格范围</span>
        <span class="legend-item"><span class="metric-fail swatch"></span>超存疑范围</span>`;
    }

    logger.info('对比表已渲染', { count: segments.length });
  }

  fmtMs(ms) {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  hideVerdictCard() {
    if (this.verdictCard) this.verdictCard.style.display = 'none';
  }

  /**
   * 记录详情弹窗里的判定摘要
   */
  renderModalVerdict(verdict) {
    if (!verdict) return '';
    return `
      <div class="detail-section">
        <h4>音色判定</h4>
        <div class="modal-verdict">
          ${this.badgeHtml(verdict.tier, 'verdict-badge-large')}
          ${verdict.insufficient
            ? `<p class="suggestion">${(verdict.reasons || []).concat(verdict.suggestions || []).map(s => this.escapeHtml(s)).join('<br>')}</p>`
            : `
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="detail-label">音准偏差</span>
                  <span class="detail-value ${this.tierTextClass(verdict.pitchTier)}">
                    ${verdict.pitchCents === null ? '—' : `${verdict.pitchCents.toFixed(0)} 音分`}
                  </span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">谐波衰减</span>
                  <span class="detail-value ${this.tierTextClass(verdict.decayTier)}">
                    ${verdict.slope === null ? '—' : `${verdict.slope.toFixed(1)} dB/倍频程`}
                  </span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">两路基频差</span>
                  <span class="detail-value">${verdict.agreementCents === null ? '—' : `${verdict.agreementCents.toFixed(0)} 音分`}
                    (${verdict.mutual ? '互证' : '不一致'})</span>
                </div>
              </div>
              <ul class="reason-list">
                ${(verdict.reasons || []).map(r => `<li>${this.escapeHtml(r)}</li>`).join('')}
              </ul>`}
          <div class="criteria-title">判定口径（判定时快照）</div>
          <ul class="criteria-list criteria-list-compact">
            ${TimbreJudge.describeCriteriaStatic(verdict.criteria).map(t => `<li>${this.escapeHtml(t)}</li>`).join('')}
          </ul>
        </div>
      </div>`;
  }
}

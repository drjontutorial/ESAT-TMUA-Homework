// ---- WPC report page — shared between dr_jon_tmua_esat_admin.html,
// dr_jon_tmua_esat_student.html, and parents.html, loaded via
// <script src="wpc_report_shared.js">.
//
// Scope note: this file holds only the report-rendering code (Phase 1 + 3),
// not a full extraction of the site's existing duplicated LQ helpers
// (computeScoreAgainst, isLQPaperType, parseLQAnswerSpec, etc. stay
// duplicated in each HTML file as before — that's a separate, bigger
// refactor). Everything below assumes the page that loads it has already
// defined: isLQPaperType, lqAllLeafKeys, lqLeafKey, parseLQAnswerSpec,
// lqRenderFilledTemplate, lqRenderFilledTableHtml, formatMathText,
// escapeHtml, lqLeafIsCorrect, isManualLikeGrading, computeScoreAgainst,
// homeworkSets (global), and — for the trend chart only — window.firebaseDB.
// Classic (non-module) scripts share one global scope and only resolve
// function references when actually CALLED, not at parse time, so it
// doesn't matter whether this <script> tag comes before or after the
// page's own.

// WPC papers use fixed grade boundaries (not the per-paper gradeBoundaries
// admin sets for other paper types) — same bands for every WPC paper.
const WPC_GRADE_BANDS = [
  { min: 85, grade: 'A*' },
  { min: 70, grade: 'A' },
  { min: 55, grade: 'B' },
  { min: 45, grade: 'C' },
  { min: 35, grade: 'D' },
  { min: 0,  grade: 'E' }
];
function wpcGradeFromPct(pct) {
  if(pct == null || isNaN(pct)) return null;
  for(const b of WPC_GRADE_BANDS) if(pct >= b.min) return b.grade;
  return 'E';
}

function isWpcPaperType(t) { return t === 'wpc_physics' || t === 'wpc_maths' || t === 'wpc_further_maths' || t === 'wpc_chemistry' || t === 'wpc_dse_maths'; }

// Paper-only submissions have no timedSubmittedAt — fall back to the
// release/report time so sorting and dates still work.
function reportSubTimestamp(sub) {
  return (sub && (sub.timedSubmittedAt || sub.resultsReleasedAt || (sub.report && sub.report.generatedAt))) || 0;
}

// Timed answers win; overtime only fills in a leaf the student never
// answered in time. Agreed rule for the "timed + overtime combined" grade —
// overtime is a from-scratch redo, not a continuation, so this is the only
// sensible way to merge the two into one "best available" answer set.
function mergeTimedOvertimeAnswers(sub) {
  const timed = sub.timedAnswers || {};
  const overtime = sub.overtimeAnswers || {};
  const merged = Object.assign({}, timed);
  Object.keys(overtime).forEach(k => { if(merged[k] == null || merged[k] === '') merged[k] = overtime[k]; });
  return merged;
}

// Builds the report's per-question accordion: one collapsed card per leaf,
// colour-coded by outcome (green = full marks, amber = partial/pending,
// red = zero), click to expand and see the student's answer, the model
// answer, and any feedback text. Any leaf's mark can be overridden via
// manualMarks regardless of gradingMode — see computeScoreAgainst.
function buildReportAccordionHtml(answers, set, manualMarks) {
  answers = answers || {};
  manualMarks = manualMarks || {};
  if(!isLQPaperType(set.paperType)) return '';
  const parents = Object.keys(set.structure || {}).map(Number).sort((a,b) => a-b);
  let html = '';
  parents.forEach(parent => {
    const leaves = (set.structure[parent].length ? set.structure[parent] : ['']);
    leaves.forEach(label => {
      const leafKey = lqLeafKey(parent, label);
      const given = answers[leafKey];
      const modelAnswerRaw = (set.answerKey||{})[leafKey] || '';
      const gradingModeVal = (set.gradingMode||{})[leafKey] || '';
      const isSketch = gradingModeVal === 'sketch';
      const isTable = gradingModeVal === 'table';
      const spec = parseLQAnswerSpec(modelAnswerRaw);
      const maxM = (set.leafMaxMarks && set.leafMaxMarks[leafKey]) || 1;
      const overrideMark = manualMarks[leafKey];
      const hasOverride = overrideMark != null;

      let marksAwarded = null, cardCls = 'notattempted', feedback = '';
      if(!given) {
        cardCls = 'notattempted';
      } else if(hasOverride) {
        if(overrideMark && typeof overrideMark === 'object' && typeof overrideMark.marks === 'number') {
          marksAwarded = Math.max(0, Math.min(overrideMark.marks, maxM));
          feedback = overrideMark.feedback || '';
        } else {
          marksAwarded = overrideMark === true ? maxM : 0;
        }
        cardCls = marksAwarded >= maxM ? 'correct' : marksAwarded <= 0 ? 'incorrect' : 'review';
      } else if(isSketch) {
        cardCls = 'notattempted'; // answered, but no judgement written yet
      } else {
        const correct = lqLeafIsCorrect(given, modelAnswerRaw);
        marksAwarded = correct ? maxM : 0;
        cardCls = correct ? 'correct' : 'incorrect';
      }

      const givenDisplay = isSketch
        ? (given && given.startsWith('data:image') ? '<img src="'+given+'" style="max-width:220px;display:block;margin-top:6px;border:1px solid var(--line);border-radius:6px">' : (given ? escapeHtml(given) : '—'))
        : isTable ? (given ? lqRenderFilledTableHtml(modelAnswerRaw, given) : '—')
        : spec.template ? (given ? lqRenderFilledTemplate(spec.template, given) : '—')
        : (given ? escapeHtml(given) : '—');
      const modelAnswerDisplay = isTable ? lqRenderFilledTableHtml(modelAnswerRaw, spec.values.join('|||'))
        : spec.template ? lqRenderFilledTemplate(spec.template, spec.values.join('|||'))
        : formatMathText(String(modelAnswerRaw||'').split('|').join(' or '));
      const qLabel = 'Q' + parent + (label ? ' ' + formatLQSubLabel(label) : '');
      const marksText = marksAwarded !== null ? (marksAwarded + ' / ' + maxM) : (given ? '⏳ pending' : '—');

      html += '<div class="report-card ' + cardCls + '">'
        + '<button type="button" class="report-card-head" onclick="this.parentElement.classList.toggle(\'open\')">'
        + '<span class="report-card-q">' + qLabel + '</span>'
        + '<span class="report-card-marks">' + marksText + '</span>'
        + '<span class="report-card-chev">▾</span>'
        + '</button>'
        + '<div class="report-card-body">'
        + '<div><strong>Your answer:</strong> ' + givenDisplay + '</div>'
        + '<div style="margin-top:6px"><strong>Model answer:</strong> ' + modelAnswerDisplay + '</div>'
        + (feedback ? '<div style="margin-top:6px;color:var(--muted)">' + escapeHtml(feedback) + '</div>' : '')
        + '</div></div>';
    });
  });
  return html;
}

// Strengths/weaknesses bar, grouped by set.leafTags/{leafKey} = {genre,
// topic}. Returns '' (renders nothing) if the paper has no tags — this is
// optional metadata, not every paper will have it.
function buildReportCategoryBarsHtml(answers, set, manualMarks) {
  const tags = set.leafTags || {};
  if(Object.keys(tags).length === 0) return '';
  answers = answers || {};
  manualMarks = manualMarks || {};
  const groups = {}; // topic -> {score, total}
  const order = [];
  lqAllLeafKeys(set).forEach(leafKey => {
    const tag = tags[leafKey];
    if(!tag) return;
    const topic = tag.topic || tag.genre || 'Other';
    if(!groups[topic]) { groups[topic] = { score: 0, total: 0 }; order.push(topic); }
    const maxM = (set.leafMaxMarks && set.leafMaxMarks[leafKey]) || 1;
    const overrideMark = manualMarks[leafKey];
    let awarded = 0;
    if(overrideMark != null) {
      if(overrideMark && typeof overrideMark === 'object' && typeof overrideMark.marks === 'number') awarded = Math.max(0, Math.min(overrideMark.marks, maxM));
      else if(overrideMark === true) awarded = maxM;
    } else if(!isManualLikeGrading((set.gradingMode||{})[leafKey])) {
      awarded = lqLeafIsCorrect(answers[leafKey], (set.answerKey||{})[leafKey]) ? maxM : 0;
    }
    // manual/sketch leaves with no override yet count as 0 for now — the
    // bar will move once marked, same as the overall score does.
    groups[topic].score += awarded;
    groups[topic].total += maxM;
  });
  if(order.length === 0) return '';
  let html = '<div class="report-section-title">By topic</div>';
  order.forEach(topic => {
    const g = groups[topic];
    const pct = g.total ? Math.round((g.score/g.total)*100) : 0;
    html += '<div class="report-cat-row"><div class="report-cat-label">'+escapeHtml(topic)+'</div>'
      + '<div class="report-cat-bar-line"><div class="report-cat-track"><div class="report-cat-fill" style="width:'+pct+'%"></div></div>'
      + '<div class="report-cat-pct">'+pct+'%</div></div></div>';
  });
  return html;
}

// ---- Score-reveal animation (count-up + progress ring) ----
function buildReportScoreRingSvg(ringId) {
  const r = 52, c = 2*Math.PI*r;
  return '<svg width="120" height="120" viewBox="0 0 120 120" style="display:block;margin:0 auto">'
    + '<circle cx="60" cy="60" r="'+r+'" fill="none" stroke="var(--line,#e2e8f0)" stroke-width="10"/>'
    + '<circle id="'+ringId+'" cx="60" cy="60" r="'+r+'" fill="none" stroke="var(--brand,#1e40af)" stroke-width="10" stroke-linecap="round" transform="rotate(-90 60 60)"'
    + ' stroke-dasharray="'+c.toFixed(2)+'" stroke-dashoffset="'+c.toFixed(2)+'" style="transition:stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)"/>'
    + '</svg>';
}
function animateReportScoreRing(ringId, pct) {
  const el = document.getElementById(ringId);
  if(!el) return;
  const r = 52, c = 2*Math.PI*r;
  const offset = c * (1 - Math.max(0, Math.min(100, pct))/100);
  // Two nested rAFs: the element needs one real paint at the starting
  // (full) offset before changing it, or the browser collapses the change
  // and skips the CSS transition entirely.
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.strokeDashoffset = offset.toFixed(2); }));
}
function animateReportScoreCountUp(pctElId, targetPct) {
  const el = document.getElementById(pctElId);
  if(!el) return;
  const durationMs = 900;
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    if(t < 1) {
      el.textContent = (targetPct * eased).toFixed(1) + '%';
      requestAnimationFrame(tick);
    } else {
      el.textContent = targetPct + '%';
    }
  }
  requestAnimationFrame(tick);
}

// ---- Score-trend chart across a student's past WPC papers ----
function buildReportTrendSvg(rows) {
  if(!rows || rows.length === 0) {
    return '<div style="text-align:center;padding:16px;color:var(--muted);font-size:12.5px">No other completed papers yet.</div>';
  }
  const width = 640, height = 200, padTop = 24, padBottom = 40, padLeft = 40, padRight = 16;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : 0;
  const points = rows.map((r, i) => ({
    x: padLeft + (rows.length > 1 ? i*stepX : plotW/2),
    y: padTop + plotH - (r.pct/100)*plotH,
    pct: r.pct, label: r.label
  }));
  let svg = '<svg viewBox="0 0 '+width+' '+height+'" style="width:100%;height:auto;display:block">';
  [0,25,50,75,100].forEach(v => {
    const y = padTop + plotH - (v/100)*plotH;
    svg += '<line x1="'+padLeft+'" y1="'+y+'" x2="'+(width-padRight)+'" y2="'+y+'" stroke="#e2e8f0" stroke-width="1"/>';
    svg += '<text x="'+(padLeft-8)+'" y="'+(y+4)+'" font-size="10" fill="#64748b" text-anchor="end">'+v+'%</text>';
  });
  if(points.length > 1) {
    const linePath = points.map((p,i) => (i===0?'M':'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    svg += '<path d="'+linePath+'" fill="none" stroke="var(--brand,#1e40af)" stroke-width="2.5"/>';
  }
  points.forEach(p => {
    const truncated = p.label.length > 12 ? p.label.slice(0,11)+'…' : p.label;
    svg += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="5" fill="var(--brand,#1e40af)"/>';
    svg += '<text x="'+p.x.toFixed(1)+'" y="'+(p.y-12).toFixed(1)+'" font-size="11" fill="var(--brand,#1e40af)" font-weight="700" text-anchor="middle">'+p.pct+'%</text>';
    svg += '<text x="'+p.x.toFixed(1)+'" y="'+(height-padBottom+18)+'" font-size="10" fill="#64748b" text-anchor="middle">'+escapeHtml(truncated)+'</text>';
  });
  svg += '</svg>';
  return svg;
}

// Fetches this student's other released WPC submissions (same paperType as
// the current paper) and fills in the trend chart placeholder. Runs after
// the report is already on screen — never blocks the initial render, and a
// slow/failed fetch just leaves the placeholder's "loading" text in place
// rather than breaking anything else.
async function loadAndRenderReportTrend(placeholderId, studentCodeVal, paperType) {
  const el = document.getElementById(placeholderId);
  if(!el || !window.firebaseDB) return;
  try {
    const {ref, get, db} = window.firebaseDB;
    const setIds = Object.keys(homeworkSets || {}).filter(id => homeworkSets[id].paperType === paperType);
    const rows = [];
    for(const setId of setIds) {
      const snap = await get(ref(db, 'submissions/'+setId+'/'+studentCodeVal));
      if(!snap.exists()) continue;
      const s = snap.val();
      if(!s.resultsReleased) continue;
      const set = homeworkSets[setId];
      const live = computeScoreAgainst(s.timedAnswers, set, s.manualMarks || {}, false);
      rows.push({ label: set.title, pct: live.pct, ts: reportSubTimestamp(s) });
    }
    rows.sort((a,b) => a.ts - b.ts);
    el.innerHTML = buildReportTrendSvg(rows);
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);font-size:12.5px">Could not load history.</div>';
  }
}

let __reportInstanceCounter = 0;

// Full report screen HTML for one submission: animated score ring/count-up
// + WPC grade, timed-vs-overtime comparison (if an overtime attempt
// exists), topic strength/weakness bars (if the paper has leafTags), the
// per-question accordion, and a trend-chart placeholder that fills itself
// in asynchronously. Score always comes from computeScoreAgainst (which
// already honours leafMaxMarks and any manualMarks override) — never a
// separately-stored total, so it can't drift from the answer data.
//
// setId/studentCodeVal are optional — pass both to get the trend chart
// (needs them to query the student's other submissions); omit either to
// skip that section (e.g. a context with no student identity to query by).
function buildReportHtml(sub, set, setId, studentCodeVal) {
  sub = sub || {};
  const manualMarks = sub.manualMarks || {};
  const live = computeScoreAgainst(sub.timedAnswers, set, manualMarks, false);
  const grade = wpcGradeFromPct(live.pct);
  const instanceId = 'wpcReport_' + (++__reportInstanceCounter) + '_' + Date.now();

  let combinedHtml = '';
  if(sub.overtimeSubmittedAt) {
    const combinedAnswers = mergeTimedOvertimeAnswers(sub);
    const combinedLive = computeScoreAgainst(combinedAnswers, set, manualMarks, false);
    const combinedGrade = wpcGradeFromPct(combinedLive.pct);
    combinedHtml = '<div class="report-tvo-row">'
      + '<div class="report-tvo-box"><div class="report-tvo-pct">'+live.pct+'%</div><div class="report-tvo-label">Timed'+(grade?' · '+grade:'')+'</div></div>'
      + '<div class="report-tvo-box"><div class="report-tvo-pct">'+combinedLive.pct+'%</div><div class="report-tvo-label">Timed + Overtime'+(combinedGrade?' · '+combinedGrade:'')+'</div></div>'
      + '</div>';
  }

  const header = '<div class="report-score-header">'
    + buildReportScoreRingSvg(instanceId + '_ring')
    + '<div class="report-score-pct" id="' + instanceId + '_pct">0%</div>'
    + '<div class="report-score-frac">' + live.score + ' / ' + live.total + ' marks</div>'
    + (grade ? '<div class="report-grade" id="' + instanceId + '_grade" style="opacity:0">' + grade + '</div>' : '')
    + '</div>' + combinedHtml;

  // The written narrative feedback — submissions/{setId}/{code}/report =
  // {text, marks, generatedAt}, written by whoever marked it once Dr Jon
  // has agreed the wording in chat. This is the main content of "the
  // report" from the student's point of view; the score/accordion below is
  // supporting detail. marks/generatedAt aren't shown separately here — the
  // live score above already reflects the same agreed marks (via
  // manualMarks overrides), so there's nothing to duplicate or drift.
  const narrativeHtml = (sub.report && sub.report.text)
    ? '<div class="report-narrative">' + escapeHtml(sub.report.text) + '</div>'
    : '';

  const categoryHtml = buildReportCategoryBarsHtml(sub.timedAnswers, set, manualMarks);
  const cards = buildReportAccordionHtml(sub.timedAnswers, set, manualMarks);

  let trendHtml = '';
  if(setId && studentCodeVal) {
    trendHtml = '<div class="report-section-title">Score over time</div>'
      + '<div id="' + instanceId + '_trend"><div style="text-align:center;padding:16px;color:var(--muted);font-size:12.5px">Loading…</div></div>';
  }

  // Kick off the reveal animation + trend fetch on the next frame, once
  // this HTML is actually in the DOM. Safe because every caller sets
  // innerHTML synchronously right after calling this function — a rAF
  // callback never fires before the current synchronous code finishes.
  requestAnimationFrame(() => {
    animateReportScoreRing(instanceId + '_ring', live.pct);
    animateReportScoreCountUp(instanceId + '_pct', live.pct);
    const gradeEl = document.getElementById(instanceId + '_grade');
    if(gradeEl) setTimeout(() => { gradeEl.style.transition = 'opacity .4s'; gradeEl.style.opacity = '1'; }, 700);
    if(setId && studentCodeVal) loadAndRenderReportTrend(instanceId + '_trend', studentCodeVal, set.paperType);
  });

  return header
    + narrativeHtml
    + (categoryHtml ? '<div class="report-cards">' + categoryHtml + '</div>' : '')
    + '<div class="report-cards">' + cards + '</div>'
    + trendHtml;
}

// Standalone mark-scheme download button — NOT baked into buildReportHtml,
// since student.html has its own dedicated fixed button in that exact spot
// (next to Continue to overtime / Reattempt) and would otherwise show it
// twice. Admin's View as Student and parents.html append this after
// buildReportHtml's output instead. Inline-styled (not a page's own .btn
// class) so it looks right regardless of which page's button classes exist.
function buildMarkSchemeButtonHtml(set) {
  if(!set || !set.markSchemeUrl) return '';
  return '<a href="' + escapeHtml(set.markSchemeUrl) + '" target="_blank" rel="noopener" style="display:block;text-align:center;background:var(--brand,#1e40af);color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:14px;border-radius:14px;margin:16px 0">📥 Download Mark Scheme</a>';
}

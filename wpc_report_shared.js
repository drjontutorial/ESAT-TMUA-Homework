// ---- WPC report page (Phase 1) — shared between dr_jon_tmua_esat_admin.html
// and dr_jon_tmua_esat_student.html (and parents.html in Phase 2), loaded via
// <script src="wpc_report_shared.js">.
//
// Scope note: this file holds only the NEW report-rendering code, not a full
// extraction of the site's existing duplicated LQ helpers (computeScoreAgainst,
// isLQPaperType, parseLQAnswerSpec, etc. stay duplicated in both HTML files as
// before — that's a separate, bigger refactor). Everything below assumes the
// page that loads it has already defined those: isLQPaperType, lqLeafKey,
// parseLQAnswerSpec, lqRenderFilledTemplate, lqRenderFilledTableHtml,
// formatMathText, escapeHtml, lqLeafIsCorrect, computeScoreAgainst.
// Classic (non-module) scripts share one global scope and only resolve
// function references when actually CALLED, not at parse time, so it doesn't
// matter whether this <script> tag comes before or after the page's own —
// by the time anything here runs (a click, or the results screen rendering),
// every script on the page has already finished loading.

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

function isWpcPaperType(t) { return t === 'wpc_physics' || t === 'wpc_maths'; }

// Builds the report's per-question accordion: one collapsed card per leaf,
// colour-coded by outcome (green = full marks, amber = partial/pending,
// red = zero), click to expand and see the student's answer, the model
// answer, and any feedback text. Mirrors the marking logic already used in
// buildLQBreakdownSection/buildBreakdown (any leaf's mark can be overridden
// via manualMarks regardless of gradingMode — see computeScoreAgainst).
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
      const qLabel = 'Q' + parent + (label ? ' (' + label + ')' : '');
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

// Full report screen HTML for one submission: score header (WPC fixed grade
// bands) + the per-question accordion. Score comes from computeScoreAgainst
// (which already honours leafMaxMarks and any manualMarks override), never
// a separately-stored total — so it can't drift from what the answer data
// actually shows.
function buildReportHtml(sub, set) {
  sub = sub || {};
  const manualMarks = sub.manualMarks || {};
  const live = computeScoreAgainst(sub.timedAnswers, set, manualMarks, false);
  const grade = wpcGradeFromPct(live.pct);
  const gradeHtml = grade ? '<div class="report-grade">' + grade + '</div>' : '';
  const header = '<div class="report-score-header">'
    + '<div class="report-score-pct">' + live.pct + '%</div>'
    + '<div class="report-score-frac">' + live.score + ' / ' + live.total + ' marks</div>'
    + gradeHtml
    + '</div>';
  const cards = buildReportAccordionHtml(sub.timedAnswers, set, manualMarks);
  return header + '<div class="report-cards">' + cards + '</div>';
}

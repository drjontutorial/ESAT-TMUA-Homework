// ---- Core LQ/paper-type/scoring engine — shared between
// dr_jon_tmua_esat_admin.html, dr_jon_tmua_esat_student.html, and
// parents.html, loaded via <script src="wpc_lq_core_shared.js">.
//
// This is the single source of truth for the functions that used to be
// copy-pasted identically into each HTML file — extracted after the
// PAPER_TYPE_GROUPS-drift bug and a same-session double-counting bug in one
// copy of computeScoreAgainst made clear that hand-keeping N copies in sync
// doesn't scale. Bug fixes now happen once, here, for every page.
//
// Depends on nothing outside itself. window.firebaseDB, currentSet, and
// other page-specific globals are NOT referenced here — this file is pure
// data-shape logic, safe to load into any page that has homeworkSets-shaped
// objects to operate on.

// Paper types that use the LQ structure/leaf engine (parent/sub-part
// questions, templated blanks, manual/mcq gradingMode) rather than the flat
// MCQ answerKey. wpc_physics/wpc_maths reuse the exact same engine as
// lq_16plus — they're separate categories for organizing papers, not a
// different renderer.
function isLQPaperType(t) { return t === 'lq_16plus' || t === 'wpc_physics' || t === 'wpc_maths' || t === 'wpc_further_maths' || t === 'wpc_chemistry' || t === 'wpc_dse_maths'; }

// Scan-based papers: student does the paper on paper/iPad and scans it back.
// No timer, no typed answers; Dr Jon marks by hand and the marks/report are
// written straight into submissions/{setId}/{code} (no student-created
// submission, so timedAnswers/timedSubmittedAt may be absent).
function isPaperOnlySet(s) { return !!s && s.deliveryMode === 'paper_only'; }

// [sketch] leaves need a human to judge them exactly like [manual] does
// (they're scored via manualMarks, not auto-matched) — only the input
// widget differs (canvas vs textarea), so scoring treats them identically.
function isManualLikeGrading(gm) { return gm === 'manual' || gm === 'sketch'; }

function lqLeafKey(parent, label) { return label ? (parent + label) : String(parent); }

// Display-only formatting: turns "x^2" / "x^-1" into real superscript
// characters (x², x⁻¹) so question templates read like actual maths instead
// of raw caret notation. Never applied to editable inputs — only to
// read-only text shown in breakdown/marking/report views.
const LQ_SUPERSCRIPT_MAP = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻'};
function formatMathText(text) {
  return String(text || '').replace(/\^(-?\d+)/g, (m, exp) => exp.split('').map(ch => LQ_SUPERSCRIPT_MAP[ch] || ch).join(''));
}

function optionLetter(n) { return 'ABCDEFGH'[n-1]; }

// Anything a student typed is escaped before being put into any page's
// HTML — admin can edit/delete everything and this same code renders on
// the student/parent side too, so it must never run markup that came from
// a student's answer box.
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// LQ sub-part labels are stored compound, e.g. "ci" for part (c)(i) — a
// letter part with a nested roman-numeral part. Split that back into
// "(c)(i)" for display rather than showing the raw "(ci)". A plain
// single-letter label like "a" is unaffected (no roman suffix to split off).
function formatLQSubLabel(label) {
  if(!label) return '';
  const m = String(label).match(/^([a-z]+?)(i{1,3}|iv|vi{0,3}|ix|x{1,3})$/i);
  return m ? '(' + m[1] + ')(' + m[2] + ')' : '(' + label + ')';
}

// Firebase turns an object whose keys are all sequential integers into a
// real JS array, inserting a null "hole" at index 0. LQ question numbers
// start at 1 (never 0), so structure/answerKey/gradingMode/leafMaxMarks hit
// this on every single LQ-engine paper — silently poisoning any
// Object.keys() loop over them with a phantom "parent 0" whose value is
// null. Strip that out right after every fetch so nothing downstream has
// to know about it.
function normalizeLQFields(sets) {
  Object.values(sets || {}).forEach(s => {
    if(s && isLQPaperType(s.paperType)) {
      ['structure','answerKey','gradingMode','leafMaxMarks'].forEach(field => {
        if(s[field] && typeof s[field] === 'object') {
          const clean = {};
          Object.keys(s[field]).forEach(k => { if(s[field][k] != null) clean[k] = s[field][k]; });
          s[field] = clean;
        }
      });
    }
  });
  return sets;
}

// Papers created before "Paper Type" existed have no paperType and are
// treated as Physics (the old default), matching the performance charts.
const PAPER_TYPE_GROUPS = [
  { key: 'tmua',        label: 'Maths' },
  { key: 'tmua_paper2', label: 'TMUA Paper 2 — Logic & Proof' },
  { key: 'esat',        label: 'Physics' },
  { key: 'sat_math',    label: 'SAT Math' },
  { key: 'wpc_physics', label: 'WPC Physics' },
  { key: 'wpc_chemistry', label: 'WPC Chemistry' },
  { key: 'wpc_dse_maths', label: 'WPC DSE Maths' },
  { key: 'wpc_maths',   label: 'WPC Maths' },
  { key: 'wpc_further_maths', label: 'WPC Further Maths' },
  { key: 'imc',         label: 'IMC' },
  { key: 'sixteen_mcq', label: '16+ MCQ' },
  { key: 'lq_16plus',   label: '16+ Long Questions' }
];

function paperTypeOf(s) {
  const t = (s && s.paperType) || 'esat';
  return PAPER_TYPE_GROUPS.some(g => g.key === t) ? t : 'esat';
}

// Natural sort so "Paper 2" comes before "Paper 10", and A/B/C order works.
function compareSetTitles(a, b) {
  return String(a.title||'').localeCompare(String(b.title||''), undefined, { numeric: true, sensitivity: 'base' });
}

// For grid-in questions the stored correct answer may list several accepted
// equivalent forms separated by "|" (e.g. "3/4|0.75") — any one matches.
// Comparison is trimmed + case-insensitive so "12", " 12 ", "b" vs "B" all work.
function answersMatch(given, correct) {
  if(given == null || given === '' || correct == null) return false;
  const acceptable = String(correct).split('|').map(s => s.trim().toLowerCase());
  return acceptable.includes(String(given).trim().toLowerCase());
}

// A leaf's stored answer is either a plain value (optionally with "|"
// alternates), or a template with one or more blanks plus the correct value
// for each, written as "<template> => <val1>, <val2>, ...". This lets a
// question like a coordinate or ratio show its real wording with small
// individual typing boxes, instead of one box where the student has to type
// brackets/commas/units themselves. Two blank markers are supported:
// "___" = number-only box (real type="number" input, can't accept letters),
// "~~~" = short-text box (exact-matched, but accepts things like "2x").
const LQ_BLANK_RE = /(___|~~~)/g;
function parseLQAnswerSpec(raw) {
  raw = String(raw || '');
  const idx = raw.indexOf('=>');
  if(idx === -1) return { template: null, values: [raw], blankTypes: [] };
  const template = raw.slice(0, idx).trim();
  const blankTypes = (template.match(LQ_BLANK_RE) || []).map(m => m === '~~~' ? 'text' : 'number');
  return {
    template,
    values: raw.slice(idx + 2).split(',').map(s => s.trim()),
    blankTypes
  };
}

// given: for a templated leaf, the student's per-blank answers joined with
// "|||" (in blank order) — for a plain leaf, just the raw typed value.
function lqLeafIsCorrect(given, correctRaw) {
  const spec = parseLQAnswerSpec(correctRaw);
  if(!spec.template) return answersMatch(given, correctRaw);
  const givenParts = String(given || '').split('|||');
  if(givenParts.length !== spec.values.length) return false;
  return spec.values.every((v, i) => answersMatch(givenParts[i], v));
}

// Fills a template's blanks ("___" or "~~~") with the student's typed
// values, for a readable "Your answer: Coordinate of B: (-26, -18)" display
// instead of showing the raw "-26|||-18" joined string.
function lqRenderFilledTemplate(template, given) {
  const parts = String(given || '').split('|||');
  let i = 0;
  const filled = template.replace(LQ_BLANK_RE, () => {
    const v = parts[i] !== undefined && parts[i] !== '' ? escapeHtml(parts[i]) : '—';
    i++;
    return v;
  });
  return formatMathText(filled);
}

// [table] leaves store their template exactly like any other — rows
// separated by ";", cells by "|" — purely a layout convention for the
// renderer. Blank order (left-to-right, top-to-bottom through the raw
// string) still lines up with spec.values, so parseLQAnswerSpec and
// lqLeafIsCorrect need no changes at all for tables.
function lqParseTableRows(template) {
  return String(template || '').split(';').map(row => row.split('|').map(c => c.trim()));
}

// Read-only filled table (breakdown/marking/report view) — same blank-
// filling idea as lqRenderFilledTemplate, laid out as a real <table>
// instead of inline text.
function lqRenderFilledTableHtml(template, given) {
  const rows = lqParseTableRows(template);
  const parts = String(given || '').split('|||');
  let i = 0;
  let html = '<table style="border-collapse:collapse;margin:6px 0"><tbody>';
  rows.forEach(cells => {
    html += '<tr>';
    cells.forEach(cell => {
      if(cell === '___' || cell === '~~~') {
        const v = parts[i] !== undefined && parts[i] !== '' ? escapeHtml(parts[i]) : '—';
        i++;
        html += '<td style="border:1px solid var(--line);padding:5px 9px;text-align:center">'+v+'</td>';
      } else {
        html += '<td style="border:1px solid var(--line);padding:5px 9px;font-weight:700;text-align:center;background:#f8fafc">'+formatMathText(escapeHtml(cell))+'</td>';
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

// Every leaf key for an LQ-engine paper — a leaf is a sub-part (e.g. "5bi")
// if the parent question has sub-parts, or just the parent number itself
// (e.g. "1") if it doesn't.
function lqAllLeafKeys(set) {
  const keys = [];
  Object.keys(set.structure || {}).map(Number).sort((a,b)=>a-b).forEach(parent => {
    (set.structure[parent].length ? set.structure[parent] : ['']).forEach(label => keys.push(lqLeafKey(parent, label)));
  });
  return keys;
}

// manualMarks: { [leafKey]: true | false | {marks, feedback} }. A human can
// override ANY leaf's mark this way — not just manual/sketch ones —
// because "marks are agreed in chat" applies to any part, e.g. a [table]
// leaf where the student got some but not all blanks right (lqLeafIsCorrect
// is all-or-nothing per leaf, so that can't be expressed automatically). A
// leaf with an override is treated as human-judged for the overtime
// exclusion too, since the override was made against that specific
// attempt's answers. A leaf with no override: manual/sketch leaves are
// "pending" (counted toward total, not score); everything else auto-grades
// via lqLeafIsCorrect, worth its full leafMaxMarks (default 1) when correct.
// excludeManual: true for overtime attempts — self-check only, so anything
// human-judged (inherently manual, or override-marked) is left out of the
// score/total entirely rather than sitting pending forever.
function computeScoreAgainst(answers, set, manualMarks, excludeManual) {
  answers = answers || {};
  manualMarks = manualMarks || {};

  if(isLQPaperType(set.paperType)) {
    const leaves = lqAllLeafKeys(set);
    let score = 0, pending = 0, total = 0;
    leaves.forEach(leafKey => {
      const gm = (set.gradingMode || {})[leafKey];
      const isManual = isManualLikeGrading(gm);
      const mark = manualMarks[leafKey];
      const hasOverride = mark != null;
      if((isManual || hasOverride) && excludeManual) return; // not counted at all for overtime
      const maxM = (set.leafMaxMarks && set.leafMaxMarks[leafKey]) || 1;
      total += maxM;
      if(hasOverride) {
        // manualMarks[leafKey] is either the legacy boolean (full/zero
        // credit) or {marks, feedback} for partial credit.
        if(mark && typeof mark === 'object' && typeof mark.marks === 'number') {
          score += Math.max(0, Math.min(mark.marks, maxM));
        } else if(mark === true) {
          score += maxM;
        }
        // mark === false -> 0, already counted toward total above
      } else if(isManual) {
        pending++;
      } else {
        // Auto/table/mcq leaves are still binary (no partial credit) when
        // there's no override, but still honour a per-leaf mark weighting.
        if(lqLeafIsCorrect(answers[leafKey], (set.answerKey||{})[leafKey])) score += maxM;
      }
    });
    return { score, total, pct: total ? Math.round((score/total)*1000)/10 : 0, pending };
  }

  let score = 0;
  const total = set.totalQuestions;
  for(let q=1; q<=total; q++) {
    if(answersMatch(answers[q], set.answerKey[q])) score++;
  }
  return { score, total, pct: total ? Math.round((score/total)*1000)/10 : 0 };
}

// gradeBoundaries: [{min: <correct answers needed>, grade: <label>}, ...],
// used by non-WPC paper types (WPC papers use the fixed wpcGradeFromPct
// bands in wpc_report_shared.js instead). Returns the grade for the
// highest boundary the score meets, or null if none are set or the score
// is below all of them.
function computeGrade(score, gradeBoundaries) {
  if(!gradeBoundaries || !gradeBoundaries.length) return null;
  const sorted = gradeBoundaries.slice().sort((a,b) => b.min - a.min);
  for(const b of sorted) { if(score >= b.min) return b.grade; }
  return null;
}

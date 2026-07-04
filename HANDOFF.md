# Handoff: Dr Jon's TMUA/ESAT Homework System

Two standalone HTML files (no build process), same pattern as Dr Jon's existing
lesson-booking system: Firebase Realtime Database backend, GitHub Pages hosting.

- `dr_jon_tmua_esat_student.html` — student-facing
- `dr_jon_tmua_esat_admin.html` — admin-facing (Dr Jon only)

Both share the **same Firebase project** as the booking system (config is
inline in each file's `<script type="module">` header), but use their own
top-level paths (`homeworkSets`, `students`, `submissions`) so they don't
collide with the booking system's data.

---

## Why this exists — Dr Jon's actual goal

Dr Jon is one tutor with a small group (~5 students) doing TMUA/ESAT prep.
He wants to set MCQ homework, have students do it under exam-like
conditions, and see their results/progress **without manually marking
anything or chasing people by hand**. That single goal is what most of the
"why" below traces back to. He is explicitly *not* trying to build a
general-purpose LMS — features that would matter for a bigger school
(role-based permissions, strict security, heavy customisation) were
deliberately skipped or deferred so effort went into things that actually
save him time day-to-day.

**Explicitly deprioritized by Dr Jon** (don't build unless asked again):
dark mode / font-size controls, a "duplicate this paper" shortcut, Firebase
security rules (accepted the risk knowingly — see below).

**Explicitly wanted** (these were his own requests, in priority order as
they came up): backup/restore, a way to nudge students who haven't
submitted, manual answer override for glitches, a clean "create student
profile" flow separate from editing, and a student-facing progress view —
all listed in detail further down with the reasoning behind each.

### Why specific design decisions were made this way

- **Timer deadline is fixed at the moment the student clicks "confirm
  start," not re-armed on resume.** Dr Jon wants exactly one real attempt
  per student per paper — no re-rolling the clock by refreshing or closing
  the tab. But he also didn't want a genuine connectivity drop to unfairly
  cost a student their attempt, so resuming within the original deadline
  continues the *same* clock rather than either restarting it or
  auto-failing them. This is a deliberate middle ground between "strict
  exam integrity" and "don't punish bad WiFi."

- **Students can have several *approved* papers (`approvedSetIds`), not
  one assigned paper.** Early on the plan was "one paper a week," but Dr
  Jon wants to keep authorship control himself — he only creates fixed
  papers (via import, see below) rather than letting the system auto-spin
  variants — while giving students flexibility to pick from whatever
  he's currently approved for them (e.g. catching up on a missed paper,
  revisiting an older one). The "approve" model keeps him as the
  gatekeeper of *what exists and who can see it*, without forcing a rigid
  one-paper-at-a-time schedule.

- **Import Answer Key via "ask another Claude" instead of typing keys by
  hand.** Dr Jon's real bottleneck isn't writing questions (he already has
  papers as PDFs/Drive links) — it's the tedious part of transcribing 27
  answers into dropdowns one at a time. The "Copy Prompt for Claude" +
  paste-back flow exists purely to remove that friction; the preview step
  before applying exists so a paste error doesn't silently corrupt a
  paper's key.

- **Manual answer override exists because real glitches happen.** If a
  student's answer fails to save, or something breaks mid-exam, Dr Jon
  needs a way to fix the record without forcing a full re-sit (which would
  violate the "one attempt" rule for no fault of the student's). This is a
  deliberate escape hatch, not a way to override a student's genuine
  mark — the UI says as much.

- **"Not attempted" is its own yellow state, separate from "wrong" (red).**
  Skipping a question and answering it incorrectly are pedagogically
  different signals — Dr Jon wants to be able to tell "ran out of
  time / didn't get to it" apart from "attempted and got it wrong" at a
  glance when reviewing a student's paper.

- **Reminder-message generator, not automated nightly emails/SMS.** There's
  no backend to run scheduled jobs from a static page, and Dr Jon didn't
  ask for one — he just wanted the *drafting* of a nudge message to be
  one click instead of typing it fresh each time, then he sends it himself
  via WhatsApp.

- **Backup button + "last backup N days ago" reminder, not automatic
  backups.** Directly downstream of the decision to skip Firebase security
  rules: since nothing is protecting the data from an outside actor (Dr
  Jon judged the risk acceptable for a 5-student trusted group), the
  backup exists as protection against *accidental* loss/corruption, not
  attack. A manual button was good enough for him; the reminder is there
  so "I'll back up later" doesn't quietly become "never."

- **Both login gates are currently bypassed on purpose, not by accident.**
  While actively building and testing on his phone, Dr Jon repeatedly
  asked to remove the login screens so he could get straight into the app
  without needing real credentials set up yet. The real login logic was
  kept intact (not deleted) specifically so it can be switched back on
  later with minimal work — see the checklist below.

If a future request seems to conflict with any of the above (e.g. "add
strict role permissions" or "auto-generate new papers"), it's worth
confirming with Dr Jon first — it likely goes against what he explicitly
optimised for.

---

## ⚠️ MUST DO BEFORE REAL STUDENTS USE THIS

1. **Re-enable login on both files.** Both currently have their password
   gates bypassed for development convenience:
   - `admin.html`: `loginSection` is `display:none`, `adminPanel` is forced
     `display:block`, and the bottom of the script calls
     `loadData(); rebuildKeyGrid(); switchTab('home');` directly instead of
     waiting for `adminLogin()`. To restore: remove the inline `style`
     overrides on `#loginSection`/`#adminPanel` and remove those three
     auto-init lines (the real `adminLogin()` function still exists and
     works — password is `drjon223`, change it in the `ADMIN_PWD` constant).
   - `student.html`: the `loginCard` (real code+password login) and
     `testModeCard` (no-password bypass — includes a built-in offline demo
     test and an "enter as test student" option that shows *every* paper
     regardless of real approvals) are both visible at once. Before go-live,
     hide/remove `testModeCard` and its related functions
     (`startLocalDemo`, `loadSetsForTestMode`, `enterTestMode`,
     `isTestModeAllSets`) so only the real `loginCard` shows.

2. **No Firebase security rules are set.** The `firebaseConfig` is public in
   the page source, so without rules anyone can read/write the whole
   database directly via the SDK, bypassing both app-level password checks.
   Dr Jon has explicitly accepted this risk for now (small trusted group,
   5 students, low incentive to attack). If that changes, rules should be
   added in the Firebase console.

3. Passwords (admin + student) are stored/checked **client-side in plain
   text** — consistent with the booking system's existing security posture,
   not bank-grade, but adequate for a small tutoring homework tool.

---

## Data model (Firebase Realtime Database)

```
/homeworkSets/{setId}
  title, totalQuestions, optionsCount (4-8, i.e. A-D..A-H),
  timeLimitMinutes, paperUrl (Google Drive/PDF link or null),
  answerKey: { "1":"B", "2":"D", ... }, createdAt

/students/{code}
  name, password,
  approvedSetIds: { setId: true, ... }   // multiple papers a student
                                          // can see & attempt, admin
                                          // controlled via "Manage" /
                                          // bulk-approve

/submissions/{setId}/{code}
  studentCode, startedAt, draftAnswers (live autosave while timed attempt
    is in progress),
  timedAnswers, timedSubmittedAt, timedScore, timedTotal, timedPercentage,
  overtimeAnswers, overtimeSubmittedAt, overtimeScore, overtimeTotal,
    overtimePercentage,
  log: { pushId: { type, ts, ...meta } }  // audit trail, see below
```

No security rules are attached to any of this (see warning above).

---

## Core mechanics (student side)

**One timed attempt, deadline fixed at "confirm start" time:**
- Pressing "Start" writes `startedAt = now`. The deadline is always
  `startedAt + timeLimitMinutes*60000` — fixed at that moment, never reset.
- If the student closes the tab and comes back **within** the deadline,
  they resume the *same* attempt with the correct remaining time (not a
  fresh timer). If they come back **after** the deadline has passed, the
  system auto-finalizes their last autosaved answers (`draftAnswers`) as
  the timed score, then switches them into "overtime" mode.
- When the timer actually hits 0 while they're active, the same
  finalization happens live, and they can keep answering — further changes
  count only toward a separate overtime score.
- The paper itself (actual question text/diagrams) is **not** stored in
  this system — only the admin-entered answer key and letter choices.
  Students access the real paper via `paperUrl`, which opens in a new tab
  the moment they press "Start" (synchronously, before any `await`, so
  mobile/desktop popup blockers don't block it — see `beginTimedTest()`).
  A persistent "📄 Open Paper" button in the exam header lets them reopen
  it any time during the attempt.

**Exam UI** mimics the real Pearson VUE / ESAT interface: one question per
screen (`renderCurrentQuestion()`), a Navigator modal (grid of
answered/unanswered/flagged questions, jump to any), a Flag-for-Review
toggle, and a mandatory confirmation modal before final submit that lists
any unanswered questions.

**Activity log** (`logEvent()` in student.html): every "confirm start",
every individual answer change, and every "confirm submit" is pushed with a
timestamp to `submissions/{setId}/{code}/log`. Viewable in admin via the
"🕐 Timeline" button on any student's breakdown. Skipped entirely in local
demo/test mode (nothing is saved there by design).

**My Progress tab** (student.html): after login, students see their own
score-over-time chart (plain SVG, no external library) and history table
across all their approved papers — separate from admin's view.

---

## Core mechanics (admin side)

Four tabs:

1. **🏠 Homepage** — overview stats (student/paper counts, submissions in
   last 7 days), a recent-activity feed (latest submissions + newly created
   papers, merged from a single `/submissions` + `/homeworkSets` read), and
   the backup/restore section (see below). `renderHomepage()` uses a
   monotonically increasing `homepageRenderToken` to discard stale async
   results — this was fixed after a real bug where concurrent triggers
   (page load + two onValue listeners) caused a duplicated stat card.

2. **📌 Assign Papers** — "Create Student Profile" (code/name/password,
   create-only; editing name/password is a separate `editStudent()` flow
   that preserves `approvedSetIds`), per-student "Manage" modal to
   check/uncheck which papers they can see, and a bulk-approve tool
   (pick a paper, tick students, adds — does not overwrite — their
   approved list via Firebase `update()` merge semantics).

3. **📊 Performance** — toggle between:
   - *By Paper*: pick a set, see class stats, an "outstanding" list of
     approved-but-not-submitted students with a one-click WhatsApp-style
     reminder message generator, a searchable/sortable results table, CSV
     export, and "Recalculate & Save" (scores are always *displayed* live
     against the current answer key — so fixing a key mistake after
     students submit doesn't leave them with wrong scores — this button
     additionally writes the corrected scores back to Firebase).
   - *By Student*: pick a student, see their approved-papers list, a
     score-over-time SVG chart, and a paper history table. Clicking any row
     opens the same breakdown modal used in "By Paper" (correct=green,
     incorrect=red, **not-attempted=yellow** — a three-way state, not just
     right/wrong).

   Both breakdown paths share `showBreakdownFor(setId, code)` /
   `viewTimelineFor(setId, code)`, which read from `allSubmissions` when
   looking at the currently-selected paper, or from `lastLoadedDetailSubs`
   (populated by `openStudentDetail`) otherwise.

   **Manual answer override** (`openEditAnswersModal` /
   `saveEditedAnswers`): lets admin directly edit a specific student's
   recorded answers for a specific attempt (timed or overtime) to fix a
   technical glitch — score is recalculated automatically on save. There's
   a guard (`byStudentViewVisible` check) to prevent this save from
   force-navigating the admin away from whichever Performance sub-view they
   were actually looking at — this was a real bug, fixed.

4. **📝 Create Paper** — title/question count (default 27)/options
   (A-D..A-H)/time limit/paper link, **Import Answer Key** (primary path):
   a "🤖 Copy Prompt for Claude" button copies instructions to clipboard so
   Dr Jon can get another Claude chat to generate an answer key, paste the
   reply (e.g. `ABCDE\nEEDHG\n...`) into a textarea, preview it
   (flags length mismatches / out-of-range letters), and apply it — this
   only touches the on-screen form; nothing is saved to Firebase until
   "💾 Save Set" is clicked. A manual per-question dropdown grid remains
   available below for direct editing/review.

**Backup**: "⬇️ Download Backup to PC" pulls all three top-level Firebase
paths in parallel and downloads one timestamped JSON file; sets a
`localStorage` timestamp used by the Homepage's "last backup N days ago"
reminder (warns at ≥7 days). "⬆️ Restore" does the reverse (`set()`s
whichever of the three sections are present in the uploaded file) with a
destructive-action confirm.

---

## Known limitations / things not built

- No Firebase security rules (accepted risk, see above).
- No automated backup — it's a manual button + a `localStorage` nag, no
  actual scheduling (can't schedule anything from a static page).
- Student-facing "My Progress" chart re-fetches each approved paper's
  submission individually (sequential `await` in a loop) — fine at 5
  students / a handful of papers, would need batching if this scaled up.
- `openStudentDetail` / Homepage activity feed both fetch the *entire*
  `/submissions` tree on every open — same scaling caveat.
- No dark mode / font-size controls (explicitly deprioritized by Dr Jon).
- No "duplicate this paper" shortcut (explicitly not wanted — Dr Jon only
  creates fixed papers via import, students choose from an approved list
  rather than one assigned paper per week).

## Debugging notes for whoever picks this up

Both files were checked with `acorn` (via `npm install acorn` in a scratch
dir) for JS syntax validity, and with a Python regex cross-check of every
`getElementById('...')` call against every `id="..."` in the HTML, to catch
typos/dangling references. Worth re-running both checks after any large
edit — one edit mid-project did silently delete a function declaration line
(caught by this exact process) and briefly broke the whole admin script.

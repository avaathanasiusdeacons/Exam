// مشترك بين كل الـ API: الاتصال بـ Supabase + الامتحانات + التصحيح
// الملفات اللي اسمها بيبدأ بـ _ مش بتبقى لينكات في Vercel.

// بيقبل اللينك حتى لو آخره /rest/v1/ أو فيه مسافات
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();

class UserError extends Error {}

async function db(path, { method = 'GET', body, prefer } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY مش متظبطين في Vercel');
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SUPABASE_KEY; // المفاتيح القديمة (JWT)
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + text);
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;
const toInt = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };

/* ---------------- الامتحانات والأسئلة ---------------- */

async function getExam(id) {
  const n = toInt(id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!n) return null;
  const rows = await db('exams?id=eq.' + n + '&select=*');
  return rows && rows[0] ? rows[0] : null;
}

function normQuestion(r) {
  const type = ['single', 'multi', 'text'].includes(r.type) ? r.type : 'single';
  const choices = (Array.isArray(r.choices) ? r.choices : [])
    .map(c => (typeof c === 'string' ? { text: c } : c || {}))
    .map(c => ({ text: String(c.text || ''), image: c.image || null }))
    .filter(c => c.text.trim() || c.image);
  let answer = Array.isArray(r.answer) ? r.answer : (r.answer == null ? [] : [r.answer]);
  if (type === 'text') answer = answer.map(a => String(a)).filter(a => a.trim());
  else answer = answer.map(a => parseInt(a, 10)).filter(n => n >= 1 && n <= choices.length);
  return { id: r.id, text: String(r.text || ''), image: r.image || null, type: type === 'text' || choices.length ? type : 'text', choices, answer, points: Number(r.points) || 0 };
}

async function readQuestions(examId, { includeInactive = false } = {}) {
  const rows = await db('questions?exam_id=eq.' + toInt(examId, 1, Number.MAX_SAFE_INTEGER, 0) +
    (includeInactive ? '' : '&active=eq.true') + '&select=*&order=position.asc,id.asc');
  return rows.filter(r => includeInactive || String(r.text || '').trim() || r.image).map(r => Object.assign(normQuestion(r), { active: r.active }));
}

const TAG_RE = /\[(ath|newath|cs|shen)\]/i;
const stripTags = s => String(s).replace(/\[\/?(ath|newath|cs|shen)\]/gi, '');
const norm = s => String(s).trim().toLowerCase()
  .replace(/[ً-ْٰـ]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

// مفتاح الاسم للمقارنة: "مينا  بخيت" = "مينا بخيت" = "ميـنا بخيت"
const nameKey = s => String(s).normalize('NFKC').toLowerCase()
  .replace(/[ً-ْٰـ]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// الأسئلة للطالب: من غير الإجابات الصحيحة
function publicQuestions(qs) {
  return qs.map(q => {
    const m = q.type === 'text' && q.answer[0] ? String(q.answer[0]).match(TAG_RE) : null;
    return { text: q.text, image: q.image, type: q.type, choices: q.choices, inputFont: m ? m[1].toLowerCase() : '' };
  });
}

// إجابة الطالب لسؤال: رقم ("2") / أرقام ("1,3") / نص
const parsePicks = a => [...new Set(String(a || '').split(',').map(x => parseInt(x, 10)).filter(n => n >= 1))].sort((x, y) => x - y);
const choiceLabel = c => stripTags(c.text || '').trim() || '[صورة]';

function grade(qs, answers) {
  answers = Array.isArray(answers) ? answers : [];
  let score = 0, total = 0;
  const log = [], review = [], marks = [];
  qs.forEach((q, i) => {
    total += q.points;
    const a = answers[i] == null ? '' : String(answers[i]).trim();
    let ok = false, given = '', item;
    if (q.type === 'text') {
      ok = q.answer.some(acc => norm(stripTags(acc)) === norm(a)) && a !== '';
      given = a;
      item = { text: q.text, image: q.image, type: q.type, choices: [], given: a, correctText: q.answer, ok, points: q.points };
    } else {
      const picks = parsePicks(a).filter(n => n <= q.choices.length);
      const right = q.answer.slice().sort((x, y) => x - y);
      ok = picks.length > 0 && picks.length === right.length && picks.every((p, k) => p === right[k]);
      if (q.type === 'single') ok = picks.length === 1 && right.includes(picks[0]);
      given = picks.map(p => choiceLabel(q.choices[p - 1])).join('، ');
      item = { text: q.text, image: q.image, type: q.type, choices: q.choices, picked: picks, correct: right, ok, points: q.points };
    }
    if (ok) score += q.points;
    marks.push(ok ? q.points : 0);
    log.push((i + 1) + ') ' + (given || '—') + (ok ? ' ✔' : ' ✘'));
    review.push(item);
  });
  return { score, total, log, review, marks };
}

function resultFor(g, exam) {
  const res = { showScore: !!exam.show_score, score: exam.show_score ? g.score : null, total: exam.show_score ? g.total : null };
  if (exam.show_review) {
    res.review = g.review.map(r => {
      const x = Object.assign({}, r);
      if (!exam.review_show_correct) { delete x.correct; delete x.correctText; }
      return x;
    });
  }
  return res;
}

/* ---------------- جلسات الطلبة ---------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function findSession(token) {
  if (!UUID_RE.test(String(token || ''))) return null;
  const rows = await db('sessions?token=eq.' + enc(token) + '&select=*');
  return rows && rows[0] ? rows[0] : null;
}

// آخر ميعاد للطالب: وقت إضافي خاص بيه (deadline) أو بداية الامتحان + المدة
function endsAtOf(sess, exam) {
  if (sess.deadline) return new Date(sess.deadline).getTime();
  return new Date(sess.started_at).getTime() + exam.minutes * 60000;
}

function examPayload(sess, exam, qs) {
  return {
    token: sess.token,
    examId: exam.id,
    name: sess.name,
    title: exam.title,
    minutes: exam.minutes,
    endsAt: endsAtOf(sess, exam),
    serverNow: Date.now(),
    maxLeaves: exam.max_leaves || 0,
    leaves: sess.leaves || 0,
    answers: Array.isArray(sess.answers) ? sess.answers : [],
    questions: publicQuestions(qs)
  };
}

const sanitizeAnswers = a => (Array.isArray(a) ? a : []).slice(0, 500).map(x => (x == null ? '' : String(x).slice(0, 1000)));

async function logEvent(sess, type, detail) {
  try {
    await db('events', { method: 'POST', body: { token: sess.token, name: sess.name, exam_id: sess.exam_id || null, type, detail: detail || null } });
  } catch (e) { console.error('event', e); }
}

// تسليم نهائي (من الطالب، أو تلقائي): بيتسجّل مرة واحدة بس
async function finalize(sess, exam, qs, answers, extraNote) {
  const now = Date.now();
  const elapsed = (now - new Date(sess.started_at).getTime()) / 1000;
  const late = now > endsAtOf(sess, exam) + exam.grace_seconds * 1000;
  const g = grade(qs, answers);
  const notes = [];
  if (extraNote) notes.push(extraNote);
  if (late && !extraNote) notes.push('اتسلّم بعد الوقت');
  if (sess.deadline) notes.push('خد وقت إضافي');
  if (sess.leaves && !(extraNote && extraNote.includes('خرج'))) notes.push('خرج من الصفحة ' + sess.leaves + ' مرة');
  if (sess.shots) notes.push('حاول يصوّر ' + sess.shots + ' مرة');

  const updated = await db('sessions?token=eq.' + enc(sess.token) + '&submitted_at=is.null', {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      submitted_at: new Date(now).toISOString(),
      answers,
      score: g.score,
      total: g.total,
      duration_min: Math.round(elapsed / 6) / 10,
      notes: notes.join(' • '),
      answer_log: g.log.join('\n')
    }
  });
  if (!updated || !updated.length) {
    const fresh = await findSession(sess.token);
    const again = resultFor(grade(qs, (fresh && fresh.answers) || []), exam);
    again.already = true;
    return again;
  }
  await logEvent(sess, 'submit', g.score + ' / ' + g.total + (extraNote ? ' — ' + extraNote : ''));
  return resultFor(g, exam);
}

// غلاف موحّد لكل endpoint: POST + JSON، والأخطاء بتترجع رسالة واضحة
function handler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    try {
      let body = req.body;
      if (typeof body === 'string') body = body ? JSON.parse(body) : {};
      const out = await fn(body || {}, req);
      res.status(200).json(out === undefined ? null : out);
    } catch (e) {
      if (e instanceof UserError) { res.status(400).json({ error: e.message }); return; }
      console.error(e);
      res.status(500).json({ error: 'حصل خطأ في السيرفر. افتح /api/health عشان تعرف السبب.' });
    }
  };
}

module.exports = {
  SUPABASE_URL, SUPABASE_KEY, db, enc, toInt, UserError, handler,
  getExam, readQuestions, normQuestion, publicQuestions, grade, resultFor, parsePicks,
  findSession, endsAtOf, examPayload, sanitizeAnswers, logEvent, finalize,
  stripTags, norm, nameKey
};

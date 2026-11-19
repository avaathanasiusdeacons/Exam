// مشترك بين كل الـ API: الاتصال بـ Supabase + التصحيح
// الملفات اللي اسمها بيبدأ بـ _ مش بتبقى لينكات في Vercel.

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

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

const DEFAULTS = {
  title: 'امتحان الطقس والقبطي', minutes: 15, grace_seconds: 20, is_open: true,
  show_score: true, show_review: true, review_show_correct: true, max_leaves: 3
};
async function getSettings() {
  const rows = await db('exam_settings?id=eq.1&select=*');
  return Object.assign({}, DEFAULTS, rows && rows[0] ? rows[0] : {});
}

async function readQuestions() {
  const rows = await db('questions?active=eq.true&select=*&order=position.asc,id.asc');
  return rows
    .filter(r => String(r.text || '').trim() !== '')
    .map(r => ({
      text: String(r.text),
      choices: [r.choice1, r.choice2, r.choice3, r.choice4].map(c => (c == null ? '' : String(c))).filter(c => c.trim() !== ''),
      correct: String(r.correct == null ? '' : r.correct).trim(),
      points: Number(r.points) || 1
    }));
}

const TAG_RE = /\[(ath|newath|cs|shen)\]/i;
const stripTags = s => String(s).replace(/\[\/?(ath|newath|cs|shen)\]/gi, '');
const norm = s => String(s).trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

// مفتاح الاسم للمقارنة: "مينا  بخيت" = "مينا بخيت" = "ميـنا بخيت"
const nameKey = s => String(s).normalize('NFKC').toLowerCase()
  .replace(/[\u064B-\u0652\u0670\u0640]/g, '')        // التشكيل والتطويل
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// الأسئلة من غير الإجابات الصحيحة
function publicQuestions(qs) {
  return qs.map(q => {
    const m = q.correct.match(TAG_RE);
    return { text: q.text, choices: q.choices, inputFont: !q.choices.length && m ? m[1].toLowerCase() : '' };
  });
}

function correctIndex(q) {
  const n = Number(q.correct);
  if (q.correct !== '' && Number.isInteger(n) && n >= 1 && n <= q.choices.length && String(n) === q.correct) return n;
  const i = q.choices.findIndex(c => stripTags(c).trim() === stripTags(q.correct).trim());
  return i >= 0 ? i + 1 : 0;
}

function grade(qs, answers) {
  answers = Array.isArray(answers) ? answers : [];
  let score = 0, total = 0;
  const log = [], review = [];
  qs.forEach((q, i) => {
    total += q.points;
    const a = answers[i] == null ? '' : String(answers[i]).trim();
    let given = a, ok = false, item;
    if (q.choices.length) {
      const idx = Number(a);
      const pick = Number.isInteger(idx) && idx >= 1 && idx <= q.choices.length ? idx : 0;
      const right = correctIndex(q);
      given = pick ? q.choices[pick - 1] : '';
      ok = pick !== 0 && pick === right;
      item = { text: q.text, choices: q.choices, picked: pick, correct: right, ok, points: q.points };
    } else {
      ok = q.correct !== '' && norm(a) === norm(stripTags(q.correct));
      item = { text: q.text, choices: [], given: a, correctText: q.correct, ok, points: q.points };
    }
    if (ok) score += q.points;
    log.push((i + 1) + ') ' + (stripTags(given) || '—') + (ok ? ' ✔' : ' ✘'));
    review.push(item);
  });
  return { score, total, log, review };
}

function resultFor(g, s) {
  const res = { showScore: !!s.show_score, score: s.show_score ? g.score : null, total: s.show_score ? g.total : null };
  if (s.show_review) {
    res.review = g.review.map(r => {
      const x = Object.assign({}, r);
      if (!s.review_show_correct) { delete x.correct; delete x.correctText; }
      return x;
    });
  }
  return res;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function findSession(token) {
  if (!UUID_RE.test(String(token || ''))) return null;
  const rows = await db('sessions?token=eq.' + encodeURIComponent(token) + '&select=*');
  return rows && rows[0] ? rows[0] : null;
}

// آخر ميعاد للطالب: وقت إضافي خاص بيه (deadline) أو بداية الامتحان + المدة
function endsAtOf(sess, s) {
  if (sess.deadline) return new Date(sess.deadline).getTime();
  return new Date(sess.started_at).getTime() + s.minutes * 60000;
}

function examPayload(sess, s, qs) {
  return {
    token: sess.token,
    name: sess.name,
    title: s.title,
    minutes: s.minutes,
    endsAt: endsAtOf(sess, s),
    serverNow: Date.now(),
    maxLeaves: s.max_leaves || 0,
    leaves: sess.leaves || 0,
    answers: Array.isArray(sess.answers) ? sess.answers : [],
    questions: publicQuestions(qs)
  };
}

const sanitizeAnswers = a => (Array.isArray(a) ? a : []).slice(0, 500).map(x => (x == null ? '' : String(x).slice(0, 500)));

async function logEvent(sess, type, detail) {
  try {
    await db('events', { method: 'POST', body: { token: sess.token, name: sess.name, type, detail: detail || null } });
  } catch (e) { console.error('event', e); }
}

// تسليم نهائي (من الطالب، أو تلقائي لما يخرج كتير): بيتسجّل مرة واحدة بس
async function finalize(sess, s, qs, answers, extraNote) {
  const now = Date.now();
  const elapsed = (now - new Date(sess.started_at).getTime()) / 1000;
  const late = now > endsAtOf(sess, s) + s.grace_seconds * 1000;
  const g = grade(qs, answers);
  const notes = [];
  if (extraNote) notes.push(extraNote);
  if (late) notes.push('اتسلّم بعد الوقت');
  if (sess.deadline) notes.push('خد وقت إضافي');
  if (sess.leaves && !(extraNote && extraNote.includes('خرج'))) notes.push('خرج من الصفحة ' + sess.leaves + ' مرة');
  if (sess.shots) notes.push('حاول يصوّر ' + sess.shots + ' مرة');

  const updated = await db('sessions?token=eq.' + encodeURIComponent(sess.token) + '&submitted_at=is.null', {
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
    const again = resultFor(grade(qs, (fresh && fresh.answers) || []), s);
    again.already = true;
    return again;
  }
  await logEvent(sess, 'submit', g.score + ' / ' + g.total + (extraNote ? ' — ' + extraNote : ''));
  return resultFor(g, s);
}

// غلاف موحّد لكل endpoint: POST + JSON، والأخطاء بتترجع رسالة واضحة للطالب
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
      res.status(500).json({ error: 'حصل خطأ في السيرفر، حاول تاني.' });
    }
  };
}

module.exports = {
  db, getSettings, readQuestions, publicQuestions, grade, resultFor, findSession,
  examPayload, handler, UserError, stripTags, norm, correctIndex, nameKey,
  endsAtOf, sanitizeAnswers, logEvent, finalize, DEFAULTS
};

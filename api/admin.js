// لوحة الأدمن: الامتحانات، الأسئلة، الصور، المتابعة المباشرة، النتائج
// لو ADMIN_PASSWORD متحط في Vercel اللوحة بتطلبه، ولو مش متحط بتفتح على طول
const crypto = require('crypto');
const { db, enc, toInt, getExam, readQuestions, normQuestion, findSession, grade, endsAtOf, logEvent, finalize,
        handler, UserError } = require('./_lib');

function checkPassword(pw) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real) return;
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new UserError('الباسورد غلط.');
}

const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const ID = v => toInt(v, 1, Number.MAX_SAFE_INTEGER, 0);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imgId = v => (v && UUID_RE.test(String(v)) ? String(v) : null);

async function examOrFail(id) {
  const e = await getExam(id);
  if (!e) throw new UserError('الامتحان ده مش موجود.');
  return e;
}
async function sessionOrFail(token) {
  const s = await findSession(token);
  if (!s) throw new UserError('الطالب ده مش موجود (يمكن اتمسح).');
  return s;
}

const EXAM_FIELDS = ['title', 'status', 'minutes', 'grace_seconds', 'max_leaves', 'show_score', 'show_review', 'review_show_correct'];
function cleanExam(x) {
  const out = {};
  if ('title' in x) out.title = str(x.title, 150).trim() || 'امتحان جديد';
  if ('status' in x) out.status = ['draft', 'published', 'closed'].includes(x.status) ? x.status : 'draft';
  if ('minutes' in x) out.minutes = toInt(x.minutes, 1, 600, 15);
  if ('grace_seconds' in x) out.grace_seconds = toInt(x.grace_seconds, 0, 600, 20);
  if ('max_leaves' in x) out.max_leaves = toInt(x.max_leaves, 0, 100, 3);
  ['show_score', 'show_review', 'review_show_correct'].forEach(k => { if (k in x) out[k] = !!x[k]; });
  return out;
}

function cleanQuestion(q) {
  const type = ['single', 'multi', 'text'].includes(q.type) ? q.type : 'single';
  const text = str(q.text, 4000).trim();
  const image = imgId(q.image);
  if (!text && !image) throw new UserError('اكتب نص السؤال أو حط صورة.');
  const body = { text, image, type, points: Math.max(0, Math.min(1000, Number(q.points) || 0)), active: q.active !== false };
  if (type === 'text') {
    const acc = (Array.isArray(q.answer) ? q.answer : [q.answer]).map(a => str(a, 1000).trim()).filter(Boolean).slice(0, 20);
    if (!acc.length) throw new UserError('اكتب الإجابة الصحيحة للسؤال المكتوب.');
    body.choices = [];
    body.answer = acc;
  } else {
    const raw = (Array.isArray(q.choices) ? q.choices : []).slice(0, 10).map(c => ({ text: str(c && c.text, 1000).trim(), image: imgId(c && c.image) }));
    const marked = new Set((Array.isArray(q.answer) ? q.answer : []).map(n => parseInt(n, 10)));
    const kept = [], answer = [];
    raw.forEach((c, i) => {
      if (!c.text && !c.image) return;
      kept.push(c.image ? c : { text: c.text });
      if (marked.has(i + 1)) answer.push(kept.length);
    });
    if (kept.length < 2) throw new UserError('السؤال محتاج اختيارين على الأقل.');
    if (!answer.length) throw new UserError('حدد الإجابة الصحيحة.');
    if (type === 'single' && answer.length > 1) throw new UserError('السؤال "اختيار واحد" ليه إجابة صحيحة واحدة بس. لو فيه أكتر من إجابة صح اختار نوع "أكتر من إجابة".');
    body.choices = kept;
    body.answer = answer;
  }
  return body;
}

const actions = {
  /* ---------- المتابعة المباشرة (كل 4 ثواني) ---------- */
  async live({ since }) {
    const sinceId = toInt(since, 0, Number.MAX_SAFE_INTEGER, 0);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    let [exams, events, active, doneToday] = await Promise.all([
      db('exams?select=id,title,status,minutes,grace_seconds,max_leaves,show_score,show_review,review_show_correct'),
      db('events?id=gt.' + sinceId + '&select=*&order=id.desc&limit=100'),
      db('sessions?submitted_at=is.null&select=token,name,exam_id,started_at,deadline,last_seen,leaves,shots,answers&order=started_at.desc&limit=500'),
      db('sessions?submitted_at=gte.' + enc(today.toISOString()) + '&select=token')
    ]);
    const byId = Object.fromEntries(exams.map(e => [e.id, e]));
    const now = Date.now();
    // اللي وقته خلص من أكتر من دقيقة وصفحته مقفولة، أو امتحانه اتقفل: يتسلّم بآخر إجابات اتحفظت
    const stale = active.filter(x => {
      const e = byId[x.exam_id];
      return !e || e.status !== 'published' || endsAtOf(x, e) + e.grace_seconds * 1000 + 60000 < now;
    });
    for (const x of stale) {
      const e = byId[x.exam_id];
      if (!e) continue;
      const qs = await readQuestions(e.id);
      await finalize(x, e, qs, Array.isArray(x.answers) ? x.answers : [],
        e.status !== 'published' ? 'اتسلّم تلقائي: الامتحان اتقفل' : 'اتسلّم تلقائي بعد الوقت (الصفحة كانت مقفولة)');
    }
    active = active.filter(x => !stale.includes(x));
    return {
      serverNow: now,
      exams: exams.map(e => ({ id: e.id, title: e.title, status: e.status })),
      events: events.map(ev => Object.assign(ev, { exam_title: byId[ev.exam_id] ? byId[ev.exam_id].title : '' })),
      active: active.map(x => ({
        token: x.token, name: x.name, exam_id: x.exam_id, exam_title: byId[x.exam_id].title,
        endsAt: endsAtOf(x, byId[x.exam_id]), last_seen: x.last_seen, leaves: x.leaves, shots: x.shots,
        answered: (x.answers || []).filter(a => String(a || '').trim()).length
      })),
      doneToday: doneToday.length + stale.length
    };
  },

  /* ---------- الامتحانات ---------- */
  async exams() {
    const [exams, qs, ss] = await Promise.all([
      db('exams?select=*&order=position.asc,id.desc'),
      db('questions?select=exam_id,points,active'),
      db('sessions?select=exam_id,submitted_at')
    ]);
    return {
      exams: exams.map(e => {
        const q = qs.filter(x => x.exam_id === e.id && x.active);
        const s = ss.filter(x => x.exam_id === e.id);
        return Object.assign(e, {
          questionCount: q.length,
          totalPoints: q.reduce((a, x) => a + Number(x.points || 0), 0),
          submittedCount: s.filter(x => x.submitted_at).length,
          activeCount: s.filter(x => !x.submitted_at).length
        });
      })
    };
  },

  async saveExam({ exam }) {
    const x = exam || {};
    const body = cleanExam(x);
    let rows;
    if (x.id) {
      await examOrFail(x.id);
      rows = await db('exams?id=eq.' + ID(x.id), { method: 'PATCH', body, prefer: 'return=representation' });
    } else {
      rows = await db('exams', { method: 'POST', body: Object.assign({ status: 'draft' }, body), prefer: 'return=representation' });
    }
    return { exam: rows[0] };
  },

  async setStatus({ id, status }) {
    await examOrFail(id);
    const rows = await db('exams?id=eq.' + ID(id), { method: 'PATCH', body: cleanExam({ status }), prefer: 'return=representation' });
    return { exam: rows[0] };
  },

  async duplicateExam({ id }) {
    const e = await examOrFail(id);
    const copy = {};
    EXAM_FIELDS.forEach(k => { copy[k] = e[k]; });
    copy.title = e.title + ' (نسخة)';
    copy.status = 'draft';
    const [ne] = await db('exams', { method: 'POST', body: copy, prefer: 'return=representation' });
    const qs = await db('questions?exam_id=eq.' + e.id + '&select=*&order=position.asc,id.asc');
    if (qs.length) {
      await db('questions', { method: 'POST', body: qs.map((q, i) => ({
        exam_id: ne.id, position: i + 1, text: q.text, image: q.image, type: q.type, choices: q.choices, answer: q.answer,
        points: q.points, active: q.active
      })) });
    }
    return { exam: ne };
  },

  async deleteExam({ id }) {
    const e = await examOrFail(id);
    await db('exams?id=eq.' + e.id, { method: 'DELETE' });   // الأسئلة والنتائج بتتمسح معاه
    return { ok: true };
  },

  /* ---------- الأسئلة ---------- */
  async questions({ examId }) {
    const e = await examOrFail(examId);
    const rows = await db('questions?exam_id=eq.' + e.id + '&select=*&order=position.asc,id.asc');
    return { exam: e, questions: rows.map(r => Object.assign(normQuestion(r), { active: r.active })) };
  },

  async saveQuestion({ question }) {
    const q = question || {};
    const body = cleanQuestion(q);
    let saved;
    if (q.id) {
      saved = await db('questions?id=eq.' + ID(q.id), { method: 'PATCH', body, prefer: 'return=representation' });
    } else {
      const e = await examOrFail(q.exam_id);
      const last = await db('questions?exam_id=eq.' + e.id + '&select=position&order=position.desc&limit=1');
      body.exam_id = e.id;
      body.position = (last[0] ? last[0].position : 0) + 1;
      saved = await db('questions', { method: 'POST', body, prefer: 'return=representation' });
    }
    return { question: Object.assign(normQuestion(saved[0]), { active: saved[0].active }) };
  },

  async deleteQuestion({ id }) {
    await db('questions?id=eq.' + ID(id), { method: 'DELETE' });
    return { ok: true };
  },

  async reorderQuestions({ ids }) {
    const list = (Array.isArray(ids) ? ids : []).map(ID).filter(Boolean).slice(0, 500);
    for (let i = 0; i < list.length; i++) {
      await db('questions?id=eq.' + list[i], { method: 'PATCH', body: { position: i + 1 } });
    }
    return { ok: true };
  },

  // نسخ أسئلة مختارة من امتحان قديم للامتحان الحالي
  async copyQuestions({ ids, toExamId }) {
    const e = await examOrFail(toExamId);
    const list = (Array.isArray(ids) ? ids : []).map(ID).filter(Boolean).slice(0, 500);
    if (!list.length) throw new UserError('اختار سؤال واحد على الأقل.');
    const src = await db('questions?id=in.(' + list.join(',') + ')&select=*');
    const order = new Map(list.map((id, i) => [id, i]));
    src.sort((a, b) => order.get(a.id) - order.get(b.id));
    const last = await db('questions?exam_id=eq.' + e.id + '&select=position&order=position.desc&limit=1');
    let pos = last[0] ? last[0].position : 0;
    await db('questions', { method: 'POST', body: src.map(q => ({
      exam_id: e.id, position: ++pos, text: q.text, image: q.image, type: q.type, choices: q.choices, answer: q.answer,
      points: q.points, active: true
    })) });
    return { added: src.length };
  },

  // رفع صورة (بتتصغّر في المتصفح الأول)
  async uploadImage({ dataUrl }) {
    const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new UserError('نوع الصورة مش مدعوم. استخدم JPG أو PNG.');
    if (m[2].length > 3.5 * 1024 * 1024) throw new UserError('الصورة كبيرة جدًا.');
    const rows = await db('images', { method: 'POST', body: { mime: m[1], data: m[2] }, prefer: 'return=representation' });
    return { id: rows[0].id };
  },

  /* ---------- النتائج ---------- */
  async results({ examId }) {
    const e = await examOrFail(examId);
    const [rows, qs] = await Promise.all([
      db('sessions?exam_id=eq.' + e.id + '&submitted_at=not.is.null&select=token,name,started_at,submitted_at,deadline,leaves,shots,score,total,duration_min,notes,answer_log,answers&order=submitted_at.desc&limit=5000'),
      readQuestions(e.id)
    ]);
    return {
      exam: e,
      questionCount: qs.length,
      results: rows.map(r => {
        const g = grade(qs, r.answers || []);
        delete r.answers;
        return Object.assign(r, { marks: g.marks });
      })
    };
  },

  // وقت إضافي: لو لسه بيمتحن بيتزوّد على وقته، ولو كان سلّم بيتفتحله تاني بإجاباته القديمة
  async addTime({ token, minutes }) {
    const sess = await sessionOrFail(token);
    const e = await examOrFail(sess.exam_id);
    if (e.status !== 'published') throw new UserError('الامتحان ده مش منشور. انشره الأول عشان الطالب يقدر يكمّل.');
    const add = toInt(minutes, 1, 180, 5) * 60000;
    const now = Date.now();
    if (sess.submitted_at) {
      await db('sessions?token=eq.' + enc(sess.token), {
        method: 'PATCH',
        body: { submitted_at: null, score: null, total: null, duration_min: null, notes: null, answer_log: null,
                leaves: 0, deadline: new Date(now + add).toISOString() }
      });
      await logEvent(sess, 'reopen', (add / 60000) + ' دقيقة' + (sess.leaves ? ' (كان خرج ' + sess.leaves + ' مرة)' : ''));
    } else {
      const base = Math.max(endsAtOf(sess, e), now);
      await db('sessions?token=eq.' + enc(sess.token), { method: 'PATCH', body: { deadline: new Date(base + add).toISOString() } });
      await logEvent(sess, 'extra', 'زيادة ' + (add / 60000) + ' دقيقة');
    }
    return { ok: true };
  },

  async endNow({ token }) {
    const sess = await sessionOrFail(token);
    await db('sessions?token=eq.' + enc(sess.token) + '&submitted_at=is.null', { method: 'PATCH', body: { deadline: new Date().toISOString() } });
    await logEvent(sess, 'ended');
    return { ok: true };
  },

  async endAll({ examId }) {
    const filter = examId ? '&exam_id=eq.' + ID(examId) : '';
    await db('sessions?submitted_at=is.null' + filter, { method: 'PATCH', body: { deadline: new Date().toISOString() } });
    return { ok: true };
  },

  async deleteSession({ token }) {
    const sess = await sessionOrFail(token);
    await db('sessions?token=eq.' + enc(sess.token), { method: 'DELETE' });
    return { ok: true };
  }
};

module.exports = handler(async (body) => {
  checkPassword(body.password);
  const fn = actions[body.action || 'live'];
  if (!fn) throw new UserError('أمر غير معروف.');
  return fn(body);
});

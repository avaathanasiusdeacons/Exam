// لوحة أستاذ مينا (محمية بباسورد ADMIN_PASSWORD):
// متابعة مباشرة + إشعارات، الأسئلة، الإعدادات، النتائج، وقت إضافي/إعادة فتح لطالب
const crypto = require('crypto');
const { db, getSettings, readQuestions, findSession, endsAtOf, logEvent, finalize, handler, UserError, DEFAULTS } = require('./_lib');

function checkPassword(pw) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real) throw new UserError('لازم تحط ADMIN_PASSWORD في إعدادات Vercel الأول.');
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new UserError('الباسورد غلط.');
}

const int = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
const str = (v, max) => (v == null ? '' : String(v)).slice(0, max);
const enc = encodeURIComponent;

const SESSION_FIELDS = 'token,name,started_at,submitted_at,deadline,last_seen,leaves,shots,score,total,duration_min,notes,answer_log,answers';

async function sessionOrFail(token) {
  const sess = await findSession(token);
  if (!sess) throw new UserError('الطالب ده مش موجود (يمكن اتمسح).');
  return sess;
}

const actions = {
  // كل 4 ثواني: الإشعارات الجديدة + اللي بيمتحنوا دلوقتي
  async live({ since }) {
    const sinceId = int(since, 0, Number.MAX_SAFE_INTEGER, 0);
    let [s, events, active, doneCount] = await Promise.all([
      getSettings(),
      db('events?id=gt.' + sinceId + '&select=*&order=id.desc&limit=100'),
      db('sessions?submitted_at=is.null&select=' + SESSION_FIELDS + '&order=started_at.desc&limit=300'),
      db('sessions?submitted_at=not.is.null&select=token')
    ]);
    const now = Date.now();
    // اللي وقته خلص من أكتر من دقيقة وصفحته مقفولة: يتسلّم بآخر إجابات اتحفظت
    const stale = active.filter(x => endsAtOf(x, s) + s.grace_seconds * 1000 + 60000 < now);
    if (stale.length) {
      const qs = await readQuestions();
      for (const x of stale) {
        await finalize(x, s, qs, Array.isArray(x.answers) ? x.answers : [], 'اتسلّم تلقائي بعد الوقت (الصفحة كانت مقفولة)');
      }
      active = active.filter(x => !stale.includes(x));
    }
    return {
      settings: s,
      serverNow: now,
      events,
      active: active.map(x => Object.assign(x, { endsAt: endsAtOf(x, s), answered: (x.answers || []).filter(a => String(a || '').trim()).length, answers: undefined })),
      doneCount: doneCount.length + stale.length
    };
  },

  async results() {
    const rows = await db('sessions?submitted_at=not.is.null&select=' + SESSION_FIELDS + '&order=submitted_at.desc&limit=3000');
    rows.forEach(r => { delete r.answers; });
    return { results: rows };
  },

  async questions() {
    return { questions: await db('questions?select=*&order=position.asc,id.asc') };
  },

  async saveSettings({ settings }) {
    const x = settings || {};
    const body = {
      title: str(x.title, 120).trim() || DEFAULTS.title,
      minutes: int(x.minutes, 1, 600, 15),
      grace_seconds: int(x.grace_seconds, 0, 600, 20),
      max_leaves: int(x.max_leaves, 0, 100, 3),
      is_open: !!x.is_open,
      show_score: !!x.show_score,
      show_review: !!x.show_review,
      review_show_correct: !!x.review_show_correct
    };
    await db('exam_settings?id=eq.1', { method: 'PATCH', body });
    return { settings: await getSettings() };
  },

  async setOpen({ open }) {
    await db('exam_settings?id=eq.1', { method: 'PATCH', body: { is_open: !!open } });
    return { settings: await getSettings() };
  },

  async saveQuestion({ question }) {
    const q = question || {};
    const text = str(q.text, 4000).trim();
    if (!text) throw new UserError('اكتب نص السؤال.');
    let choices = [q.choice1, q.choice2, q.choice3, q.choice4].map(c => str(c, 1000).trim());
    let correct = str(q.correct, 1000).trim();
    if (choices.some(Boolean)) {
      // نشيل الاختيارات الفاضية من النص ونظبط رقم الإجابة الصحيحة
      const idx = parseInt(correct, 10);
      const kept = [];
      let newCorrect = 0;
      choices.forEach((c, i) => { if (c) { kept.push(c); if (i + 1 === idx) newCorrect = kept.length; } });
      if (kept.length < 2) throw new UserError('السؤال الاختياري محتاج اختيارين على الأقل.');
      if (!newCorrect) throw new UserError('حدد الإجابة الصحيحة.');
      choices = kept.concat(['', '', '', '']).slice(0, 4);
      correct = String(newCorrect);
    } else if (!correct) {
      throw new UserError('اكتب الإجابة الصحيحة للسؤال المقالي.');
    }
    const body = {
      text,
      choice1: choices[0] || null, choice2: choices[1] || null, choice3: choices[2] || null, choice4: choices[3] || null,
      correct,
      points: Math.max(0, Math.min(1000, Number(q.points) || 1)),
      active: q.active !== false
    };
    let saved;
    if (q.id) {
      saved = await db('questions?id=eq.' + int(q.id, 1, Number.MAX_SAFE_INTEGER, 0), { method: 'PATCH', body, prefer: 'return=representation' });
    } else {
      const last = await db('questions?select=position&order=position.desc&limit=1');
      body.position = (last[0] ? last[0].position : 0) + 1;
      saved = await db('questions', { method: 'POST', body, prefer: 'return=representation' });
    }
    return { question: saved[0] };
  },

  async deleteQuestion({ id }) {
    await db('questions?id=eq.' + int(id, 1, Number.MAX_SAFE_INTEGER, 0), { method: 'DELETE' });
    return { ok: true };
  },

  async reorderQuestions({ ids }) {
    const list = (Array.isArray(ids) ? ids : []).map(x => int(x, 1, Number.MAX_SAFE_INTEGER, 0)).filter(Boolean).slice(0, 500);
    for (let i = 0; i < list.length; i++) {
      await db('questions?id=eq.' + list[i], { method: 'PATCH', body: { position: i + 1 } });
    }
    return { ok: true };
  },

  // وقت إضافي: لو لسه بيمتحن بيتزوّد على وقته، ولو كان سلّم بيتفتحله الامتحان تاني بإجاباته القديمة
  async addTime({ token, minutes }) {
    const sess = await sessionOrFail(token);
    const s = await getSettings();
    const add = int(minutes, 1, 180, 5) * 60000;
    const now = Date.now();
    if (sess.submitted_at) {
      await db('sessions?token=eq.' + enc(sess.token), {
        method: 'PATCH',
        body: { submitted_at: null, score: null, total: null, duration_min: null, notes: null, answer_log: null,
                leaves: 0, deadline: new Date(now + add).toISOString() }
      });
      await logEvent(sess, 'reopen', (add / 60000) + ' دقيقة' + (sess.leaves ? ' (كان خرج ' + sess.leaves + ' مرة)' : ''));
    } else {
      const base = Math.max(endsAtOf(sess, s), now);
      await db('sessions?token=eq.' + enc(sess.token), { method: 'PATCH', body: { deadline: new Date(base + add).toISOString() } });
      await logEvent(sess, 'extra', 'زيادة ' + (add / 60000) + ' دقيقة');
    }
    return { ok: true };
  },

  // إنهاء امتحان طالب دلوقتي (أو الكل): الوقت بيخلص وصفحته بتسلّم لوحدها
  async endNow({ token }) {
    const sess = await sessionOrFail(token);
    await db('sessions?token=eq.' + enc(sess.token) + '&submitted_at=is.null', { method: 'PATCH', body: { deadline: new Date().toISOString() } });
    await logEvent(sess, 'ended');
    return { ok: true };
  },

  async endAll() {
    await db('sessions?submitted_at=is.null', { method: 'PATCH', body: { deadline: new Date().toISOString() } });
    return { ok: true };
  },

  // مسح طالب: يقدر يدخل الامتحان تاني بنفس الاسم
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

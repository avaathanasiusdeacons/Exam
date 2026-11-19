// التسليم: بيتصحّح على السيرفر، وبيتحفظ مرة واحدة بس (محدش يقدر يعدّل بعد كده)
const { db, getSettings, readQuestions, findSession, grade, resultFor, handler, UserError } = require('./_lib');

const clampInt = v => Math.max(0, Math.min(999, parseInt(v, 10) || 0));

module.exports = handler(async ({ token, answers, meta }) => {
  const sess = await findSession(token);
  if (!sess) throw new UserError('الجلسة غير موجودة.');
  const [s, qs] = await Promise.all([getSettings(), readQuestions()]);

  if (sess.submitted_at) {
    const again = resultFor(grade(qs, sess.answers || []), s);
    again.already = true;
    return again;
  }

  const now = Date.now();
  const elapsed = (now - new Date(sess.started_at).getTime()) / 1000;
  const late = elapsed > s.minutes * 60 + s.grace_seconds;
  answers = (Array.isArray(answers) ? answers : []).slice(0, 500).map(a => (a == null ? '' : String(a).slice(0, 500)));
  meta = meta || {};
  const leaves = clampInt(meta.leaves), shots = clampInt(meta.shots);

  const g = grade(qs, answers);
  const notes = [];
  if (late) notes.push('اتسلّم بعد الوقت');
  if (leaves) notes.push('خرج من الصفحة ' + leaves + ' مرة');
  if (shots) notes.push('حاول يصوّر ' + shots + ' مرة');

  // الشرط submitted_at=is.null بيضمن إن التسليم يتسجّل مرة واحدة حتى لو اتبعت مرتين في نفس اللحظة
  const updated = await db('sessions?token=eq.' + encodeURIComponent(sess.token) + '&submitted_at=is.null', {
    method: 'PATCH',
    prefer: 'return=representation',
    body: {
      submitted_at: new Date(now).toISOString(),
      answers,
      score: g.score,
      total: g.total,
      duration_min: Math.round(elapsed / 6) / 10,
      leaves, shots,
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
  return resultFor(g, s);
});

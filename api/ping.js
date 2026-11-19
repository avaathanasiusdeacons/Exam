// نبضة من صفحة الطالب كل شوية + فورًا لما يخرج من الصفحة أو يرجع أو يحاول يصوّر:
//  - بتحفظ إجاباته أول بأول على السيرفر
//  - بتسجّل إشعار لأستاذ مينا (فلان خرج / رجع / حاول يصوّر)
//  - بترجّع آخر ميعاد (لو الأدمن زوّد وقت) أو إن الامتحان اتسلّم
const { db, getSettings, readQuestions, findSession, grade, resultFor, finalize, sanitizeAnswers,
        endsAtOf, logEvent, handler } = require('./_lib');

const EVENTS = { leave: 'leave', back: 'back', shot: 'shot' };

module.exports = handler(async ({ token, answers, event }) => {
  const sess = await findSession(token);
  if (!sess) return { gone: true };
  const s = await getSettings();

  if (sess.submitted_at) {
    const qs = await readQuestions();
    const res = resultFor(grade(qs, sess.answers || []), s);
    res.submitted = true;
    return res;
  }

  const patch = { last_seen: new Date().toISOString() };
  if (Array.isArray(answers)) patch.answers = sanitizeAnswers(answers);
  const type = EVENTS[event];
  if (type === 'leave') patch.leaves = (sess.leaves || 0) + 1;
  if (type === 'shot') patch.shots = (sess.shots || 0) + 1;

  await db('sessions?token=eq.' + encodeURIComponent(sess.token), { method: 'PATCH', body: patch });
  Object.assign(sess, patch);

  if (type) {
    const detail = type === 'leave' ? 'المرة رقم ' + patch.leaves : type === 'shot' ? 'المحاولة رقم ' + patch.shots : null;
    await logEvent(sess, type, detail);
  }

  // تعدّى الحد المسموح للخروج ← الامتحان يتسلّم لوحده بآخر إجابات محفوظة
  if (type === 'leave' && s.max_leaves > 0 && patch.leaves >= s.max_leaves) {
    const qs = await readQuestions();
    const res = await finalize(sess, s, qs, sess.answers || [], 'اتسلّم تلقائي: خرج من الصفحة ' + patch.leaves + ' مرات');
    res.submitted = true;
    res.forced = true;
    return res;
  }

  return { endsAt: endsAtOf(sess, s), serverNow: Date.now(), leaves: sess.leaves || 0, maxLeaves: s.max_leaves || 0 };
});

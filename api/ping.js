// نبضة من صفحة الطالب كل شوية + فورًا لما يخرج من الصفحة أو يرجع أو يحاول يصوّر:
//  - بتحفظ إجاباته أول بأول على السيرفر
//  - بتسجّل إشعار للأدمن (فلان خرج / رجع / حاول يصوّر)
//  - بترجّع آخر ميعاد (لو الأدمن زوّد وقت) أو إن الامتحان اتسلّم
const { db, enc, getExam, readQuestions, findSession, grade, resultFor, finalize, sanitizeAnswers,
        endsAtOf, logEvent, handler } = require('./_lib');

const EVENTS = { leave: 'leave', back: 'back', shot: 'shot' };

module.exports = handler(async ({ token, answers, event }) => {
  const sess = await findSession(token);
  if (!sess) return { gone: true };
  const exam = await getExam(sess.exam_id);
  if (!exam) return { gone: true };
  const done = res => Object.assign(res, { submitted: true, name: sess.name, examId: exam.id, title: exam.title });

  if (sess.submitted_at) {
    const qs = await readQuestions(exam.id);
    return done(resultFor(grade(qs, sess.answers || []), exam));
  }

  const patch = { last_seen: new Date().toISOString() };
  if (Array.isArray(answers)) patch.answers = sanitizeAnswers(answers);
  const type = EVENTS[event];
  if (type === 'leave') patch.leaves = (sess.leaves || 0) + 1;
  if (type === 'shot') patch.shots = (sess.shots || 0) + 1;
  await db('sessions?token=eq.' + enc(sess.token), { method: 'PATCH', body: patch });
  Object.assign(sess, patch);

  if (type) {
    const detail = type === 'leave' ? 'المرة رقم ' + patch.leaves : type === 'shot' ? 'المحاولة رقم ' + patch.shots : null;
    await logEvent(sess, type, detail);
  }

  // الأدمن قفل الامتحان، أو الطالب عدّى الحد المسموح للخروج ← يتسلّم لوحده بآخر إجابات
  const forcedByLeaves = type === 'leave' && exam.max_leaves > 0 && patch.leaves >= exam.max_leaves;
  if (exam.status !== 'published' || forcedByLeaves) {
    const qs = await readQuestions(exam.id);
    const note = forcedByLeaves ? 'اتسلّم تلقائي: خرج من الصفحة ' + patch.leaves + ' مرات' : 'اتسلّم تلقائي: الامتحان اتقفل';
    const res = await finalize(sess, exam, qs, sess.answers || [], note);
    return done(Object.assign(res, { forced: forcedByLeaves ? 'leaves' : 'closed' }));
  }

  return { endsAt: endsAtOf(sess, exam), serverNow: Date.now(), leaves: sess.leaves || 0, maxLeaves: exam.max_leaves || 0 };
});

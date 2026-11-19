// لو الطالب عمل refresh: يكمّل بنفس الوقت، ولو كان سلّم يشوف نتيجته (للعرض بس)
const { getExam, readQuestions, findSession, examPayload, grade, resultFor, finalize, permFor, handler } = require('./_lib');

module.exports = handler(async ({ token }) => {
  const sess = await findSession(token);
  if (!sess) return null;
  const exam = await getExam(sess.exam_id);
  if (!exam) return null;
  const qs = await readQuestions(exam.id);

  let res;
  if (sess.submitted_at) {
    res = resultFor(grade(qs, sess.answers || []), exam, permFor(sess, qs));
  } else if (exam.status !== 'published') {
    // الأدمن قفل الامتحان وهو لسه بيمتحن: يتسلّم بآخر إجابات اتحفظت
    res = await finalize(sess, exam, qs, sess.answers || [], 'اتسلّم تلقائي: الامتحان اتقفل');
  } else {
    return examPayload(sess, exam, qs);
  }
  return Object.assign(res, { submitted: true, name: sess.name, examId: exam.id, title: exam.title });
});

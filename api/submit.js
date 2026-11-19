// التسليم: بيتصحّح على السيرفر، وبيتحفظ مرة واحدة بس (محدش يقدر يعدّل بعد كده)
const { getExam, readQuestions, findSession, grade, resultFor, finalize, sanitizeAnswers, permFor, toCanonical, handler, UserError } = require('./_lib');

module.exports = handler(async ({ token, answers }) => {
  const sess = await findSession(token);
  if (!sess) throw new UserError('الجلسة غير موجودة.');
  const exam = await getExam(sess.exam_id);
  if (!exam) throw new UserError('الامتحان ده اتمسح.');
  const qs = await readQuestions(exam.id);

  let res;
  if (sess.submitted_at) {
    res = resultFor(grade(qs, sess.answers || []), exam, permFor(sess, qs));
    res.already = true;
  } else {
    // الطالب باعت الإجابات بترتيبه هو ← بنرجّعها للترتيب الأصلي قبل التصحيح والحفظ
    res = await finalize(sess, exam, qs, toCanonical(sanitizeAnswers(answers), permFor(sess, qs), qs.length));
  }
  return Object.assign(res, { name: sess.name, examId: exam.id, title: exam.title });
});

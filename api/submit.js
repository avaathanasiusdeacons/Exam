// التسليم: بيتصحّح على السيرفر، وبيتحفظ مرة واحدة بس (محدش يقدر يعدّل بعد كده)
const { getSettings, readQuestions, findSession, grade, resultFor, finalize, sanitizeAnswers, handler, UserError } = require('./_lib');

module.exports = handler(async ({ token, answers }) => {
  const sess = await findSession(token);
  if (!sess) throw new UserError('الجلسة غير موجودة.');
  const [s, qs] = await Promise.all([getSettings(), readQuestions()]);

  if (sess.submitted_at) {
    const again = resultFor(grade(qs, sess.answers || []), s);
    again.already = true;
    return again;
  }
  return finalize(sess, s, qs, sanitizeAnswers(answers));
});

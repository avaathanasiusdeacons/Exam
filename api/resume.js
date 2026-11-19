// لو الطالب عمل refresh: يكمّل بنفس الوقت، ولو كان سلّم يشوف نتيجته ومراجعته (للعرض بس)
const { getSettings, readQuestions, findSession, examPayload, grade, resultFor, handler } = require('./_lib');

module.exports = handler(async ({ token }) => {
  const sess = await findSession(token);
  if (!sess) return null;
  const [s, qs] = await Promise.all([getSettings(), readQuestions()]);
  if (sess.submitted_at) {
    const res = resultFor(grade(qs, sess.answers || []), s);
    res.submitted = true;
    res.name = sess.name;
    return res;
  }
  return examPayload(sess, s, qs);
});

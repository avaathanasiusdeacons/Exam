// الطالب اختار امتحان وضغط "ابدأ": بنسجّل وقت البدء على السيرفر
const { db, getExam, readQuestions, examPayload, handler, UserError, nameKey, shuffledIds } = require('./_lib');

module.exports = handler(async ({ name, examId }) => {
  const exam = await getExam(examId);
  if (!exam || exam.status !== 'published') throw new UserError('الامتحان ده مش متاح دلوقتي.');
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new UserError('من فضلك اكتب اسمك بالكامل.');
  if (name.length > 100) throw new UserError('الاسم طويل جدًا.');
  const key = nameKey(name);
  if (key.replace(/\s/g, '').length < 3) throw new UserError('من فضلك اكتب اسمك بالكامل.');

  const qs = await readQuestions(exam.id);
  if (!qs.length) throw new UserError('الامتحان ده لسه مفيهوش أسئلة.');

  let rows;
  try {
    rows = await db('sessions', { method: 'POST', body: { exam_id: exam.id, name, name_key: key, q_order: exam.shuffle === false ? null : shuffledIds(qs) }, prefer: 'return=representation' });
  } catch (e) {
    if (/Supabase 409/.test(e.message) || /23505/.test(e.message)) {
      throw new UserError('الاسم ده دخل الامتحان ده قبل كده. لو ده اسمك ومحتاج تدخل تاني، كلّم المدرس.');
    }
    throw e;
  }
  return examPayload(rows[0], exam, qs);
});

// الطالب كتب اسمه وضغط "ابدأ الامتحان": بنسجّل وقت البدء على السيرفر
const { db, getSettings, readQuestions, examPayload, handler, UserError, nameKey } = require('./_lib');

module.exports = handler(async ({ name }) => {
  const s = await getSettings();
  if (!s.is_open) throw new UserError('الامتحان مقفول حاليًا.');
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new UserError('من فضلك اكتب اسمك بالكامل.');
  if (name.length > 100) throw new UserError('الاسم طويل جدًا.');

  const key = nameKey(name);
  if (key.replace(/\s/g, '').length < 3) throw new UserError('من فضلك اكتب اسمك بالكامل.');

  let rows;
  try {
    rows = await db('sessions', { method: 'POST', body: { name, name_key: key }, prefer: 'return=representation' });
  } catch (e) {
    // 23505 = الاسم موجود قبل كده (unique index)
    if (/Supabase 409/.test(e.message) || /23505/.test(e.message)) {
      throw new UserError('الاسم ده دخل الامتحان قبل كده. لو ده اسمك ومحتاج تدخل تاني، كلّم أستاذ مينا.');
    }
    throw e;
  }
  const qs = await readQuestions();
  return examPayload(rows[0], s, qs);
});

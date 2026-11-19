// الطالب كتب اسمه وضغط "ابدأ الامتحان": بنسجّل وقت البدء على السيرفر
const { db, getSettings, readQuestions, examPayload, handler, UserError } = require('./_lib');

module.exports = handler(async ({ name }) => {
  const s = await getSettings();
  if (!s.is_open) throw new UserError('الامتحان مقفول حاليًا.');
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new UserError('من فضلك اكتب اسمك بالكامل.');
  if (name.length > 100) throw new UserError('الاسم طويل جدًا.');

  const [qs, rows] = await Promise.all([
    readQuestions(),
    db('sessions', { method: 'POST', body: { name }, prefer: 'return=representation' })
  ]);
  return examPayload(rows[0], s, qs);
});

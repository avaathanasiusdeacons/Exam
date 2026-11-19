// قايمة الامتحانات المنشورة للطلبة
const { db, handler } = require('./_lib');

module.exports = handler(async () => {
  const exams = await db('exams?status=eq.published&select=id,title,minutes&order=position.asc,id.desc');
  if (!exams.length) return { exams: [] };
  const qs = await db('questions?active=eq.true&select=exam_id&exam_id=in.(' + exams.map(e => e.id).join(',') + ')');
  return {
    exams: exams.map(e => ({ id: e.id, title: e.title, minutes: e.minutes, count: qs.filter(q => q.exam_id === e.id).length }))
  };
});

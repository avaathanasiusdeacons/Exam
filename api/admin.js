// صفحة أستاذ مينا: النتائج + فتح/قفل الامتحان (محمية بباسورد ADMIN_PASSWORD)
const crypto = require('crypto');
const { db, getSettings, handler, UserError } = require('./_lib');

function checkPassword(pw) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real) throw new UserError('لازم تحط ADMIN_PASSWORD في إعدادات Vercel الأول.');
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  if (!crypto.timingSafeEqual(a, b)) throw new UserError('الباسورد غلط.');
}

module.exports = handler(async ({ password, action, open }) => {
  checkPassword(password);

  if (action === 'setOpen') {
    await db('exam_settings?id=eq.1', { method: 'PATCH', body: { is_open: !!open } });
  }

  const [s, done, inProgress] = await Promise.all([
    getSettings(),
    db('sessions?submitted_at=not.is.null&select=name,submitted_at,started_at,score,total,duration_min,leaves,shots,notes,answer_log&order=submitted_at.desc&limit=2000'),
    db('sessions?submitted_at=is.null&select=name,started_at&order=started_at.desc&limit=500')
  ]);
  return { settings: { title: s.title, is_open: s.is_open, minutes: s.minutes }, results: done, inProgress };
});

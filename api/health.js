// صفحة فحص: افتح /api/health في المتصفح عشان تعرف لو فيه حاجة ناقصة في الإعداد
// (مش بتعرض أي مفاتيح أو بيانات طلبة)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const RAW_URL = (process.env.SUPABASE_URL || '').trim();

async function probe(path) {
  try {
    const headers = { apikey: SUPABASE_KEY };
    if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SUPABASE_KEY;
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers });
    const text = await r.text();
    return { status: r.status, text };
  } catch (e) {
    return { status: 0, text: String(e && e.message || e) };
  }
}

function explain(res, what) {
  if (res.status === 200) return null;
  const t = res.text || '';
  if (res.status === 0) return 'مش قادر يوصل لـ Supabase. اتأكد إن SUPABASE_URL مكتوب صح (زي https://xxxx.supabase.co).';
  if (res.status === 401 || res.status === 403 || /Invalid API key|No API key|JWT/i.test(t))
    return 'المفتاح SUPABASE_SERVICE_ROLE_KEY غلط أو اتمسح. انسخ مفتاح secret جديد من Supabase وحطه في Vercel، وبعدين Redeploy.';
  if (/does not exist|Could not find the table|PGRST205|42P01/i.test(t))
    return 'الجدول "' + what + '" مش موجود. شغّل ملف supabase/schema.sql في Supabase ← SQL Editor ← Run.';
  if (/column .* does not exist|PGRST204|42703|Could not find the .* column/i.test(t))
    return 'قاعدة البيانات نسخة قديمة. شغّل ملف supabase/schema.sql الجديد في Supabase ← SQL Editor ← Run.';
  if (/permission denied|42501/i.test(t))
    return 'المفتاح مالوش صلاحية. اتأكد إنه مفتاح secret / service_role مش publishable / anon.';
  return 'خطأ ' + res.status + ': ' + t.slice(0, 200);
}

module.exports = async (req, res) => {
  const checks = [];
  const add = (label, ok, hint) => checks.push({ label, ok, hint });

  add('SUPABASE_URL متحط في Vercel', !!SUPABASE_URL,
    'ضيف SUPABASE_URL في Vercel ← Settings ← Environment Variables، وبعدين Redeploy.');
  add('SUPABASE_URL شكله صح', /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(RAW_URL),
    'لازم يكون بالشكل ده بالظبط من غير أي حاجة في آخره: https://xxxx.supabase.co');
  add('SUPABASE_SERVICE_ROLE_KEY متحط في Vercel', !!SUPABASE_KEY,
    'ضيف SUPABASE_SERVICE_ROLE_KEY (المفتاح السري من Supabase) في Vercel، وبعدين Redeploy.');
  add('المفتاح نوعه سري (secret / service_role)', !/^sb_publishable_/.test(SUPABASE_KEY) && !!SUPABASE_KEY,
    'ده مفتاح publishable. لازم المفتاح السري: sb_secret_... أو service_role.');

  if (SUPABASE_URL && SUPABASE_KEY) {
    const tests = [
      ['جدول الامتحانات (exams)', 'exams?select=id,status,max_leaves,shuffle&limit=1', 'exams'],
      ['جدول الأسئلة (questions)', 'questions?select=id,exam_id,type,choices,answer,image&limit=1', 'questions'],
      ['جدول الصور (images)', 'images?select=id&limit=1', 'images'],
      ['جدول الطلبة (sessions)', 'sessions?select=token,exam_id,name_key,deadline,last_seen,q_order&limit=1', 'sessions'],
      ['جدول الإشعارات (events)', 'events?select=id,exam_id&limit=1', 'events']
    ];
    for (const [label, path, table] of tests) {
      const r = await probe(path);
      const hint = explain(r, table);
      add(label, !hint, hint);
      if (r.status === 401 || r.status === 0) break;   // المشكلة في الاتصال، مفيش داعي نكمّل
    }
    const ex = await probe('exams?select=id&status=eq.published');
    if (ex.status === 200) {
      let n = 0; try { n = JSON.parse(ex.text).length; } catch (e) {}
      add('فيه امتحانات منشورة للطلبة (' + n + ')', n > 0, 'مفيش امتحان منشور: ادخل /admin ← الامتحانات واضغط "انشر".');
    }
  }

  const allOk = checks.every(c => c.ok);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = checks.map(c => '<li class="' + (c.ok ? 'ok' : 'bad') + '"><b>' + (c.ok ? '✅' : '❌') + ' ' + esc(c.label) + '</b>' +
    (c.ok ? '' : '<div>' + esc(c.hint) + '</div>') + '</li>').join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>فحص الإعداد</title><style>body{font-family:Tahoma,Arial;background:#f5eedd;color:#2b1d14;max-width:720px;margin:30px auto;padding:0 16px}' +
    'h1{color:#6b1f14}li{background:#fffdf7;border:1px solid #e8dcc2;border-radius:12px;padding:12px 14px;margin:8px 0;list-style:none}' +
    'li.bad{border-color:#eba59e;background:#fbe9e7}li div{margin-top:6px;color:#b3261e}ul{padding:0}.sum{font-size:20px;font-weight:bold}</style>' +
    '<h1>فحص إعداد الامتحان</h1><p class="sum">' + (allOk ? '✅ كله تمام، الموقع جاهز.' : '❌ فيه حاجة محتاجة تتظبط، شوف الخطوات الحمرا تحت:') + '</p>' +
    '<ul>' + rows + '</ul></html>');
};

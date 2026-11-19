-- =====================================================================
--  امتحان الطقس والقبطي — قاعدة البيانات
--  انسخ الملف ده كله والزقه في Supabase ← SQL Editor ← Run
--  آمن تشغّله أكتر من مرة: بيضيف الناقص بس ومش بيمسح أي بيانات
-- =====================================================================

-- 1) إعدادات الامتحان (صف واحد بس — عدّله من Table Editor والتغيير بيشتغل على طول)
create table if not exists public.exam_settings (
  id                  int primary key default 1 check (id = 1),
  title               text    not null default 'امتحان الطقس والقبطي',
  minutes             int     not null default 15,      -- مدة الامتحان بالدقائق
  grace_seconds       int     not null default 20,      -- سماحية بطء النت عند التسليم
  is_open             boolean not null default true,    -- false = الامتحان مقفول
  show_score          boolean not null default true,    -- الطالب يشوف درجته
  show_review         boolean not null default true,    -- الطالب يراجع إجاباته بعد التسليم
  review_show_correct boolean not null default true     -- يظهر له الإجابة الصحيحة
);
alter table public.exam_settings add column if not exists max_leaves int not null default 3;  -- بعد كام خروج الامتحان يتسلّم لوحده (0 = مفيش حد)
insert into public.exam_settings (id) values (1) on conflict (id) do nothing;

-- 2) الأسئلة
--   الكلام القبطي بين علامات: [ath]...[/ath] أو [shen]...[/shen] أو [newath]...[/newath] أو [cs]...[/cs]
--   correct = رقم الاختيار الصحيح (1..4)، أو نص الإجابة لو السؤال مقالي (الاختيارات فاضية)
create table if not exists public.questions (
  id        bigserial primary key,
  position  int     not null default 0,     -- ترتيب السؤال في الامتحان
  text      text    not null,
  choice1   text,
  choice2   text,
  choice3   text,
  choice4   text,
  correct   text    not null default '',
  points    numeric not null default 1,
  active    boolean not null default true   -- false = السؤال مش هيظهر
);

-- 3) الطلبة (كل دخول للامتحان = صف، وبعد التسليم بيتملي بالدرجة)
create table if not exists public.sessions (
  token         uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 3 and 100),
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  answers       jsonb,
  score         numeric,
  total         numeric,
  duration_min  numeric,
  leaves        int not null default 0,     -- كام مرة خرج من الصفحة
  shots         int not null default 0,     -- كام مرة حاول يصوّر
  notes         text,
  answer_log    text
);
create index if not exists sessions_submitted_idx on public.sessions (submitted_at desc);

-- الاسم مينفعش يدخل الامتحان مرتين (المقارنة بتتجاهل المسافات والهمزات والتاء المربوطة والتشكيل)
alter table public.sessions add column if not exists name_key text;
create unique index if not exists sessions_name_key_uq on public.sessions (name_key);

-- وقت إضافي لطالب معيّن (لو اتحدد، بيبقى هو آخر ميعاد للطالب ده) + آخر مرة الصفحة كانت مفتوحة
alter table public.sessions add column if not exists deadline  timestamptz;
alter table public.sessions add column if not exists last_seen timestamptz;

-- 3ب) الإشعارات: خروج من الصفحة / رجوع / محاولة تصوير / تسليم ...
create table if not exists public.events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  token      uuid,
  name       text,
  type       text not null,
  detail     text
);
create index if not exists events_created_idx on public.events (id desc);

-- 4) عرض النتائج (للقراية بس) — افتحه من Table Editor
create or replace view public.results with (security_invoker = true) as
  select submitted_at as "وقت التسليم", name as "الاسم", score as "الدرجة", total as "من",
         duration_min as "المدة (دقيقة)", notes as "ملاحظة", answer_log as "الإجابات"
  from public.sessions
  where submitted_at is not null
  order by submitted_at desc;

-- 5) الحماية: محدش يقدر يقرا أو يكتب في الجداول دي من المتصفح.
--    الموقع بيكلّم قاعدة البيانات من السيرفر بس (Vercel) بالمفتاح السري.
alter table public.exam_settings enable row level security;
alter table public.questions     enable row level security;
alter table public.sessions      enable row level security;
alter table public.events        enable row level security;
revoke all on public.exam_settings, public.questions, public.sessions, public.events, public.results from anon, authenticated;

-- 6) الأسئلة العشرة (بتتضاف بس لو جدول الأسئلة فاضي)
insert into public.questions (position, text, choice1, choice2, choice3, choice4, correct, points)
select * from (values
  (1, $q$الرجل معناها [ath].......Rwmi[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]`Q[/ath]$q$, $q$[ath]`P[/ath]$q$, null, $q$1$q$, 1),
  (2, $q$الأخت معناها [ath].......Cwni[/ath]$q$, $q$[ath]:[/ath]$q$, $q$[ath]`T[/ath]$q$, $q$كلاهما$q$, null, $q$3$q$, 1),
  (3, $q$الله معناها [ath].......nou;[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]`Q[/ath]$q$, $q$[ath]`P[/ath]$q$, null, $q$1$q$, 1),
  (4, $q$البحر معناها [ath].......iom[/ath]$q$, $q$[ath]`Q[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]:[/ath]$q$, null, $q$2$q$, 1),
  (5, $q$الملك معناها [ath].......ouro[/ath]$q$, $q$[ath]`P[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]`T[/ath]$q$, null, $q$1$q$, 1),
  (6, $q$الأيقونة معناها [ath].......[/ath][shen]h[/shen][ath]ikwn[/ath]$q$, $q$[ath]:[/ath]$q$, $q$[ath]Pi[/ath]$q$, $q$[ath]`V[/ath]$q$, null, $q$1$q$, 1),
  (7, $q$الأرض معناها [ath].......Ka[/ath][shen]h[/shen][ath]i[/ath]$q$, $q$[ath]`P[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]`T[/ath]$q$, null, $q$1$q$, 1),
  (8, $q$النساء معناها [ath].......[/ath][shen]h[/shen][ath]iomi[/ath]$q$, $q$[ath]:[/ath]$q$, $q$[ath]Pi[/ath]$q$, $q$[ath]Ni[/ath]$q$, null, $q$3$q$, 1),
  (9, $q$الرجال معناها [ath].......Rwmi[/ath]$q$, $q$[ath]Ni[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]`T[/ath]$q$, null, $q$1$q$, 1),
  (10, $q$الأم معناها [ath].......mau[/ath]$q$, $q$[ath]`V[/ath]$q$, $q$[ath]`P[/ath]$q$, $q$[ath]`Q[/ath]$q$, null, $q$3$q$, 1)
) as v(position, text, choice1, choice2, choice3, choice4, correct, points)
where not exists (select 1 from public.questions);

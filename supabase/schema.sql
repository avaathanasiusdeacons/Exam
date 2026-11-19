-- =====================================================================
--  موقع امتحانات — مدرسة البابا أثناسيوس الرسولي للألحان
--  انسخ الملف ده كله والزقه في Supabase ← SQL Editor ← Run
--  آمن تشغّله أكتر من مرة: بيضيف الناقص بس، وبينقل البيانات القديمة لو موجودة، ومش بيمسح حاجة
-- =====================================================================

-- 1) الامتحانات: كل امتحان ليه إعداداته، والأدمن بيحدد اللي يتنشر
create table if not exists public.exams (
  id                  bigserial primary key,
  title               text    not null default 'امتحان جديد',
  status              text    not null default 'draft' check (status in ('draft', 'published', 'closed')),
                      -- draft = مسودة (محدش شايفه) / published = منشور للطلبة / closed = مقفول (النتائج محفوظة)
  minutes             int     not null default 15,
  grace_seconds       int     not null default 20,
  max_leaves          int     not null default 3,      -- بعد كام خروج من الصفحة الامتحان يتسلّم لوحده (0 = مفيش حد)
  show_score          boolean not null default true,
  show_review         boolean not null default true,
  review_show_correct boolean not null default true,
  position            int     not null default 0,
  created_at          timestamptz not null default now()
);

-- 2) الصور (أسئلة واختيارات) — بتتخزن هنا وبتتعرض من /api/img
create table if not exists public.images (
  id         uuid primary key default gen_random_uuid(),
  mime       text not null,
  data       text not null,                -- base64
  created_at timestamptz not null default now()
);

-- 3) الأسئلة
create table if not exists public.questions (
  id        bigserial primary key,
  position  int     not null default 0,
  text      text    not null default '',
  points    numeric not null default 1,
  active    boolean not null default true
);
alter table public.questions add column if not exists exam_id bigint references public.exams(id) on delete cascade;
alter table public.questions add column if not exists type    text not null default 'single';  -- single / multi / text
alter table public.questions add column if not exists image   text;     -- id صورة السؤال (اختياري)
alter table public.questions add column if not exists choices jsonb;    -- [{"text": "...", "image": "id"}]
alter table public.questions add column if not exists answer  jsonb;    -- single/multi: [رقم الاختيار,...]  text: ["إجابة مقبولة", ...]
-- أعمدة النسخة القديمة (بتتنقل تلقائي تحت)
alter table public.questions add column if not exists choice1 text;
alter table public.questions add column if not exists choice2 text;
alter table public.questions add column if not exists choice3 text;
alter table public.questions add column if not exists choice4 text;
alter table public.questions add column if not exists correct text;
alter table public.questions alter column text set default '';
create index if not exists questions_exam_idx on public.questions (exam_id, position);

-- 4) الطلبة: كل دخول لامتحان = صف
create table if not exists public.sessions (
  token         uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 3 and 100),
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  answers       jsonb,
  score         numeric,
  total         numeric,
  duration_min  numeric,
  leaves        int not null default 0,
  shots         int not null default 0,
  notes         text,
  answer_log    text
);
alter table public.sessions add column if not exists exam_id   bigint references public.exams(id) on delete cascade;
alter table public.sessions add column if not exists name_key  text;
alter table public.sessions add column if not exists deadline  timestamptz;
alter table public.sessions add column if not exists last_seen timestamptz;
create index if not exists sessions_submitted_idx on public.sessions (submitted_at desc);
create index if not exists sessions_exam_idx on public.sessions (exam_id);

-- 5) الإشعارات (خرج / رجع / حاول يصوّر / سلّم ...)
create table if not exists public.events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  token      uuid,
  name       text,
  type       text not null,
  detail     text
);
alter table public.events add column if not exists exam_id bigint;
create index if not exists events_created_idx on public.events (id desc);

-- 6) نقل البيانات من النسخة القديمة (امتحان واحد) لو موجودة
do $$
declare
  first_exam bigint;
  has_old_settings boolean := to_regclass('public.exam_settings') is not null;
begin
  if not exists (select 1 from public.exams) then
    if has_old_settings then
      execute $q$
        insert into public.exams (title, status, minutes, grace_seconds, max_leaves, show_score, show_review, review_show_correct)
        select title, case when is_open then 'published' else 'closed' end, minutes, grace_seconds,
               coalesce((to_jsonb(s) ->> 'max_leaves')::int, 3), show_score, show_review, review_show_correct
        from public.exam_settings s where id = 1
      $q$;
    end if;
    if not exists (select 1 from public.exams) then
      insert into public.exams (title, status) values ('امتحان الطقس والقبطي', 'published');
    end if;
  end if;
  select min(id) into first_exam from public.exams;

  update public.questions q set
    exam_id = first_exam,
    type    = case when coalesce(choice1, '') = '' and coalesce(choice2, '') = '' then 'text' else 'single' end,
    choices = (select coalesce(jsonb_agg(jsonb_build_object('text', c) order by n), '[]'::jsonb)
               from unnest(array[q.choice1, q.choice2, q.choice3, q.choice4]) with ordinality as t(c, n)
               where coalesce(c, '') <> ''),
    answer  = case
                when coalesce(choice1, '') = '' and coalesce(choice2, '') = '' then jsonb_build_array(coalesce(correct, ''))
                when correct ~ '^[0-9]+$' then jsonb_build_array(correct::int)
                else '[]'::jsonb
              end
  where q.exam_id is null;

  update public.sessions set exam_id = first_exam where exam_id is null;
  update public.events   set exam_id = first_exam where exam_id is null;
end $$;

-- الاسم مينفعش يدخل نفس الامتحان مرتين (بس يقدر يدخل امتحانات تانية)
drop index if exists public.sessions_name_key_uq;
create unique index if not exists sessions_exam_name_uq on public.sessions (exam_id, name_key);

-- 7) عرض النتائج (للقراية من Table Editor)
drop view if exists public.results;
create view public.results with (security_invoker = true) as
  select e.title as "الامتحان", s.submitted_at as "وقت التسليم", s.name as "الاسم", s.score as "الدرجة", s.total as "من",
         s.duration_min as "المدة (دقيقة)", s.notes as "ملاحظة", s.answer_log as "الإجابات"
  from public.sessions s join public.exams e on e.id = s.exam_id
  where s.submitted_at is not null
  order by s.submitted_at desc;

-- 8) الحماية: الجداول مقفولة قدام المتصفح، والموقع بيكلّمها من السيرفر بس بالمفتاح السري
alter table public.exams     enable row level security;
alter table public.images    enable row level security;
alter table public.questions enable row level security;
alter table public.sessions  enable row level security;
alter table public.events    enable row level security;
revoke all on public.exams, public.images, public.questions, public.sessions, public.events, public.results from anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- 9) أسئلة الامتحان الأول (بتتضاف بس لو مفيش أسئلة خالص)
insert into public.questions (exam_id, position, text, type, choices, answer, points)
select (select min(id) from public.exams), v.position, v.text, 'single', v.choices::jsonb, v.answer::jsonb, 1
from (values
  (1, $q$الرجل معناها [ath].......Rwmi[/ath]$q$, $q$[{"text":"[ath]`V[/ath]"},{"text":"[ath]`Q[/ath]"},{"text":"[ath]`P[/ath]"}]$q$, '[1]'),
  (2, $q$الأخت معناها [ath].......Cwni[/ath]$q$, $q$[{"text":"[ath]:[/ath]"},{"text":"[ath]`T[/ath]"},{"text":"كلاهما"}]$q$, '[3]'),
  (3, $q$الله معناها [ath].......nou;[/ath]$q$, $q$[{"text":"[ath]`V[/ath]"},{"text":"[ath]`Q[/ath]"},{"text":"[ath]`P[/ath]"}]$q$, '[1]'),
  (4, $q$البحر معناها [ath].......iom[/ath]$q$, $q$[{"text":"[ath]`Q[/ath]"},{"text":"[ath]`V[/ath]"},{"text":"[ath]:[/ath]"}]$q$, '[2]'),
  (5, $q$الملك معناها [ath].......ouro[/ath]$q$, $q$[{"text":"[ath]`P[/ath]"},{"text":"[ath]`V[/ath]"},{"text":"[ath]`T[/ath]"}]$q$, '[1]'),
  (6, $q$الأيقونة معناها [ath].......[/ath][shen]h[/shen][ath]ikwn[/ath]$q$, $q$[{"text":"[ath]:[/ath]"},{"text":"[ath]Pi[/ath]"},{"text":"[ath]`V[/ath]"}]$q$, '[1]'),
  (7, $q$الأرض معناها [ath].......Ka[/ath][shen]h[/shen][ath]i[/ath]$q$, $q$[{"text":"[ath]`P[/ath]"},{"text":"[ath]`V[/ath]"},{"text":"[ath]`T[/ath]"}]$q$, '[1]'),
  (8, $q$النساء معناها [ath].......[/ath][shen]h[/shen][ath]iomi[/ath]$q$, $q$[{"text":"[ath]:[/ath]"},{"text":"[ath]Pi[/ath]"},{"text":"[ath]Ni[/ath]"}]$q$, '[3]'),
  (9, $q$الرجال معناها [ath].......Rwmi[/ath]$q$, $q$[{"text":"[ath]Ni[/ath]"},{"text":"[ath]`V[/ath]"},{"text":"[ath]`T[/ath]"}]$q$, '[1]'),
  (10, $q$الأم معناها [ath].......mau[/ath]$q$, $q$[{"text":"[ath]`V[/ath]"},{"text":"[ath]`P[/ath]"},{"text":"[ath]`Q[/ath]"}]$q$, '[3]')
) as v(position, text, choices, answer)
where not exists (select 1 from public.questions);

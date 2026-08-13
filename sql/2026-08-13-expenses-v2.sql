-- ============================================================
-- 지출 관리 2차: 결제수단 + 정기결제 + 고정비 분류 (2026-08-13)
-- 실행 위치: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- 기존 지출 데이터는 그대로 유지됩니다 (컬럼만 추가)
-- ============================================================

-- ------------------------------------------------------------
-- [1] payment_methods — 결제수단 목록 (추가·수정·삭제 가능)
-- ------------------------------------------------------------
create table if not exists public.payment_methods (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 기본 결제수단 (이미 있으면 건너뜀)
insert into public.payment_methods (name, sort_order) values
  ('현금', 1), ('신한카드', 2), ('하나카드', 3), ('네이버포인트', 4), ('계좌이체', 5)
on conflict (name) do nothing;

alter table public.payment_methods enable row level security;
drop policy if exists "admins full access to payment methods" on public.payment_methods;
create policy "admins full access to payment methods" on public.payment_methods
  for all to authenticated using (true) with check (true);


-- ------------------------------------------------------------
-- [2] recurring_expenses — 정기결제 항목
--     결제일이 되면 관리자 화면에서 확인 후 등록하는 방식.
--     (자동 기록하지 않음 — 실제로 나가지 않은 돈이 장부에 쌓이는 것을 막기 위함)
-- ------------------------------------------------------------
create table if not exists public.recurring_expenses (
  id bigint generated always as identity primary key,
  name text not null,                       -- 예: 인터넷 (KT)
  amount numeric(14,2) not null,
  currency text not null default 'KRW',
  day_of_month smallint not null,           -- 1~31, 99 = 말일
  category text not null,
  payment_method text,
  memo text,
  active boolean not null default true,     -- 해지 시 false
  created_at timestamptz not null default now()
);

alter table public.recurring_expenses enable row level security;
drop policy if exists "admins full access to recurring" on public.recurring_expenses;
create policy "admins full access to recurring" on public.recurring_expenses
  for all to authenticated using (true) with check (true);


-- ------------------------------------------------------------
-- [3] expenses 테이블에 컬럼 추가
--     payment_method: 결제수단
--     recurring_id : 어떤 정기결제로 등록된 건인지 (중복 등록 방지용)
-- ------------------------------------------------------------
alter table public.expenses add column if not exists payment_method text;
alter table public.expenses add column if not exists recurring_id bigint
  references public.recurring_expenses(id) on delete set null;

create index if not exists expenses_recurring_idx on public.expenses (recurring_id);


-- ------------------------------------------------------------
-- [4] 확인용 — RLS 꺼진 테이블이 없어야 정상 (0줄이면 안전)
-- ------------------------------------------------------------
select tablename as "RLS 꺼진 테이블"
from pg_tables
where schemaname = 'public' and rowsecurity = false;


-- ============================================================
-- 되돌리기(롤백) — 문제가 생겼을 때만 실행
-- ============================================================
-- alter table public.expenses drop column if exists recurring_id;
-- alter table public.expenses drop column if exists payment_method;
-- drop table if exists public.recurring_expenses;
-- drop table if exists public.payment_methods;

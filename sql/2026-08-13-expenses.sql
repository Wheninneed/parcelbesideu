-- ============================================================
-- 지출 관리 기능 (2026-08-13)
-- 실행 위치: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- ============================================================

-- ------------------------------------------------------------
-- [1] expenses 테이블 — 운영비 지출 내역
-- ------------------------------------------------------------
create table if not exists public.expenses (
  id bigint generated always as identity primary key,
  spent_on date not null,                       -- 지출 날짜
  category text not null,                       -- 광고비 / 인쇄물 / 사무실 비품 / 기타
  amount numeric(14,2) not null,                -- 입력한 원래 금액
  currency text not null default 'KRW',         -- KRW 또는 USD
  exchange_rate numeric(12,4),                  -- USD일 때 1달러당 원화 (KRW면 비워둠)
  amount_krw numeric(14,2) not null,            -- 원화 환산 금액 (모든 합계의 기준)
  vendor text,                                  -- 지출처
  memo text,
  photo_path text,                              -- 첨부 사진 경로 (비공개 저장소)

  -- 광고비일 때만 사용하는 상세 항목
  ad_platform text,                             -- Instagram / Facebook / Naver ...
  ad_target_age text,                           -- 예: 20-35
  ad_target_gender text,                        -- 전체 / 남성 / 여성
  ad_radius_km numeric(8,2),                    -- 타겟 반경 (km)
  ad_period text,                               -- 예: 8/1 ~ 8/7
  ad_note text,                                 -- 광고 코멘트

  created_at timestamptz not null default now()
);

create index if not exists expenses_spent_on_idx on public.expenses (spent_on desc);

-- 보안: 지출은 사업 정보이므로 로그인한 관리자만 접근 (비로그인 전면 차단)
alter table public.expenses enable row level security;

drop policy if exists "admins full access to expenses" on public.expenses;

create policy "admins full access to expenses" on public.expenses
  for all to authenticated
  using (true) with check (true);


-- ------------------------------------------------------------
-- [2] expense-photos 저장소 — 지출 첨부 사진 (비공개)
--     public = false 이므로 링크만으로는 열람 불가.
--     관리자 페이지에서 임시 서명 링크를 만들어 표시한다.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('expense-photos', 'expense-photos', false)
on conflict (id) do nothing;

drop policy if exists "admins read expense photos" on storage.objects;
drop policy if exists "admins upload expense photos" on storage.objects;
drop policy if exists "admins delete expense photos" on storage.objects;

create policy "admins read expense photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-photos');

create policy "admins upload expense photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expense-photos');

create policy "admins delete expense photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'expense-photos');


-- ------------------------------------------------------------
-- [3] 확인용 — RLS 꺼진 테이블이 없어야 정상 (0줄이면 안전)
-- ------------------------------------------------------------
select tablename as "RLS 꺼진 테이블"
from pg_tables
where schemaname = 'public' and rowsecurity = false;


-- ============================================================
-- 되돌리기(롤백) — 문제가 생겼을 때만 실행
-- ============================================================
-- drop table if exists public.expenses;
-- delete from storage.buckets where id = 'expense-photos';

-- ============================================================
-- 방문 통계용 site_visits 테이블 (2026-07-21)
-- 실행 위치: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- ============================================================

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  visitor_id text not null,          -- 브라우저별 익명 랜덤 ID (개인정보 아님)
  page text not null,                -- 방문한 페이지 경로 (예: /faq)
  referrer text,                     -- 유입 출처 URL (외부에서 왔을 때만)
  utm_source text,                   -- 홍보 링크의 utm_source 값 (있을 때만)
  created_at timestamptz not null default now()
);

create index if not exists site_visits_created_at_idx
  on public.site_visits (created_at);

alter table public.site_visits enable row level security;

-- 방문 기록 남기기: 누구나 가능 (사이트 방문자가 익명으로 기록)
create policy "anyone can insert visits" on public.site_visits
  for insert to anon, authenticated
  with check (true);

-- 통계 조회: admin.html에 로그인한 관리자만 가능
create policy "admins can read visits" on public.site_visits
  for select to authenticated
  using (true);

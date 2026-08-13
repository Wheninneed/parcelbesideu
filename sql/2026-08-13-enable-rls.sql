-- ============================================================
-- 보안 수정: RLS(행 단위 보안) 활성화 (2026-08-13)
-- Supabase 보안 경고 "Table publicly accessible" 대응
--
-- 실행 위치: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- 되돌리기: 이 파일 맨 아래 주석의 롤백 SQL 참고
-- ============================================================


-- ------------------------------------------------------------
-- [1] message_templates — 고객 주소록 (이름·전화번호·현관코드)
--     현재: 누구나 읽기/수정/삭제 가능 ← 심각
--     변경: 로그인한 관리자만 접근. 비로그인 접근은 전면 차단
--     영향: admin-templates.html은 로그인 후에만 데이터를 부르므로 정상 동작
-- ------------------------------------------------------------
alter table public.message_templates enable row level security;

drop policy if exists "admins full access to templates" on public.message_templates;

create policy "admins full access to templates" on public.message_templates
  for all
  to authenticated
  using (true)
  with check (true);


-- ------------------------------------------------------------
-- [2] site_settings — 영업시간·결제수단·추천쇼핑몰·FAQ
--     현재: 누구나 읽기/수정/삭제 가능 ← 수정 권한이 문제
--     변경: 읽기는 모두 허용(고객 페이지에 표시되어야 함),
--           수정/추가/삭제는 로그인한 관리자만
--     영향: 고객 페이지 표시 정상, admin 저장 기능 정상
-- ------------------------------------------------------------
alter table public.site_settings enable row level security;

drop policy if exists "anyone can read settings" on public.site_settings;
drop policy if exists "admins can update settings" on public.site_settings;
drop policy if exists "admins can insert settings" on public.site_settings;
drop policy if exists "admins can delete settings" on public.site_settings;

create policy "anyone can read settings" on public.site_settings
  for select to anon, authenticated using (true);

create policy "admins can update settings" on public.site_settings
  for update to authenticated using (true) with check (true);

create policy "admins can insert settings" on public.site_settings
  for insert to authenticated with check (true);

create policy "admins can delete settings" on public.site_settings
  for delete to authenticated using (true);


-- ------------------------------------------------------------
-- [3] 확인용 — 실행 후 남아 있는 위험 테이블 점검
--     결과가 0줄이면 public 스키마의 모든 테이블이 보호된 상태
-- ------------------------------------------------------------
select tablename as "RLS 꺼진 테이블"
from pg_tables
where schemaname = 'public' and rowsecurity = false;


-- ============================================================
-- 되돌리기(롤백) — 문제가 생겼을 때만 실행
-- ============================================================
-- alter table public.message_templates disable row level security;
-- alter table public.site_settings disable row level security;

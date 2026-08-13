# Parcel Beside U

캠프 험프리스(평택 안정리) 미군·카투사 대상 **한국 주소 대여 + 택배 보관 + 구매 대행** 서비스의 웹사이트.
프로덕션: https://www.parcelbesideu.com/ (Vercel 배포)

## 비즈니스 개요

- **위치**: 캠프 험프리스 안정리 보행자 게이트(Walking Gate) 도보 5분. 경기 평택시 팽성읍 안정순환로 104번길 32, 1층 11호
- **고객**: 미군 장병·군무원·가족, 카투사(KATUSA). 연락처 010-6749-1519, SNS @parcelbesideu (페이스북/인스타그램)
- **해결하는 문제**: ① APO 사서함으로는 쿠팡/네이버쇼핑 등 국내 택배 수령 불가 ② 외국인은 본인인증/한국 카드가 없어 국내 온라인 쇼핑 어려움

### 서비스 라인업 · 요금
1. **Package Holding** — 사무실 주소로 택배 수령·보관, 고객이 직접 픽업. 택배 3개까지 **$7 / ₩10,000**, 4개째부터 개당 $1 / ₩1,500 추가
2. **Order & Hold** — 대신 주문·결제 후 사무실 보관. 물품가 5% 수수료 + $7 보관료
3. **Order & Deliver** — 대신 주문 후 게이트/집까지 배달. 5% 수수료 + $7 보관료 + 배달비

## 기술 스택

- **정적 사이트**: HTML5 + Vanilla JS(ES6+, async/await) + CSS3. 빌드 도구 없음, 프레임워크 없음
- **디자인**: Notion/Oopy 스타일 미니멀 UI. Pretendard & Inter 폰트, 얇은 보더, 옅은 hover, 카드 중심
- **DB**: Supabase (프로젝트: `ankpcatdvcumwdjwptvp`). `@supabase/supabase-js@2` CDN 사용, 클라이언트에서 직접 호출. URL/anon key는 `app.js`와 각 admin HTML에 하드코딩됨
- **호스팅**: Vercel, `vercel.json`에 `"cleanUrls": true` (확장자 없는 URL)
- **로컬 실행**: `npx serve` (포트 3000). 정적 서버면 무엇이든 가능

## 데이터 모델 — `message_templates` 단일 테이블

템플릿·FAQ·안내멘트·주소록이 전부 이 한 테이블에 저장된다.

- `id` (PK) / `sheet_name` (탭 구분: `'주소'`, `'안내멘트'`, `'FAQ'` 등) / `category` (건물·그룹명 또는 소분류) / `title` (고객 이름 또는 템플릿 제목) / `content` (본문 또는 JSON 문자열) / `sort_order` (드래그 정렬 순서) / `created_at`

### ⚠️ '주소' 탭 핵심 규칙 (깨뜨리지 말 것)
주소록 상세 필드는 별도 컬럼이 아니라 **`content` 컬럼 안에 JSON 문자열**로 직렬화되어 있다:

```json
{
  "address": "경기 평택시 팽성읍 안정순환로 104번길 32, 1층 11호",
  "zip_code": "17983",
  "city": "평택시",
  "state": "경기도",
  "phone": "010-1234-5678",
  "gate_code": "🔑#1234",
  "comment": "배송 요청사항 메모"
}
```

- 읽을 때는 반드시 `try { JSON.parse(t.content) } catch { ... }` 폴백 유지 (구버전 평문 데이터 호환)
- 이 구조를 바꾸는 스키마 마이그레이션은 하지 않는다

## 보안 모델 (RLS) — 2026-08-13 적용

Supabase anon key는 클라이언트 코드에 노출되는 것이 정상이며, **실제 보호는 전적으로 RLS가 담당**한다. 모든 테이블은 RLS가 켜져 있어야 하고, 새 테이블을 만들 때도 반드시 정책을 함께 정의한다.

| 테이블 | 비로그인(anon) | 로그인(authenticated) |
|---|---|---|
| `message_templates` (고객 주소록·PII) | 접근 전면 차단 | 전체 읽기·쓰기 |
| `site_settings` (영업시간·FAQ·쇼핑몰) | 읽기만 | 읽기·쓰기 |
| `site_visits` (방문 통계) | 기록(insert)만 | 읽기 |
| `expenses` (운영비 지출) | 접근 전면 차단 | 전체 읽기·쓰기 |
| `payment_methods` (결제수단 목록) | 접근 전면 차단 | 전체 읽기·쓰기 |
| `recurring_expenses` (정기결제) | 접근 전면 차단 | 전체 읽기·쓰기 |

저장소(Storage): `images`는 공개(쇼핑몰 로고용), `expense-photos`는 **비공개** — 지출 첨부 사진은 서명 링크(`createSignedUrl`)로만 열람

적용 SQL: `sql/2026-08-13-enable-rls.sql`, `sql/2026-07-21-site-visits.sql`, `sql/2026-08-13-expenses.sql`, `sql/2026-08-13-expenses-v2.sql`

지출 분류는 5종 고정: 광고비 / 인쇄물 / 사무실 비품 / 고정비 / 기타.
정기결제는 **자동 기록하지 않는다** — 결제일이 지나면 화면에 알림을 띄우고 사장이 확인 후 등록하는 방식(실제로 나가지 않은 돈이 장부에 쌓이는 것을 방지). 등록한 달(`created_at`) 이전 달은 "미등록"으로 표시하지 않는다.

주의사항:
- `message_templates`에는 고객 이름·주소·전화번호·현관 출입코드가 들어 있다. 이 테이블을 비로그인에 열어주는 변경은 절대 금지
- 관리자 페이지(`admin*.html`)는 로그인 세션 확인 후에만 데이터를 로드하는 구조 — 이 순서를 깨지 말 것
- 새 테이블 추가 시 `alter table ... enable row level security` + 정책을 같은 SQL에 포함

### 배포 노출 규칙 (중요)

Vercel 정적 배포라 **저장소의 모든 파일이 `parcelbesideu.com/<파일명>`으로 공개된다.** `.vercelignore`에 없으면 전부 노출. GitHub를 비공개로 바꿔도 이건 그대로다(배포본은 별개).

- 새 파일을 추가할 때마다 "이게 웹에 공개돼도 되는가"를 판단하고, 아니면 `.vercelignore`에 추가
- 현재 제외: `*.md`, `sql/`, `vercel-admin-live.txt`, `update-nav.js`, `_*.html`
- anon key가 HTML에 보이는 것은 정상(공개용). 보호는 전적으로 RLS가 담당
- `service_role` 키는 클라이언트 코드에 **절대** 넣지 않는다 (RLS를 무시하는 마스터 키)

### 보안 점검 체크리스트 (기능 추가·배포 전마다 실행)

1. 새 테이블/버킷에 RLS·정책이 걸렸는가 → `select tablename from pg_tables where schemaname='public' and rowsecurity=false;` 결과가 0줄
2. 비로그인 상태에서 새 테이블 조회·쓰기가 차단되는가 (anon key로 실제 요청해 확인)
3. 새로 추가한 파일이 웹에 노출되는가 → 배포 후 URL로 직접 접근해 404 확인
4. 민감 키가 코드·커밋 이력에 들어갔는가 → `service_role`, `.env`, JWT payload의 `role` 확인
5. 저장한 사진·첨부는 공개 버킷인가 비공개 버킷인가 (지출 첨부는 비공개 + 서명 링크)

## 파일 구조

```
index.html               # 메인 랜딩 (카투사 배너 + 네비 포함)
package-holding.html     # 미군용 영문 가이드 (주소 복사 버튼)
package-holding-ko.html  # 카투사/한국인용 한글 가이드
online-shopping-1.html   # Order & Hold 안내
online-shopping-2.html   # Order & Deliver 안내
stores.html              # 추천 한국 쇼핑몰 목록
faq.html / about.html    # FAQ, 소개
admin.html               # 관리자 대시보드
admin-faq.html           # 관리자 FAQ 관리
admin-templates.html     # 관리자 템플릿/주소록 스프레드시트 (드래그 정렬, 그룹 관리)
admin-expenses.html      # 관리자 지출 관리 (분류별 집계, 광고 상세, 달러 환산, 사진 첨부)
styles.css               # 전역 테마 (.katusa-banner, 반응형 포함)
app.js                   # Supabase 연결, 동적 데이터 로딩, 클립보드 복사
vercel.json              # cleanUrls 설정
```

## 구현된 주요 기능

- **카투사 배너**(index): "🇰🇷 카투사도 이용 가능합니다!" + 한글 가이드 링크
- **한글 가이드**(package-holding-ko): 원화 우선 표기, 통합 한국 주소 한 줄 복사, 택배사 이름 마스킹 주의 안내, `복사 완료!` 피드백
- **admin-templates 스프레드시트**: 기본은 읽기(복사) 모드, ✏️ Edit Mode 토글로 인라인 편집·드래그 정렬(`sort_order` upsert)·그룹 관리
- **'주소' 탭 그룹화**: `category` 기준 건물별 노란 헤더(🏢 림하우스, 힐사이드…), 그룹명 일괄 변경, 그룹 삭제 시 "주민까지 삭제 / '개별 주소'로 이동" 분기, 긴 코멘트 3줄 말줄임 + 클릭 아코디언

## 작업 규칙

- 사용자와는 **한국어**로 소통. 사용자는 코딩 초보자 — 터미널/git 절차는 상세히 안내
- Notion/Oopy 미니멀 스타일 유지 (부드러운 색, 얇은 보더, 절제된 hover)
- `message_templates`의 JSON-in-content 구조 절대 훼손 금지
- 작업 완료 시 수정/생성한 파일 목록을 명시 (예: `[NEW] package-holding-ko.html`, `[MODIFY] styles.css`)
- 사이트는 미군 고객용 영문 + 카투사/한국인용 국문 이중 구조 — 고객 노출 문구 수정 시 두 언어 버전 모두 확인

# 드라이브 헤더/검색 정리 (타이틀 중복 제거 + 검색 통합)

## 배경

드라이브 페이지 상단에 "드라이브"라는 텍스트가 세 번 반복 표시된다:
사이드바 헤더(`DriveSidebar.tsx:109`), 페이지 타이틀 `<PageHeader title="드라이브">`
(`DrivePage.tsx:460`), 브레드크럼 루트 버튼(`DrivePage.tsx:512`). 또한 검색창이
두 개 존재한다 — 헤더의 파일명 검색(`SearchInput`, 현재 공간 스코프)과 본문의
콘텐츠 검색(`DriveSearchBar`, 테넌트 전역 스코프, AI Overview 포함). 사용자가
화면을 보고 혼란스러워한 것이 계기.

## 범위

1. 페이지 타이틀 제거 (브레드크럼만 유지)
2. 두 검색창을 헤더의 검색 입력 1개로 통합 (파일명 + 콘텐츠 동시 검색)
3. embedded 모드(채팅 드로워 내 드라이브 등)에도 통합 검색 적용
4. 콘텐츠 검색 스코프를 전역 → 현재 공간으로 제한 (백엔드 변경)
5. 디자인 시스템 문서 갱신 (PageHeader title optional화, 신규 검색 결과 그룹 패턴)

**범위 제외**: 검색 UX의 추가 기능(필터, 정렬), 콘텐츠 검색 자체의 랭킹/하이브리드
로직 변경, Q&A/전역 검색(별도 이슈 영역).

## 1. 타이틀 중복 제거

- `DrivePage.tsx`에서 `<PageHeader title="드라이브" .../>` 의 `title` prop 제거.
- `PageHeader` 컴포넌트(`components/layout/PageHeader.tsx`)의 `title` prop을
  **optional**로 변경 — 현재 필수(`04-components.md:73-75`). title이 없으면
  좌측 제목 영역을 렌더링하지 않고 `actions` 슬롯만 표시.
- 브레드크럼(`drive-breadcrumb`)이 유일한 위치 표시자가 된다. 루트 버튼 텍스트
  "드라이브"는 그대로 유지 (사이드바와는 다른 계층 — 폴더 경로의 시작점이므로
  중복이 아님).
- 다른 페이지에 영향 없음 (title 지정 시 기존과 동일하게 동작, optional 추가만).
- `docs/design-system/04-components.md`의 PageHeader 정의를 "title(선택, 좌측
  제목 — 생략 시 다른 위치 표시자로 대체 가능)"으로 갱신.

## 2. 검색 통합

### 동작

- 헤더에 검색 입력 1개 (`SearchInput`, 기존 위치 유지). placeholder는 기존
  "이 공간에서 검색..." 유지, `aria-label="파일명 및 콘텐츠 검색"`으로 변경
  (기존 "드라이브 검색"에서 역할 명확화).
- 입력 300ms debounce, 2자 이상일 때만 검색 트리거 (기존 파일명 검색 조건과
  동일 — 콘텐츠 검색도 동일 조건이라 그대로 재사용).
- 트리거 시 **두 API를 동시 호출**:
  - 파일명 검색: `driveApi.search(spaceId, q)` (기존, 변경 없음)
  - 콘텐츠 검색: `searchDriveContent(q, spaceId)` (아래 3번 백엔드 변경 반영)
- 본문의 독립된 `<DriveSearchBar>` 블록(`DrivePage.tsx:554`)은 제거. 그 로직
  (debounce 제거하고 상위 debounce에 합류, snippet 렌더링, AI Overview 버튼)은
  `DrivePage.tsx`의 검색 결과 렌더링으로 흡수.

### 결과 표시 (신규 패턴 — design-system에 없음)

검색 중(`searching`)일 때 결과 영역을 두 그룹으로 표시:

```
[검색 입력]

파일명 일치 (N)
  📁 폴더명           경로
  📄 파일명.ext        경로

내용 일치 (M)
  📄 파일명.ext   "…스니펫 하이라이트…"   [스페이스뱃지]

  [✦ AI Overview 보기]   ← !embedded 일 때만
```

- 그룹 소제목("파일명 일치" / "내용 일치")은 `.label` 스타일(작은 uppercase
  보조 텍스트류, 기존 `text-muted-foreground text-xs` 패턴 재사용).
- 결과 없는 그룹은 숨김. 두 그룹 모두 없으면 기존 "검색 결과 없음" 문구 유지.
- 같은 파일이 양쪽 그룹에 나타날 수 있음 (파일명+내용 둘 다 일치) — 중복 제거
  하지 않고 일치 근거로 구분해 그대로 노출.
- AI Overview 버튼: `bg-ai-accent-subtle text-ai-accent` 토큰 사용
  (`01-design-tokens.md:207-226`, 기존 AI 강조 색상 재사용, 신규 색 도입 아님).
  `!embedded`일 때만 렌더링 — embedded(채팅 드로워 등 소형 뷰)는 공간이 좁아
  AI Overview를 숨기고 리스트만 표시.
- 이 패턴은 구현 완료 후 `docs/design-system/05-page-patterns.md`에
  "검색 결과 다중 그룹 표시" 패턴으로 기록.

### embedded 모드

- 기존에는 embedded에서 파일명 검색만 가능했음(`DriveSearchBar`가
  `!embedded` 조건으로 아예 숨겨져 있었음). 통합 후에는 embedded도 동일한
  검색 입력 1개로 파일명+콘텐츠 동시 검색 (AI Overview만 제외).

## 3. 백엔드: 콘텐츠 검색 스코프를 공간 단위로 제한

- `DriveContentSearchController.search`: `@RequestParam(required = false) Long spaceId`
  추가.
- `DriveContentSearchService.search(userId, q, limit, spaceId)`: spaceId를
  repository로 전달.
- `DriveContentSearchRepository.hybridSearch`: SQL에 `spaceId != null` 이면
  `AND drive_file.space_id = :spaceId` 조건 추가 (RLS/멤버십 필터는 기존 유지,
  단순 스코프 좁히기이므로 한도(limit) 내 결과가 공간 밖 파일에 밀려나는 문제도
  함께 해결됨).
- 마이그레이션 없음 (기존 컬럼 활용).
- 프론트 `searchDriveContent` API 함수에 `spaceId` 파라미터 추가.

## 4. 테스트

- 백엔드: `DriveContentSearchService`/`Repository` 통합 테스트에 spaceId 필터
  케이스 추가 (다른 공간의 일치 파일이 결과에서 빠지는지).
- 프론트 E2E (`apps/workplace-web/e2e/pages/` 드라이브 관련 spec):
  - 페이지 타이틀 미노출 확인 (`drive-page` 내 title 텍스트 부재)
  - 검색 입력 1개에 입력 시 파일명 API + 콘텐츠 API 두 요청이 모두 발생하는지
    (`page.route()` 모킹 후 postDataJSON/query 검증)
  - 결과 그룹 2개(파일명 일치/내용 일치) 렌더링 및 스니펫 표시
  - embedded 모드에서도 통합 검색 동작 + AI Overview 버튼 미노출
  - 풀페이지에서는 AI Overview 버튼 노출
- 기존 `drive-content-search` testid는 제거되고 통합 검색 입력이 그 역할을
  대신하므로, 해당 testid를 참조하는 기존 E2E는 새 구조에 맞게 갱신.

## 결정 요약 (브레인스토밍에서 확정)

| 항목 | 결정 |
|------|------|
| 검색창 개수 | 1개로 통합 |
| 검색 실행 방식 | 항상 파일명+콘텐츠 동시 검색 (수동 트리거 없음) |
| 검색 스코프 | 현재 공간으로 통일 (콘텐츠 검색도 공간 한정) |
| embedded 모드 | 통합 검색 사용 (기존 파일명 전용에서 확장) |
| AI Overview 노출 | 풀페이지만 (embedded는 숨김) |
| 페이지 타이틀 | 제거, 브레드크럼만 유지 |

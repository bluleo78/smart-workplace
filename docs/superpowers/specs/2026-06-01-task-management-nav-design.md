# 작업 관리 사이드바 개편 설계

> 작성일: 2026-06-01
> 근거 조사: [docs/research/2026-06-01-task-management-nav-survey.md](../../research/2026-06-01-task-management-nav-survey.md)

## 목표

"작업 관리" 좌측 사이드바를 경쟁 솔루션 10종의 공통 패턴(① 개인 영역 → ② 프로젝트, 항목=아이콘+라벨/섹션=텍스트 헤더)에 맞춰 개편한다. 두 가지 사용자 피드백을 해소한다.

- **"휑함"**: 개인 영역이 `내 태스크` 1줄뿐 → 개인 영역을 `내 작업`(3탭) + `AI 위임 작업`으로 충실화.
- **"어색함"**: 프로젝트 항목만 아이콘이 없음(`IssueSidebar.tsx:46`) → 프로젝트 항목에 컬러 식별자 부여.

## 범위

**프론트엔드 중심 + 백엔드 reporter 필터 1개.** 저장된 뷰(Views)·Inbox/알림은 백엔드 도메인 신설이 필요한 별도 큰 작업으로, 본 설계에서 제외한다(향후 별도 스펙).

## 아키텍처

### 사이드바 구조 (`apps/workplace-web/src/components/issue/IssueSidebar.tsx`)

```
작업 관리                         ← 헤더 [LayoutList] (기존 유지)
──────────────
📋 내 작업          → /me/tasks/assigned   (개인 영역)
⭐ AI 위임 작업     → /me/ai-tasks
──────────────
PROJECTS                          ← 섹션 헤더(텍스트, 기존 유지)
🟦 WP  워크플레이스  → /projects/WP
🟪 AI  에이전트     → /projects/AI
   +  (전체 보기)   → /projects
```

규칙: **항목 = 아이콘/컬러+라벨 / 섹션 헤더 = 텍스트**. 프로젝트 항목에 컬러 사각형(key 해시 색 + key 1–2자)을 붙여 일관성을 맞춘다.

### 라우트 변경 (`apps/workplace-web/src/App.tsx`)

| 경로 | 페이지 | 비고 |
|---|---|---|
| `/me/tasks/:tab` | `MyTasksPage` | tab ∈ {assigned, reported, watched}. 잘못된 tab → assigned |
| `/me/tasks` | redirect → `/me/tasks/assigned` | |
| `/me/ai-tasks` | `AiDelegatedTasksPage` | |
| `/me/watched` | redirect → `/me/tasks/watched` | 기존 경로 하위호환 |

기존 `WatchedIssuesPage`는 `MyTasksPage`의 "구독" 탭으로 흡수된다.

## 컴포넌트 설계

### 1. `MyTasksPage` (`apps/workplace-web/src/pages/me/MyTasksPage.tsx`)

- 상단 탭 3개: **할당 / 내가 만든 / 구독**. `useParams().tab`로 활성 탭 결정, 탭 클릭 시 `/me/tasks/:tab`로 네비게이트(경로 기반 → 공유 가능).
- 탭별 이슈 리스트는 공통 `IssueList`/카드 컴포넌트 재사용.
- 데이터 소스:
  - **할당**: `/api/v1/me/issues?assignee=me` (백엔드 기존, `MeIssuesController.java:24-28`)
  - **내가 만든**: `/api/v1/me/issues?reporter=me` (**백엔드 reporter 필터 신규** — §백엔드 변경)
  - **구독**: `/api/v1/me/watched-issues` (기존 `useWatchedIssues` 훅 재사용)
- 빈 상태: 탭별 안내 문구("할당된 작업이 없어요" 등).

### 2. `AiDelegatedTasksPage` (`apps/workplace-web/src/pages/me/AiDelegatedTasksPage.tsx`)

- **정의**: 내가 만든 이슈 중 담당이 AI인 것 = `reporter=me` 결과를 클라이언트에서 `assignee.kind === 'AGENT'`로 필터. 추가 백엔드 0.
- `/api/v1/me/issues?reporter=me` 재사용 후 클라이언트 필터.
- 빈 상태: "AI에게 맡긴 작업이 아직 없어요".
- 근거: `UserSummary.kind`('HUMAN' | 'AGENT') 필드가 백엔드·프론트 모두 존재(`src/types/user.ts:37-42`).

### 3. 프로젝트 컬러 유틸 (`apps/workplace-web/src/lib/project-color.ts`)

- `projectColor(key: string): { bg: string; fg: string }` — key 문자열 해시 → 결정적 색상(같은 key = 항상 같은 색). HSL 기반으로 충분한 채도/명도 확보, 다크/라이트 모두 가독.
- `projectInitial(key: string): string` — key 앞 1–2자 대문자.
- `IssueSidebar`의 프로젝트 항목에서 둥근 사각형 배경색/텍스트로 사용.
- 백엔드 `ProjectResponse`에 색상 필드 없음(`ProjectResponse.java:6-13`)이 확인되어 프론트 생성 방식 채택.

## 백엔드 변경 (유일)

이슈 검색에 `reporter` 필터를 추가한다. (`apps/workplace-api`)

- `IssueSearchQuery`에 `reporterId: Long` 필드 추가.
- `IssueSearchService.parse()`에서 `reporter` 파라미터의 `me` 리터럴을 현재 사용자 ID로 치환(`assignee=me` 처리와 동일 패턴, `IssueSearchService.java:137-158` 참고).
- `IssueRepository.search()`에 reporter 조건 추가(`assignee` 조건과 대칭).
- 한국어 주석 필수(무엇을·왜).

## 데이터 흐름

```
[내 작업 - 할당]  탭 클릭 → /me/tasks/assigned → useQuery(/me/issues?assignee=me) → IssueList 렌더
[내 작업 - 내가만든] 탭 클릭 → /me/tasks/reported → useQuery(/me/issues?reporter=me) → IssueList 렌더
[내 작업 - 구독]  탭 클릭 → /me/tasks/watched → useWatchedIssues(/me/watched-issues) → IssueList 렌더
[AI 위임]  /me/ai-tasks → useQuery(/me/issues?reporter=me) → filter(kind==='AGENT') → IssueList 렌더
[프로젝트 항목]  useProjects() → projectColor(key) → 컬러 사각형 + 이름 렌더
```

## 에러 처리

- 이슈 조회 실패: 기존 `handleApiError()` + Sonner 토스트 패턴 재사용.
- 잘못된 `:tab` 파라미터: `assigned`로 폴백(에러 아님).

## 테스트

### E2E (Playwright) — 입력→처리→출력 전체 파이프라인

- **내 작업 탭 전환**: 각 탭 클릭 → API query param 검증(`assignee=me` / `reporter=me` / watched 엔드포인트) + 응답 이슈가 셀 단위로 렌더.
- **AI 위임 필터**: `reporter=me` 응답에 HUMAN/AGENT 담당 이슈 혼합 모킹 → `/me/ai-tasks`에서 **AGENT 담당 이슈만** 표시되는지 검증.
- **프로젝트 컬러**: 사이드바 프로젝트 항목이 컬러 사각형 + key + 이름으로 렌더, 같은 key는 같은 색(결정적).
- **사이드바 네비게이션**: `내 작업`/`AI 위임 작업` 클릭 → 올바른 경로 이동.
- **하위호환**: `/me/watched` 접근 → `/me/tasks/watched`로 리다이렉트.

### JUnit (백엔드 통합 테스트)

- `reporter=me` 필터: 특정 사용자가 reporter인 이슈만 반환하는지 통합 테스트.

## 비범위 (향후 별도 스펙)

- 저장된 뷰(Views/Saved filters) — SavedView 엔티티 + CRUD API + UI.
- Inbox/알림(notify 모듈) — Notification 도메인 신설.
- 즐겨찾기/사이드바 커스터마이즈.

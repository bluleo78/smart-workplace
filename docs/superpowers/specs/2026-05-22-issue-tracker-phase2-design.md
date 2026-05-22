# Phase 2 — 칸반 보드 + 검색/필터 설계

> 관련 이슈: bluleo78/smart-workplace#17
> 의존성: Phase 1 (#16) 머지 완료 (commit a1f3225)

## 1. 목표 / 범위

Phase 1 의 리스트 단일 뷰를 확장해 다음을 제공한다.

- 리스트 ↔ 칸반 보드 **뷰 토글** (동일 데이터 소스, URL 동기화)
- 필터(assignee / priority / status / due range) + 자유 텍스트 검색(`q`)
- 칸반 보드에서 **DnD 로 상태 전환** (optimistic update + 실패 시 롤백)
- 무한 스크롤 페이지네이션 (cursor 기반)
- 상태 전환 단일 엔드포인트 `PATCH /issues/{id}/status`

**Out of Scope**: 저장된 필터/즐겨찾기, 다중 정렬, 칸반 내 순서 저장, FTS/벡터 검색.

## 2. 용어 — "태스크" vs "이슈"

**UI 표시 용어는 "태스크"** 로 통일한다. 코드/DB/API 경로의 식별자는 Phase 1 의 `issue` 를 유지한다.

- 이유: 사람·AI 공동 작업 단위로 "태스크" 가 더 자연스럽고 향후 #20(AI Assignee), #21(자연어 작성) 과 결이 맞음. 단, DB 리네임은 V7 마이그레이션 + 광범위 코드 변경 비용이 커서 도메인이 충분히 안정된 뒤로 미룬다.
- 적용: 화면 라벨, 빈 상태 카피, 토스트 메시지, 페이지 타이틀, 메뉴 항목. URL 슬러그(`/issues/:number`) 와 API(`/issues`) 는 그대로.

## 3. 아키텍처 개요

### 3.1 백엔드 (apps/workplace-api)

- `IssueSearchService` — 필터/검색/cursor 페이지네이션 단일 진입점. Phase 1 의 `IssueService.list` 를 흡수.
- `IssueStatusController` — `PATCH /api/v1/issues/{id}/status` 단일 책임 (DnD 호출용). 권한·이력 기록 경로가 명확해짐.
- `IssueService.updateStatus(actorId, issueId, newStatus)` — STATUS-only 단축 경로. 내부적으로 기존 `IssueHistoryRecorder` 재사용.
- 검색 구현: jOOQ ILIKE (`title ILIKE %q% OR body ILIKE %q%`). FTS/trigram 은 Phase 5 에서 재검토.
- cursor: `base64(updated_at_epoch_millis + ":" + id)`, 정렬 `(updated_at DESC, id DESC)`.

### 3.2 프론트엔드 (apps/workplace-web)

- `ProjectDetailPage` 가 `IssueFilterBar` + 뷰 토글 + 활성 뷰 렌더.
- `IssueListView` (기존 `IssueListTable` 흡수/리네임), `IssueBoardView` (신규), 둘 다 동일 hook `useIssueSearch` 사용.
- `useIssueSearch` — TanStack `useInfiniteQuery`, cursor pageParam.
- `useUpdateIssueStatus` — optimistic onMutate, onError 롤백, onSettled invalidate.
- DnD: `@dnd-kit/core` + `@dnd-kit/sortable` (React 19 호환, 키보드 접근성 기본).

### 3.3 데이터 흐름

1. URL 파라미터 변경 → `useIssueSearch` 가 새 쿼리 키로 재실행.
2. 보드 DnD drop → optimistic 캐시 패치 → `PATCH /issues/{id}/status` → 실패 시 스냅샷 복원 + 토스트.
3. `IssueHistoryRecorder` 가 STATUS 변경 1건 기록 (Phase 1 그대로).

## 4. 백엔드 API

### 4.1 검색

```
GET /api/v1/projects/{key}/issues
  ?q=string              # 선택. title ILIKE %q% OR body ILIKE %q%
  &status=TODO,IN_PROGRESS  # 선택. CSV, OR 결합
  &assignee=42,null      # 선택. CSV, "null" 토큰은 미지정(NULL) 매칭
  &priority=HIGH,URGENT  # 선택. CSV
  &dueFrom=2026-05-01    # 선택. ISO date, due_date >= dueFrom
  &dueTo=2026-06-30      # 선택. due_date <= dueTo
  &cursor=BASE64         # 선택. 없으면 첫 페이지
  &size=30               # 선택. 기본 30, 100 초과 시 100 으로 클램프
```

**응답**

```json
{
  "items": [IssueSummary, ...],
  "nextCursor": "BASE64|null",
  "hasMore": true
}
```

- 정렬: `updated_at DESC, id DESC` 고정.
- cursor 디코딩 실패 → 400 `INVALID_CURSOR`.
- 권한: `ProjectAccessGuard.assertMember` (Phase 1).
- 잘못된 enum 값 → 400 `INVALID_ENUM`.

### 4.2 상태 전환

```
PATCH /api/v1/issues/{id}/status
Body: { "status": "IN_PROGRESS" }
```

- 권한: 프로젝트 멤버 전원 (Phase 1 의 `issue:write` 가정).
- 응답: 갱신된 `IssueDetail`.
- 이력: STATUS 변경분만 1건 기록. 동일 status 재요청 시 이력 없음(Recorder 정책).
- 동시성: last-write-wins, 별도 ETag/version 없음.
- 오류: 없는 이슈 404 `ISSUE_NOT_FOUND`, 비멤버 403, 잘못된 enum 400.

### 4.3 기존 코드 영향

- `IssueController.list` 는 경로 유지. 내부에서 `IssueSearchService` 호출 (시그니처 확장).
- `IssueService.update(...)` 의 STATUS 단독 변경 경로는 유지하되, DnD 는 새 컨트롤러를 쓴다.

## 5. 프론트엔드 상세

### 5.1 파일 구조

```
src/pages/projects/
  ProjectDetailPage.tsx       # 기존 — FilterBar + 뷰 토글 + 활성 뷰
  components/
    IssueFilterBar.tsx        # 신규
    IssueBoardView.tsx        # 신규
    IssueListView.tsx         # 기존 IssueListTable 리네임/흡수
    IssueCard.tsx             # 신규 — 보드 카드
src/hooks/queries/
  useIssueSearch.ts           # 신규 — useInfiniteQuery
  useUpdateIssueStatus.ts     # 신규 — optimistic mutation
src/lib/
  issueFilters.ts             # URL ↔ 필터 객체 직렬화 (zod parse)
```

### 5.2 URL 동기화

- `?view=list|board` (기본 `list`)
- `?q=`, `?status=`, `?priority=`, `?assignee=`, `?dueFrom=`, `?dueTo=`
- `useSearchParams()` 가 단일 source of truth. FilterBar 내부 useState 금지.
- "초기화" 버튼: view 를 제외한 모든 파라미터 제거.

### 5.3 IssueFilterBar

- 검색창: 300ms debounce 후 URL `q=` 반영.
- status/priority: multi-select (Radix Select + checkbox 패턴 또는 Popover).
- assignee: 프로젝트 멤버 select + "미지정" 옵션 (값 `null`).
- due range: 두 개의 DatePicker (from/to).

### 5.4 useIssueSearch

- `queryKey: ['issues','search', projectKey, filters]`
- `useInfiniteQuery({ getNextPageParam: r => r.nextCursor })`
- 리스트 뷰: IntersectionObserver 가 sentinel 진입 시 `fetchNextPage()`.
- 보드 뷰: 동일 쿼리 결과를 status 별 그룹핑. 자동으로 `size=100` 으로 2 페이지까지 prefetch (최대 200 카드). 더 많은 결과는 "필터로 좁혀주세요" 안내.

### 5.5 useUpdateIssueStatus (Optimistic)

```ts
onMutate: async ({ issueId, status }) => {
  await qc.cancelQueries({ queryKey: ['issues','search', projectKey] })
  const snapshots = qc.getQueriesData({ queryKey: ['issues','search', projectKey] })
  qc.setQueriesData({ queryKey: ['issues','search', projectKey] }, (old) =>
    patchIssueStatus(old, issueId, status))
  return { snapshots }
},
onError: (_e, _v, ctx) => {
  ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data))
  toast.error('상태 변경에 실패했습니다')
},
onSettled: () => {
  qc.invalidateQueries({ queryKey: ['issues','search', projectKey] })
  qc.invalidateQueries({ queryKey: ['issue', projectKey] })
}
```

### 5.6 DnD (@dnd-kit)

- 보드 전체를 `DndContext` 가 감싸고, 컬럼별 `SortableContext`.
- `onDragEnd`: drop target 의 status 와 source 가 다르면 `updateIssueStatus.mutate(...)`. 같은 컬럼 내 순서 변경은 무시(서버에 order 컬럼 없음).
- 카드 활성화 제스처: `activationConstraint: { distance: 5 }` — 카드 클릭 네비게이션과 충돌 방지.
- 키보드 접근성: dnd-kit 기본 키보드 센서 (Space 들기 / 방향키 이동 / Space 놓기).

### 5.7 IssueCard

표시 항목: title, identifier(예 `WP-12`), assignee 아바타+이름, priority 뱃지, due_date(소형). 카드 클릭은 `/projects/:key/issues/:number` 로 이동.

## 6. 에러 처리

| 상황 | 처리 |
|---|---|
| 잘못된 cursor | 400 `INVALID_CURSOR` |
| 잘못된 enum 값 | 400 `INVALID_ENUM` |
| size > 100 | 100 으로 클램프 (정상 응답) |
| 없는 이슈 status 변경 | 404 `ISSUE_NOT_FOUND` |
| 비멤버 | 403 |
| 프론트 검색 API 실패 | 결과 영역에 "불러올 수 없습니다 [재시도]" |
| DnD PATCH 실패 | 캐시 롤백 + 토스트 |

## 7. 테스트

### 7.1 백엔드 (JUnit + @SpringBootTest)

- `IssueSearchServiceTest`
  - 빈 필터 → updated_at DESC 순 30개
  - `q` ILIKE: title only / body only / 둘 다 매칭
  - `status` CSV 다중 OR
  - `assignee=null` 미지정 매칭, `assignee=42,null` 혼합
  - `priority` CSV
  - `dueFrom` / `dueTo` 경계(포함) 검증
  - cursor 페이징 연속성, `nextCursor=null` 종료
  - 잘못된 cursor → 400
  - 비멤버 → 403
- `IssueStatusControllerTest`
  - 멤버 status 변경 → 200 + history 1건
  - 동일 status 재요청 → 200 + history 미기록
  - 비멤버 → 403
  - 잘못된 enum → 400
  - 없는 이슈 → 404

### 7.2 프론트엔드 E2E (Playwright)

`e2e/pages/projects/board.spec.ts`

- **@smoke**: 보드 진입 → 4 컬럼 표시 → DnD TODO→IN_PROGRESS → PATCH payload 검증 → UI 즉시 반영 → 활동 타임라인 STATUS 1건
- 검색 입력 → debounce 후 `q=` 쿼리 → 결과 셀 검증
- status/priority multi-select → URL `?status=...` 반영 + 결과 변경
- 뷰 토글: list ↔ board, `?view=` URL 동기화
- DnD 실패 롤백: `route.fulfill({ status: 500 })` → 카드 원위치 + 토스트
- 무한 스크롤: 두번째 페이지 자동 로드 (cursor 쿼리 검증)
- 비멤버 보드 진입 → 403 화면

### 7.3 회귀

- husky `WEB_DOMAINS_RE='admin|projects'` 그대로 → projects 도메인 변경 시 자동 게이팅.
- 기존 `IssueListTable` 리네임은 import 경로 변경으로만 처리 (시그니처 유지).

## 8. 마이그레이션

DB 스키마 변경 없음. Phase 1 의 V5/V6 위에서 동작한다.

## 9. 결정 로그

- DnD: `@dnd-kit` (React 19 호환, 유지보수 활발, 접근성)
- 페이지네이션: 무한 스크롤(cursor) — 리스트/보드 공통
- 검색 구현: ILIKE — FTS 는 Phase 5 에서 재검토
- 상태 변경 권한: 프로젝트 멤버 전원
- UI 용어: "태스크" (코드/DB 는 issue 유지)

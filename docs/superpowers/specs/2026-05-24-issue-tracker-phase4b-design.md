# Phase 4b — 이슈 의존성 설계

> 관련 이슈: bluleo78/smart-workplace#25
> 의존성: Phase 1 (#16), 이슈 유형 (#27), Phase 4a (SUBTASK, 무관하지만 N:M 패턴 재사용)
> 후속: #26 (Phase 4c custom fields)

## 1. 목표 / 범위

이슈 간 단방향 의존성(`A blocks B` — "A 가 B 를 차단"). 사이클 검출. 같은 프로젝트 안에서만. 모든 유형(SUBTASK 포함) 가능.

- `issue_dependency(issue_id, blocks_issue_id, created_by, created_at, PK(...))` 단방향 1 row
- 추가 시 DFS 사이클 검출 → 409 `DEPENDENCY_CYCLE`
- 응답: `blockedBy`, `blocks`, `blocked` (서버 계산)
- 검색 필터: `?blocked=true`
- 변경 권한: 멤버 (라벨 부착 패턴)
- 중복 추가/없는 관계 remove → 멱등

**Out of Scope**: 외부 프로젝트 이슈 의존성, 시각화 그래프, 의존성 알림, 일괄 관리.

## 2. 아키텍처

신규 모듈 없음. `issue` 모듈 내부:
- `IssueDependencyRepository` — jOOQ CRUD + cycle detection + N+1 batch
- `IssueDependencyService` — 멤버 가드 + 같은 프로젝트 + 사이클 + history
- `IssueDependencyController` — add (POST) + remove (DELETE)

## 3. 데이터 모델 — Flyway V12

```sql
-- V12__issue_dependency.sql
CREATE TABLE issue_dependency (
  issue_id          BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  blocks_issue_id   BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  created_by        BIGINT NOT NULL REFERENCES "user"(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, blocks_issue_id),
  CHECK (issue_id <> blocks_issue_id)
);
CREATE INDEX idx_issue_dep_blocks ON issue_dependency(blocks_issue_id);
```

**해석**: `(A, B)` row = "A 가 B 를 차단". B 는 blockedBy 에 A 보유.

### 불변식

- 자기 자신 차단 금지 (CHECK + 서비스)
- 같은 프로젝트 안에서만 (서비스 가드)
- 사이클 금지 (DFS, 추가 시점 검증)
- 중복 추가/없는 관계 remove → 멱등

## 4. 백엔드 API

### 4.1 추가

```
POST /api/v1/projects/{key}/issues/{number}/dependencies
{ "otherNumber": 42, "direction": "blocks" | "blockedBy" }
→ IssueDetailResponse (갱신된 blocks/blockedBy/blocked)
```

- `direction == "blocks"` → `(this, other)` row 추가 = 이 이슈가 42 를 차단
- `direction == "blockedBy"` → `(other, this)` row 추가 = 이 이슈가 42 에 의해 차단됨
- otherNumber 검증: 같은 프로젝트 / 활성 / 자기 자신 아님 → 400 `INVALID_DEPENDENCY`
- 사이클 검증: 새 엣지 `(from, to)` 추가 전 `to → ... → from` 경로 존재하면 409 `DEPENDENCY_CYCLE`
- 중복 (`ON CONFLICT DO NOTHING`) → 200, history 미기록
- history: `DEPENDENCY_ADDED` 1건, payload toValue JSON `{other:{number,title}, direction:"blocks"|"blockedBy"}`

### 4.2 제거

```
DELETE /api/v1/projects/{key}/issues/{number}/dependencies?otherNumber=42&direction=blocks
→ 204
```

- direction 에 따라 `(this, other)` 또는 `(other, this)` row 삭제
- 없는 관계 → 204, history 미기록
- history: `DEPENDENCY_REMOVED` 1건 (실제 삭제 시만)

### 4.3 사이클 검출 (DFS)

```java
boolean wouldCycle(Long fromId, Long toId) {
  Set<Long> visited = new HashSet<>();
  Deque<Long> stack = new ArrayDeque<>();
  stack.push(toId);
  while (!stack.isEmpty()) {
    Long cur = stack.pop();
    if (cur.equals(fromId)) return true;
    if (!visited.add(cur)) continue;
    for (Long next : repo.findBlocksOf(cur)) stack.push(next);
  }
  return false;
}
```

작은 그래프 가정 — 단순 DFS 충분. 매번 DB 조회 OK.

### 4.4 응답 모양

```java
public record IssueLinkSummary(int number, String title, String status, IssueTypeSummary type) {}

public record IssueResponse(
    /* … 기존 모든 필드 (Phase 4a 시점 = parent/childCount/childDoneCount 까지) */,
    List<IssueLinkSummary> blockedBy,    // 신규
    List<IssueLinkSummary> blocks,       // 신규
    boolean blocked) {}                  // 신규 — 서버 계산
```

신규 factory `fromWithDeps(...)` — 모든 필드 채움. 기존 6 factory (Phase 4a 의 `fromWithSubtasks` 포함) 는 신규 3 필드 default `(List.of(), List.of(), false)`.

### 4.5 검색 + N+1 batch

`IssueSearchQuery` 마지막에 `Boolean blocked` 추가.

`IssueRepository.search` 안:
```java
if (Boolean.TRUE.equals(query.blocked())) {
  where = where.and(DSL.exists(
    dsl.selectOne()
      .from(ISSUE_DEPENDENCY)
      .join(ISSUE.as("b")).on(ISSUE.as("b").ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
      .where(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID.eq(ISSUE.ID)
        .and(ISSUE.as("b").STATUS.notIn("DONE", "CANCELED"))
        .and(ISSUE.as("b").DELETED_AT.isNull()))));
}
```

`IssueSearchService.search` 의 batch 체인 끝에:
```java
var blockedByByIssue = dependencyRepository.findBlockedByForIssues(issueIds);  // Map<Long, List<IssueLinkSummary>>
var blocksByIssue    = dependencyRepository.findBlocksForIssues(issueIds);
var blockedFlagByIssue = dependencyRepository.findBlockedFlags(issueIds);     // Map<Long, Boolean>

var items = rows.stream()
    .map(r -> IssueResponse.fromWithDeps(
        project.key(), r,
        labelsByIssue.getOrDefault(r.id(), List.of()),
        countsByIssue.getOrDefault(r.id(), 0),
        typesById.get(r.typeId()),
        assigneesByIssue.getOrDefault(r.id(), List.of()),
        parentRefByChild.get(r.id()),
        childCountByParent.getOrDefault(r.id(), 0),
        childDoneCountByParent.getOrDefault(r.id(), 0),
        blockedByByIssue.getOrDefault(r.id(), List.of()),
        blocksByIssue.getOrDefault(r.id(), List.of()),
        blockedFlagByIssue.getOrDefault(r.id(), false)))
    .toList();
```

`IssueService.get(...)` 도 단건으로 동일 batch 호출.

### 4.6 에러 매핑

| 상황 | 응답 |
|---|---|
| 자기 자신/다른 프로젝트/없는 이슈 | 400 `INVALID_DEPENDENCY` |
| 사이클 발생 | 409 `DEPENDENCY_CYCLE` |
| 중복 추가 | 200 (멱등) |
| 없는 관계 remove | 204 (멱등) |
| 비멤버 | 403 |

### 4.7 cascade 영향

- `ON DELETE CASCADE` (FK) — 이슈 hard delete 시 의존성 정리. 현재 시스템은 soft delete 만 — `findBlockedByForIssues` / `findBlocksForIssues` 가 `deleted_at IS NULL` 필터로 deleted 이슈 의존성을 응답에서 제외.

## 5. 프론트엔드

### 5.1 파일 구조

```
src/types/issue.ts                                # IssueLinkSummary, blockedBy/blocks/blocked, IssueFilters.blocked
src/lib/issueFilters.ts                           # blocked URL 직렬화
src/api/issueDependencies.ts                      # add/remove
src/hooks/queries/useIssueDependencies.ts         # add + remove mutations
src/components/issues/IssueLinkRow.tsx            # 한 행 (아이콘 + KEY-N + 제목 + status + X)
src/pages/projects/components/
  IssueDependenciesSection.tsx                    # 차단됨/차단 중 두 슬롯
  IssueLinkPicker.tsx                             # number 입력 + direction 고정
```

### 5.2 IssueDependenciesSection (상세 우측 메타)

두 슬롯:
- "차단됨 (선행 필요)" — `blockedBy` 리스트 + Picker(direction='blockedBy')
- "차단 중" — `blocks` 리스트 + Picker(direction='blocks')

각 행 (IssueLinkRow):
- 좌측: IssueTypeBadge(iconOnly) + `WP-12`
- 본문: 제목 (Link → 해당 이슈 상세)
- 우측: status 배지 + X 제거

### 5.3 IssueLinkPicker

Popover 안 number input + 저장. `direction` prop 고정. 성공 시 close + 토스트.
- mutation 성공 시 close
- 실패 (사이클 등) 시 유지 + 에러 토스트

### 5.4 헤더 차단 배지

`summary.blocked === true` 면 제목 옆 빨간 `⛔ 차단됨` 배지.
- testid: `issue-blocked-badge`

### 5.5 보드 카드

`blocked === true` 면 카드 우상단 작은 ⛔.
- testid: `issue-card-{n}-blocked`

### 5.6 활동 타임라인

`DEPENDENCY_ADDED` / `DEPENDENCY_REMOVED` 두 분기. payload 파싱:
- `직선님이 WP-12 를 차단 관계로 추가 (blocks)`
- `직선님이 WP-7 와 의존성 제거 (blockedBy)`

### 5.7 필터바

`?blocked=true` deferred (UI 안 노출). `parseFilters`/`filtersToParams` 에 `blocked: boolean` 추가.

### 5.8 카피

- 섹션 헤더: `의존성`
- 슬롯 라벨: `차단됨 (선행 필요)`, `차단 중`
- 빈 상태: `없음`
- Picker label: `이슈 번호`, buttons: `추가`/`취소`
- Success toast: `의존성을 추가했습니다` / `의존성을 제거했습니다`
- Error toast fallback: `의존성 변경에 실패했습니다`

## 6. 테스트

### 6.1 백엔드 (JUnit)

`IssueDependencyServiceTest`
- 멤버 add blocks → row + history
- 멤버 add blockedBy → (other,this) row
- 자기 자신/다른 프로젝트/없는 이슈 → 400
- 비멤버 → 403
- 중복 add → 멱등 (history 미기록)
- remove 정상 → 204 + history
- 없는 관계 remove → 204 + history 미기록

`IssueDependencyCycleTest`
- A→B 후 B→A 시도 → 409
- A→B, B→C 후 C→A 시도 → 409 (3 노드)
- A→B, B→C, C→D 후 D→A 시도 → 409 (4 노드)

`IssueSearchServiceBlockedTest`
- X 가 Y 를 차단(X→Y), X status TODO → Y.blocked=true (Y 가 미완료 차단원에 의해)
- X done 으로 변경 → Y.blocked=false
- `?blocked=true` 필터 → blocked 인 이슈만
- 검색 결과 `blockedBy/blocks/blocked` N+1 없이 채워짐

### 6.2 V12 검증 (수동)

```sql
\d issue_dependency
SELECT * FROM issue_dependency LIMIT 5;
```

### 6.3 프론트엔드 E2E

`e2e/pages/projects/dependencies.spec.ts`
- **@smoke**: 상세 진입 → 차단 중 picker → number 입력 → POST `{otherNumber, direction:"blocks"}` → 슬롯 행 노출 → 제거 → DELETE → 사라짐
- 사이클 시도: route mock 409 → 토스트 + picker 유지
- blocked=true 이슈 헤더 빨간 배지
- 보드 카드 blocked 마커

### 6.4 회귀

- IssueResponse 신규 3 필드 호환
- factory default 갱신: `blockedBy: [], blocks: [], blocked: false`
- husky 게이팅 그대로

## 7. 결정 로그

- 단방향 1row (`A blocks B`)
- 사이클: DFS, 추가 시 409
- 자기 자신/외부/없는 이슈 → 400
- 중복/없는 관계 → 멱등
- `blocked`: blockedBy 중 미완료(DONE/CANCELED 아님) 존재
- 변경 권한: 멤버
- SUBTASK 도 의존성 가능
- 외부 프로젝트 / 시각화 / 알림 / 일괄 deferred
- 필터 UI deferred

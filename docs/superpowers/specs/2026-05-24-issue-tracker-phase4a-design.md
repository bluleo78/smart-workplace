# Phase 4a — Subtasks (Jira 스타일) 설계

> 관련 이슈: bluleo78/smart-workplace#24
> 의존성: Phase 1 (#16), 이슈 유형 (#27)
> 후속: #25 (Phase 4b 의존성), #26 (Phase 4c custom fields)

## 1. 목표 / 범위

이슈 1단계 parent-child 트리. Jira 패턴 — `SUBTASK` 별도 유형, SUBTASK 만 parent 가질 수 있고, SUBTASK 는 자식 못 가짐.

- `SUBTASK` 시스템 유형 신규 (시스템 5종 째)
- `issue.parent_issue_id` 컬럼 추가
- `IssueResponse` 에 `parent: ParentRef?`, `childCount: int`, `childDoneCount: int` 추가
- 부모 변경: 독립 PATCH 엔드포인트
- 자식 생성: 기존 `POST /issues` 에 `parentNumber` 옵션
- cascade soft-delete (부모 deleted 시 자식 동일 timestamp 마킹)
- 자동 상태 전파 없음 (UI 가 진행률 표시만)

**Out of Scope**: 다단계 트리, 자동 상태 전파, 자식 일괄 status 전이, 다단계 복구.

## 2. 아키텍처

신규 모듈 없음. `issue` 모듈 내부에 추가:
- `IssueParentController` — `PATCH /issues/{number}/parent`
- `IssueService.setParent(...)`, `create(...)` 확장
- `IssueRepository` — children/count batch + cascade
- `IssueHistoryRecorder.recordParentChanged(...)`

## 3. 데이터 모델 — Flyway V11

```sql
-- V11__subtasks.sql

-- 1) SUBTASK 시스템 유형 시드 (기존 프로젝트 전체)
INSERT INTO issue_type_def (project_id, name, color_token, icon, is_system, position)
SELECT id, 'SUBTASK', 'TEAL', 'CornerDownRight', true, 4 FROM project;

-- 2) parent_issue_id 컬럼 + 인덱스
ALTER TABLE issue ADD COLUMN parent_issue_id BIGINT NULL REFERENCES issue(id) ON DELETE CASCADE;
CREATE INDEX idx_issue_parent ON issue(parent_issue_id) WHERE parent_issue_id IS NOT NULL;
```

코드 변경:
- `IssueTypeIcon.ALL` 화이트리스트에 `CornerDownRight` 추가 → 9종 (`Circle, Bug, BookOpen, Wrench, Star, Zap, Flag, Target, CornerDownRight`)
- `IssueTypeService.seedSystemTypes(projectId)` 에 SUBTASK 5번째 INSERT 추가 (신규 프로젝트 자동 시드)

## 4. 불변식

- 1단계만: 모든 SUBTASK 의 parent 는 비SUBTASK. parent 의 parent 는 자동 NULL.
- **SUBTASK 만 parent 보유 가능** — 비SUBTASK 가 parent 가지면 400 `PARENT_NOT_ALLOWED`
- **비SUBTASK 만 parent 가능** — parent type 이 SUBTASK 면 400 `PARENT_CANNOT_BE_SUBTASK`
- 같은 프로젝트 안에서만
- 자기 자신 parent 금지
- SUBTASK 생성 시 `parentNumber` 필수. 누락 → 400 `SUBTASK_PARENT_REQUIRED`

## 5. 백엔드 API

### 5.1 생성

```
POST /api/v1/projects/{key}/issues
{
  "title": "...",
  "typeId": <subtaskTypeId>,
  "parentNumber": 42,
  ...
}
```

검증 (위 § 4 + ):
- `parentNumber` 의 부모가 다른 프로젝트 / 존재하지 않음 → 400 `INVALID_PARENT`

### 5.2 부모 변경 (SUBTASK 전용)

```
PATCH /api/v1/projects/{key}/issues/{number}/parent
{ "parentNumber": 42 }      // null 가능 (해제)
→ IssueDetailResponse
```

- 권한: 멤버
- 현재 이슈가 SUBTASK 아님 → 400 `SET_PARENT_ON_NON_SUBTASK`
- 새 parent 의 type 이 SUBTASK / 다른 프로젝트 / 자기 자신 → 400
- null 로 설정 (해제) — 일시적 "부모 없는 SUBTASK" 상태 허용
- history: `PARENT_CHANGED` 1건, payload `{from:{number,title}|null, to:{number,title}|null}`
- diff 0 → history 미기록

### 5.3 유형 변경 시 parent 자동 처리

`IssueService.setType(...)` 확장:
- SUBTASK → 비SUBTASK 전환이고 `parent_issue_id != null` → parent_issue_id NULL + history `PARENT_CHANGED`(to=null) + `TYPE_CHANGED` 1건 (총 2건)
- 비SUBTASK → SUBTASK 전환 → parent_issue_id 그대로 NULL (UI 가 부모 설정 유도)

### 5.4 응답 모양

```java
public record ParentRef(int number, String title, IssueTypeSummary type) {}

public record IssueResponse(
    Long id, String projectKey, int number, String title, String status, String priority,
    LocalDate dueDate, Long reporterId,
    Instant createdAt, Instant updatedAt,
    List<LabelSummary> labels,
    int attachmentCount,
    IssueTypeSummary type,
    List<UserSummary> assignees,
    ParentRef parent,             // 신규 — SUBTASK 의 부모, 아니면 null
    int childCount,               // 신규 — 비SUBTASK 의 자식 활성 수 (SUBTASK 는 0)
    int childDoneCount) {}        // 신규 — DONE 상태 자식 수
```

신규 factory `fromWithSubtasks(projectKey, row, labels, count, type, assignees, parent, childCount, childDoneCount)`. 기존 factory 5종 (`from`, `fromWithLabels`, `fromWithDetails`, `fromWithFullDetails`, `fromWithType`) 는 신규 필드 default `(null, 0, 0)` 로 유지 → 이전 페이즈 호환.

`IssueRow` 에 `parentIssueId: Long?` 추가.

### 5.5 검색 + N+1 batch

`IssueSearchQuery` 에 `Integer parentNumber`, `Boolean topLevel` 추가.

`IssueRepository.search(...)` 안:
```java
if (query.parentNumber() != null) {
  var parentId = dsl.select(ISSUE.ID).from(ISSUE)
      .where(ISSUE.PROJECT_ID.eq(projectId)
             .and(ISSUE.NUMBER.eq(query.parentNumber()))
             .and(ISSUE.DELETED_AT.isNull()))
      .fetchOptional(0, Long.class).orElse(-1L);
  where = where.and(ISSUE.PARENT_ISSUE_ID.eq(parentId));
} else if (Boolean.TRUE.equals(query.topLevel())) {
  where = where.and(ISSUE.PARENT_ISSUE_ID.isNull());
}
```

`IssueSearchService.search` 의 batch 체인에 두 가지 추가:
- `issueRepository.findParentRefsByIssueIds(issueIds)` — Map<childId, ParentRef>
- `issueRepository.countChildrenByParentIds(parentIds)` + `countDoneChildrenByParentIds(parentIds)` — Map<parentId, Integer>

`fromWithSubtasks(...)` 로 응답 조립.

### 5.6 cascade soft-delete

`IssueService.softDelete(...)`:
```java
var now = Instant.now();
issueRepository.softDelete(issue.id(), now);
issueRepository.softDeleteChildren(issue.id(), now);
```

신규 `IssueRepository.softDeleteChildren(parentId, deletedAt)`:
```sql
UPDATE issue SET deleted_at = ? WHERE parent_issue_id = ? AND deleted_at IS NULL
```

복구 시점에 "deleted_at == 부모.deleted_at" 일치 자식만 자동 복구. 본 페이즈 범위 밖.

### 5.7 에러 매핑

| 상황 | 응답 |
|---|---|
| SUBTASK 생성에 parentNumber 누락 | 400 `SUBTASK_PARENT_REQUIRED` |
| 비SUBTASK 생성에 parentNumber 지정 | 400 `PARENT_NOT_ALLOWED` |
| parent 가 다른 프로젝트/없음 | 400 `INVALID_PARENT` |
| parent type 이 SUBTASK | 400 `PARENT_CANNOT_BE_SUBTASK` |
| 자기 자신 parent | 400 `INVALID_PARENT` |
| setParent 가 비SUBTASK 에 호출 | 400 `SET_PARENT_ON_NON_SUBTASK` |
| 비멤버 | 403 |
| 없는 이슈 | 404 |

## 6. 프론트엔드

### 6.1 파일 구조

```
src/types/issue.ts                          # IssueResponse 신규 필드 + IssueFilters 의 parentNumber/topLevel
src/api/issueParent.ts                      # PATCH /issues/{n}/parent
src/hooks/queries/useUpdateIssueParent.ts
src/components/issues/ParentBadge.tsx
src/pages/projects/components/
  IssueParentSlot.tsx                       # SUBTASK 우측 메타 부모 슬롯
  IssueParentPicker.tsx                     # 부모 설정 다이얼로그
  IssueChildrenSection.tsx                  # 본문 아래 자식 SUBTASK 영역
```

### 6.2 이슈 상세

**SUBTASK 인 경우** — 우측 메타에 "부모" 슬롯:
- 부모 있음 → `ParentBadge`(parent 링크 + 유형 배지) + "변경" 버튼
- 부모 없음 → 빨간 경고 "부모 없는 SUBTASK — 설정 필요" + "부모 설정" 버튼
- 버튼 클릭 → `IssueParentPicker` (이슈 number 직접 입력)
- mutation 성공 시 invalidate `['issues', projectKey, 'detail']` + `['issues','search', projectKey]`

**비SUBTASK 인 경우** — 부모 슬롯 비표시. 본문 아래 자식 영역만.

### 6.3 자식 SUBTASK 영역

표시 조건: 비SUBTASK 이슈 (childCount 와 무관 — 0이어도 "+ SUBTASK 추가" 인라인 노출).
- 진행률: `{childDoneCount}/{childCount}` 텍스트 + 진행률 바
- 자식 리스트 — `searchIssues(projectKey, { parentNumber: number }, null, 100)`
- 각 행: type 아이콘 (`└` 들여쓰기) + 제목 + status 변경 select + 우측 status 배지
- "+ SUBTASK 추가" 인라인 — 클릭 시 input 펼침, Enter 로 `createIssue({ typeId: SUBTASK, parentNumber: <이슈 number>, title })`

### 6.4 IssueCreateDialog

기존 유형 select 활용:
- 유형 SUBTASK 선택 시 `parentNumber` 입력 필드 동적 노출 (필수, 양의 정수)
- 비SUBTASK 면 필드 숨김 + reset
- payload: 유형 SUBTASK 면 `parentNumber` 포함, 아니면 생략

### 6.5 보드 카드 / 리스트

- 보드 카드:
  - SUBTASK → 좌측 `└` + 부모 number 작게 (예: `└ WP-12`)
  - 비SUBTASK 면서 childCount > 0 → 우하단 `└ 2/5`
- 리스트 뷰: 변경 없음

### 6.6 필터바

`?parent=<number>` / `?topLevel=true` 둘 다 deferred. URL 직렬화만 추가, UI 미노출.

`lib/issueFilters.ts` 의 `parseFilters` / `filtersToParams` 두 키 처리.

### 6.7 활동 타임라인

`PARENT_CHANGED` 분기 추가:
- 변경: `"홍길동님이 부모를 WP-12 → WP-7 로 변경"`
- 해제: `"홍길동님이 부모를 해제"`
- 설정: `"홍길동님이 부모를 WP-7 로 설정"`

`formatParentChanged(toValue)` — JSON `{from:{number,title}|null, to:{number,title}|null}` 파싱.

### 6.8 cascade soft-delete UX

부모 삭제 confirm 메시지:
- `childCount == 0` → 기존 메시지 (`이 이슈를 삭제하시겠습니까?`)
- `childCount > 0` → `이 이슈에는 자식 SUBTASK 가 N개 있습니다. 함께 삭제됩니다. 진행하시겠습니까?`

## 7. 테스트

### 7.1 백엔드 (JUnit)

`IssueParentServiceTest`
- SUBTASK 생성에 parentNumber 누락 → 400
- 비SUBTASK 생성에 parentNumber 지정 → 400
- SUBTASK 생성 OK + parent_issue_id + parent 응답
- parent type SUBTASK → 400
- parent 다른 프로젝트 → 400
- 자기 자신 parent → 400

`IssueSetParentTest`
- SUBTASK setParent OK + history 1건
- 비SUBTASK setParent → 400
- null 해제 OK + history (to=null)
- 동일 parent 재요청 → history 미기록
- 비멤버 → 403

`IssueSetTypeWithParentTest`
- SUBTASK → TASK 전환 + parent 있음 → parent NULL + PARENT_CHANGED + TYPE_CHANGED (2건)
- 비SUBTASK → SUBTASK 전환 → parent 그대로 NULL

`IssueSoftDeleteCascadeTest`
- 자식 N개 가진 부모 삭제 → 부모 + 자식 동일 deleted_at
- 자식 이미 deleted → 영향 없음

`IssueSearchServiceParentTest`
- `parent=<number>` → 해당 자식만
- `topLevel=true` → parent_issue_id IS NULL 만
- 검색 결과 parent/childCount/childDoneCount 정확 (N+1 없이)

### 7.2 V11 검증 (수동)

```sql
SELECT project_id, COUNT(*) FROM issue_type_def WHERE is_system GROUP BY project_id;  -- 5
SELECT name FROM issue_type_def WHERE name='SUBTASK' LIMIT 1;
SELECT COUNT(*) FROM issue WHERE parent_issue_id IS NOT NULL;  -- 0
```

### 7.3 프론트엔드 E2E

`e2e/pages/projects/subtasks.spec.ts`
- **@smoke**: 비SUBTASK 진입 → 자식 SUBTASK 인라인 추가 → 자식 영역 노출 + 진행률 → 자식 DONE 으로 → 진행률 갱신
- SUBTASK 상세 → 부모 슬롯 + 변경 버튼 → number 입력 → PATCH payload + 갱신
- SUBTASK → TASK 유형 변경 → parent 자동 해제, UI 부모 슬롯 비표시, 타임라인 2건
- cascade 삭제 confirm: 자식 N개 경고 메시지

### 7.4 회귀

- IssueResponse 새 필드 3종 호환 (기존 클라이언트 무시)
- factory default 갱신: `parent: null, childCount: 0, childDoneCount: 0`
- `IssueTypeIcon.ALL` 9종 (CornerDownRight 추가)
- 시스템 유형 5종 — `IssueTypeSystemSeedTest` 갱신 (4 → 5)

## 8. 결정 로그

- Jira-style SUBTASK 별도 유형 (시스템 5번째)
- SUBTASK 만 parent 보유, 비SUBTASK 만 parent 가능
- 1단계만 (자동 보장)
- 자동 상태 전파 없음
- cascade soft-delete (Asana 패턴)
- SUBTASK 생성에 parentNumber 필수, setParent 후 해제 가능 (일시 "부모 없음")
- SUBTASK → 비SUBTASK 전환 시 parent 자동 해제 + history 2건
- 비SUBTASK → SUBTASK 전환은 parent NULL 유지 (UI 안내)
- 9번째 아이콘 `CornerDownRight` 화이트리스트 추가
- 필터 UI deferred (URL 직렬화만)
- 복구 deferred

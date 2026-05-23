# Phase 3c — 다중 assignee 마이그레이션 설계

> 관련 이슈: bluleo78/smart-workplace#23
> 의존성: Phase 1 (#16), Phase 2 (#17), Phase 3a (#18 watcher 자동 등록 영향)
> Phase 3 시리즈의 마지막 사이클 — Phase 3 epic 종료.

## 1. 목표 / 범위

이슈 담당자를 단일에서 다중으로 전환한다. 운영 사용자가 없으므로 **단일컷 마이그레이션** — V9 한 번에 매핑 테이블 추가, 데이터 복사, 단일 컬럼 drop 까지 완료한다.

- `issue.assignee_id` 컬럼 **완전 제거**
- `issue_assignee(issue_id, user_id, assigned_by, created_at, PK(issue_id, user_id))` N:M 매핑 도입
- API 응답 `IssueResponse.assignees: List<UserSummary>` 만 노출, `assigneeId`/`assigneeName` 필드 삭제
- 담당자 변경은 **별도 PUT 엔드포인트** `PUT /projects/{key}/issues/{number}/assignees`
- 검색 `assignee=` 의미는 OR 결합 유지 (`null` 토큰 = 미지정)
- watcher 자동 등록은 신규 추가된 모든 assignee 에 대해 수행

**Out of Scope**: 멀티 assignee 필터 UI (백엔드만 강화, 프론트 픽커 deferred). create 다이얼로그의 담당자 입력 제거 (생성 후 상세에서 지정). 담당자 수 한도(무제한).

## 2. 아키텍처

### 2.1 백엔드 모듈

신규 모듈 없음. `issue` 모듈 내부에 추가:
- `IssueAssigneeRepository` — jOOQ
- `IssueAssigneeService` — 집합 교체 + history + WatcherAutoEnroller 호출
- `IssueAssigneeController` — `PUT /issues/{number}/assignees`
- `UserSummary` record `(id, username, name)` — 이슈 응답 내부에서 사용 (Watcher 도메인의 `WatcherResponse` 와는 별도; Modulith 경계)

### 2.2 데이터 흐름

1. 생성: 클라이언트 `CreateIssueRequest.assigneeIds: List<Long>?` → `IssueService.create` 가 멤버 검증 후 `issue_assignee` 다중 row insert + 각 assignee 자동 watch
2. 변경: 클라이언트 PUT `{userIds}` → `IssueAssigneeService.replace` → diff 계산 후 INSERT/DELETE → history 1건 + added 각각 watcher 자동 등록
3. 조회: 검색/상세 모두 `IssueAssigneeRepository.findByIssueIds(...)` 로 batch 채움 (N+1 회피, Phase 3a/3b 패턴 그대로)

## 3. 데이터 모델 — Flyway V9 (단일컷)

```sql
-- V9__multi_assignee.sql
-- 1) 매핑 테이블
CREATE TABLE issue_assignee (
  issue_id    BIGINT NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  assigned_by BIGINT NOT NULL REFERENCES "user"(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX idx_issue_assignee_user ON issue_assignee(user_id);

-- 2) 기존 단일 assignee 복사 (assigned_by 는 reporter 로 대체)
INSERT INTO issue_assignee (issue_id, user_id, assigned_by, created_at)
SELECT id, assignee_id, reporter_id, created_at
FROM issue
WHERE assignee_id IS NOT NULL;

-- 3) 컬럼 제거 (관련 인덱스 cascade)
ALTER TABLE issue DROP COLUMN assignee_id;
```

`assigned_by = reporter_id` 는 마이그레이션 시점에 원래 할당자 정보가 남아있지 않은 한계 — 합리적 fallback.

## 4. 백엔드 API

### 4.1 생성

```
POST /api/v1/projects/{key}/issues
{
  "title": "...",
  "body": "...",
  "priority": "MID",
  "dueDate": null,
  "assigneeIds": [42, 17]   // optional, null/빈 배열 허용
}
```

- 단일 `assigneeId` 필드 삭제
- 모든 assigneeIds 가 프로젝트 멤버여야 함. 아니면 400 `INVALID_ASSIGNEE_FOR_PROJECT`
- 자동 watcher: reporter + 각 assignee

### 4.2 부분 수정

`PATCH /issues/{number}` — assignee 관련 필드 제거 (`assigneeId`, `clearAssignee`). title/body/status/priority/dueDate 만 처리. assignee 변경은 별도 PUT.

### 4.3 담당자 집합 교체

```
PUT /api/v1/projects/{key}/issues/{number}/assignees
{ "userIds": [42, 17] }
→ List<UserSummary>
```

- 권한: 프로젝트 멤버
- 모든 userIds 가 프로젝트 멤버여야 함. 아니면 400 `INVALID_ASSIGNEE_FOR_PROJECT`
- 빈 배열 → 전체 제거 (히스토리에 removed 기록)
- history: `ASSIGNEES_CHANGED` 1건, payload toValue JSON `{added:[UserSummary], removed:[UserSummary]}`
- diff 0 → history 미기록
- added 각각 `WatcherAutoEnroller.enroll(issueId, userId)`

### 4.4 응답

`IssueResponse` 시그니처 변경 — 마지막 인자 자리에 `assignees: List<UserSummary>` 추가, `assigneeId`/`assigneeName` 제거:

```java
public record IssueResponse(
    Long id, String projectKey, int number, String title, String status, String priority,
    LocalDate dueDate, Long reporterId,
    Instant createdAt, Instant updatedAt,
    List<LabelSummary> labels,
    int attachmentCount,
    List<UserSummary> assignees) { ... }
```

신규 factory `fromWithFullDetails(projectKey, row, labels, attachmentCount, assignees)`. `from(...)` / `fromWithLabels(...)` / `fromWithDetails(...)` 모두 빈 assignees default 유지 → Phase 1·2·3a·3b 호환.

`IssueRow` 의 `assigneeId` 필드 제거 — mapToRow / select column 리스트 갱신.

### 4.5 검색 필터

기존 `assignee=42,null,17` 의미 유지 (OR 결합 + null=미지정).

`IssueRepository.search` 구현 교체:
```java
boolean hasAssigneeList = !query.assigneeIds().isEmpty();
if (hasAssigneeList || query.includeUnassigned()) {
  Condition cond = DSL.noCondition();
  if (hasAssigneeList) {
    cond = cond.or(DSL.exists(
      dsl.selectOne().from(ISSUE_ASSIGNEE)
         .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID)
                .and(ISSUE_ASSIGNEE.USER_ID.in(query.assigneeIds())))));
  }
  if (query.includeUnassigned()) {
    cond = cond.or(DSL.notExists(
      dsl.selectOne().from(ISSUE_ASSIGNEE)
         .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))));
  }
  where = where.and(cond);
}
```

### 4.6 watcher 자동 등록 변경

- `IssueService.create(...)` 끝: reporter + 각 신규 assignee 마다 `WatcherAutoEnroller.enroll(...)`
- `IssueAssigneeService.replace(...)` 끝: added 집합 각각 enroll
- 기존 `IssueService.update(...)` 의 assignee transition 분기 삭제 (필드 제거됨)

### 4.7 에러 매핑

| 상황 | 응답 |
|---|---|
| 다른 프로젝트 user / 멤버 아님 | 400 `INVALID_ASSIGNEE_FOR_PROJECT` |
| 존재하지 않는 userId | 400 (멤버 아님과 합침) |
| 비멤버 PUT | 403 |

## 5. 프론트엔드

### 5.1 파일 구조

```
src/types/user.ts                            # UserSummary 인터페이스
src/types/issue.ts                           # assigneeId/assigneeName 제거, assignees: UserSummary[]
src/api/issueAssignees.ts                    # PUT 집합 교체
src/hooks/queries/useUpdateIssueAssignees.ts
src/components/users/UserAvatar.tsx          # 이니셜 아바타
src/pages/projects/components/
  AssigneePickerPopover.tsx                  # 멤버 체크박스 다중 선택
```

### 5.2 IssueDetailPage

라벨 슬롯 옆 "담당자" 슬롯 추가. 라벨 픽커와 동일 패턴 — 팝오버 닫힐 때 변경분만 PUT.

### 5.3 보드 카드 / 리스트

- 카드: `assignees[0..2]` 아바타 + overflow `+N`. 빈 배열 → `미지정`
- 리스트: 담당자 컬럼 추가 안 함 (정보량 과다)

### 5.4 IssueCreateDialog

기존 단일 assignee 입력 제거. 생성 후 상세 화면에서 픽커로 지정.

### 5.5 활동 타임라인

- legacy `ASSIGNEE_CHANGED` (fromValue/toValue 단일 id) — 기존 렌더링 유지
- 신규 `ASSIGNEES_CHANGED` (toValue JSON `{added,removed}`) — `LABELS_CHANGED` 와 동일 파싱 패턴

### 5.6 필터 UI

deferred. URL 직렬화는 Phase 2 의 `parseFilters`/`filtersToParams` 그대로 사용 (`assigneeIds`/`includeUnassigned` 키 존재). 백엔드 파라미터 의미만 OR 로 강화됨.

## 6. 테스트

### 6.1 백엔드 (JUnit)

`IssueAssigneeServiceTest`
- 빈 → [42, 17] PUT → DB 2행 + history 1건 (added 2) + watcher 2명 자동 등록
- [42] → [17] PUT → swap + history (added 17, removed 42)
- 다른 프로젝트 user 섞이면 400
- 비멤버 PUT → 403
- 동일 집합 → history 미기록
- 빈 배열 PUT → 전체 제거

`IssueServiceTest` 보강
- `create(assigneeIds=[42,17])` → 매핑 2 + reporter/assignees 자동 watch 3명
- create 에서 다른 프로젝트 멤버 섞이면 400

`IssueRepositorySearchTest` 확장
- `assignee=42` → 42 가 매핑된 이슈만
- `assignee=42,17` → 42 OR 17
- `assignee=null` → NOT EXISTS
- `assignee=42,null` → OR 결합

`IssueResponseAssigneesTest`
- 검색 결과 `IssueResponse.assignees` N+1 없이 정확

### 6.2 마이그레이션 검증 (수동)

V9 적용 후:
```sql
SELECT COUNT(*) FROM issue WHERE deleted_at IS NULL;
SELECT COUNT(DISTINCT issue_id) FROM issue_assignee;
-- 차이만큼 원래 미지정이었는지 수동 확인
```

### 6.3 프론트엔드 E2E

`e2e/pages/projects/assignees.spec.ts`
- **@smoke**: 이슈 상세 진입 → AssigneePicker → 2명 체크 → 닫으면 PUT 호출 + 응답 → 메타에 아바타 2개 + 보드 카드도 2개
- 비우기: 모두 해제 → PUT `{userIds:[]}` → "미지정"
- 백엔드 400 → 에러 토스트

### 6.4 회귀

- Phase 1·2 의 `assigneeId` 참조 모두 갱신 필요 (백엔드 IssueRow/mapToRow/IssueResponse/Service/Repository, 프론트 IssueCard/WatchedIssuesPage/IssueListView)
- husky 게이팅: `projects` 도메인 그대로

## 7. 마이그레이션 영향 요약

- 응답 모양 breaking change: `assigneeId`/`assigneeName` 제거 → `assignees: UserSummary[]` 만. 프론트엔드 전면 갱신.
- `CreateIssueRequest` API breaking change: `assigneeId` → `assigneeIds`.
- `PATCH /issues/{number}` 의 assignee 필드 제거.
- 기존 `ASSIGNEE_CHANGED` history row 는 그대로. 신규 변경은 `ASSIGNEES_CHANGED`.

## 8. 결정 로그

- 단일컷 V9 — 운영 사용자 없음 가정
- `assignee_id` 완전 제거
- 변경은 별도 PUT 엔드포인트로 분리
- 검색 OR 결합 + null=NOT EXISTS
- 담당자 수 무제한
- create 다이얼로그 담당자 입력 제거 (상세 픽커로 일원화)
- 멀티 assignee 필터 UI 본 페이즈 deferred
- assigned_by 마이그레이션 fallback = reporter_id

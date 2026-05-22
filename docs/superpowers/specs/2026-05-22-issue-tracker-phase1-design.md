# Phase 1 — 이슈 트래커 골격 (Project + Issue CRUD)

- 관련 에픽: [#16](https://github.com/bluleo78/smart-workplace/issues/16)
- 후속: Phase 2 (#17 칸반/검색), Phase 5 (#20 AI Assignee)
- 작성일: 2026-05-22

## 1. 목적과 범위

워크플레이스 v1 의 이슈 트래커 골격. 사용자는 프로젝트를 만들고, 이슈를 등록·할당·상태 전이·코멘트할 수 있다. AI 기능은 본 페이즈에 포함하지 않으며, Phase 5 에서 같은 도메인 위에 얹는다.

### 포함

- `project`, `issue` 모듈 (workplace-api)
- `Project` / `ProjectMember` / `Issue` / `IssueComment` / `IssueHistory` 도메인
- 프로젝트별 시퀀스 + key 기반 이슈 식별자 (`{key}-{number}`, 예 `WP-123`)
- 4-state 워크플로우 (todo/in_progress/done/canceled), 자유 전이
- 단일 assignee + reporter, priority (low/mid/high), due_date
- 코멘트 (스레드 없음)
- 자동 활동 기록 (status/assignee/priority 변경)
- 프로젝트 멤버십 + 프로젝트 내 역할(OWNER/MEMBER), 시스템 ADMIN 은 모두 통과
- 프론트엔드 라우트: 프로젝트 목록/생성/상세/설정, 이슈 상세

### 제외

- 칸반 보드, DnD, 검색/필터 (Phase 2)
- 라벨, 파일 첨부, watchers, 다중 assignee (Phase 3)
- subtasks, 의존성, custom fields (Phase 4)
- AI Assignee, 이벤트 webhook, 자연어 작성 (Phase 5/6)
- 상태 전이 강제 규칙
- 알림 (이메일/푸시)
- 실시간 동기화

## 2. 데이터 모델

Flyway 마이그레이션 `V5__issue_tracker_phase1.sql` 로 일괄 추가.

### project

| column | type | note |
|---|---|---|
| id | BIGSERIAL PK | 내부 식별자 |
| key | VARCHAR(10) UNIQUE NOT NULL | `^[A-Z][A-Z0-9]{1,9}$`, 외부 노출 |
| name | VARCHAR(120) NOT NULL | |
| description | TEXT | nullable |
| owner_id | BIGINT NOT NULL | FK `"user".id` |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| deleted_at | TIMESTAMPTZ | soft delete |

index: `(deleted_at)` 부분 인덱스 (active 조회)

### project_member

| column | type | note |
|---|---|---|
| project_id | BIGINT NOT NULL | FK |
| user_id | BIGINT NOT NULL | FK `"user".id` |
| role | VARCHAR(16) NOT NULL | `OWNER`/`MEMBER` |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| PK | (project_id, user_id) | |

생성 시 호출자를 자동 `OWNER` 로 추가.

### issue

| column | type | note |
|---|---|---|
| id | BIGSERIAL PK | 내부 식별자 |
| project_id | BIGINT NOT NULL | FK |
| number | INT NOT NULL | 프로젝트 내 시퀀스 |
| title | VARCHAR(200) NOT NULL | |
| body | TEXT | 마크다운, nullable |
| status | VARCHAR(16) NOT NULL DEFAULT 'TODO' | `TODO`/`IN_PROGRESS`/`DONE`/`CANCELED` |
| priority | VARCHAR(8) NOT NULL DEFAULT 'MID' | `LOW`/`MID`/`HIGH` |
| due_date | DATE | nullable |
| reporter_id | BIGINT NOT NULL | FK `"user".id` |
| assignee_id | BIGINT | FK `"user".id`, nullable |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| closed_at | TIMESTAMPTZ | DONE/CANCELED 진입 시각, 재개 시 NULL |
| deleted_at | TIMESTAMPTZ | soft delete |
| UNIQUE | (project_id, number) | |

index: `(project_id, status, updated_at DESC)`, `(assignee_id)`

번호 발급: `project_issue_sequence(project_id BIGINT PK, next_number INT)` 별도 테이블에서 `UPDATE ... RETURNING` 으로 원자 발급. 동시 발급 경쟁 회피.

### issue_comment

| column | type | note |
|---|---|---|
| id | BIGSERIAL PK | |
| issue_id | BIGINT NOT NULL | FK |
| author_id | BIGINT NOT NULL | FK `"user".id` |
| body | TEXT NOT NULL | 마크다운 |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| deleted_at | TIMESTAMPTZ | |

index: `(issue_id, created_at)`

### issue_history

| column | type | note |
|---|---|---|
| id | BIGSERIAL PK | |
| issue_id | BIGINT NOT NULL | FK |
| actor_id | BIGINT NOT NULL | FK `"user".id` |
| event_type | VARCHAR(32) NOT NULL | `STATUS_CHANGED`/`ASSIGNEE_CHANGED`/`PRIORITY_CHANGED`/`DUE_DATE_CHANGED`/`TITLE_CHANGED` |
| from_value | TEXT | 직렬화 (단순 문자열) |
| to_value | TEXT | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

index: `(issue_id, created_at)`

본문(`body`) 변경은 활동 기록 대상에서 제외 (소음 방지). 향후 diff 보존이 필요해지면 Phase 5 (AI 컨텍스트) 단계에서 별도 정책 수립.

## 3. 권한 / 가드

### 권한 코드 (DB seed 추가)

- `project:read` — 프로젝트/이슈/코멘트 조회
- `project:write` — 프로젝트 생성·수정
- `project:manage` — 멤버 관리·프로젝트 삭제 (OWNER 또는 ADMIN)
- `issue:write` — 이슈 생성·수정·삭제, 코멘트 작성

ADMIN 역할에 위 4종 모두 부여. USER 역할에 `project:read`, `project:write`, `issue:write` 부여.

### 멤버십 가드

`@RequirePermission` 만으로는 "어느 프로젝트인지" 검증이 불가하다. 다음 두 단계 가드를 둔다.

1. `@RequirePermission` 으로 권한 코드 보유 검증 (기존 인터셉터)
2. 서비스 메서드 진입부에서 `ProjectAccessGuard.assertMember(projectKey, principal, requiredRole?)` 호출
   - 시스템 ADMIN 역할 보유 시 모든 프로젝트 통과
   - 그 외에는 `project_member` 행이 있어야 통과
   - `requiredRole = OWNER` 인 경우 멤버 role 도 OWNER 여야 통과

가드 실패 시 `ForbiddenException` (403).

## 4. API

모든 경로 prefix `/api/v1`. 인증 필요. 응답은 기존 `ApiResponse` 래퍼 일관.

### 프로젝트

| Method | Path | 권한 | 비고 |
|---|---|---|---|
| GET | `/projects` | `project:read` | 내가 멤버인 프로젝트 (ADMIN 은 전체). 페이지네이션 |
| POST | `/projects` | `project:write` | 호출자 자동 OWNER 등록 |
| GET | `/projects/{key}` | `project:read` + 멤버 | 상세 (멤버 수, 이슈 카운트 요약) |
| PATCH | `/projects/{key}` | `project:write` + 멤버 | name/description |
| DELETE | `/projects/{key}` | `project:manage` + OWNER | soft delete |
| GET | `/projects/{key}/members` | `project:read` + 멤버 | |
| POST | `/projects/{key}/members` | `project:manage` + OWNER | `{ userId, role }` |
| PATCH | `/projects/{key}/members/{userId}` | `project:manage` + OWNER | role 변경 |
| DELETE | `/projects/{key}/members/{userId}` | `project:manage` + OWNER | OWNER 본인 제거는 다른 OWNER 가 1명 이상 있어야 가능 |

### 이슈

| Method | Path | 권한 | 비고 |
|---|---|---|---|
| GET | `/projects/{key}/issues` | `project:read` + 멤버 | 페이지네이션, 정렬 `updated_at desc` 기본. 필터는 Phase 2 |
| POST | `/projects/{key}/issues` | `issue:write` + 멤버 | 서버가 `number` 발급. reporter 는 호출자 |
| GET | `/projects/{key}/issues/{number}` | `project:read` + 멤버 | 코멘트/히스토리 임베드 (최근 N개) |
| PATCH | `/projects/{key}/issues/{number}` | `issue:write` + 멤버 | 부분 갱신. 변경 항목별 `issue_history` 자동 기록. status 가 DONE/CANCELED 로 진입 시 `closed_at` 세팅, 복귀 시 NULL |
| DELETE | `/projects/{key}/issues/{number}` | `issue:write` + (reporter or OWNER) | soft delete |

### 코멘트

코멘트는 내부 `issueId` 기반으로 단순화 (이슈 상세 응답에 issueId 포함).

| Method | Path | 권한 | 비고 |
|---|---|---|---|
| GET | `/issues/{issueId}/comments` | `project:read` + 멤버 | 페이지네이션, `created_at asc` |
| POST | `/issues/{issueId}/comments` | `issue:write` + 멤버 | author 는 호출자 |
| PATCH | `/issues/{issueId}/comments/{commentId}` | author 본인만 | |
| DELETE | `/issues/{issueId}/comments/{commentId}` | author 또는 프로젝트 OWNER | soft delete |

### 요청/응답 페이로드

기존 `ApiResponse<T>`, `PageResponse<T>` 형식 따름. DTO 명세는 구현 단계에서 확정.

## 5. 백엔드 모듈 구조

```
com.workplace.project/
  controller/ProjectController.java
  controller/ProjectMemberController.java
  service/ProjectService.java
  service/ProjectAccessGuard.java
  repository/ProjectRepository.java
  repository/ProjectMemberRepository.java
  dto/...
  exception/ProjectNotFoundException.java
  exception/ProjectAccessDeniedException.java

com.workplace.issue/
  controller/IssueController.java
  controller/IssueCommentController.java
  service/IssueService.java
  service/IssueCommentService.java
  service/IssueHistoryRecorder.java
  repository/IssueRepository.java
  repository/IssueCommentRepository.java
  repository/IssueHistoryRepository.java
  repository/IssueNumberSequenceRepository.java
  dto/...
  exception/IssueNotFoundException.java
```

- jOOQ 사용 (프로젝트 컨벤션)
- 도메인 간 직접 import 금지: `issue` → `project` 는 `ProjectAccessGuard` 빈만 의존, 데이터 접근은 자체 repository
- `IssueHistoryRecorder`: `IssueService.update*` 가 변경 전/후 값을 받아 일괄 기록

## 6. 프론트엔드 구조

### 라우트

| Path | Page | Guard |
|---|---|---|
| `/projects` | `ProjectListPage` | Authenticated |
| `/projects/new` | (모달 in `ProjectListPage`) | Authenticated |
| `/projects/:key` | `ProjectDetailPage` (이슈 리스트) | Authenticated + member check via 404/403 |
| `/projects/:key/issues/new` | (모달 in `ProjectDetailPage`) | |
| `/projects/:key/issues/:number` | `IssueDetailPage` | |
| `/projects/:key/settings` | `ProjectSettingsPage` (멤버 관리 포함) | OWNER (UI 차단) |

기존 라우터에 lazy import 로 추가.

### 신규 파일

```
src/api/projects.ts
src/api/issues.ts
src/api/issueComments.ts
src/types/project.ts
src/types/issue.ts
src/hooks/queries/useProjects.ts
src/hooks/queries/useIssues.ts
src/hooks/queries/useIssue.ts
src/hooks/queries/useIssueComments.ts
src/lib/validations/project.ts
src/lib/validations/issue.ts
src/pages/projects/ProjectListPage.tsx
src/pages/projects/ProjectDetailPage.tsx
src/pages/projects/ProjectSettingsPage.tsx
src/pages/projects/IssueDetailPage.tsx
src/pages/projects/components/IssueListTable.tsx
src/pages/projects/components/IssueCreateDialog.tsx
src/pages/projects/components/IssueStatusBadge.tsx
src/pages/projects/components/IssuePriorityBadge.tsx
src/pages/projects/components/IssueCommentList.tsx
src/pages/projects/components/IssueActivityTimeline.tsx
```

shadcn 추가: `dialog`, `select`, `textarea`, `badge`, `popover`, `calendar`(due_date).

### 상태 관리

- 서버 상태는 TanStack Query
- 상세 페이지 인라인 편집은 `useMutation` + `invalidateQueries(['issue', key, number])`
- 활동 타임라인은 상세 응답에 임베드, 코멘트 추가 시 같은 쿼리 invalidate

## 7. 검증 / 에러

- 백엔드: `@Valid` + Bean Validation, 검증 실패 시 기존 `GlobalExceptionHandler` 의 400 응답
- 프론트: Zod 스키마 + react-hook-form, 서버 400 메시지는 Sonner toast
- `key` 중복 시 409 conflict, 한국어 메시지

## 8. 테스트

### 백엔드 (JUnit + IntegrationTestBase)

각 컨트롤러별 다음 케이스를 의무화한다.

- happy path
- 권한 거부 (비멤버 / role 부족 / 권한 코드 미보유)
- 입력 검증 실패 (key 패턴, title blank, status enum)
- 도메인 규칙
  - 동일 프로젝트 내 issue.number 가 단조 증가
  - `PATCH` status 변경 시 `issue_history` row 생성, `closed_at` 갱신
  - OWNER 1명 남은 상태에서 본인 제거 시 422
  - soft delete 후 목록·상세 모두 미노출

### 프론트엔드 (Playwright)

`e2e/pages/projects/` 디렉토리 신설.

- `@smoke` (1개): 프로젝트 생성 → 이슈 생성 → 상태 `IN_PROGRESS` 로 변경 → 코멘트 1개 작성. 각 단계에서 API payload·UI 반영을 검증
- non-smoke:
  - 권한 없는 프로젝트 접근 시 403 메시지
  - `PATCH` 직후 활동 타임라인에 변경 row 가 한국어 라벨로 노출
  - soft delete 후 목록에서 사라짐

`pre-commit` 훅 매핑을 위해 `src/pages/projects/` 디렉토리와 `e2e/pages/projects/` 디렉토리를 같은 이름으로 둔다 (도메인 = `projects`). 도메인 정규식에 `projects` 를 추가 (`scripts/husky/pre-commit.sh`).

## 9. 빌드 순서

1. Flyway V5 마이그레이션 + jOOQ regen (`pnpm db:reset` 후 `./gradlew generateJooq`)
2. 권한 seed (V5 안에서 INSERT)
3. `project` 모듈 — repository → service → controller → 통합 테스트
4. `issue` 모듈 — 같은 순서, `IssueHistoryRecorder` 포함
5. 코멘트
6. 프론트 API 클라이언트 + 쿼리 훅
7. 프로젝트 리스트/상세
8. 이슈 상세 (인라인 편집 + 코멘트 + 활동)
9. 프로젝트 설정 (멤버 관리)
10. E2E (smoke + non-smoke)
11. `scripts/husky/pre-commit.sh` 의 `WEB_DOMAINS_RE` 에 `projects` 추가

## 10. 위험 / 미해결

- jOOQ codegen 이 V5 마이그레이션 후 의존하므로, DB 가 켜진 상태에서만 빌드 가능. CI 에서는 `db:up` 후 `generateJooq` 자동화 필요
- 동시 이슈 생성 시 `number` 발급은 별도 sequence 테이블의 `UPDATE ... RETURNING` 로 직렬화. 단일 노드 가정. 향후 horizontally scale 시 advisory lock 검토
- `closed_at` 의미: 재개 시 NULL 로 되돌리는 동작이 통계에 미치는 영향 — 본 페이즈에서는 단순화, Phase 5 에서 별도 정책 검토

## 11. 완료 정의 (DoD)

- 백엔드 통합 테스트 전부 통과, JaCoCo 라인 커버리지 신규 모듈 ≥ 80%
- Playwright 전체 spec 통과 (smoke + non-smoke 포함)
- `pnpm typecheck`, `pnpm lint` 통과
- `pnpm test:e2e` 로컬 통과
- 새 라우트 수동 검증 (개발 서버 + 브라우저)
- 본 spec 과 구현/마이그레이션이 한 PR 로 묶여 사용자 승인 후 커밋

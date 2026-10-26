# 버전(수정 버전·영향 버전) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트별 버전 목록(이름·설명·시작일·출시일·상태)을 두고, 이슈에 수정 버전·영향 버전을 여러 개 붙여 걸러 보며, Jira 처럼 출시·보관하고, 버전 화면에서 유형별로 나가는 이슈와 진행을 보고, 타임라인에 출시일을 그리며, MCP·가져오기 API 가 버전을 다룬다.

**Architecture:** 새 테이블 2개(`project_version`, `issue_version(kind FIX|AFFECTS)`, 테넌트 RLS)와 새 패키지 `com.workplace.version`(목록 관리·출시·삭제 옮기기), issue 모듈에 이슈-버전 연결·필터·이력을 더한다. 바로 앞 웨이브의 구성요소(`com.workplace.component`, `IssueComponentService`, `COMPONENTS_CHANGED`, V218)가 가장 가까운 선례이므로 같은 모양을 따른다(자동 지정만 없다). 웹은 프로젝트 머리 「버전」 버튼과 새 화면 2개(목록·상세), 이슈 레일 두 줄, 필터 facet 두 개, 선택 열 두 개, 타임라인 「버전」 레인을 더한다. 마일스톤은 건드리지 않는다.

**Tech Stack:** Spring Boot · jOOQ · Flyway(Postgres, Testcontainers) / React 19 · TanStack Query · shadcn/ui · SVAR 간트 · Playwright / TypeScript MCP 공유 도구(vitest).

**Spec:** `docs/superpowers/specs/2026-10-26-wp888-issue-versions-design.md` — 이 계획은 스펙을 따른다. 구현자는 둘 다 읽는다.

## Global Constraints

- 작업은 워크트리 `.claude/worktrees/wp882-wave5`(브랜치 `feat/WP-882-wave5`)에서만. 커밋은 로컬 `--no-verify`, 메시지는 docs/COMMIT_CONVENTION.md 한국어 형식 + 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `docs/superpowers/` 는 gitignore 대상이라 `git add -f`. `.superpowers/` 아래는 절대 add 하지 않는다.
- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜). 백엔드 테스트는 `IntegrationTestBase` 통합 테스트, 웹은 Playwright E2E(순수 로직은 vitest, 화면 분기는 컴포넌트 테스트).
- 마이그레이션은 `V219__project_versions.sql` 하나. 새 테이블만(롤링 배포 호환). 적용 후 `./gradlew generateJooq`. 테넌트 테이블 패턴은 `V218__issue_components.sql` 그대로.
- 값: 이름 1~40자(앞뒤 공백 제거, NFC — 구성요소의 `SingleLineTitles` 사용, 프로젝트 안 대소문자 무시 유일), 설명 0~500자, `start_date <= release_date`(둘 다 있을 때). 상한 200개/프로젝트(보관 포함).
- 상태 = 보관(`archived_at`) > 출시됨(`released_at`) > 미출시. API 값 `UNRELEASED|RELEASED|ARCHIVED`.
- 목록 순서(모든 곳 같은 순서): 미출시 → 출시됨 → 보관. 미출시는 `release_date` 오름차순(null 뒤), 출시됨·보관은 `release_date` 내림차순(null 이면 `released_at` 내림차순), 마지막으로 `lower(name)`, id.
- 관리(만들기·편집·출시·출시 취소·보관·복원·삭제) = `ProjectAccessGuard.assertWithRole(key, uid, "OWNER")`(테넌트 ADMIN 우회 포함, 구성요소와 같음). 보기 = `assertReadable`. 이슈에 붙이기·떼기 = 구성요소와 같은 멤버 권한(`IssueComponentService.replace` 의 가드). 개인 프로젝트는 만들기 400 `PERSONAL_PROJECT_UNSUPPORTED`.
- 보관된 버전: 새로 붙이기 400 `VERSION_ARCHIVED`(이미 붙은 것 유지는 허용), 가져오기는 허용. 출시된 버전은 자유롭게 붙인다.
- 진행: 수정 버전 이슈를 상태 범주로 센다 — **CANCELED 는 done** (`CycleProgress` 와 같음). `progress {done, inProgress, todo}`, 전체 = 합. `affectsCount` = 영향 버전 이슈 수(취소 포함).
- 이력 유형 `FIX_VERSIONS_CHANGED`, `AFFECTS_VERSIONS_CHANGED` payload `{added:[{id,name}], removed:[{id,name}]}`, 차이 없으면 기록 안 함, 화면은 저장된(당시) 이름.
- 이슈 변경 이벤트는 정리성 변경과 같은 `updatedWithoutTouch` 경로(AI 작업을 시작하지 않는다) — 붙이기·출시 옮기기·삭제 옮기기 모두.
- 잠금은 한 방향 **이슈 행 → 버전 행**: 교체·가져오기는 이슈 `FOR UPDATE` → 버전 공유 잠금. 출시 옮기기·삭제는 대상 이슈 id 를 읽고 → 이슈 행들 id 순 `FOR UPDATE` → 원래·대상 버전 행 id 순 잠금 → 잠근 상태에서 대상 집합 재확인.
- 오류 코드(`CodedException`, `errors.code`): `VERSION_NAME_TAKEN`, `VERSION_ARCHIVED`, `VERSION_NOT_FOUND`, `VERSION_NOT_ARCHIVED`, `VERSION_LIMIT`, `VERSION_INVALID_DATES`, `VERSION_MOVE_TARGET_INVALID`, `PERSONAL_PROJECT_UNSUPPORTED`. 가져오기: `IMPORT_UNKNOWN_VERSIONS`(`errors.reason`).
- 필터 파라미터 `fixVersion`, `affectsVersion` = id 또는 이름 CSV, OR, 특수 토큰 `none`. 두 필터는 서로 AND. 해석은 구성요소 `component` 와 같은 코드 경로를 일반화하거나 따른다.
- MCP: 새 도구 없음(`APP_TOOL_CAP` 18). `DEFINITION_TOKEN_CAP`(16,900)를 넘으면 **올리지 말고 멈춰서 보고**(사용자 승인 필요). 플러그인 `plugins/genia-works/.claude-plugin/plugin.json` 0.1.13 → 0.1.14, `apps/workplace-web/public/claude/marketplace.json` 참조 `genia-works--v0.1.14`.
- 화면 문구에 내부 구분어(태스크 번호, 영어 코드)를 쓰지 않는다. 디자인 시스템 토큰만(`docs/design-system/`), hex 금지. 날짜 표시는 `src/lib/formatters.ts` 만.
- 보관 안 된 버전이 없는 프로젝트에서는 이슈 상세 두 줄·필터·열·타임라인 레인이 보이지 않는다(보관 값이 붙은 이슈 상세만 읽기 전용). 프로젝트 머리 「버전」 버튼은 개인 프로젝트가 아니면 늘 보인다.

## Review Focus

1. 출시 옮기기가 완료·취소 이슈와 영향 버전을 건드리지 않고, 이미 대상 버전이 붙은 이슈는 중복 행을 만들지 않는지(Task 4 `releaseMovesOnlyUnresolvedFix`, `releaseMoveSkipsAlreadyTargeted`).
2. 같은 버전을 한 이슈에 수정·영향으로 동시에 붙여도 두 종류가 서로 덮어쓰지 않는지(Task 3 `fixAndAffectsIndependent`).
3. 동시에 교체와 출시 옮기기가 일어나도 교착 없이 끝나는지(Task 4 `concurrentReplaceAndReleaseNoDeadlock`).
4. 출시일이 지난 미출시 버전, 날짜 없는 버전의 순서·「지남」 표시(Task 2 `listOrder`, Task 7 vitest `versionDueState`).
5. 버전이 없는 프로젝트에서 이슈 화면·타임라인이 바뀌지 않는지(Task 8 vitest `versionsHidden`, Task 9 E2E `버전이 없으면 칸·필터·레인이 보이지 않는다`).

---

### Task 1: 스키마

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V219__project_versions.sql`
- Modify: `apps/workplace-api/src/main/java/com/workplace/platform/purge/TenantPurgePlan.java`
- Regenerate: `apps/workplace-api/src/main/generated/` (`./gradlew generateJooq`)
- Test: `apps/workplace-api/src/test/java/com/workplace/version/VersionSchemaTest.java`

**Interfaces:**
- Produces: `project_version(id, tenant_id, project_id, name, description, start_date, release_date, released_at, archived_at, created_by, created_at, updated_at)` — FK project cascade, `created_by` → `"user"(id)` SET NULL, 유일 인덱스 `uq_project_version_name (project_id, lower(name))`, `CHECK (char_length(name) BETWEEN 1 AND 40)`, `description VARCHAR(500)`, `CHECK (start_date IS NULL OR release_date IS NULL OR start_date <= release_date)`.
- Produces: `issue_version(issue_id, version_id, kind, tenant_id, created_at)` — PK `(issue_id, version_id, kind)`, `kind VARCHAR(10) CHECK (kind IN ('FIX','AFFECTS'))`, 두 FK cascade, 인덱스 `idx_issue_version_version (version_id, kind)`.

- [ ] **Step 1: 실패하는 테스트** — `VersionSchemaTest`: `nameUniqueIgnoringCaseAtDb`(`v1.0`·`V1.0` INSERT → `DataIntegrityViolationException`), `datesOrderChecked`(start 11/05·release 11/01 → 위반), `sameVersionBothKindsAllowed`(같은 이슈·버전에 FIX·AFFECTS 두 행 OK, FIX 두 번은 위반), `issueDeleteCascades`, `rlsIsolatesTenants`.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*VersionSchemaTest"` FAIL.
- [ ] **Step 3: 구현** — V219 + `TenantPurgePlan` 에 `issue_version` → `project_version` 순서 + `generateJooq`.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*TenantPurge*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 버전 테이블을 더한다 (WP-888)`

### Task 2: 버전 목록 관리 API (만들기·편집·보관·진행)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/version/{controller/VersionController, service/VersionService, repository/VersionRepository, dto/VersionResponse, dto/VersionRow, dto/VersionSummary, dto/VersionProgress, dto/CreateVersionRequest, dto/UpdateVersionRequest, exception/VersionException}.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/version/VersionManagementTest.java`

**Interfaces:**
- Produces: REST `/api/v1/projects/{key}/versions` — `GET`(보관 포함 전체, 목록 순서) · `POST` · `GET /{id}` · `PATCH /{id}`(`name?`, `description?`, `clearDescription?`, `startDate?`, `clearStartDate?`, `releaseDate?`, `clearReleaseDate?`, `archived?`). 삭제·출시는 Task 4.
- Produces: `record VersionResponse(long id, String name, String description, LocalDate startDate, LocalDate releaseDate, String status, OffsetDateTime releasedAt, VersionProgress progress, int affectsCount)`; `record VersionProgress(int done, int inProgress, int todo)`; `record VersionSummary(long id, String name, String status)`.
- Produces: `VersionRepository.listByProject(long projectId): List<VersionRow>`(목록 순서), `findByIds(long projectId, Collection<Long> ids)`, `findByNamesIgnoreCase(long projectId, Collection<String> names)`, `lockForShare(Collection<Long> ids)`, `lockForUpdate(Collection<Long> ids)`, `summariesByIssueIds(Collection<Long> issueIds, String kind): Map<Long, List<VersionSummary>>`(목록 순서), `progressByVersionIds(Collection<Long>): Map<Long, VersionProgress>`, `affectsCountByVersionIds(...)` — 이후 태스크가 쓴다. 집계는 버전 목록 한 번에(N+1 금지).

- [ ] **Step 1: 실패하는 테스트** — `VersionManagementTest`:
  - `listOrder`: 미출시 A(11/10)·B(11/01)·C(날짜 없음), 출시 D(10/01)·E(10/15), 보관 F → GET 순서 `B, A, C, E, D, F`.
  - `adminCanManageMemberCannot`: 테넌트 ADMIN 201, 멤버 403, 읽을 수 있는 비멤버 GET 200.
  - `nameUniqueIgnoringCase`: `v1.6.1` 있을 때 `" V1.6.1 "` 생성·이름 변경 400 `VERSION_NAME_TAKEN`; 41자 400.
  - `datesValidated`: start > release 400 `VERSION_INVALID_DATES`(생성·PATCH 모두, PATCH 는 기존 값과 합쳐 검사).
  - `personalProjectRejected`: 400 `PERSONAL_PROJECT_UNSUPPORTED`.
  - `archiveAndRestore`: PATCH `archived:true` → `status=ARCHIVED`, false → 이전 상태(미출시/출시됨) 복원.
  - `progressCountsFixOnlyCanceledAsDone`: 수정 버전 이슈 DONE·CANCELED·IN_PROGRESS·TODO 각 1 + 영향 버전 이슈 2 → `progress {done:2, inProgress:1, todo:1}`, `affectsCount 2`.
  - `limit200`: 201번째 400 `VERSION_LIMIT`.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*VersionManagementTest"` FAIL.
- [ ] **Step 3: 구현** — `com.workplace.component` 모양을 따른다. 이 태스크의 테스트 데이터는 jOOQ 로 `issue_version` 에 직접 넣는다.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 프로젝트 버전을 만들고 고치고 보관하며 진행을 세는 API 를 더한다 (WP-888)`

### Task 3: 이슈에 버전 — 붙이기·응답·필터·이력

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/{controller/IssueVersionController, service/IssueVersionService, repository/IssueVersionRepository, dto/ReplaceVersionsRequest}.java`
- Modify: `.../issue/dto/IssueResponse.java`(`fixVersions`, `affectsVersions`), `.../issue/dto/IssueHistoryEventType.java`, `.../issue/service/IssueHistoryRecorder.java`, `.../issue/service/IssueSearchService.java`, `.../issue/service/IssueFilterResolver.java`, `.../issue/repository/IssueSearchQuery.java`, `.../issue/repository/IssueRepository.java`, `IssueResponse` 를 조립하는 상세·목록 경로(구성요소 `components` 가 채워지는 곳과 같은 곳)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueVersionTest.java`, `IssueVersionFilterTest.java`

**Interfaces:**
- Consumes: Task 2 `VersionRepository`, `VersionSummary`.
- Produces: `PUT /api/v1/projects/{key}/issues/{number}/versions` body `{fixVersionIds?: long[], affectsVersionIds?: long[]}`(빠진 키는 그 종류 유지) → `{fixVersions: VersionSummary[], affectsVersions: VersionSummary[]}`.
- Produces: `IssueHistoryEventType.FIX_VERSIONS_CHANGED`, `AFFECTS_VERSIONS_CHANGED`; `IssueHistoryRecorder.recordVersionsChanged(Long actor, long issueId, String kind, List<VersionSummary> added, List<VersionSummary> removed)` + `at` 오버로드(빈 diff 생략).
- Produces: `IssueVersionService.applyChange(long issueId, String kind, Set<Long> add, Set<Long> remove, Long actor)` — Task 4 출시·삭제 옮기기가 쓰는 공통 경로(행 쓰기·이력·`updatedWithoutTouch` 이벤트).
- Produces: `IssueResponse.fixVersions`, `affectsVersions: List<VersionSummary>`(목록 순서, null 아님). `IssueSearchQuery.fixVersionIds`, `fixVersionNone`, `affectsVersionIds`, `affectsVersionNone`; 쿼리 파라미터 `fixVersion`, `affectsVersion`.

- [ ] **Step 1: 실패하는 테스트**
  - `IssueVersionTest`: `replaceRecordsDiffPerKind`(fix [A,B] → [B] 이력 `FIX_VERSIONS_CHANGED` 2건, affects 는 기록 없음, 같은 집합 재전송 기록 없음); `fixAndAffectsIndependent`(fix=[A] 후 `{affectsVersionIds:[A]}` 만 PUT → fix 그대로 [A], affects [A]); `archivedCannotBeAddedButKept`(A 붙인 뒤 보관, [A] 재전송 200, 보관된 C 추가 400 `VERSION_ARCHIVED`); `releasedCanBeAdded`(출시된 버전 추가 200); `otherProjectVersionRejected`(400 `VERSION_NOT_FOUND`); `nonMemberCannotReplace`(403); `detailAndListIncludeVersions`; `replaceDoesNotStartAiWork`(AI 담당 이슈에 붙여도 에이전트 작업 이벤트 없음 — 구성요소 테스트의 같은 검증 방식).
  - `IssueVersionFilterTest`: `fixFilterOrById`, `fixFilterByNameIgnoringCase`, `fixFilterNone`, `affectsFilterSeparate`(fix 로만 붙은 이슈는 `affectsVersion=A` 에 안 나옴), `bothFiltersAnd`, `filterIncludesArchived`, `savedViewQueryRoundTrip`.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueVersion*"` FAIL.
- [ ] **Step 3: 구현** — `IssueComponentService.replace` 모양 + 종류(kind) 인자. 필터는 `component` 조건 옆에 `EXISTS issue_version … kind=? AND version_id IN (…)` / `NOT EXISTS`. 목록 응답은 `summariesByIssueIds` 로 한 번에.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*IssueSearch*" --tests "*IssueComponent*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 이슈에 수정 버전·영향 버전을 붙이고 버전으로 거른다 (WP-888)`

### Task 4: 출시·출시 취소·삭제(옮기기)

**Files:**
- Modify: `.../version/controller/VersionController.java`, `.../version/service/VersionService.java`, `.../version/repository/VersionRepository.java`
- Create: `.../version/dto/ReleaseVersionRequest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/version/VersionReleaseTest.java`, `VersionDeleteTest.java`, `VersionRaceTest.java`

**Interfaces:**
- Consumes: Task 3 `IssueVersionService.applyChange`.
- Produces: `POST /{id}/release` body `{releaseDate?: date, moveUnresolvedTo?: long}` → `VersionResponse`; `POST /{id}/unrelease` → `VersionResponse`; `GET /{id}/issue-count` → `{fix, affects, unresolvedFix}`; `DELETE /{id}?moveTo={id}`.

- [ ] **Step 1: 실패하는 테스트**
  - `VersionReleaseTest`: `releaseSetsStatusAndDate`(releaseDate 없음·기존 없음 → 오늘 Asia/Seoul, `released_at` 채움); `releaseKeepsExistingDate`; `releaseMovesOnlyUnresolvedFix`(fix 이슈 TODO·IN_PROGRESS·DONE·CANCELED + affects TODO 이슈 → 옮긴 것은 앞 둘뿐, 각 이슈 `FIX_VERSIONS_CHANGED` 1건, affects 불변); `releaseMoveSkipsAlreadyTargeted`(대상이 이미 붙은 이슈 → 원래만 빠지고 대상 행 하나); `moveTargetValidated`(자기 자신·출시된·보관된·다른 프로젝트 → 400 `VERSION_MOVE_TARGET_INVALID`, 아무것도 안 바뀜); `unreleaseKeepsReleaseDate`; `memberCannotRelease`(403).
  - `VersionDeleteTest`: `deleteRequiresArchived`(보관 안 됨 400 `VERSION_NOT_ARCHIVED`); `deleteDetaches`(fix 2·affects 1 이슈 → 연결 0, 이력 종류별 1건씩); `deleteMovesSameKind`(`moveTo=B` → fix 는 fix 로, affects 는 affects 로); `deleteMoveTargetValidated`(보관된 대상 400); `issueCountBeforeDelete`.
  - `VersionRaceTest`: `concurrentReplaceAndReleaseNoDeadlock`(같은 이슈에 PUT 교체와 출시 옮기기를 동시에 20회 → 모두 끝나고 최종 행이 둘 중 하나의 결과와 일치, 교착·500 없음).
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*VersionRelease*" --tests "*VersionDelete*" --tests "*VersionRace*"` FAIL.
- [ ] **Step 3: 구현** — 잠금 순서는 Global Constraints. 옮기기는 이슈마다 `applyChange`.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 버전을 출시하며 끝나지 않은 이슈를 다음 버전으로 옮기고, 보관한 버전을 지운다 (WP-888)`

### Task 5: 가져오기 API — 버전·변경 이력

**Files:**
- Modify: `.../issue/dto/ImportIssueRequest.java`(`fixVersionNames`, `affectsVersionNames`), `.../issue/service/IssueImportService.java`, `.../issue/exception/IssueImportException.java`(`unknownVersions(List<String>)` → `IMPORT_UNKNOWN_VERSIONS`)
- Modify: `docs/integrations/issue-import-api.md` — 필드·history 유형·오류·준비 순서(버전을 먼저 만들고 출시된 것은 출시, 이력에만 남은 지워진 이름은 보관된 버전으로 만든다)·CLIM 주의
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueImportVersionsTest.java`

**Interfaces:**
- Consumes: Task 2 `findByNamesIgnoreCase`, Task 3 연결 저장소·`recordVersionsChanged(..., at)`.

- [ ] **Step 1: 실패하는 테스트** — `importsBothKindsByNameIgnoringCase`; `archivedAndReleasedAllowed`; `duplicateNamesCollapse`(`["v1","V1"]` → 1행); `unknownNameRejectedBeforeWrite`(400 `IMPORT_UNKNOWN_VERSIONS`, 이슈 0건); `historyImported`(`FIX_VERSIONS_CHANGED` added `["v1.5.3"]` 원시각·작성자 그대로, `AFFECTS_VERSIONS_CHANGED` 도); `historyUnknownNameRejected`.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueImportVersionsTest"` FAIL.
- [ ] **Step 3: 구현** — 구성요소 가져오기(`componentNames`, `AddedRemovedNames`)와 같은 「쓰기 전 모두 검증」 단계. 문서 갱신.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*IssueImport*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 가져오기 API 가 수정 버전·영향 버전과 그 변경 이력을 옮긴다 (WP-888)`

### Task 6: MCP·AI 비서·플러그인

**Files:**
- Modify: `packages/mcp-tools-shared/src/{schemas.ts, issue-tools.ts, project-tools.ts, resolve.ts, rest-client.ts, tool-client.ts, issue-view.ts, issue-detail.ts}`, `tool-naming.test.ts`(상한은 넘으면 멈춤), 스냅샷
- Modify: `apps/workplace-ai-agent/src/agent/assistant-system-prompt.ts`(+ 테스트), `apps/workplace-ai-agent/src/agent/subagents/issue-agent/agent.md`, `plugins/genia-works/.claude-plugin/plugin.json`(0.1.14), `apps/workplace-web/public/claude/marketplace.json`(`genia-works--v0.1.14`)

**Interfaces:**
- Consumes: `GET /projects/{key}/versions`, `PUT …/versions`, 필터 `fixVersion`/`affectsVersion`, `IssueResponse.fixVersions/affectsVersions`. 이슈 만들기 API 에는 버전 인자가 없으므로 `create_issue` 는 만든 뒤 `PUT …/versions` 를 부른다.
- Produces: `SharedToolClient.getProjectVersions(projectKey)`; `resolveVersionNames(names, existing, {allowArchivedIds?})`(구성요소 `resolveComponentNames` 와 같은 모양).
- 도구 인자: `list_issues.fixVersion`, `list_issues.affectsVersion`(string, 이름 CSV, `none`), `create_issue`/`update_issue` 의 `fixVersions`, `affectsVersions`(string[], update 는 종류별 교체). `get_project` 응답 `versions: [{name, status, releaseDate}]`(`.catch(() => null)` 로 실패 격리). 상세·목록 보기에 두 이름 배열.

- [ ] **Step 1: 실패하는 테스트** — `createIssueSetsVersionsAfterCreate`; `unknownVersionFailsBeforeWrite`(생성 호출 없음); `archivedVersionFailsOnCreate`; `updateKeepsAttachedArchived`; `updateReplacesOnlyGivenKind`; `listIssuesPassesVersionFilters`; `getProjectListsVersions`(+ 버전 API 실패 시 나머지 응답 유지); 시스템 프롬프트 단언.
- [ ] **Step 2: 실패 확인** — `cd packages/mcp-tools-shared && npx vitest run` FAIL.
- [ ] **Step 3: 구현** — 설명은 최소. 토큰 상한 테스트가 실패하면 상한을 올리지 말고 크기 수치를 들고 BLOCKED 로 보고.
- [ ] **Step 4: 통과 확인** — mcp-tools-shared·`apps/workplace-mcp`·`apps/workplace-ai-agent` `npx vitest run`, `pnpm typecheck` PASS.
- [ ] **Step 5: 커밋** — `feat(mcp): AI 가 수정 버전·영향 버전으로 이슈를 찾고 붙이며 프로젝트 버전 목록을 읽는다 (WP-888)`

### Task 7: 웹 — 버전 화면(목록·상세·대화상자)

**Files:**
- Create: `apps/workplace-web/src/{types/version.ts, api/versions.ts, hooks/queries/useVersions.ts, lib/versions.ts}`, `pages/projects/versions/{VersionsPage.tsx, VersionDetailPage.tsx, VersionFormDialog.tsx, VersionReleaseDialog.tsx, VersionDeleteDialog.tsx, VersionProgressBar.tsx, VersionStatusBadge.tsx}`, `lib/aiScreenContext/builders/version.ts`
- Modify: `App.tsx`(라우트 `projects/:key/versions`, `projects/:key/versions/:versionId`, lazy), `pages/projects/ProjectDetailPage.tsx`(머리 버튼·모바일 ⋯: 사이클 · 버전 · 타임라인 · 설정, 개인 프로젝트 제외), `lib/resourceInvalidation.ts`·`lib/resource-contract.json`(버전 변경 이벤트 — API 쪽 publish 는 Task 2 서비스에 이 태스크에서 더한다)
- Test: `lib/versions.test.ts`, `pages/projects/versions/VersionsPage.test.tsx`

**Interfaces:**
- Produces: `lib/versions.ts` — `versionDueState(v, today): 'none'|'upcoming'|'overdue'`(미출시 + 출시일 < 오늘 → overdue), `daysLeftLabel(v, today): string|null`(「N일 남음」/「N일 지남」), `groupIssuesByType(issues, types): {type, issues}[]`(프로젝트 유형 순서, 빈 묶음 제외), `nextUnreleased(list, currentId): VersionResponse|null`(목록 순서상 다음 미출시, 보관 제외), `alsoInOtherVersions(issue, currentId): string[]`.
- 문구(그대로): 빈 상태 「출시 단위로 이슈를 모으고 진행을 봐요. 버전을 만들면 이슈에 수정 버전·영향 버전 칸이 생겨요.」; 탭 「이 버전에 나가는 것 {n}」/「이 버전에서 난 결함 {n}」; 「영향 버전으로 붙은 결함 {n}건」; 「{이름} 에도 포함」; 출시 대화상자 「아직 끝나지 않은 이슈 {n}건이 있어요.」 「다음 버전으로 옮기기」 「그대로 두기」; 접기 「보관한 버전 {n}개 보기」; 「이슈 목록에서 열기」; 상태 배지 「미출시」「출시됨」「보관됨」.

- [ ] **Step 1: 실패하는 테스트** — vitest `versionDueState`(미출시·어제 → overdue, 출시됨·어제 → none, 날짜 없음 → none); `daysLeftLabel`; `groupIssuesByType`(유형 순서, 빈 묶음 제외); `nextUnreleased`(보관·출시 건너뜀, 마지막이면 null); 컴포넌트 `VersionsPage.test.tsx`(OWNER/ADMIN 은 만들기·⋯ 메뉴, 멤버는 읽기 전용, 보관된 행만 삭제, 빈 상태 문구).
- [ ] **Step 2: 실패 확인** — `cd apps/workplace-web && npx vitest run src/lib/versions.test.ts src/pages/projects/versions` FAIL.
- [ ] **Step 3: 구현** — 스펙 6절. 상세 이슈 목록은 검색 API `fixVersion=<id>` / `affectsVersion=<id>` 를 커서로 끝까지 읽는다. 「이슈 목록에서 열기」는 프로젝트 목록 URL 에 필터 쿼리. 모바일 목록은 카드. 버전 상세는 AI 화면 컨텍스트 등록.
- [ ] **Step 4: 통과 확인** — `cd apps/workplace-web && npx vitest run && npx tsc -b --noEmit && npx eslint src` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 프로젝트 버전 화면에서 버전을 만들고 출시하며 나가는 이슈를 유형별로 본다 (WP-888)`

### Task 8: 웹 — 이슈 상세·필터·열·활동 기록·타임라인

**Files:**
- Create: `apps/workplace-web/src/components/versions/{VersionChip.tsx, VersionPickerPopover.tsx, IssueVersionsField.tsx}`, `lib/issueVersions.ts`
- Modify: `types/issue.ts`(`fixVersions`, `affectsVersions`, 이력 유형 2개), `pages/projects/components/IssuePropertyRail.tsx`(구성요소 아래 두 줄), `lib/issueFilters.ts`, `lib/issueFacetFilters.ts`, `pages/projects/hooks/useIssueFilterControls.tsx`, 모바일 필터 시트, `lib/issueListColumns.ts`, `pages/projects/components/issueListColumnDefs.tsx`, `IssueColumnPicker.tsx`, `issueHistoryLabels.ts`, `pages/projects/timeline/{timelineData.ts, timelineTypes.ts, TimelineGantt.tsx, TimelineGanttBody.tsx, TimelinePage.tsx, TimelineAgendaList.tsx}`, `lib/aiScreenContext/builders/issue.ts`
- Test: `lib/issueVersions.test.ts`, `lib/issueFilters.test.ts`, `issueHistoryLabels.test.ts`, `pages/projects/timeline/timelineData.test.ts`, `components/versions/IssueVersionsField.test.tsx`

**Interfaces:**
- Consumes: Task 7 `useVersions`, `types/version.ts`.
- Produces: `lib/issueVersions.ts` — `hasActiveVersions(list): boolean`, `showVersionField(list, attached: VersionSummary[]): 'edit'|'readonly'|'hidden'`. `IssueFilters.fixVersionIds`, `fixVersionNone`, `affectsVersionIds`, `affectsVersionNone`, URL `fixVersion`/`affectsVersion`. `timelineData.versionsToMarkers(list): TimelineVersionMarker[]`(출시일 있는 미출시·출시됨만).
- 문구: 상세 행 「수정 버전」「영향 버전」; 필터 특수 항목 「수정 버전 없음」「영향 버전 없음」; 보관 묶음 「보관됨」; 활동 기록 「수정 버전 {추가/제거}」「영향 버전 {추가/제거}」(구성요소 `formatAddedRemoved` 재사용); 타임라인 레인 「버전」; 모바일 일정 칩 「버전 {n}」.

- [ ] **Step 1: 실패하는 테스트** — vitest `versionsHidden`(보관 안 된 0개 → hidden, 보관 값 붙음 → readonly); `issueFilters` 왕복(두 키·`none`·모두 지우기); 이력 문구; `versionsToMarkers`(날짜 없음·보관 제외); `IssueVersionsField.test.tsx`(멤버는 ＋ 피커, 비멤버는 칩만, 칩 클릭 링크가 버전 상세 경로).
- [ ] **Step 2: 실패 확인** — `cd apps/workplace-web && npx vitest run <위 파일>` FAIL.
- [ ] **Step 3: 구현** — 칩·피커는 구성요소 `ComponentChip`/`ComponentPickerPopover` 를 일반화하거나 따른다(빌더 판단). 피커는 미출시 먼저, 보관 제외. 열 `fixVersions`·`affectsVersions`(기본 꺼짐) 칩 2개+「+N」. 타임라인은 마일스톤 레인 아래 별도 「버전」 레인: ▲ 아이콘 칩 + 세로 점선(마일스톤과 다른 토큰 색), 빈 곳 클릭 없음, 칩 클릭 → 버전 상세, 겹침 배치는 마일스톤 배치 로직 재사용, 표시할 버전이 없으면 레인 없음. 보드 카드·모바일 행은 바꾸지 않는다.
- [ ] **Step 4: 통과 확인** — `cd apps/workplace-web && npx vitest run && npx tsc -b --noEmit && npx eslint src` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 이슈에 수정 버전·영향 버전을 붙이고 거르며, 타임라인에 버전 출시일을 그린다 (WP-888)`

### Task 9: 웹 E2E

**Files:**
- Create: `apps/workplace-web/e2e/pages/issue-versions.spec.ts`, `e2e/factories/version.factory.ts`
- Modify: `e2e/fixtures/auth.fixture.ts`(프로젝트 하위 목록 정규식에 `versions` — 빈 목록), 응답 필드 추가로 깨지는 기존 모킹

- [ ] **Step 1: 테스트 작성** — `page.route` 모킹으로, 데이터 로드 앵커를 먼저 기다린 뒤 부재를 단언한다(지난 웨이브 교훈):
  - `버전 화면에서 버전을 만들면 POST 본문이 이름·설명·날짜를 담는다` (@smoke)
  - `버전 상세는 나가는 이슈를 유형별로 묶고 영향 버전 탭을 따로 보인다`
  - `출시 대화상자에서 다음 버전으로 옮기기를 고르면 release 요청에 moveUnresolvedTo 가 실린다`
  - `상세 피커로 수정 버전을 붙이면 PUT 본문이 fixVersionIds 만 담고 칩이 보인다`
  - `수정 버전 필터를 고르면 목록 요청에 fixVersion 이 실리고 URL 에 남는다`(+ 「수정 버전 없음」 → `fixVersion=none`)
  - `타임라인 버전 레인의 칩을 누르면 버전 상세로 간다`
  - `버전이 없으면 칸·필터·레인이 보이지 않는다`(한 테스트에 페이지 로드 2개 이하 — 무거우면 둘로 나눈다)
  - `보관된 버전은 피커에 없고 필터의 보관됨 묶음에 있다`
  - `멤버는 버전 화면에서 만들기·⋯ 메뉴가 없다`
  - `버전 API 400 오류 메시지가 토스트로 보인다`
- [ ] **Step 2: 실행** — `cd apps/workplace-web && npx playwright test e2e/pages/issue-versions.spec.ts` PASS(연속 3회), `npx tsc -p tsconfig.e2e.json --noEmit` PASS.
- [ ] **Step 3: 관련 기존 스위트** — `npx playwright test e2e/pages/issue-components.spec.ts e2e/pages/projects/ e2e/pages/timeline*`(존재하는 경로 기준) PASS.
- [ ] **Step 4: 커밋** — `test(issue): 버전 화면 E2E 를 더한다 (WP-888)`

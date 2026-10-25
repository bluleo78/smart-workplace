# 구성요소(Components) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트별 구성요소 목록(이름·설명·담당자)을 두고, 이슈에 여러 개 붙여 걸러 보며, 담당자 없이 만든 새 이슈에 구성요소 담당자를 자동 지정하고, MCP·가져오기 API 가 구성요소를 다룬다.

**Architecture:** 새 테이블 2개(`project_component`, `issue_component`, 테넌트 RLS)와 새 패키지 `com.workplace.component`(목록 관리), issue 모듈에 이슈-구성요소 연결·자동 지정·필터·이력을 더한다. 라벨(`com.workplace.label`, `IssueLabelService`, `LABELS_CHANGED`)이 가장 가까운 선례이므로 같은 모양을 따른다. 웹은 이슈 레일 담당자 아래 행, 만들기 창 필드, 필터 facet, 선택 열, 카드 칩, 프로젝트 설정 섹션을 더한다. MCP 공유 도구 세 곳에 인자를 더한다.

**Tech Stack:** Spring Boot · jOOQ · Flyway(Postgres, Testcontainers) / React 19 · TanStack Query · shadcn/ui · Playwright / TypeScript MCP 공유 도구(vitest).

**Spec:** `docs/superpowers/specs/2026-10-25-wp933-issue-components-design.md` — 이 계획은 스펙을 따른다. 구현자는 둘 다 읽는다.

## Global Constraints

- 작업은 워크트리 `.claude/worktrees/wp882-wave4`(브랜치 `feat/WP-882-wave4`)에서만. 커밋은 로컬 `--no-verify`, 메시지는 docs/COMMIT_CONVENTION.md 한국어 형식 + 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `docs/superpowers/` 는 gitignore 대상이라 `git add -f`.
- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜). 백엔드 테스트는 `IntegrationTestBase` 통합 테스트, 웹은 Playwright E2E(순수 로직은 vitest, 화면 분기는 컴포넌트 테스트).
- 마이그레이션은 `V218__issue_components.sql` 하나. 새 테이블만 추가(롤링 배포 호환). 적용 후 `./gradlew generateJooq`.
- 테넌트 테이블 패턴은 `V89__calendar_event_attendee.sql` 그대로: `tenant_id BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint`, FK `fk_<t>_tenant`, 인덱스 `idx_<t>_tenant`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, 정책 `<t>_tenant_isolation USING (...) WITH CHECK (...)`.
- 값: 이름 1~40자(앞뒤 공백 제거, 프로젝트 안 대소문자 무시 유일), 설명 0~200자. 목록 순서 = `lower(name)` 오름차순, 같으면 id. 상한: 구성요소 100개/프로젝트.
- 관리(추가·편집·보관·복원·삭제) = `ProjectAccessGuard.assertWithRole(key, uid, "OWNER")`(테넌트 ADMIN 우회 포함, 이슈 유형 관리와 같은 규칙). 보기 = `assertReadable`. 이슈에 붙이기·떼기 = 라벨과 같은 워크플로 권한(`IssueLabelService.replace` 와 같은 가드). 이슈 만들 때 구성요소는 **구성원만**(라벨·담당자와 같은 member-only 검사, WP-477).
- 개인 프로젝트(`ProjectRow#isPersonal()`)는 구성요소 생성 400(`PERSONAL_PROJECT_UNSUPPORTED`).
- 담당자: 프로젝트 멤버 + 활성 + 사람(`kind=HUMAN`)만 지정 가능, 아니면 400 `COMPONENT_ASSIGNEE_INVALID`. 저장된 담당자가 나중에 무효가 되면 `defaultAssigneeValid=false`, 자동 지정에서 건너뜀.
- 자동 지정: 일반 생성 경로(`IssueService.create`, IMPORT 모드 제외)에서 요청 담당자가 비어 있고 구성요소가 있으면, 고른 구성요소를 목록 순서로 보아 처음으로 유효한 담당자를 가진 구성요소의 담당자 1명을 담당자로 넣는다. 일반 담당자 지정과 같은 이벤트·알림·워처·에이전트 작업 경로를 탄다. 이력 `ASSIGNEES_CHANGED` payload `{added:[UserSummary], removed:[], reason:"COMPONENT_DEFAULT", componentId, componentName}`.
- 이력 유형 `COMPONENTS_CHANGED` payload `{added:[{id,name}], removed:[{id,name}]}`, 차이 없으면 기록 안 함, 화면은 저장된(당시) 이름 표시.
- 보관된 구성요소: 새로 붙이기 400 `COMPONENT_ARCHIVED`(이미 붙어 있던 것 유지는 허용), 자동 지정 제외, 가져오기는 허용.
- 오류 응답은 라벨·관계 API 의 `errors.code` 관례(`CodedException`). 코드: `COMPONENT_NAME_TAKEN`, `COMPONENT_ARCHIVED`, `COMPONENT_ASSIGNEE_INVALID`, `COMPONENT_NOT_FOUND`, `COMPONENT_LIMIT`, `PERSONAL_PROJECT_UNSUPPORTED`. 가져오기: `IMPORT_UNKNOWN_COMPONENTS`(`errors.reason`).
- 필터 파라미터 `component` = id 또는 이름 CSV, **OR**(하나라도 붙음), 특수 토큰 `none` = 구성요소 없음(사이클 필터 `none` 관례). 묶어 보기(group-by)·group-counts 는 바꾸지 않는다.
- MCP: `DEFINITION_TOKEN_CAP` 16,700 → 실제 필요한 만큼(≤ 16,850), 날짜 주석 「2026-10-25 WP-933 구성요소 인자 — 사용자 승인」. `APP_TOOL_CAP` 18 그대로, 새 도구 없음. 플러그인 `plugins/genia-works/.claude-plugin/plugin.json` 0.1.11 → 0.1.12.
- 화면 문구에 내부 구분어(태스크 번호, 영어 코드)를 쓰지 않는다. 디자인 시스템 토큰만(`docs/design-system/`).
- 사용 중(보관 안 됨) 구성요소가 없는 프로젝트에서는 이슈 상세·만들기·필터·열 고르기에 구성요소가 보이지 않는다(보관된 값이 붙은 이슈 상세만 읽기 전용 표시).

## Review Focus

1. 담당자를 직접 고른 생성·가져오기 생성에서 자동 지정이 끼어들지 않는지(Task 3 `explicitAssigneeWins`, Task 4 `importDoesNotAutoAssign`).
2. 공개 프로젝트 비구성원이 `componentIds` 를 넘겨 자동 지정을 우회 경로로 쓰지 못하는지(Task 3 `nonMemberCreateWithComponentsRejected`).
3. 여러 구성요소 중 첫 구성요소 담당자가 비활성/비멤버/없음일 때 다음 구성요소 담당자로 넘어가는지(Task 3 `autoAssignSkipsInvalidAssignee`).
4. 이름 대소문자만 다른 중복(`compute` vs `Compute`)과 이름 앞뒤 공백이 막히는지(Task 2 `nameUniqueIgnoringCase`).
5. 구성요소가 없는 프로젝트에서 웹 화면이 바뀌지 않는지(Task 6 `componentsHidden` vitest, Task 7 E2E `구성요소가 없으면 칸·필터가 보이지 않는다`).

---

### Task 1: 스키마

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V218__issue_components.sql`
- Modify: `apps/workplace-api/src/main/java/com/workplace/platform/purge/TenantPurgePlan.java`
- Regenerate: `apps/workplace-api/src/main/generated/` (`./gradlew generateJooq`)
- Test: `apps/workplace-api/src/test/java/com/workplace/component/ComponentSchemaTest.java`

**Interfaces:**
- Produces: `project_component(id, tenant_id, project_id, name, description, default_assignee_id, archived_at, created_by, created_at, updated_at)` — FK project `ON DELETE CASCADE`, `default_assignee_id`·`created_by` → `"user"(id)` `ON DELETE SET NULL`, 유일 인덱스 `uq_project_component_name (project_id, lower(name))`, `CHECK (char_length(name) BETWEEN 1 AND 40)`, `description VARCHAR(200)`.
- Produces: `issue_component(issue_id, component_id, tenant_id, created_at)` — PK `(issue_id, component_id)`, 두 FK `ON DELETE CASCADE`, 인덱스 `idx_issue_component_component (component_id)`.

- [ ] **Step 1: 실패하는 테스트** — `ComponentSchemaTest`: `nameUniqueIgnoringCaseAtDb`(같은 프로젝트에 `Compute`·`compute` INSERT → `DataIntegrityViolationException`), `issueDeleteCascades`(이슈 행 삭제 시 `issue_component` 행 사라짐), `rlsIsolatesTenants`(테넌트 2 GUC 로 tenant#1 행 0개).
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*ComponentSchemaTest"` → 테이블 없음 FAIL.
- [ ] **Step 3: 구현** — V218 + `TenantPurgePlan` 에 `issue_component` → `project_component` 순서로 추가 + `generateJooq`.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*TenantPurge*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 구성요소 테이블을 더한다 (WP-933)`

### Task 2: 구성요소 목록 관리 API

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/component/{controller/ComponentController, service/ComponentService, repository/ComponentRepository, dto/ComponentResponse, dto/CreateComponentRequest, dto/UpdateComponentRequest, dto/ComponentSummary, exception/ComponentException}.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueHistoryRecorder.java`, `.../issue/dto/IssueHistoryEventType.java`, `.../global/exception/GlobalExceptionHandler.java`(필요 시)
- Test: `apps/workplace-api/src/test/java/com/workplace/component/ComponentManagementTest.java`

**Interfaces:**
- Produces: REST `/api/v1/projects/{key}/components` — `GET`(보관 포함 전체, 목록 순서) · `POST` · `PATCH /{id}`(`name?`, `description?`, `defaultAssigneeId?`, `clearDefaultAssignee?`, `archived?`) · `GET /{id}/issue-count` → `{count}` · `DELETE /{id}`.
- Produces: `record ComponentResponse(long id, String name, String description, UserSummary defaultAssignee, boolean defaultAssigneeValid, boolean archived, int issueCount)`; `record ComponentSummary(long id, String name, boolean archived)`.
- Produces: `ComponentRepository.listByProject(long projectId): List<ComponentRow>`(목록 순서), `findByIds(long projectId, Collection<Long> ids)`, `findByNamesIgnoreCase(long projectId, Collection<String> names)`, `summariesByIssueIds(Collection<Long> issueIds): Map<Long, List<ComponentSummary>>`(목록 순서) — Task 3·4 가 쓴다.
- Produces: `IssueHistoryEventType.COMPONENTS_CHANGED`, `IssueHistoryRecorder.recordComponentsChanged(Long actor, long issueId, List<ComponentSummary> added, List<ComponentSummary> removed)` 와 `at` 을 받는 오버로드(`recordLabelsChanged` 와 같은 모양, 빈 diff 생략).
- Produces: `ComponentService.isAssigneeValid(ProjectRow p, Long userId): boolean`(멤버·활성·HUMAN) — Task 3 자동 지정이 쓴다.

- [ ] **Step 1: 실패하는 테스트** — `ComponentManagementTest`:
  - `ownerCreatesAndListsInNameOrder`: OWNER 가 `Network`, `compute`, `Audit` 생성 → GET 순서 `Audit, compute, Network`.
  - `adminCanManageMemberCannot`: 테넌트 ADMIN(비멤버) 생성 201, 일반 멤버 403, 비멤버 GET 은 프로젝트를 읽을 수 있으면 200.
  - `nameUniqueIgnoringCase`: `Compute` 있는 데 `" compute "` 생성/이름 변경 → 400 `COMPONENT_NAME_TAKEN`; 41자 이름 400.
  - `personalProjectRejected`: 개인 프로젝트 POST → 400 `PERSONAL_PROJECT_UNSUPPORTED`.
  - `assigneeMustBeActiveHumanMember`: 비멤버·비활성·AI 사용자 지정 → 400 `COMPONENT_ASSIGNEE_INVALID`; 멤버 지정 200 후 그 멤버를 프로젝트에서 빼면 GET 의 `defaultAssigneeValid=false`.
  - `archiveAndRestore`: PATCH `archived:true` → `archived=true`, 다시 false → 복원.
  - `deleteRemovesFromIssuesWithHistory`: 이슈 2건에 붙인 뒤 삭제 → `issue_component` 0행, 두 이슈에 `COMPONENTS_CHANGED` 제거 기록 각 1건, `issue-count` 는 삭제 전 2.
  - `limit100`: 101번째 생성 400 `COMPONENT_LIMIT`.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*ComponentManagementTest"` FAIL.
- [ ] **Step 3: 구현** — 라벨 `LabelController`/`LabelService`/`LabelRepository` 모양을 따른다. 삭제·이름 변경은 대상 행 `FOR UPDATE`.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 프로젝트 구성요소를 관리하는 API 를 더한다 (WP-933)`

### Task 3: 이슈에 구성요소 — 붙이기·응답·자동 지정·필터

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/{controller/IssueComponentController, service/IssueComponentService, repository/IssueComponentRepository, dto/ReplaceComponentsRequest}.java`
- Modify: `.../issue/dto/IssueResponse.java`(`components`), `.../issue/dto/CreateIssueRequest.java`(`componentIds`), `.../issue/service/IssueService.java`(`planCreate`·`linkLabelsAndCycles` 근처·`finishCreate`), `.../issue/service/IssueSearchService.java`, `.../issue/service/IssueFilterResolver.java`, `.../issue/repository/IssueSearchQuery.java`, `.../issue/repository/IssueRepository.java`, `IssueResponse` 를 조립하는 상세·목록 경로
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueComponentTest.java`, `IssueComponentAutoAssignTest.java`, `IssueComponentFilterTest.java`

**Interfaces:**
- Consumes: Task 2 `ComponentRepository`, `ComponentSummary`, `recordComponentsChanged`, `ComponentService.isAssigneeValid`.
- Produces: `PUT /api/v1/projects/{key}/issues/{number}/components` body `{componentIds: long[]}` → 갱신된 `List<ComponentSummary>`.
- Produces: `IssueResponse.components: List<ComponentSummary>`(목록 순서, null 아님). `CreateIssueRequest.componentIds: List<Long>`(null 허용).
- Produces: `IssueSearchQuery.componentIds: List<Long>` + `boolean componentNone`; 쿼리 파라미터 `component`.

- [ ] **Step 1: 실패하는 테스트**
  - `IssueComponentTest`: `replaceRecordsDiff`(빈 → [A,B] → [B] 순으로 PUT, 이력 `COMPONENTS_CHANGED` 2건, payload added/removed id·name 일치, 같은 집합 재전송은 기록 없음); `archivedCannotBeAddedButKept`(A 붙인 뒤 A 보관, [A] 재전송 200, 보관된 C 새로 추가 400 `COMPONENT_ARCHIVED`); `otherProjectComponentRejected`(다른 프로젝트 id 400 `COMPONENT_NOT_FOUND`); `nonMemberCannotReplace`(403); `detailAndListIncludeComponents`(상세·목록 응답 `components` 이름 순서).
  - `IssueComponentAutoAssignTest`: `autoAssignsFirstComponentAssignee`([Network(woody), Compute(soon)] 로 담당자 없이 생성 → 담당자 soon(이름순 Compute 먼저), `IssueAssignedEvent` 발행, soon 이 워처, 이력 `ASSIGNEES_CHANGED` 1건 payload `reason=COMPONENT_DEFAULT`, `componentName=Compute`); `explicitAssigneeWins`(담당자 지정 + 구성요소 → 지정한 담당자만, 자동 지정 이력 없음); `autoAssignSkipsInvalidAssignee`(Compute 담당자를 비멤버로 만든 뒤 → Network 담당자); `noAssigneeNoChange`(담당자 없는 구성요소만 → 담당자 없음, 이력 없음); `archivedComponentRejectedOnCreate`(보관 id 로 생성 400); `nonMemberCreateWithComponentsRejected`(OPEN 프로젝트 비구성원이 `componentIds` 넣어 생성 → 라벨과 같은 member-only 오류, 구성요소 없이 생성은 201·담당자 없음); `updateDoesNotReassign`(생성 후 PUT 으로 Compute 붙여도 담당자 그대로).
  - `IssueComponentFilterTest`: `filterOrById`(A·B·없음 이슈, `component=A,B` → 두 건); `filterByNameIgnoringCase`(`component=compute`); `filterNone`(`component=none` → 구성요소 없는 이슈만); `filterIncludesArchived`(보관된 A 로 거르기 가능); `savedViewQueryRoundTrip`(`component=…` 를 담은 저장된 뷰 생성·조회 시 query 문자열 보존).
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueComponent*"` FAIL.
- [ ] **Step 3: 구현** — 붙이기는 `IssueLabelService.replace` 모양. 생성 검증은 `planCreate` 의 라벨 검사 옆(member-only 목록에 구성요소 추가), 연결은 `linkLabelsAndCycles` 옆, 자동 지정은 담당자 집합을 확정하는 곳(이벤트 발행 전)에서 결정해 기존 담당자 경로를 그대로 탄다. IMPORT 모드면 건너뛴다. 필터는 `labelGroupsCondition` 옆에 `EXISTS issue_component … component_id IN (…)` / `NOT EXISTS`. 목록 응답은 이슈 id 묶음으로 한 번에 조회(`summariesByIssueIds`) — N+1 금지.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*IssueSearch*" --tests "*IssueCreate*" --tests "*IssueLabel*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 이슈에 구성요소를 붙이고, 담당자 없이 만든 이슈에 구성요소 담당자를 붙이며, 구성요소로 거른다 (WP-933)`

### Task 4: 가져오기 API — 구성요소·변경 이력

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/issue/dto/ImportIssueRequest.java`(`componentNames`, `HistoryEntry` 는 기존 `added`/`removed` 재사용), `.../issue/service/IssueImportService.java`(`prepareHistory`, 연결), `.../issue/exception/IssueImportException.java`(`unknownComponents(List<String>)` → reason `IMPORT_UNKNOWN_COMPONENTS`)
- Modify: `docs/integrations/issue-import-api.md` — 요청 필드·`history[]` 유형 표·오류 표·준비 순서(「구성요소를 먼저 일반 API 로 만든다」)·CLIM 이관 주의
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueImportComponentsTest.java`

**Interfaces:**
- Consumes: Task 2 `ComponentRepository.findByNamesIgnoreCase`, `recordComponentsChanged(..., at)`; Task 3 연결 저장소.
- Produces: `ImportIssueRequest.componentNames: List<String>`(null 허용), history 유형 `COMPONENTS_CHANGED`(added/removed = 이름).

- [ ] **Step 1: 실패하는 테스트** — `importsComponentsByNameIgnoringCase`(`["compute","Network"]` → 두 개 연결, 응답·상세 이름 일치); `archivedAllowed`(보관된 이름 연결 성공); `unknownNameRejectedBeforeWrite`(`["Nope"]` → 400 `IMPORT_UNKNOWN_COMPONENTS`, 이슈 0건 생성); `historyImported`(`COMPONENTS_CHANGED` added `["Compute"]` at 원시각 → 이력 1건, 시각·작성자 원본 그대로); `historyUnknownNameRejected`(400, 쓰기 없음); `importDoesNotAutoAssign`(담당자 없이 담당자 있는 구성요소로 가져오기 → 담당자 없음, `ASSIGNEES_CHANGED` 없음, 알림 없음).
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueImportComponentsTest"` FAIL.
- [ ] **Step 3: 구현** — 검증은 기존 「쓰기 전 모두 검증」 단계(`loadLookups`·`prepareHistory`)에 넣는다. 문서 갱신.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*IssueImport*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 가져오기 API 가 구성요소와 그 변경 이력을 옮긴다 (WP-933)`

### Task 5: MCP·AI 비서·플러그인

**Files:**
- Modify: `packages/mcp-tools-shared/src/{schemas.ts, issue-tools.ts, project-tools.ts, resolve.ts, issue-view.ts, issue-detail.ts}` 와 `SharedToolClient` 구현(웹 MCP 앱 `apps/workplace-mcp`·ai-agent 쪽 클라이언트 중 해당하는 곳), `packages/mcp-tools-shared/src/tool-naming.test.ts`, 스냅샷 `__snapshots__/shared-tools.test.ts.snap`
- Modify: `apps/workplace-ai-agent/src/agent/assistant-system-prompt.ts`(+ 테스트), `plugins/genia-works/.claude-plugin/plugin.json`
- Test: `packages/mcp-tools-shared/src/*.test.ts` 해당 파일

**Interfaces:**
- Consumes: API `GET /projects/{key}/components`, `CreateIssueRequest.componentIds`, `PUT …/components`, 필터 `component`, `IssueResponse.components`.
- Produces: `SharedToolClient.getProjectComponents(projectKey): Promise<{id,name,archived,defaultAssignee?:{username}|null}[]>`; `resolveComponentNames(names: string[], existing): {ids:number[], unknown:string[]}`(대소문자 무시, 보관된 것은 `unknown` 이 아니라 별도 `archived` 로 실패).
- 도구 인자: `list_issues.component` (string, 「Component names CSV; any matches; "none" = no component」), `create_issue.components`/`update_issue.components` (string[], update 는 교체). `get_project` 응답 `components: [{name, assignee, archived}]`. 상세·목록 보기에 `components: string[]`.

- [ ] **Step 1: 실패하는 테스트** — `createIssueResolvesComponentNames`(이름 → `componentIds` 전송); `unknownComponentFailsBeforeWrite`(없는 이름 → 오류, 생성 호출 없음); `archivedComponentFails`; `updateReplacesComponents`(PUT 호출); `listIssuesPassesComponent`(쿼리에 `component=…`); `getProjectListsComponents`; 토큰 상한 테스트가 새 상한으로 통과, 앱별 도구 수 변화 없음; 시스템 프롬프트 테스트에 `component` 안내 단언.
- [ ] **Step 2: 실패 확인** — `pnpm --filter @workplace/mcp-tools-shared test`(패키지 이름은 package.json 확인) FAIL.
- [ ] **Step 3: 구현** — 설명은 짧게. 상한은 실제 크기 + 소량 여유로만 올리고 날짜 주석. 플러그인 0.1.12.
- [ ] **Step 4: 통과 확인** — mcp-tools-shared·workplace-mcp·workplace-ai-agent 테스트와 typecheck PASS, 스냅샷 갱신 확인.
- [ ] **Step 5: 커밋** — `feat(mcp): AI 가 구성요소로 이슈를 찾고 붙이며 프로젝트 구성요소 목록을 읽는다 (WP-933)`

### Task 6: 웹 화면

**Files:**
- Create: `apps/workplace-web/src/{types/component.ts, api/components.ts, hooks/queries/useComponents.ts, components/components/ComponentChip.tsx, components/components/ComponentPickerPopover.tsx, lib/issueComponents.ts}`, `pages/projects/components/ComponentManagement.tsx`(+ 편집 대화창)
- Modify: `types/issue.ts`(`components`, `'COMPONENTS_CHANGED'`), `pages/projects/components/IssuePropertyRail.tsx`(담당자 아래 행), `IssueCreateDialog.tsx`, `mobile/MobileIssueCreateSheet.tsx`·`CreateIssueChips.tsx`·`issuePropSheets.tsx`, `pages/projects/hooks/useIssueFilterControls.tsx`, `lib/issueFilters.ts`, `lib/issueFacetFilters.ts`, `lib/issueListColumns.ts`, `pages/projects/components/issueListColumnDefs.tsx`, `IssueCard.tsx`, `IssueMobileMeta.tsx`, `IssueActivityTimeline.tsx`·`issueHistoryLabels.ts`, `pages/projects/ProjectSettingsPage.tsx`(라벨 아래), `lib/aiScreenContext/builders/issue.ts`(구성요소 이름)
- Test: `lib/issueComponents.test.ts`, `lib/issueFilters.test.ts`, `pages/projects/components/ComponentManagement.test.tsx`, `IssueActivityTimeline`/`issueHistoryLabels.test.ts`

**Interfaces:**
- Consumes: Task 2·3 API 와 응답 모양.
- Produces: `lib/issueComponents.ts` — `hasActiveComponents(list: ComponentResponse[]): boolean`, `showComponentField(list, issueComponents: ComponentSummary[]): 'edit'|'readonly'|'hidden'`, `autoAssignHint(selectedIds: number[], list: ComponentResponse[], hasAssignee: boolean): { componentName: string; assigneeName: string } | null`(이름순 첫 유효 담당자). `IssueFilters.componentIds: number[]`, `componentNone: boolean`, URL `component`.
- 문구(그대로): 만들기 안내 「만들면 {구성요소} 담당 {이름} 님이 맡아요」; 설정 빈 상태 「영역별로 이슈를 나누고 영역 담당자를 자동으로 붙여요. 구성요소를 추가하면 이슈에 칸이 생겨요.」; 활동 기록 자동 지정 「구성요소 {이름} 담당자로 자동 지정」; 담당자 경고 「프로젝트 구성원이 아니에요 — 자동 지정을 건너뛰어요」; 필터 특수 항목 「구성요소 없음」; 보관 묶음 「보관됨」; 설정 접기 「보관한 구성요소 {n}개 보기」.

- [ ] **Step 1: 실패하는 테스트** — vitest `componentsHidden`(사용 중 0개 → 상세 `hidden`, 보관 값이 붙은 이슈 → `readonly`); `autoAssignHint`(이름순 첫 유효 담당자, `hasAssignee=true` → null, 유효 담당자 없음 → null); `issueFilters` 왕복(`component=3,5` ↔ ids, `none`, 모두 지우기 시 초기화); 활동 기록 문구(추가·제거·자동 지정); `ComponentManagement.test.tsx`(OWNER/ADMIN 은 추가·편집·보관 버튼, 멤버는 읽기 전용, 빈 상태 문구).
- [ ] **Step 2: 실패 확인** — `pnpm --filter workplace-web test` FAIL.
- [ ] **Step 3: 구현** — 스펙 6절. 상세 행은 담당자 바로 아래(첫 묶음), 피커는 다중 선택·검색·보관 제외. 데스크톱 만들기 창은 구성원에게만 필드, 모바일은 담당자 고르면 안내 숨김. 필터 facet 은 사용 중 구성요소가 있을 때만, 보관된 것은 「보관됨」 묶음. 목록 열 `components`(기본 꺼짐) 칩 2개+「+N」. 카드·모바일 행은 라벨 앞 칩(최대 2개+「+N」). 설정 섹션은 개인 프로젝트에서 그리지 않음. 삭제는 기존 `DeleteConfirmDialog`·`DeleteImpactNote` 로 영향 이슈 수(`issue-count`)를 보여 준다.
- [ ] **Step 4: 통과 확인** — `pnpm --filter workplace-web test && pnpm --filter workplace-web typecheck && pnpm --filter workplace-web lint` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 화면에서 구성요소를 관리하고, 이슈에 붙이고, 구성요소로 거른다 (WP-933)`

### Task 7: 웹 E2E

**Files:**
- Create: `apps/workplace-web/e2e/pages/issue-components.spec.ts`, 필요한 팩토리(`e2e/factories/`)
- Modify: 구성요소 응답 필드 추가로 깨지는 기존 모킹(타입 오류가 가리키는 곳)

- [ ] **Step 1: 테스트 작성** — `page.route` 모킹으로:
  - `설정에서 구성요소를 추가하면 POST 본문이 이름·설명·담당자를 담는다` (@smoke)
  - `상세 담당자 아래 피커로 붙이면 PUT 본문이 componentIds 를 담고 칩이 보인다`
  - `만들기 창에서 구성요소를 고르면 자동 지정 안내가 보이고 POST 에 componentIds 가 실린다`
  - `구성요소 필터를 고르면 목록 요청에 component 파라미터가 실리고 URL 에 남는다` (+ 「구성요소 없음」 → `component=none`)
  - `구성요소가 없으면 칸·필터가 보이지 않는다`
  - `목록 열 고르기에서 구성요소 열을 켜면 칩이 보인다`
  - `보관된 구성요소는 피커에 없고 필터의 보관됨 묶음에 있다`
  - `구성원이 아니면 만들기 창에 구성요소 칸이 없다`
  - `구성요소 API 400 오류 메시지가 토스트로 보인다`
- [ ] **Step 2: 실행** — `cd apps/workplace-web && npx playwright test e2e/pages/issue-components.spec.ts` PASS, `npx tsc -p tsconfig.e2e.json --noEmit` PASS.
- [ ] **Step 3: 관련 기존 스위트** — `npx playwright test e2e/pages/issue-detail* e2e/pages/issue-list* e2e/pages/project-settings*`(존재하는 파일 기준) PASS.
- [ ] **Step 4: 커밋** — `test(issue): 구성요소 화면 E2E 를 더한다 (WP-933)`

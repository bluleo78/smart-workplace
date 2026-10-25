# 이슈 관계 유형 · 외부 링크 · 앱별 설정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이슈 사이에 차단 말고도 관련·중복·복제·원인·사용자 정의 관계(다른 프로젝트 포함)와 외부 링크를 걸고, 워크스페이스 관리자가 관계 유형을 「설정 › 앱 설정 › 작업 관리」에서 관리하며, 관리자 가져오기로 Jira 관계를 알림 없이 옮긴다.

**Architecture:** 새 테이블 3개(`issue_relation_type`·`issue_relation`·`issue_external_link`, 테넌트 RLS)와 issue 모듈의 서비스·컨트롤러를 더한다. 차단은 기존 `issue_dependency`·의존성 API 그대로이고 유형 목록에만 `BLOCKS` 행으로 보인다. 웹은 이슈 레일 「의존성」 그룹을 「관계」로 바꾸고 설정 사이드바에 「앱 설정」 그룹을 둔다. MCP 공유 도구에 관계 도구를 더한다.

**Tech Stack:** Spring Boot · jOOQ · Flyway(Postgres, Testcontainers) / React 19 · TanStack Query · shadcn/ui · Playwright / TypeScript MCP 공유 도구(vitest).

**Spec:** `docs/superpowers/specs/2026-10-24-wp887-issue-relations-design.md` — 이 계획은 스펙을 따른다. 구현자는 둘 다 읽는다.

## Global Constraints

- 작업은 워크트리 `.claude/worktrees/wp882-wave3`(브랜치 `feat/WP-882-wave3`)에서만. 커밋은 로컬 `--no-verify`, 메시지는 docs/COMMIT_CONVENTION.md 한국어 형식 + 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_01QoCRVZp7KHyhyfAPdEQtGx`.
- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜). 백엔드 테스트는 `IntegrationTestBase` 통합 테스트, 웹은 Playwright E2E(순수 로직은 vitest).
- 마이그레이션은 `V214__issue_relations.sql` 하나. 새 테이블만 추가(롤링 배포 호환). 적용 후 `./gradlew generateJooq`.
- 테넌트 테이블 패턴은 `V89__calendar_event_attendee.sql` 그대로: `tenant_id BIGINT NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::bigint`, FK `fk_<t>_tenant`, 인덱스 `idx_<t>_tenant`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, 정책 `<t>_tenant_isolation USING (...) WITH CHECK (...)`.
- 기본 유형(코드·이름·A 쪽 말·B 쪽 말·방향·외부 전용·정렬): `BLOCKS` 차단·「차단 중」·「차단됨」·방향·×·10 / `RELATES` 관련·「관련」·NULL·방향 없음·×·20 / `DUPLICATES` 중복·「중복임」·「원본임」·방향·×·30 / `CLONES` 복제·「복제본임」·「복제 원본임」·방향·×·40 / `CAUSES` 원인·「원인임」·「결과임」·방향·×·50 / `PARENT_EPIC` 상위 에픽·「에픽에 속함」·NULL·방향 있음(외부에서 이 이슈가 A)·외부 전용·60. 사용자 정의 유형의 `sort_order` 는 1000.
- 새 권한 코드 `issue_relation_type:manage`(이름 「이슈 관계 유형 관리」, 리소스 `issue`).
- 상한: 사용자 정의 유형 50/워크스페이스, 외부 링크 50/이슈, 관계 가져오기 1000/요청, `lookup` 결과 20. 이름·말 1~30자, 외부 키 1~50자, 제목 1~300자, URL ≤2000자 `http`/`https` 만.
- 알림(인박스·푸시)을 내는 도메인 이벤트를 새로 만들지 않는다. 실시간 갱신은 `IssueChangeNotifier.updatedWithoutTouch` 만.
- 차단(의존성) 저장·API·블로커 계산·차단 필터·타임라인 화살표·AI 블로커 배지 코드는 바꾸지 않는다.
- 기존 E2E 테스트 id `blocked-by-list`, `blocks-list`, `issue-link-row-*`, `issue-link-remove-*` 는 유지.
- 화면 문구에 내부 구분어(「v2」, 태스크 번호, 영어 코드)를 쓰지 않는다.

## Review Focus

1. 상대 프로젝트를 읽을 수 없는 사람에게 관계가 새는 곳 — 상세 `relations`, 레일 개수, 이력의 상대 키·제목, MCP 상세. 모두 가려져야 한다(Task 3 테스트 `relationHiddenFromNonReader`, `historyRedactsUnreadableOther`).
2. 방향 있는 유형을 B 쪽에서 추가(`side=target`)했을 때 저장 방향과 양쪽 표시 말이 맞는지(Task 3 `addFromTargetSideStoresReversed`).
3. 사용 중인 방향 있는 사용자 유형을 방향 없는 유형으로 옮길 때 같은 쌍이 A→B·B→A 로 둘 다 있으면 하나로 합쳐지는지(Task 2 `deleteMoveToSymmetricDedupes`).
4. Jira 처럼 같은 링크가 양쪽에서 두 번 들어오는 가져오기 재시도·중복 줄이 오류 없이 멱등인지(Task 5 `importRelationsIdempotentAndDuplicateRows`).
5. `javascript:`·`data:`·공백 섞인 URL 이 외부 링크로 저장되지 않는지(Task 4 `rejectsNonHttpSchemes`).

---

### Task 1: 스키마·테넌트 시드·권한

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V214__issue_relations.sql`
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/domain/IssueRelationBuiltIns.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/platform/service/TenantProvisioningService.java`, `.../platform/repository/PlatformTenantRepository.java`, `.../platform/purge/TenantPurgePlan.java`, `.../role/dto/AdminPermissionCodes.java`
- Regenerate: `apps/workplace-api/src/main/generated/` (`./gradlew generateJooq`)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueRelationSchemaTest.java`, 기존 `NewTenantProvisioningTest` 확장

**Interfaces:**
- Produces: 테이블 `issue_relation_type(id, tenant_id, code, name, directed, outward_label, inward_label, external_only, hidden, sort_order, created_by, created_at, updated_at)`(유일 `(tenant_id, code)` WHERE code NOT NULL, 유일 `(tenant_id, lower(name))`), `issue_relation(id, tenant_id, type_id, source_issue_id, target_issue_id, created_by, created_at)`(유일 `(type_id, source_issue_id, target_issue_id)`, CHECK `source_issue_id <> target_issue_id`, 이슈 FK `ON DELETE CASCADE`, 인덱스 `(source_issue_id)`, `(target_issue_id)`), `issue_external_link(id, tenant_id, issue_id, type_id, issue_is_source, url, ext_key, title, created_by, created_at, updated_at)`(유일 `(issue_id, url)`). `type_id` FK 는 `ON DELETE RESTRICT`. `created_by` 는 `"user"(id)` FK `ON DELETE SET NULL`(NULL 허용).
- Produces: `IssueRelationBuiltIns` — `record BuiltIn(String code, String name, boolean directed, String outwardLabel, String inwardLabel, boolean externalOnly, int sortOrder)`, `static final List<BuiltIn> ALL`(Global Constraints 표 순서), 상수 `BLOCKS`, `RELATES`, `DUPLICATES`, `CLONES`, `CAUSES`, `PARENT_EPIC`(코드 문자열), `CUSTOM_SORT_ORDER = 1000`.
- Produces: `PlatformTenantRepository.insertBuiltInRelationTypes()` — 현재 GUC 테넌트에 `ALL` 을 INSERT(`TenantProvisioningService.seedDefaultRoles` 의 try 블록 안에서 호출).

- [ ] **Step 1: 실패하는 테스트** — `IssueRelationSchemaTest`:
  - `builtInsSeededForExistingTenant`: tenant#1 의 `issue_relation_type` 에서 code 가 있는 행 6개, 각 행 값이 `IssueRelationBuiltIns.ALL` 과 같다.
  - `adminRoleHasManagePermission`: tenant#1 ADMIN 역할이 `issue_relation_type:manage` 를 가진다, USER·AGENT 는 없다.
  - `relationRejectsSelfLink`: 같은 이슈 id 로 `issue_relation` INSERT → `DataIntegrityViolationException`.
  - `rlsIsolatesTenants`: 테넌트 2 GUC 로 tenant#1 유형이 0행.
  - `NewTenantProvisioningTest` 에 새 테넌트의 기본 유형 집합 = tenant#1 집합(code·이름·말·방향·외부 전용·정렬) 단언 추가.
- [ ] **Step 2: 실행해 실패 확인** — `./gradlew test --tests "*IssueRelationSchemaTest" --tests "*NewTenantProvisioningTest"` → 테이블 없음으로 FAIL.
- [ ] **Step 3: 구현** — V214: 세 테이블 + RLS + 기존 모든 테넌트에 기본 6행(`INSERT … SELECT FROM tenant`) + `permission` 에 코드 추가하고 모든 테넌트의 시스템 ADMIN 역할(`r.name='ADMIN' AND r.is_system`)에 부여(V138 패턴). `AdminPermissionCodes.CODES` 에 코드 추가(`RoleKindAssignmentTest` 통과). `TenantPurgePlan` 에 세 테이블을 FK 순서(관계·외부 링크 → 유형)로. `generateJooq`.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "*RoleKindAssignmentTest" --tests "*TenantPurge*"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 이슈 관계 유형·관계·외부 링크 테이블과 기본 유형·권한을 더한다 (WP-887)`

### Task 2: 관계 유형 조회·관리 API

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/repository/IssueRelationTypeRepository.java`, `.../issue/service/IssueRelationTypeService.java`, `.../issue/controller/IssueRelationTypeController.java`, `.../issue/controller/IssueRelationTypeAdminController.java`, `.../issue/dto/IssueRelationTypeResponse.java`, `.../issue/dto/IssueRelationTypeAdminResponse.java`, `.../issue/dto/SaveIssueRelationTypeRequest.java`, `.../issue/exception/IssueRelationException.java`(`CodedException`, `GlobalExceptionHandler.handleCoded` 목록에 추가)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueRelationTypeApiTest.java`

**Interfaces:**
- Consumes: Task 1 테이블·`IssueRelationBuiltIns`.
- Produces:
  - `IssueRelationTypeResponse(long id, String code, String name, boolean directed, String outwardLabel, String inwardLabel, boolean externalOnly, boolean hidden, int sortOrder)`; `IssueRelationTypeAdminResponse`(위 필드 + `long relationCount, long externalLinkCount`). `BLOCKS` 의 `relationCount` 는 `issue_dependency` 건수.
  - `SaveIssueRelationTypeRequest(@NotBlank @Size(max=30) String name, boolean directed, @NotBlank @Size(max=30) String outwardLabel, @Size(max=30) String inwardLabel)` — directed 면 inwardLabel 필수, 아니면 무시(NULL 저장).
  - `IssueRelationTypeService`: `List<IssueRelationTypeResponse> list()`(정렬 `sort_order, id`), `List<IssueRelationTypeAdminResponse> listForAdmin()`, `IssueRelationTypeResponse create(long callerId, SaveIssueRelationTypeRequest)`, `update(long callerId, long id, SaveIssueRelationTypeRequest)`, `setHidden(long callerId, long id, boolean hidden)`, `void delete(long callerId, long id, Long moveTo, boolean deleteLinks)`, 그리고 다른 태스크용 `IssueRelationTypeRow require(long id)`·`Optional<IssueRelationTypeRow> resolveByCodeOrName(String codeOrName)`(코드 정확 일치 먼저, 그다음 이름 대소문자 무시).
  - `IssueRelationTypeRow(long id, String code, String name, boolean directed, String outwardLabel, String inwardLabel, boolean externalOnly, boolean hidden, int sortOrder)` — `labelFor(boolean isSource)` 는 방향 없으면 outward, 있으면 isSource ? outward : inward.
  - 엔드포인트: `GET /api/v1/issue-relation-types`(로그인 사용자 — 권한 코드 없이 인증만), `GET|POST /api/v1/admin/issue-relation-types`, `PUT /api/v1/admin/issue-relation-types/{id}`, `PUT /api/v1/admin/issue-relation-types/{id}/hidden` 본문 `{hidden}`, `DELETE /api/v1/admin/issue-relation-types/{id}?moveTo=&deleteLinks=`. 관리 컨트롤러는 클래스에 `@RequirePermission("issue_relation_type:manage")`.
  - 오류 코드(`IssueRelationException`): `RELATION_TYPE_NAME_TAKEN`(409), `RELATION_TYPE_LIMIT`(400, 사용자 정의 50 초과), `RELATION_TYPE_BUILT_IN`(400, 기본 유형 편집·삭제), `RELATION_TYPE_BLOCKS_LOCKED`(400, BLOCKS 숨김), `RELATION_TYPE_DIRECTION_LOCKED`(409, 사용 중 방향 변경), `RELATION_TYPE_IN_USE`(409, 사용 중인데 moveTo·deleteLinks 둘 다 없음), `RELATION_TYPE_BAD_MOVE_TARGET`(400, 대상이 자신·BLOCKS·외부 전용·숨김·없음), `RELATION_TYPE_NOT_FOUND`(404).

- [ ] **Step 1: 실패하는 테스트** — `IssueRelationTypeApiTest`(MockMvc, ADMIN·일반 사용자·AI 토큰):
  - `listReturnsBuiltInsInOrder`: 일반 사용자 GET → 코드 순 `BLOCKS, RELATES, DUPLICATES, CLONES, CAUSES, PARENT_EPIC`, `CAUSES` 의 말 「원인임」/「결과임」.
  - `adminCrudCustomType`: 「테스트」 방향 있음 「테스트함」/「테스트됨」 추가 → 목록 끝(sortOrder 1000), 이름 수정, 숨김 → 목록 `hidden=true`.
  - `nonAdminForbidden`: 일반 사용자·AI 의 관리 API 403.
  - `nameTakenIncludingBuiltIn`: 이름 「관련」·「테스트」 중복(대소문자 무시) 409 `RELATION_TYPE_NAME_TAKEN`.
  - `builtInImmutable`: 기본 유형 PUT·DELETE 400 `RELATION_TYPE_BUILT_IN`, `BLOCKS` 숨김 400 `RELATION_TYPE_BLOCKS_LOCKED`, `RELATES` 숨김은 200.
  - `limitFifty`: 사용자 정의 50개 뒤 51번째 400 `RELATION_TYPE_LIMIT`.
  - `directionLockedWhenUsed`: 관계 1건(직접 INSERT) 있는 유형의 `directed` 변경 409, 이름·말 변경 200.
  - `deleteUnusedType`: 204, 목록에서 사라짐.
  - `deleteInUseRequiresChoice`: 409 `RELATION_TYPE_IN_USE`.
  - `deleteMoveToSymmetricDedupes`: 방향 있는 사용자 유형에 (A→B), (B→A) 관계 2건 + 외부 링크 1건 → `moveTo=RELATES id` → `issue_relation` 에 RELATES (min,max) 1건, 외부 링크의 type 이 RELATES, 유형 삭제됨, 감사 로그 1건(`ISSUE_RELATION_TYPE_DELETED`, 메타에 moved=3).
  - `deleteMoveToDirectedKeepsOrder`: 방향 있는 → 다른 방향 있는 사용자 유형으로 A→B 유지.
  - `deleteWithLinks`: `deleteLinks=true` → 관계·외부 링크 0건.
  - `badMoveTarget`: moveTo 가 BLOCKS·PARENT_EPIC·숨긴 유형·자기 자신이면 400.
- [ ] **Step 2: 실행해 실패 확인** — `./gradlew test --tests "*IssueRelationTypeApiTest"` → 404/컴파일 FAIL.
- [ ] **Step 3: 구현** — 위 시그니처대로. 옮기기는 한 트랜잭션: 방향 없는 대상이면 `INSERT … SELECT LEAST(source,target), GREATEST(source,target) … ON CONFLICT DO NOTHING` 후 원래 행 삭제, 방향 있는 대상이면 순서 유지로 같은 방식. 외부 링크는 `UPDATE type_id`(방향 없는 대상이면 `issue_is_source=true`). 감사 로그는 `AuditLogService.log` 로 `ISSUE_RELATION_TYPE_CREATED|UPDATED|HIDDEN|DELETED`.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 관계 유형 목록과 관리자용 추가·편집·숨김·삭제 API 를 더한다 (WP-887)`

### Task 3: 이슈 관계 — 걸기·지우기·찾기·상세·이력

**Files:**
- Create: `.../issue/repository/IssueRelationRepository.java`, `.../issue/service/IssueRelationService.java`, `.../issue/controller/IssueRelationController.java`, `.../issue/controller/IssueLookupController.java`, `.../issue/dto/IssueRelationView.java`, `.../issue/dto/AddIssueRelationRequest.java`, `.../issue/dto/IssueLookupItem.java`
- Modify: `.../issue/dto/IssueDetailResponse.java`(필드 `relations`, `externalLinks` 추가 — `externalLinks` 는 Task 4 가 채우고 여기선 빈 목록), `.../issue/service/IssueService.java`(`get` 에서 관계 로드·이력 가림), `.../issue/service/IssueHistoryRecorder.java`, `.../issue/dto/IssueHistoryEventType.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueRelationApiTest.java`

**Interfaces:**
- Consumes: Task 2 `IssueRelationTypeService.require/labelFor`, `ProjectAccessGuard.assertMember/canRead`, `IssueChangeNotifier.updatedWithoutTouch(ProjectRow, int number, Long issueId, Long callerId)`.
- Produces:
  - `IssueRelationView(long id, long typeId, String typeCode, String label, RelatedIssue issue)`, `record RelatedIssue(String projectKey, int number, String title, String status, IssueTypeSummary type)`.
  - `AddIssueRelationRequest(@NotNull Long typeId, String side /* "source"(기본)|"target" */, @NotNull @Valid Target target)`, `record Target(String projectKey /* null=같은 프로젝트 */, @NotNull @Positive Integer number)`.
  - `POST /api/v1/projects/{key}/issues/{n}/relations` → 200 `List<IssueRelationView>`(이 이슈 기준 갱신 목록), `DELETE …/relations/{relationId}` → 204(없으면 204), `GET /api/v1/issues/lookup?q=` → `List<IssueLookupItem(String projectKey, int number, String title, String status, IssueTypeSummary type)>`.
  - `IssueRelationService.listFor(long callerId, IssueRow issue, ProjectRow project) : List<IssueRelationView>` — Task 4·6 와 상세가 쓴다.
  - 이력 종류 `RELATION_ADDED`, `RELATION_REMOVED`; `toValue` JSON `{"typeId":n,"label":"원인임","other":{"projectKey":"WP","number":12,"title":"…"}}`. 이력 가림 결과는 `other` 를 `{"hidden":true}` 로 바꾼 JSON.
  - 오류 코드: `RELATION_SELF`(400), `RELATION_TARGET_NOT_FOUND`(400 — 없음·삭제됨·읽기 불가 같은 메시지), `RELATION_TYPE_HIDDEN`(400), `RELATION_TYPE_BLOCKS`(400 — 의존성 API 안내), `RELATION_TYPE_EXTERNAL_ONLY`(400), `RELATION_CROSS_PROJECT_NOT_ALLOWED`(400 — 개인 프로젝트).
- 규칙: 걸기·지우기 모두 주소 이슈 `assertMember` + 상대 `canRead`. 방향 없는 유형은 `(min(id), max(id))` 로 저장. `side=target` 이면 상대가 source. 같은 관계면 200 + 이력 없음. 이력은 두 이슈 각각(각자 쪽 말). 실시간은 두 이슈 각각 자기 프로젝트로. 상세 목록은 삭제된 상대 제외, 상대 프로젝트를 `canRead` 로 프로젝트 id 별 한 번씩 검사해 거른 뒤 `sort_order` → 말 → (projectKey, number) 순. `lookup`: `q` 가 `^[A-Z][A-Z0-9_]*-\d+$`(대소문자 무시)면 키 정확 일치, `^#?\d+$` 면 호출자가 읽을 수 있는 프로젝트들에서 그 번호, 그 밖엔 제목 부분 일치(대소문자 무시) — 읽을 수 있는 비개인 프로젝트 + 개인 프로젝트는 자기 소유만, 삭제 제외, 최신 수정순 20.

- [ ] **Step 1: 실패하는 테스트** — `IssueRelationApiTest`:
  - `addRelatesSameProjectShowsOnBoth`: WP#1 에 RELATES WP#2 → 응답·#1 상세·#2 상세 모두 말 「관련」, 이력 각 1건.
  - `addFromTargetSideStoresReversed`: #1 화면에서 CAUSES `side=target` 대상 #2 → DB source=#2, #1 상세 말 「결과임」, #2 상세 「원인임」.
  - `symmetricNormalizedAndIdempotent`: #2 에서 RELATES #1 다시 → 200, 행 1개, 추가 이력 없음.
  - `crossProjectAllowedForReader`: WP 멤버이고 OPEN 프로젝트 WPV 를 읽을 수 있는 사용자 → 200, WPV#5 상세에 `projectKey=WP`.
  - `relationHiddenFromNonReader`: WPV 를 TEAM(비멤버)로 바꾸면 WP 만 읽는 사용자의 WP#1 상세 `relations` 에 WPV 줄 없음.
  - `historyRedactsUnreadableOther`: 위 사용자에게 WP#1 이력의 RELATION_ADDED `toValue.other` 가 `{"hidden":true}`.
  - `targetUnreadableIs400Same`: 읽을 수 없는 프로젝트 이슈·없는 번호 모두 400 `RELATION_TARGET_NOT_FOUND`, 같은 메시지.
  - `rejects`: 자기 자신 400 `RELATION_SELF`, BLOCKS 400, PARENT_EPIC 400, 숨긴 유형 400, 개인 프로젝트 ↔ 다른 프로젝트 400 `RELATION_CROSS_PROJECT_NOT_ALLOWED`, 비멤버(OPEN 읽기만) 403.
  - `removeFromEitherSide`: WP 에서 건 관계를 WPV 멤버가 WPV#5 주소로 DELETE → 204, 두 이슈 이력 RELATION_REMOVED.
  - `deletedIssueHidden`: 상대 이슈 소프트 삭제 뒤 상세에서 사라짐.
  - `blockerUnaffected`: RELATES 만 건 이슈의 `summary.blocked=false`, `blockedBy` 비어 있음.
  - `noNotificationEvents`: `@RecordApplicationEvents` 로 걸기·지우기 때 알림 계열 이벤트 0건(웨이브 2 `IssueImportTest` 의 단언 목록 재사용).
  - `lookupScopes`: 키 `WPV-5`, `#5`, 제목 조각으로 찾기, 읽을 수 없는 TEAM 프로젝트·삭제 이슈·남의 개인 프로젝트 제외, 최대 20.
- [ ] **Step 2: 실행해 실패 확인** — `./gradlew test --tests "*IssueRelationApiTest"` FAIL.
- [ ] **Step 3: 구현** — 위 시그니처·규칙대로. 이력 가림은 `IssueService.get` 의 이력 매핑에서 RELATION_* 만 파싱해 처리.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `./gradlew test --tests "com.workplace.issue.*"` PASS(상세 응답 필드 추가로 깨지는 기존 테스트 수정 포함).
- [ ] **Step 5: 커밋** — `feat(issue): 이슈 사이에 관련·중복·복제·원인 관계를 다른 프로젝트까지 걸고 지우는 API 를 더한다 (WP-887)`

### Task 4: 외부 링크

**Files:**
- Create: `.../issue/repository/IssueExternalLinkRepository.java`, `.../issue/service/IssueExternalLinkService.java`, `.../issue/controller/IssueExternalLinkController.java`, `.../issue/dto/IssueExternalLinkView.java`, `.../issue/dto/SaveIssueExternalLinkRequest.java`
- Modify: `IssueService.get`(externalLinks 채움), `IssueHistoryRecorder`, `IssueHistoryEventType`, `apps/workplace-api/CLAUDE.md`(Modules 표 issue 행에 「관계·외부 링크」, label 행 근처에 관계 유형 관리 언급)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueExternalLinkApiTest.java`

**Interfaces:**
- Consumes: Task 2 유형 서비스, Task 3 의 상세 필드.
- Produces:
  - `IssueExternalLinkView(long id, long typeId, String typeCode, String label, String url, String key, String title)`.
  - `SaveIssueExternalLinkRequest(@NotNull Long typeId, String side /* "source"(기본)|"target" */, @NotBlank @Size(max=2000) String url, @Size(max=50) String key, @NotBlank @Size(max=300) String title)`; PUT 은 url 을 무시(바꾸지 않음).
  - `POST /api/v1/projects/{key}/issues/{n}/external-links` → 200 `List<IssueExternalLinkView>`, `PUT …/external-links/{id}` → 200 목록, `DELETE …/external-links/{id}` → 204.
  - `IssueExternalLinkService.listFor(long issueId) : List<IssueExternalLinkView>`, `void insertForImport(long issueId, long callerId, List<ResolvedExternalLink>)`(Task 5 용, 이력·실시간 없음, 같은 URL 같은 유형·방향이면 건너뜀), `static String normalizeUrl(String)`(앞뒤 공백 제거 후 `java.net.URI` 파싱, 스킴 `http|https` 대소문자 무시만, host 필수, 아니면 `EXTERNAL_LINK_URL_INVALID`).
  - 이력 `EXTERNAL_LINK_ADDED|UPDATED|REMOVED`: `toValue` `{"label","key","title","url"}`, UPDATED 는 `fromValue` 에 이전 값.
  - 오류: `EXTERNAL_LINK_URL_INVALID`(400), `EXTERNAL_LINK_CONFLICT`(409 — 같은 URL 다른 유형·방향), `EXTERNAL_LINK_LIMIT`(400 — 50 초과), 숨긴 유형 `RELATION_TYPE_HIDDEN`, 없음 404.
- 권한: 주소 이슈 `assertMember`. 같은 URL·같은 유형·방향이면 200 + 이력 없음. 정렬 `sort_order` → 말 → key → id.

- [ ] **Step 1: 실패하는 테스트** — `IssueExternalLinkApiTest`:
  - `addParentEpicShowsLabel`: PARENT_EPIC `https://iacloud.atlassian.net/browse/CL-1867`, key `CL-1867`, 제목 → 상세 `externalLinks[0].label="에픽에 속함"`, 이력 1건.
  - `directedSideLabel`: CAUSES `side=target` → 말 「결과임」.
  - `rejectsNonHttpSchemes`: `javascript:alert(1)`, `data:text/html,x`, `ftp://a`, `https:///nohost`, 빈 문자열 → 400 `EXTERNAL_LINK_URL_INVALID`; `  https://a.b/c  ` 는 앞뒤 공백 제거돼 저장.
  - `sameUrlIdempotentOrConflict`: 같은 URL·유형 → 200 행 1개 이력 추가 없음, 다른 유형 → 409.
  - `limitFifty`: 51번째 400.
  - `editAndRemove`: 제목·유형 수정 → 이력 UPDATED(from/to), 삭제 204 + REMOVED, 다시 삭제 204.
  - `blocksExternalNotBlocker`: BLOCKS 외부 링크가 있어도 `summary.blocked=false`.
  - `nonMemberForbidden`: OPEN 비멤버 403.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueExternalLinkApiTest"` FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 다른 시스템 이슈를 관계·키·제목·주소로 붙이는 외부 링크를 더한다 (WP-887)`

### Task 5: 관리자 가져오기 — 외부 링크·관계 일괄

**Files:**
- Create: `.../issue/dto/ImportRelationsRequest.java`, `.../issue/dto/ImportRelationsResponse.java`, `.../issue/service/IssueRelationImportService.java`
- Modify: `.../issue/dto/ImportIssueRequest.java`(`externalLinks` 추가), `.../issue/service/IssueImportService.java`, `.../issue/controller/IssueImportController.java`, `.../issue/exception/IssueImportException.java`, `docs/integrations/issue-import-api.md`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueImportRelationsTest.java`

**Interfaces:**
- Consumes: Task 2 `resolveByCodeOrName`, Task 4 `insertForImport`·`normalizeUrl`, `IssueDependencyRepository`(add·exists·lockProjectDependencies·findBlocksOf), 웨이브 2 `requireHumanAdmin`(공용으로 꺼내 두 서비스가 같이 쓴다).
- Produces:
  - `ImportIssueRequest.ExternalLink(@NotBlank String type, String side, @NotBlank @Size(max=2000) String url, @Size(max=50) String key, @NotBlank @Size(max=300) String title)`; 필드 `@Size(max=50) List<@NotNull @Valid ExternalLink> externalLinks`.
  - `ImportRelationsRequest(@NotEmpty @Size(max=1000) List<@NotNull @Valid Item> relations)`, `record Item(@NotBlank String type, @NotNull @Positive Integer from, @Positive Integer toNumber, String toKey)` — `toNumber`(같은 프로젝트)와 `toKey`(`WPV-28`) 중 정확히 하나.
  - `POST /api/v1/projects/{key}/import/relations` → 200 `ImportRelationsResponse(int created, int skipped)`.
  - 오류: `IMPORT_INVALID_RELATIONS`(400, 상세에 `[{index, reason}]` 전부), 그 밖 웨이브 2 권한 오류 그대로.
- 규칙: 숨긴 유형도 허용. `type` 이 `BLOCKS` 면 같은 프로젝트만, `issue_dependency` 로(프로젝트 의존성 잠금 후 순환이면 그 줄 오류). 외부 전용 유형은 오류. 전부 검증 뒤 쓰기(하나라도 오류면 0건). 이미 있는 관계·요청 안 중복 줄(방향 없는 유형의 뒤집힌 쌍 포함)은 `skipped`. 이력·알림 없음. 끝나면 `IssueChangeNotifier` 로 프로젝트 단위 갱신 한 번(기존에 프로젝트 단위 신호가 없으면 관계가 생긴 이슈마다 `updatedWithoutTouch` — 구현자가 기존 API 를 보고 고른다). 외부 링크는 `importIssue` 트랜잭션 안에서 `insertForImport`.

- [ ] **Step 1: 실패하는 테스트** — `IssueImportRelationsTest`:
  - `importIssueWithExternalLinks`: 가져오기 요청에 PARENT_EPIC·RELATES 외부 링크 2개 → 상세에 2개, 이력 0건.
  - `importRelationsCreatesAll`: RELATES·CAUSES·CLONES·DUPLICATES·BLOCKS 각 1줄 + 다른 프로젝트 `toKey` 1줄 → `created=6`, BLOCKS 는 `blockedBy` 에 보임, 이력 0건, 알림 이벤트 0건.
  - `importRelationsIdempotentAndDuplicateRows`: 같은 요청 두 번 → 두 번째 `created=0, skipped=6`; 한 요청 안 RELATES (1,2)·(2,1) → `created=1, skipped=1`.
  - `allOrNothing`: 6줄 중 5번째가 없는 번호 → 400, `[{index:4,…}]`, 관계 0건.
  - `blocksCycleRejected`: BLOCKS (1→2),(2→1) → 400.
  - `hiddenTypeAllowed`: RELATES 숨김 상태에서도 성공.
  - `adminOnly`: 프로젝트 OWNER(비ADMIN)·AI 403, 개인 프로젝트 400.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueImportRelationsTest"` FAIL.
- [ ] **Step 3: 구현** + 사용법 문서에 「관계·외부 링크」 절 추가: 순서(이슈 전부 → 관계 일괄), Jira 링크 유형 → 코드 표(Relates→RELATES, Duplicate A duplicates B→DUPLICATES from A, Cloners A clones B→CLONES from A, Problem/Incident A causes B→CAUSES from A, Blocks A blocks B→BLOCKS from A), 같은 링크가 양쪽 이슈에 보이므로 링크 id 로 중복 제거, 다른 프로젝트 `parent` 에픽은 `PARENT_EPIC` 외부 링크(URL `https://<사이트>/browse/<키>`), CL·TECH·INFRA 링크는 외부 링크, 오류 표.
- [ ] **Step 4: 통과 확인** — 같은 명령 + 웨이브 2 `*IssueImport*` 테스트 전체 PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 가져오기에 외부 링크와 관계 일괄 넣기를 더한다 (WP-887)`

### Task 6: MCP·AI 도구와 플러그인 버전

**Files:**
- Modify: `packages/mcp-tools-shared/src/issue-tools.ts`, `schemas.ts`, `rest-client.ts`, `issue-detail.ts`, `tool-labels.ts`, 프로젝트 도구(`get_project` 정의 파일), 관련 테스트·스냅샷(`issue-tools.test.ts`, `__snapshots__/*.snap`, `tool-annotations.test.ts`, `no-user-ids.test.ts`, `tool-definitions.test.ts`), `apps/workplace-ai-agent/src/mcp/tools.ts`(두 곳 `sharedTool` 목록), `apps/workplace-ai-agent/src/agent/subagents/issue-agent/agent.md`(+`agent.test.ts`), `apps/workplace-ai-agent/src/agent/run-agent.ts` 주석, `apps/workplace-mcp` 스냅샷, `plugins/genia-works/.claude-plugin/plugin.json`(0.1.11), `apps/workplace-web/public/claude/marketplace.json`(`genia-works--v0.1.11`), `apps/workplace-web/src/lib/pluginGuide.test.ts`, `plugins/genia-works/skills/work-loop/SKILL.md`(버전 언급이 있으면)
- Test: 위 vitest

**Interfaces:**
- Consumes: Task 2 `GET /issue-relation-types`, Task 3·4 API·상세 필드.
- Produces:
  - `add_issue_relation` — `app:'issue'`, `kind:'write'`, hints `{destructive:false, idempotent:true}`; 입력 `{issueKey: string, type: string /* 코드 또는 이름 */, side?: 'source'|'target', otherIssueKey?: string, externalLink?: {url: string, key?: string, title: string}}` — `otherIssueKey`·`externalLink` 중 정확히 하나. 유형은 `GET /issue-relation-types` 로 풀고(숨김이면 오류), `BLOCKS` 면 「add_issue_dependency 를 쓰세요」 오류. 출력 JSON `{issueKey, relations, externalLinks}`.
  - `remove_issue_relation` — hints `{destructive:true, idempotent:true}`; 입력 `{issueKey, relationId?: number, externalLinkId?: number}` 중 정확히 하나. 출력 `'ok'`.
  - `get_issue_detail` 출력: `relations: [{relationId, type, label, issueKey, title, status}]`, `externalLinks: [{externalLinkId, type, label, key, title, url}]`(`type` = 코드가 있으면 코드, 없으면 이름).
  - `get_project` 출력: `relationTypes: [{code?, name, outwardLabel, inwardLabel?, externalOnly}]`(숨김 제외).
- [ ] **Step 1: 실패하는 테스트** — `issue-tools.test.ts`: 두 도구의 요청 경로·본문(`side` 기본 source, 이름→typeId 해석, 숨김·BLOCKS 오류, 둘 다/둘 다 없음 오류), `get_issue_detail` 매핑, `get_project` relationTypes. 스냅샷 갱신 전 실패 확인.
- [ ] **Step 2: 실행** — `pnpm --filter @workplace/mcp-tools-shared test`(패키지 이름은 package.json 확인) FAIL.
- [ ] **Step 3: 구현** + AI 에이전트 공유 도구 목록·이슈 서브에이전트 안내(관계 유형 말 규칙과 차단은 의존성 도구) + 플러그인 0.1.11.
- [ ] **Step 4: 통과 확인** — `pnpm --filter <shared> test`, `pnpm --filter workplace-ai-agent test`, `pnpm --filter workplace-mcp test`, `pnpm --filter workplace-web exec vitest run src/lib/pluginGuide.test.ts`, `pnpm typecheck` PASS.
- [ ] **Step 5: 커밋** — `feat(mcp): 이슈 관계·외부 링크를 읽고 걸고 지우는 도구를 더한다 (WP-887)`

### Task 7: 웹 화면 — 설정 「앱 설정」과 관계 유형 관리, 이슈 「관계」 그룹

**Files:**
- Create: `apps/workplace-web/src/api/issueRelations.ts`(유형·관계·외부 링크·lookup·관리 API), `src/hooks/queries/useIssueRelations.ts`, `src/hooks/queries/useIssueRelationTypes.ts`, `src/pages/settings/apps/WorkAppSettingsPage.tsx`, `src/pages/settings/apps/IssueRelationTypesSection.tsx`, `src/pages/settings/apps/IssueRelationTypeDialog.tsx`, `src/pages/settings/apps/DeleteIssueRelationTypeDialog.tsx`, `src/pages/projects/components/IssueRelationsSection.tsx`, `src/pages/projects/components/AddIssueRelationDialog.tsx`, `src/components/issues/IssueExternalLinkRow.tsx`, `src/lib/issueRelations.ts`(+`.test.ts`)
- Modify: `src/components/layout/SettingsSidebar.tsx`, `src/App.tsx`, `src/lib/documentTitle.ts`, `src/components/settings-guide/settingsGuides.ts`, `src/pages/projects/components/IssuePropertyRail.tsx`, `src/pages/projects/IssueDetailPage.tsx`(새 상세 필드 전달), `src/types/issue.ts`, `src/components/issues/IssueLinkRow.tsx`(다른 프로젝트 키·링크 지원 — `projectKey` 는 줄의 프로젝트), `src/pages/projects/components/IssueActivityTimeline.tsx`, `src/components/home/widgets/ActivityWidget.tsx`, `src/lib/resourceInvalidation.ts`(필요 시)
- Remove: `IssueDependenciesSection.tsx` 의 사용(차단 슬롯은 새 섹션 안으로; 파일은 지우거나 새 섹션이 재사용)

**Interfaces:**
- Consumes: Task 2~4 API, 기존 `useAddIssueDependency`/`useRemoveIssueDependency`.
- Produces:
  - `src/lib/issueRelations.ts`: `relationOptions(types): {typeId, side, label, typeCode, externalOnly}[]`(숨김 제외, 방향 있는 유형은 A·B 두 선택지, 방향 없는 유형은 하나; `BLOCKS` 의 B 쪽 표시 말 「차단됨 (선행 필요)」), `extractKeyFromUrl(url): string | null`(`/browse/([A-Z][A-Z0-9_]*-\d+)` 등 경로 끝의 키), `groupRelations(blockedBy, blocks, relations): {label, rows}[]`(순서: 차단됨 → 차단 중 → 유형 정렬 → 말).
  - 설정 경로 `/settings/apps/work`(「작업 관리」, 관리자 라우트 가드 안), `/settings/apps/wiki`(기존 `WikiSharingPage`), `/settings/wiki-sharing` → `<Navigate to="/settings/apps/wiki" replace />`. 사이드바 그룹: 「개인 설정」 / 「워크스페이스 관리」(구성원·에이전트·역할·SSO·감사 로그, testId `settings-admin-group` 유지) / 「앱 설정」(작업 관리 — 아이콘은 AppRail 의 `LayoutList`, 노트 — `BookOpen`, testId `settings-apps-group`).
  - 이슈 레일 그룹 제목 「관계」, `storageKey="issue-rail:dependencies"` 유지, testId `property-group-relations`, 섹션 testId `issue-relations-section`, 외부 링크 줄 testId `issue-external-link-row-{id}`, 「＋ 관계 추가」 버튼 testId `issue-relation-add`.
- [ ] **Step 1: vitest** — `src/lib/issueRelations.test.ts`: `relationOptions` 가 기본 유형에서 「차단 중·차단됨 (선행 필요)·관련·중복임·원본임·복제본임·복제 원본임·원인임·결과임」(외부 탭에선 + 「에픽에 속함」) 순서, 숨긴 유형 제외; `extractKeyFromUrl('https://iacloud.atlassian.net/browse/CL-1867')==='CL-1867'`, `extractKeyFromUrl('https://example.com/a')===null`; `groupRelations` 빈 묶음 제외·순서.
- [ ] **Step 2: 실패 확인** — `pnpm --filter workplace-web exec vitest run src/lib/issueRelations.test.ts` FAIL.
- [ ] **Step 3: 구현** — 스펙 「화면」 절과 시안을 따른다. 레일: 관계가 있는 묶음만, 전부 비면 「없음」, 다른 프로젝트 줄은 키 `WPV-28`·그 프로젝트 이슈 링크, 외부 링크 줄은 말·키·제목·↗(`target="_blank" rel="noopener noreferrer"`), 편집 권한 없으면 추가·제거·편집 조작 없음, 터치는 기존 ⋯ 패턴. 추가 창: 「이 이슈는…」 선택 → 탭 「이슈」(lookup 디바운스 250ms, 차단이면 같은 프로젝트만)/「외부 링크」(URL 입력 시 키 자동 채움). 관계 유형 관리: 표(이름·이 이슈는·상대 쪽·구분·쓰는 곳·동작), 추가·편집 창(방향 토글, 미리보기 「#31 에서: <A 쪽 말> · #12」, 「#12 에서: <B 쪽 말> · #31」), 삭제 창(사용 0건이면 확인만, 아니면 옮기기 대상 선택/함께 삭제). 활동 타임라인: 「관계 추가」「관계 삭제」「외부 링크 추가」「외부 링크 수정」「외부 링크 삭제」, 상대가 가려졌으면 「볼 수 없는 이슈」. 홈 활동 위젯 라벨 같은 문구.
- [ ] **Step 4: 통과 확인** — vitest PASS, `pnpm --filter workplace-web typecheck`, `pnpm --filter workplace-web lint` PASS, 기존 의존성·설정 E2E(`e2e/pages/settings/*`, 의존성 관련 spec) 중 경로가 바뀐 것만 고쳐 PASS.
- [ ] **Step 5: 커밋** — `feat(web): 이슈 「관계」 그룹과 설정 「앱 설정 › 작업 관리」 관계 유형 관리를 더한다 (WP-887)`

> **사용자 확인 관문(컨트롤러가 직접):** Task 7 커밋 뒤 격리 라이브 스택(6160/6273/5444)에 띄워 실제 화면을 캡처한다 — 데스크톱 이슈 상세 「관계」 그룹(차단·관련·다른 프로젝트·외부 링크가 섞인 이슈), 관계 추가 창(이슈 탭·외부 링크 탭), 설정 사이드바 「앱 설정」, 작업 관리 관계 유형 표·추가 창·삭제 창, 모바일 「＋ 속성」 시트. 사용자에게 보이고 의견을 반영한 뒤 Task 8.

### Task 8: 웹 E2E

**Files:**
- Create: `apps/workplace-web/e2e/pages/projects/issue-relations.spec.ts`, `apps/workplace-web/e2e/pages/settings/work-app-settings.spec.ts`
- Modify: `apps/workplace-web/e2e/pages/settings/wiki-sharing.spec.ts`(새 경로 + 옛 주소 이동 1건), `settings-nav.spec.ts`, 기존 의존성 E2E(그룹 제목·testId 변경분)

**Interfaces:**
- Consumes: Task 7 testId·경로, API 로 시드(기존 E2E 헬퍼 패턴).
- [ ] **Step 1: 테스트 작성** —
  - `issue-relations.spec.ts`: 같은 프로젝트 「관련」 추가 → 양쪽 상세에 「관련」; 「원인임」 추가 → 상대 상세에 「결과임」; 다른 프로젝트 키로 찾아 추가 → `WPV-` 키 표시·클릭 이동; 외부 링크(Jira browse URL) 추가 → 키 자동 채움·「에픽에 속함」·`target=_blank`; 줄 제거; 차단 추가가 기존처럼 `blocked-by-list` 에 보임; 편집 권한 없는 사용자에게 「＋ 관계 추가」 없음; 모바일 뷰포트 「＋ 속성」 시트 안 같은 그룹; 활동 타임라인 「관계 추가」.
  - `work-app-settings.spec.ts`: 관리자에게 「앱 설정 › 작업 관리」·「노트」, 일반 사용자에게 그룹 없음·직접 주소 접근 차단; 유형 추가(미리보기 문구 확인)·편집·숨김(관계 추가 창 선택지에서 사라짐)·사용 중 삭제(옮기기)·삭제(함께 삭제); 기본 유형에 편집·삭제 없음, 차단에 숨기기 없음.
  - `wiki-sharing.spec.ts`: `/settings/wiki-sharing` → `/settings/apps/wiki` 이동.
- [ ] **Step 2: 실행** — `pnpm --filter workplace-web exec playwright test e2e/pages/projects/issue-relations.spec.ts e2e/pages/settings/` PASS(실패하면 구현을 고친다).
- [ ] **Step 3: 커밋** — `test(web): 이슈 관계·외부 링크·앱 설정 E2E 를 더한다 (WP-887)`

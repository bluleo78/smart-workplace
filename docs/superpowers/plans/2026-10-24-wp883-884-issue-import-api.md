# 이슈 가져오기 API 구현 계획 (WP-883, WP-884)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 워크스페이스 관리자만 쓰는 `POST /api/v1/projects/{key}/import/issues` 로 이슈 한 건(댓글·첨부·본문 이미지·워처·커스텀 필드·변경 이력)을 원래 사람·원래 시각으로, 알림·푸시·AI 착수 없이 한 트랜잭션에 넣는다.

**Architecture:** 새 `IssueImportService`(issue 모듈) 가 일반 생성의 검증(`IssueService.planCreate`)을 「가져오기 모드」로 재사용하고, 저장은 기존 저장소 + 시각을 받는 작은 오버로드로 한다. 도메인 이벤트(`IssueCreatedEvent`·`IssueAssignedEvent`·`IssueCommentedEvent`·`WatcherAddedEvent`·`AgentToolWriteEvent`)는 **발행하지 않는다** — 플래그로 거르지 않는다(`@Async` 리스너엔 스레드 로컬이 전달되지 않는다). 화면 갱신(SSE `ResourceChangedEvent`)·첨부 텍스트 추출 요청·감사 로그만 낸다.

**Tech Stack:** Spring Boot, jOOQ, Flyway(PostgreSQL), JUnit 통합 테스트(`IntegrationTestBase`, Testcontainers), MockMvc.

**Spec:** `docs/superpowers/specs/2026-10-24-wp883-884-issue-import-api-design.md` — 각 태스크 구현자는 계획과 함께 이 설계를 읽는다.

## Global Constraints

- 작업 위치: 워크트리 `.claude/worktrees/wp882-wave2`, 브랜치 `feat/WP-882-wave2`. main 작업 폴더는 건드리지 않는다.
- 커밋은 워크트리 로컬 `git commit --no-verify`, 메시지는 `docs/COMMIT_CONVENTION.md`(한국어) + 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_01QoCRVZp7KHyhyfAPdEQtGx`.
- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜) — `docs/CODING_CONVENTION.md`. 직접 쓴 검증 `message` 는 한국어(`ValidationMessageKoreanTest`).
- 포맷: `./gradlew spotlessApply` (apps/workplace-api).
- 마이그레이션 번호 **V212** (main 최신 V211). nullable 추가만 — 롤링 배포 호환. 적용 후 `./gradlew generateJooq`.
- 새 예외는 `global/exception/CodedException` 을 구현해 상태·`errors` 를 직접 정한다(처리기 추가 없음).
- 권한: 테넌트 ADMIN 역할(`PermissionChecker.userHasRole(callerId, "ADMIN")`)만. 프로젝트 OWNER 도 403. 호출자 kind 가 `HUMAN` 이 아니면 403. PERSONAL 프로젝트면 400.
- 상한: 제목 200·본문/댓글 `IssueTextLimits.BODY_MAX`(50,000)·`sourceKey` 100·담당자 50·첨부 50·댓글 500·이력 1,000·이력 상태/제목 문자열 200.
- 가져오기는 알림 행·푸시·AI 디스패치·`agent_work` 를 하나도 만들지 않는다. 자동 워처(보고자·담당자) 없음 — `watchers` 그대로.
- 가져오기가 만드는 자동 이력(첨부 추가·담당자 지정·라벨·필드)은 남기지 않는다. `history[]` 만 넣는다.

## Review Focus

1. 시간 초과 뒤 같은 요청을 다시 보냄(`sourceKey` 같음, `number` 없음) — 두 번째는 409 이고 이슈가 하나만 남아야 한다. → Task 3 `sameSourceKey_secondImport409`.
2. 지정 번호가 **지워진(soft-delete) 이슈** 번호와 같음 — 고유 제약은 지운 행에도 걸린다. 500 이 아니라 409. → Task 3 `numberOfSoftDeletedIssue_409`.
3. 요청 뒷부분(예: 마지막 첨부 fileId 가 호출자 스테이징이 아님)에서 실패 — 이슈·댓글·워처가 하나도 남지 않아야 한다. → Task 4 `lateFailure_rollsBackWholeIssue`.
4. 가져온 이슈에 **일반 API 로** 댓글을 달면 평소대로 담당자·워처에게 알림이 가야 한다(가져오기가 알림 경로를 망가뜨리지 않음). → Task 4 `normalCommentAfterImport_notifies`.
5. 시각 오프셋(`+09:00`)이 섞인 입력 — 목록 생성일 정렬·`createdFrom` 필터가 원래 순서·날짜로 동작. → Task 3 `createdAt_orderAndFilterUseOriginalTimes`.

---

### Task 1: 스키마와 시각을 받는 저장소 메서드

**Files:**
- Create: `apps/workplace-api/src/main/resources/db/migration/V212__issue_import_marker.sql`
- Modify: `issue/repository/IssueRepository.java`, `issue/repository/IssueCommentRepository.java`, `issue/repository/IssueAttachmentRepository.java`, `issue/repository/IssueHistoryRepository.java`, `issue/repository/IssueBodyImageRepository.java`, `project/repository/ProjectIssueSequenceRepository.java` (모두 `apps/workplace-api/src/main/java/com/workplace/` 아래)
- Regenerate: `apps/workplace-api/src/main/generated/` (`./gradlew generateJooq`)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/repository/IssueImportRepositoryTest.java`

**Interfaces:**
- Produces (V212):
  - `issue.imported_by BIGINT NULL REFERENCES "user"(id) ON DELETE SET NULL`, `issue.imported_at TIMESTAMPTZ NULL`, `issue.import_source_key VARCHAR(100) NULL`
  - `issue_comment.imported_by BIGINT NULL REFERENCES "user"(id) ON DELETE SET NULL`, `issue_comment.imported_at TIMESTAMPTZ NULL`
  - `CREATE UNIQUE INDEX uq_issue_project_import_source_key ON issue(project_id, import_source_key) WHERE import_source_key IS NOT NULL`
- Produces (저장소):
  - `IssueRepository.markImported(long issueId, OffsetDateTime createdAt, OffsetDateTime updatedAt, OffsetDateTime closedAt, long importedBy, String sourceKey): void` — 네 시각·표시를 덮어쓴다(`closedAt` null 이면 null 로).
  - `IssueRepository.existsNumberIncludingDeleted(long projectId, int number): boolean`
  - `IssueRepository.existsImportSourceKey(long projectId, String sourceKey): boolean`
  - `IssueCommentRepository.markImported(long commentId, OffsetDateTime createdAt, OffsetDateTime updatedAt, long importedBy): void`
  - `IssueAttachmentRepository.insert(Long fileId, Long issueId, Long attachedBy, OffsetDateTime attachedAt): void` — 기존 3-인자는 `OffsetDateTime.now()` 로 이것에 위임.
  - `IssueHistoryRepository.insert(Long issueId, Long actorId, String eventType, String fromValue, String toValue, OffsetDateTime createdAt): void` — 기존 5-인자는 `created_at` 을 DB 기본값에 맡기는 그대로 둔다.
  - `IssueBodyImageRepository.reassign(long issueId, Collection<Long> fileIds, long uploadedBy, OffsetDateTime createdAt): void` — 그 이슈에 연결된 이 파일들의 `uploaded_by`·`created_at` 을 바꾼다.
  - `ProjectIssueSequenceRepository.raiseTo(long projectId, int nextAtLeast): void` — `next_number = GREATEST(next_number, nextAtLeast)`.

- [ ] **Step 1: 실패하는 저장소 테스트 작성** — `IssueImportRepositoryTest extends IntegrationTestBase`, `@Transactional`, `IssueClosedAtTest` 의 사용자·프로젝트 준비 방식을 따른다.
  - `markImported_overwritesTimesAndMarker`: 이슈 insert 후 `markImported(id, 2026-06-11T10:00+09:00, 2026-06-12T10:00+09:00, null, userId, "CLIM-17")` → 다시 읽은 행의 `createdAt`·`updatedAt` 이 그 순간과 같고 `import_source_key = "CLIM-17"`.
  - `raiseTo_neverLowers`: `allocateNext` 두 번(→1,2) 후 `raiseTo(p, 18)` → 다음 `allocateNext` 가 18, 다시 `raiseTo(p, 5)` → 다음 19.
  - `existsNumberIncludingDeleted_seesSoftDeleted`: 3번 이슈 insert 후 `deleted_at` 설정 → `true`.
  - `sourceKeyUnique_perProject`: 같은 프로젝트에 같은 키 두 번 `markImported` → `DataIntegrityViolationException`(또는 jOOQ `DataAccessException`); 다른 프로젝트는 허용.
  - `historyInsert_withCreatedAt`, `attachmentInsert_withAttachedAt`, `commentMarkImported`: 넣은 시각이 그대로 읽힌다.
- [ ] **Step 2: 실행해 실패 확인** — `cd apps/workplace-api && ./gradlew test --tests "*IssueImportRepositoryTest"` → 컴파일 실패(메서드 없음).
- [ ] **Step 3: V212 작성 → `./gradlew generateJooq` → 위 메서드 구현.**
- [ ] **Step 4: 테스트 통과 확인** — 같은 명령 PASS, 그리고 `./gradlew test --tests "*IssueClosedAtTest" --tests "*IssueCommentControllerTest"` 로 기존 오버로드 회귀 없음.
- [ ] **Step 5: `./gradlew spotlessApply` 후 커밋** — `feat(issue): 가져오기 표시 열과 시각을 받는 저장소 메서드를 더한다 (WP-883)`

---

### Task 2: 요청 DTO·예외·사용자 해석

**Files:**
- Create: `issue/dto/ImportIssueRequest.java`, `issue/service/ImportUserResolver.java`, `issue/exception/IssueImportException.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/dto/ImportIssueRequestValidationTest.java`, `.../issue/service/ImportUserResolverTest.java`

**Interfaces:**
- Produces `ImportIssueRequest` (record, Bean Validation, 한국어 메시지):
  ```java
  record ImportIssueRequest(
      @Positive Integer number,
      @Size(max = 100) String sourceKey,
      @NotBlank @Size(max = 200) String title,
      @Size(max = IssueTextLimits.BODY_MAX) String body,
      Long typeId, Long statusId, @Pattern(regexp = IssueStatuses.CATEGORY_REGEX) String status,
      @Pattern(regexp = IssuePriorities.REGEX) String priority,
      LocalDate startDate, LocalDate dueDate, Integer parentNumber, Long milestoneId,
      List<@NotNull Long> labelIds, List<String> labelNames, List<@NotNull Long> cycleIds,
      @Valid List<UpdateIssueFieldsRequest.FieldValueInput> fields,
      @NotBlank String reporter,
      @Size(max = 50) List<@NotBlank String> assignees,
      List<@NotBlank String> watchers,
      @NotNull OffsetDateTime createdAt, OffsetDateTime updatedAt, OffsetDateTime closedAt,
      @Size(max = 50) @Valid List<Attachment> attachments,
      @Size(max = 500) @Valid List<Comment> comments,
      @Size(max = 1000) @Valid List<HistoryEntry> history) {
    record Attachment(@NotNull Long fileId, @NotBlank String attachedBy, @NotNull OffsetDateTime attachedAt) {}
    record Comment(@NotBlank String author, @NotNull OffsetDateTime createdAt, OffsetDateTime updatedAt,
                   @NotBlank @Size(max = IssueTextLimits.BODY_MAX) String body) {}
    record HistoryEntry(@NotBlank String type, @NotBlank String actor, @NotNull OffsetDateTime at,
                        @Size(max = 200) String from, @Size(max = 200) String to,
                        Long fromStatusId, Long toStatusId, Long fromTypeId, Long toTypeId,
                        List<@NotBlank String> added, List<@NotBlank String> removed) {}
    /** 요청에 나온 모든 username(보고자·담당자·워처·댓글·첨부·이력 행위자·이력 added/removed 중 ASSIGNEES_CHANGED 것). */
    Set<String> referencedUsernames();
  }
  ```
  (`fields` 는 일반 필드 값 API 와 같은 `defId`+값 형식 — 설계의 「일반 필드 값 API 와 같은 형식」.)
- Produces `IssueImportException implements CodedException` — 정적 팩토리:
  `forbidden()` 403 `{reason:"IMPORT_ADMIN_ONLY"}` · `personalProject()` 400 · `unknownUsers(List<String>)` 400 `{reason:"IMPORT_UNKNOWN_USERS", usernames:"a,b"}` · `numberTaken(int)` 409 · `sourceKeyTaken(String)` 409 · `invalidTimes(String detail)` 400 · `invalidHistory(int index, String detail)` 400 · `unknownLabels(List<String>)` 400. 메시지는 한국어.
- Produces `ImportUserResolver.resolve(long projectId, Collection<String> usernames): Map<String, UserSummary>` — 모두 **이 프로젝트의 멤버이고 이 테넌트에서 활성**이어야 하며, 아니면 맞지 않은 username 을 **모두** 담아 `IssueImportException.unknownUsers` (정렬된 목록). 대체 사용자 없음.

- [ ] **Step 1: 실패 테스트** —
  - `ImportIssueRequestValidationTest`(`Validation.buildDefaultValidatorFactory()`): `createdAt` 없음 → 위반 1건; 댓글 501개 → 위반; 댓글 본문 50,001자 → 위반; `referencedUsernames()` 가 보고자·담당자·워처·댓글 작성자·첨부자·이력 행위자·`ASSIGNEES_CHANGED` 의 added/removed 를 합친 집합(라벨 이름은 제외).
  - `ImportUserResolverTest`(통합): 멤버 2명 + 비멤버 1명 + 없는 이름 1명 요청 → 예외의 `errors().get("usernames")` 가 `"ghost,outsider"`; 정지된 멤버(`TestFixtures.suspendMember`)도 포함; 모두 멤버면 username→`UserSummary` 맵.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*ImportIssueRequestValidationTest" --tests "*ImportUserResolverTest"`.
- [ ] **Step 3: 구현** — 사용자 조회는 기존 `UserRepository`·`ProjectMemberRepository` 메서드로(새 쿼리가 필요하면 username 집합으로 한 번에 읽는 메서드 하나).
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, `./gradlew test --tests "*ValidationMessageKoreanTest"` PASS.
- [ ] **Step 5: 커밋** — `feat(issue): 가져오기 요청 형식과 원작성자 해석을 더한다 (WP-883)`

---

### Task 3: 이슈 가져오기 서비스·API (이슈 본체·담당자·워처·필드·번호·감사)

**Files:**
- Create: `issue/service/IssueImportService.java`, `issue/controller/IssueImportController.java`
- Modify: `issue/service/IssueService.java` (`planCreate` 가져오기 모드), `issue/outbound/IssueChangeNotifier.java` (`imported`), `issue/service/IssueFieldValueService.java` (`importValues`)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueImportTest.java`

**Interfaces:**
- Consumes: Task 1 저장소 메서드, Task 2 `ImportIssueRequest`·`ImportUserResolver`·`IssueImportException`.
- Produces:
  - `IssueService.planCreate(Long callerId, String projectKey, CreateIssueRequest req, boolean importing): CreateIssuePlan` — 기존 3-인자는 `importing=false` 로 위임. `importing=true` 면 **완료 사이클 거절**(`CompletedCycleNotAssignableException`)과 **완료 에픽 아래 미완료 하위 거절**(`requireOpenChildAllowed`)만 건너뛴다. 나머지 검증은 같다.
  - `IssueChangeNotifier.imported(ProjectRow project, int issueNumber, long issueId, Long actorId): void` — `ResourceChangedEvent` OP_CREATED 만(AgentToolWriteEvent 없음).
  - `IssueFieldValueService.importValues(long projectId, long issueId, List<UpdateIssueFieldsRequest.FieldValueInput> values): void` — `replace` 와 같은 정의 소속·`FieldTypeValidator` 검증 뒤 upsert, **이력·알림 없음**. `replace` 와 검증 코드를 공유하도록 꺼낸다.
  - `IssueImportService.importIssue(long callerId, String projectKey, ImportIssueRequest req): IssueResponse` (`@Transactional`)
  - `POST /api/v1/projects/{key}/import/issues` → 201 + `IssueResponse`, `@RequirePermission("issue:write")`, `@Valid`.

순서(한 트랜잭션): 권한(ADMIN·HUMAN) → 프로젝트(PERSONAL 거절) → 시각 검증(`updatedAt ≥ createdAt`; `closedAt` 은 해석된 상태가 종료 범주일 때만, 없으면 `updatedAt ?? createdAt`) → `ImportUserResolver.resolve(req.referencedUsernames())` → `CreateIssueRequest` 로 바꿔(담당자 id, `fileIds=null`) `planCreate(..., true)` → `sourceKey` 중복 409 → 번호: 있으면 `raiseTo(number+1)` 후 `existsNumberIncludingDeleted` 면 409, 없으면 `allocateNext` → `issueRepository.insert(... reporterId=보고자 ...)` → `markImported` → 라벨(`labelService.mergeWithNames`)·사이클 연결 → 필드 `importValues` → 담당자 `assigneeRepository.add(issueId, uid, callerId)` → 워처 `IssueWatcherRepository.add` 를 `watchers` 에만 → `changeNotifier.imported` → `AuditLogService.log(callerId, username, "ISSUE_IMPORTED", "issue", issueKey, "이슈 가져오기", null, null, "SUCCESS", null, Map.of("sourceKey",…, "reporter",…, "comments",n, "attachments",n, "history",n))`. 고유 제약 위반(번호·원본 키 경합)은 409 로 바꾼다. `finishCreate`·`agentWorkService`·`watcherAutoEnroller`·`publisher.publishEvent` 는 부르지 않는다.

- [ ] **Step 1: 실패 테스트** — `IssueImportTest extends IntegrationTestBase` + `@RecordApplicationEvents`(예: `notify/service/IssueChatNotificationTest` 참고), MockMvc 로 HTTP 호출(`AdminAgentDeleteTest` 의 `authentication(...)` 방식). 준비: ADMIN(`TestFixtures.grantRole(dsl, admin, "ADMIN")`), 프로젝트(TEAM) + 구성원 3명(보고자·담당자·워처), 완료 사이클 1개.
  - `admin_importsWithOriginalPeopleAndTimes`: 보고자 B, `createdAt 2026-06-11T09:00+09:00`, `updatedAt 2026-06-20T18:00+09:00`, 완료 범주 상태 + `closedAt 2026-06-21T10:00+09:00`, 담당자 C, 워처 [B], 완료 사이클, 커스텀 필드 1개 → 201; 상세의 reporter=B·createdAt·updatedAt·closedAt 일치, 담당자 [C], 워처 정확히 [B](C 자동 등록 없음), 필드 값 저장, 이력 0건.
  - `importEmitsNoNotificationOrAiEvents`: 위 가져오기 뒤 `ApplicationEvents` 에 `IssueCreatedEvent`·`IssueAssignedEvent`·`WatcherAddedEvent`·`AgentToolWriteEvent`·`InboxPushRequestedEvent` 0건, `NOTIFICATION` 테이블 행 0, `AGENT_WORK` 행 0, `ResourceChangedEvent` 1건; AI 담당자(`TestFixtures.createAgentWithToken` + 프로젝트 멤버)를 담당으로 넣어도 `agent_work` 0.
  - `nonAdmin_403_evenProjectOwner`: 프로젝트 OWNER(ADMIN 아님) → 403, 이슈 0건.
  - `personalProject_400`.
  - `agentCaller_403`: ADMIN 역할을 준 AI 구성원(kind `AGENT`)으로 호출 → 403.
  - `openChildUnderDoneEpic_andCompletedCycle_allowed`: 완료 상태로 가져온 에픽 아래에 미완료 하위를 `parentNumber` 로, 완료 사이클에 넣어 가져오기 → 201(일반 생성이면 거절되는 조합). `issue.imported_by`=ADMIN·`imported_at` 이 채워진다.
  - `specifiedNumber_usedAndSequenceRaised`: `number=17` → 이슈 번호 17, 이어서 일반 `IssueService.create` → 18.
  - `sameNumber_409` · `numberOfSoftDeletedIssue_409` (Review Focus 2).
  - `sameSourceKey_secondImport409` (Review Focus 1): `number` 없이 같은 `sourceKey` 두 번 → 두 번째 409, 프로젝트 이슈 1건.
  - `unknownUsers_400_listsAll`: 보고자 비멤버 + 워처 없는 이름 → 400, `errors.usernames` 둘 다.
  - `updatedBeforeCreated_400`, `closedAtOnOpenStatus_400`.
  - `createdAt_orderAndFilterUseOriginalTimes` (Review Focus 5): `+09:00`·`Z` 섞인 3건 → `IssueSearchService.search` 생성일 오름차순이 원래 순서, `createdFrom` 이 KST 날짜 경계로 거른다.
  - `auditLogWritten`: `AUDIT_LOG` 에 `ISSUE_IMPORTED` 1행, resourceId = 이슈 키.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueImportTest"`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — `IssueImportTest` PASS + `./gradlew test --tests "com.workplace.issue.*"` 회귀 없음.
- [ ] **Step 5: 커밋** — `feat(issue): 관리자가 이슈를 원래 보고자·시각으로 알림 없이 가져오는 API 를 더한다 (WP-883, WP-884)`

---

### Task 4: 댓글·첨부·본문 이미지 가져오기

**Files:**
- Modify: `issue/service/IssueImportService.java`, `issue/service/IssueAttachmentService.java` (`attachImported`), `issue/service/IssueBodyImageService.java` (`claimForImport`)
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueImportContentTest.java`

**Interfaces:**
- Consumes: Task 1 `IssueAttachmentRepository.insert(…, attachedAt)`, `IssueCommentRepository.markImported`, `IssueBodyImageRepository.reassign`; Task 3 `importIssue`.
- Produces:
  - `IssueAttachmentService.attachImported(long issueId, long callerId, List<ImportedAttachment> items): void` — `record ImportedAttachment(long fileId, long attachedBy, OffsetDateTime attachedAt)`. `attachStaged` 와 같은 잠금·스테이징 클레임(호출자 소유)·파일 크기 상한·`FileExtractionRequestedEvent(TEXT_ONLY)`, **개수 상한 50**, **이력·알림 없음**. 공통부는 `attachStaged` 와 나눠 쓴다.
  - `IssueBodyImageService.claimForImport(ProjectRow project, long issueId, long callerId, String text, long uploadedBy, OffsetDateTime at): void` — 호출자가 올린 미연결 이미지를 연결(`lockClaimable`+`claim`)한 뒤 `reassign(issueId, 연결된 ids, uploadedBy, at)`. 강등 판정 없음(새 글).
- 저장 순서(Task 3 흐름에 끼움): 이슈 insert 직후 본문 이미지 `claimForImport(…, req.body(), 보고자, createdAt)` → 첨부 `attachImported` → 댓글마다 `commentRepository.insert(issueId, 작성자, body)` → `markImported(commentId, c.createdAt, c.updatedAt ?? c.createdAt, callerId)` → `claimForImport(…, c.body, 작성자, c.createdAt)`. 댓글 `updatedAt < createdAt` 이면 `invalidTimes`. `IssueCommentedEvent`·`IssueHumanReplyPosted`·워처 자동 등록 없음.

- [ ] **Step 1: 실패 테스트** — `IssueImportContentTest` (Task 3 준비 재사용). 스테이징 파일은 기존 스테이징 업로드 서비스로 ADMIN 이 올린다(`file/service/StagedUploadService`), 본문 이미지는 `IssueBodyImageService.upload`.
  - `commentsKeepAuthorAndTimes`: 댓글 2개(작성자 B·C, 시각 06-12·06-13, 두 번째는 `updatedAt` 06-14) → 상세 댓글 작성자·`createdAt`·`updatedAt` 일치, 순서 유지.
  - `attachmentsKeepUploaderAndTime`: 첨부 2개(`attachedBy` C, `attachedAt` 06-11) → 첨부 목록의 첨부자 C·시각 일치, `ATTACHMENTS_CHANGED` 이력 0, 텍스트 추출 요청 이벤트 2건.
  - `bodyAndCommentImagesReassigned`: 본문·댓글에 이미지 참조 → `issue_body_image.uploaded_by` 가 각각 보고자·댓글 작성자, `created_at` 이 그 글 시각.
  - `eleventhAttachmentAllowed_upTo50`: 첨부 11개 → 201(일반 상한 10 을 넘어도 됨).
  - `noCommentNotifications`: 댓글에 `@C` 멘션이 있어도 `NOTIFICATION` 0, `IssueCommentedEvent` 0.
  - `lateFailure_rollsBackWholeIssue` (Review Focus 3): 마지막 첨부 fileId 가 다른 사람 스테이징 → 4xx, 그 프로젝트 이슈·댓글·워처 0건.
  - `normalCommentAfterImport_notifies` (Review Focus 4): 가져온 이슈에 `IssueCommentService.create` 로 일반 댓글 → 담당자·워처에게 COMMENTED 알림이 생긴다(비동기면 `Awaitility` 또는 기존 테스트의 대기 방식).
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueImportContentTest"`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 위 PASS + `./gradlew test --tests "*IssueAttachment*" --tests "*IssueBodyImage*"` 회귀 없음.
- [ ] **Step 5: 커밋** — `feat(issue): 가져오기에 댓글·첨부·본문 이미지를 원래 작성자·시각으로 넣는다 (WP-883)`

---

### Task 5: 변경 이력 가져오기

**Files:**
- Modify: `issue/service/IssueHistoryRecorder.java`, `issue/service/IssueImportService.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/IssueImportHistoryTest.java`

**Interfaces:**
- Consumes: Task 1 `IssueHistoryRepository.insert(…, createdAt)`, Task 2 `HistoryEntry`·`invalidHistory`·`unknownLabels`, Task 3 흐름.
- Produces: `IssueHistoryRecorder` 의 기존 기록 메서드에 `OffsetDateTime at` 을 받는 오버로드 — `recordAssigneesChanged(actorId, issueId, added, removed, at)`, `recordLabelsChanged(…, at)`, `recordTypeChanged(…, at)`, 그리고 단순 값용 `recordImportedValue(long issueId, long actorId, String eventType, String from, String to, OffsetDateTime at)`. 기존 메서드는 `at=null`(DB 기본값)로 위임해 **일반 변경의 저장 모양과 같은 payload** 를 만든다.
- 유형별 처리(설계 표 그대로): `STATUS_CHANGED` 는 `fromStatusId`/`toStatusId` 가 이 프로젝트 상태여야 하고 값은 그 상태의 **지금 이름**(from 은 null 허용 — 생성 직후 첫 전이); `PRIORITY_CHANGED` 는 `IssuePriorities.ORDER` 안의 코드; `ASSIGNEES_CHANGED` 는 username → `UserSummary`; `TITLE_CHANGED` 문자열; `TYPE_CHANGED` 는 이 프로젝트 유형 id → `IssueTypeSummary`; `DUE_DATE_CHANGED`·`START_DATE_CHANGED` 는 `YYYY-MM-DD`(파싱 실패 400) 또는 null; `LABELS_CHANGED` 는 이 프로젝트 라벨 이름(정확히 일치, 이슈 라벨 생성 뒤 기준) → `LabelSummary`, 없으면 `unknownLabels`. 그 밖의 `type` 은 `invalidHistory(index, …)`. 검증은 **저장 전에 전부** 돌려 하나라도 틀리면 아무것도 넣지 않는다(트랜잭션 롤백으로 충분).

- [ ] **Step 1: 실패 테스트** — `IssueImportHistoryTest`.
  - `statusHistory_byStatusId_storesCurrentNames`: `toStatusId`=「진행 중」 상태(06-11 10:00, 행위자 B), 「진행 중」→완료 상태(06-20) → 상세 이력 2건, 값이 상태 이름, `actorUsername`·`createdAt` 원래 값, 시각 오름차순.
  - `statusOfOtherProject_400` · `unknownType_400`(`CYCLE_CHANGED`) · `badDate_400` · `unknownLabel_400`.
  - `assigneesLabelsTypeTitleDates_roundTrip`: 각 유형 1건씩 → `IssueActivityTimeline` 이 읽는 필드(`eventType`, `fromValue`, `toValue` payload)가 일반 변경으로 생긴 행과 같은 모양(같은 테스트에서 일반 `IssueService.update`·`IssueAssigneeService.replace` 로 만든 행의 JSON 키 집합과 비교).
  - `homeActivity_showsImportedHistoryAtOriginalTime`: 워처의 홈 활동(`HomeActivityRepository`)에 행이 원래 시각으로 보이고 알림은 0.
- [ ] **Step 2: 실패 확인** — `./gradlew test --tests "*IssueImportHistoryTest"`.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — 위 PASS + `./gradlew test --tests "*IssueHistory*"` 회귀 없음.
- [ ] **Step 5: 커밋** — `feat(issue): 가져오기에 상태·담당자·우선순위·제목·유형·일정·라벨 변경 이력을 원래 시각으로 넣는다 (WP-883)`

---

### Task 6: 스크립트 작성자용 사용법 문서

**Files:**
- Create: `docs/integrations/issue-import-api.md`
- Modify: `apps/workplace-api/CLAUDE.md` (Modules 표 `issue` 행에 「관리자 전용 가져오기(`/import/issues`)」 한 줄)

내용: 권한(ADMIN·개인 토큰), 준비 순서(구성원·상태·유형·사이클·라벨·커스텀 필드 → 이슈마다 첨부·이미지 스테이징 업로드 → 가져오기, 에픽 먼저), 요청 전체 예시(JSON — Task 2 필드 이름 그대로), 오류 응답 표(403·400 `IMPORT_UNKNOWN_USERS`·409 번호/원본 키), 재시도 규칙(`sourceKey` 로 409 = 이미 들어감), 설계 「스크립트 작성자용 사용법 문서」 절의 CLIM 주의 9개(그대로 옮긴다), 하지 않는 것(관계·버전·구성요소·사이클 이력 — WP-887·888·933).

- [ ] **Step 1: 문서 작성** — 예시 JSON 이 Task 2 의 레코드 필드 이름과 정확히 일치하는지 `ImportIssueRequest.java` 와 대조.
- [ ] **Step 2: 커밋** — `docs(issue): 이슈 가져오기 API 사용법을 이관 스크립트 작성자용으로 정리한다 (WP-883)`

---

## 마무리 (태스크 뒤, 웨이브 흐름)

- 브랜치 전체 `/code-review medium` → `/simplify` → 전체 회귀 `pnpm test:full`(웹 변경 없음이어도 훅 기준 트리 기록용) → merge-base 기준 스쿼시 → 사용자 의견 들은 뒤 main `--no-ff` 머지.
- 배포: API 만(V212). 실제 이관은 이 배포 + WP-704 운영 배포 + 웨이브 3(WP-887, 관계) 뒤.

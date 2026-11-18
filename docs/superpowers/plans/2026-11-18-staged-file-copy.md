# 기존 첨부를 스테이징 파일로 복사·반영 안내 자료 흐름 (WP-1705) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 호출자가 읽을 수 있는 이슈 첨부·이슈 본문 이미지·이슈 챗 첨부·드라이브 파일을 서버에서 복사해 호출자 소유 스테이징 파일로 만들고(`POST /api/v1/staged-files/copy` + `upload_file` 의 `source` 갈래), work-loop 스킬에 「사용 가이드」와 「안내 자료 요청」 처리 규칙을 더한다.

**Architecture:** core `file` 은 포트 `StagedCopySourceResolver` 만 알고, issue·chat·drive 모듈이 자기 읽기 가드를 그대로 써서 「읽을 수 있는 core file id」를 돌려주는 구현을 둔다(`AttachmentBindingLookup` 과 같은 방향). 새 `StagedFileCopyService` 가 source 로 리졸버를 골라 한 트랜잭션 안에서 `StagedUploadService.createFromCopy` 를 부른다 — 복사본은 새 FILE 행(임시 ATTACHMENT)이라 기존 클레임·`file:<id>` 자리표시가 그대로 받는다. MCP 는 기존 `upload_file` 에 `read_file` 과 같은 출처 인자를 더한다(새 도구 없음).

**Tech Stack:** Spring Boot + jOOQ(JUnit 통합 테스트, Testcontainers), TypeScript + zod + vitest(`packages/mcp-tools-shared`, ai-agent), Markdown 스킬 + `node --test`(`plugins/genia-works`).

**Spec:** `docs/superpowers/specs/2026-11-18-staged-file-copy-design.md`

## Global Constraints

- 한국어 주석 필수(클래스·메서드·주요 로직에 무엇을·왜) — `docs/CODING_CONVENTION.md`. 도구 설명·`.describe()` 는 영어, 오류·결과 문구는 한국어(README 「도구 설명 쓰는 법」).
- core `file` 패키지는 issue·chat·drive 패키지를 import 하지 않는다. 구현은 각 도메인 패키지에 둔다.
- 출처는 `issue`·`issue_chat`·`drive` 셋뿐(노트·채널 메시지·메일 없음).
- 읽을 수 없거나 없는 출처는 도메인 가드가 던지는 예외 그대로(404/403)이고 **FILE 행·blob 이 남지 않는다**.
- 복사본: `uploaded_by` = 호출자, `category` = `ATTACHMENT`, `expires_at` = 지금 + `temp-expiry-hours`(24), 경로 = `StorageDomain.STAGED` + 원본 확장자, 응답 = 기존 `StagedFileResponse`(201).
- source 에 맞는 리졸버가 없거나 source 별 필수 필드가 없으면 400.
- MCP: source 가 있으면 content 와 함께 줄 수 없고 `name` 은 생략 가능(원본 이름). source 가 없으면 지금과 같다(`name` 필수). content 전용 판(`allowUploadLink: false`)도 source 갈래를 허용한다. 설명은 한 문장만 더한다.
- `DEFINITION_TOKEN_CAP`(`tool-naming.test.ts`, 17_700) 은 **올리지 않는다** — 지금 17,690 토큰(97개, 여유 10)이라 넘친 만큼 다른 설명을 줄인다(뜻·필수 인자·출력 모양은 유지).
- 에이전트 신원 프로필(issue·chat·messaging·home)에 `upload_file` 을 새로 싣지 않는다.
- 플러그인 버전 0.1.52 → 0.1.53. 안내 자료 요청 라벨 이름은 `.work-loop/project.md` 에만 두고 스킬은 그 절을 읽는다(플러그인은 저장소마다 쓴다).
- 커밋: `<type>(<scope>): <한글 제목> (WP-1705)`, 본문 첫 줄 `- WP-1705`, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **25MB 를 넘는 출처(큰 드라이브 파일)** — 복사하지 않고 400(`FileSizeLimitExceededException`, 「최대 25MB」)이며 행·blob 이 남지 않는다. 스펙은 상한을 정하지 않았지만 스테이징 링크 상한(`linkMaxBytes`, 25MB)과 같게 둔다 → Task 1 테스트.
2. **FILE 행은 있는데 원본 blob 이 디스크에 없음** — 500 이 아니라 `FileBlobMissingException`(기존 핸들러 상태)이고 행·스테이징 blob 이 남지 않는다 → Task 1 테스트.
3. **메시지 수정으로 뺀 이슈 챗 첨부·삭제된 메시지의 첨부** — 다운로드와 같은 가드라 404, 행 없음 → Task 3 테스트.
4. **휴지통에 있는 드라이브 파일** — `viewableRow` 가 404, 행 없음 → Task 3 테스트.
5. **모델이 쓰지 않는 인자를 null 로 채움**(`content: null`, `driveFileId: null` 과 source issue 등) — null 은 생략으로 보고 source 갈래로 정상 처리, content 전용 판에서도 링크 거절 오류가 나지 않는다 → Task 4 테스트.

---

### Task 1: core 복사 경로 — 포트·`createFromCopy`·`POST /staged-files/copy`

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/file/api/StagedCopySource.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/file/api/StagedCopySourceResolver.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/file/dto/CopyStagedFileRequest.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/file/service/StagedFileCopyService.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/file/service/StagedUploadService.java` (`createFromBytes` 뒤에 `createFromCopy`, 클래스 Javadoc 에 WP-1705 한 줄)
- Modify: `apps/workplace-api/src/main/java/com/workplace/file/controller/StagedFileController.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/file/controller/StagedFileCopyIntegrationTest.java`

**Interfaces:**
- Produces:
  - `public record StagedCopySource(String source, String issueKey, Long messageId, Long attachmentId, Long driveFileId)` (`file.api`)
  - `public interface StagedCopySourceResolver { String source(); long resolveReadableFileId(long callerId, StagedCopySource src); }` — Javadoc: 필수 필드가 없으면 `IllegalArgumentException`(400, 한국어 문구 `source '<s>' 는 <필드·필드> 가 필요합니다`), 읽을 수 없으면 도메인 가드 예외 그대로.
  - `public record CopyStagedFileRequest(@NotBlank String source, @Size(max = 64) String issueKey, Long messageId, Long attachmentId, Long driveFileId, @Size(max = 255) String name)` (`file.dto`)
  - `StagedUploadService#createFromCopy(long callerId, long srcFileId, String name) : StagedFileResponse` — `@Transactional`
  - `StagedFileCopyService#copy(long callerId, StagedCopySource src, String name) : StagedFileResponse` — `@Transactional`
  - `POST /api/v1/staged-files/copy` → 201 `StagedFileResponse`

- [ ] **Step 1: Write the failing tests** — `StagedFileCopyIntegrationTest extends IntegrationTestBase`. 시드·정리·`bearer(userId)` 는 `StagedUploadIntegrationTest` 의 방식을 따르고, 원본은 FILE 행 + blob 을 직접 시드한다(`IssueBodyFilePlaceholderTest#seedStaged` 와 같은 방식, 단 `expires_at` null·category `ATTACHMENT`·다른 사용자 소유).

```java
@Test void createFromCopy_는_호출자_소유_임시_ATTACHMENT_새_행을_만들고_바이트가_같다() {
  long src = seedFile(otherId, "화면.png", PNG, "image/png");
  StagedFileResponse r = service.createFromCopy(callerId, src, null);
  FileRecord row = fileRow(r.fileId());
  assertThat(r.fileId()).isNotEqualTo(src);
  assertThat(row.getUploadedBy()).isEqualTo(callerId);
  assertThat(row.getCategory()).isEqualTo("ATTACHMENT");
  assertThat(row.getExpiresAt()).isNotNull();
  assertThat(row.getOriginalName()).isEqualTo("화면.png");
  assertThat(row.getMimeType()).isEqualTo("image/png");
  assertThat(row.getStoragePath()).contains("/staged/").endsWith(".png").isNotEqualTo(fileRow(src).getStoragePath());
  assertThat(Files.readAllBytes(fileStore.resolve(row.getStoragePath()))).isEqualTo(PNG);
  assertThat(fileRow(src).getUploadedBy()).isEqualTo(otherId); // 원본은 그대로
}
@Test void createFromCopy_name_을_주면_정리한_그_이름으로_저장한다() // name "a/b.png" → SafeFileNames.sanitize 결과, 경로 확장자는 원본(stored_name) 기준
@Test void createFromCopy_25MB_초과면_400_행이_남지_않는다()        // 원본 size_bytes = 26214401 로 시드 → FileSizeLimitExceededException, filesUploadedBy(callerId) 그대로
@Test void createFromCopy_원본_blob_이_없으면_FileBlobMissingException_행이_남지_않는다()
@Test void copy_모르는_source_는_400() throws Exception          // POST {"source":"wiki","attachmentId":1} → status 400
@Test void copy_source_없으면_400() throws Exception              // POST {} → 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `apps/workplace-api`): `./gradlew test --tests "com.workplace.file.controller.StagedFileCopyIntegrationTest"`
Expected: 컴파일 실패(`createFromCopy` 없음).

- [ ] **Step 3: Implement**
  - `StagedUploadService` 에 `public StagedFileResponse createFromCopy(long callerId, long srcFileId, String name)`: `dsl` 로 원본 FILE 행(ORIGINAL_NAME·STORED_NAME·MIME_TYPE·SIZE_BYTES·STORAGE_PATH)을 읽고(없으면 `FileNotFoundException(srcFileId)`), `size > linkMaxBytes` 면 `new FileSizeLimitExceededException("ATTACHMENT", linkMaxBytes, 이름)`, `!fileStore.exists(path)` 면 `FileBlobMissingException(srcFileId)`. 이름 = `SafeFileNames.sanitize(name != null && !name.isBlank() ? name : 원본 이름, "file")`. 그다음 `createFromBytes` 와 같은 순서: `quotaGuard.assertWithinQuotaLocked(size)` → `pathBuilder.buildWithExtensionOf(StorageDomain.STAGED, 원본 stored_name)` → `fileStore.copy(src, dest)` → `fileStore.deleteOnRollback(dest)` → `insertStagedFile(callerId, 이름, 원본 MIME, size, dest)`.
  - `StagedFileCopyService`(`@Service`): 생성자에서 `List<StagedCopySourceResolver>` 를 `source()` 키 맵으로 만든다(중복이면 `Collectors.toMap` 의 `IllegalStateException` 으로 기동 실패 — 의도). `copy`: 맵에 없으면 `IllegalArgumentException("복사할 수 없는 source 입니다: " + s)`, 있으면 `resolveReadableFileId` → `staged.createFromCopy`. 별도 클래스로 두는 이유(주석): 도메인 서비스가 `StagedUploadService` 에 기대는 경로가 있어 `StagedUploadService` 가 리졸버를 주입받으면 생성자 순환이 생길 수 있다.
  - 컨트롤러: `@PostMapping("/copy")` → `ResponseEntity.status(CREATED).body(copyService.copy(callerId, new StagedCopySource(req.source(), req.issueKey(), req.messageId(), req.attachmentId(), req.driveFileId()), req.name()))`. 컨트롤러 Javadoc 에 「읽기 권한은 출처 도메인 리졸버가 본다」 한 줄.

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test --tests "com.workplace.file.controller.StagedFileCopyIntegrationTest" --tests "com.workplace.file.controller.StagedUploadIntegrationTest" --tests "com.workplace.architecture.*"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/workplace-api/src/main/java/com/workplace/file apps/workplace-api/src/test/java/com/workplace/file/controller/StagedFileCopyIntegrationTest.java
git commit -m "feat(api/file): 읽을 수 있는 첨부를 스테이징 파일로 복사하는 경로를 더한다 (WP-1705)" -m "- WP-1705
- 출처 도메인이 구현하는 포트로 읽기 권한을 확인한 뒤 원본 바이트를 호출자 소유 임시 첨부로 복사한다
- 25MB 초과·원본 유실은 행을 남기지 않고 거절한다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: issue 출처 — 이슈 첨부·본문 이미지 + 다른 프로젝트 댓글 이미지

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/issue/service/IssueStagedCopySource.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/issue/service/IssueStagedCopySourceTest.java`

**Interfaces:**
- Consumes: Task 1 `StagedCopySourceResolver`, `StagedCopySource`, `POST /api/v1/staged-files/copy`.
- Uses: `IssueAttachmentService#resolveViewFileId(Long callerId, String projectKey, int number, Long fileId) : long`(가드 = 프로젝트 읽기 + 그 이슈의 첨부 또는 그 프로젝트 이슈에 연결된 본문·댓글 이미지), `IssueKeys.parse(String) : Optional<IssueKey>`.
- Produces: `@Component IssueStagedCopySource implements StagedCopySourceResolver`, `source()` = `"issue"`.

- [ ] **Step 1: Write the failing tests** — `@Transactional` 클래스 + MockMvc(`IssueBodyFilePlaceholderTest` 의 setUp·`seedStaged`·`tokenFor` 방식). 사용자: `ownerId`(P1·P2 OWNER), `p2OnlyId`(P2 MEMBER 만), P1·P2 는 기본(비공개) 프로젝트.

```java
@Test void 이슈_첨부를_복사하면_호출자_소유_임시_파일이_된다()   // IssueAttachmentService.upload 로 PNG 첨부 → POST copy {source:"issue", issueKey:"P1-1", attachmentId} → 201, uploaded_by=ownerId, ATTACHMENT, expires_at 있음, 바이트 같음
@Test void 본문_이미지도_복사된다()                            // seedStaged + 이슈 본문 ![](file:id) 로 연결된 본문 이미지 → copy 201
@Test void 복사본을_다른_프로젝트_댓글에_넣으면_그_프로젝트만_읽는_사용자가_이미지를_받는다() {
  // P1 첨부 → owner 가 copy → P2 이슈에 commentService.create(ownerId, p2IssueId, new CreateCommentRequest("![화면](file:" + copyId + ")"))
  // 댓글 본문에 /issue-images/{copyId} 주소(P2 키)가 들어간다
  assertThat(bodyImageService.load(p2OnlyId, p2Key, copyId).mimeType()).isEqualTo("image/png");
  // 대조: P2 만 읽는 사용자는 원본(P1) 첨부를 읽을 수 없다
  assertThatThrownBy(() -> attachmentService.resolveViewFileId(p2OnlyId, p1Key, 1, origId)).isInstanceOf(ProjectAccessDeniedException.class);
}
@Test void 읽을_수_없는_프로젝트의_첨부는_403_행이_생기지_않는다()   // p2OnlyId 로 P1 첨부 copy → 403, filesUploadedBy(p2OnlyId) 그대로
@Test void 다른_이슈의_첨부_번호는_404_행이_생기지_않는다()          // P1-2 키 + P1-1 첨부 id → 404
@Test void issueKey_나_attachmentId_가_없으면_400()                  // {source:"issue", issueKey:"P1-1"} → 400
@Test void 키_꼴이_아닌_issueKey_는_400()                           // "abc" → 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./gradlew test --tests "com.workplace.issue.service.IssueStagedCopySourceTest"`
Expected: FAIL — `복사할 수 없는 source 입니다: issue`(400) 로 성공 케이스가 깨진다.

- [ ] **Step 3: Implement `IssueStagedCopySource#resolveReadableFileId(long callerId, StagedCopySource src) : long`** — 필수 `issueKey`·`attachmentId` 확인(없으면 `IllegalArgumentException("source 'issue' 는 issueKey·attachmentId 가 필요합니다")`), `IssueKeys.parse` 실패면 `IllegalArgumentException("이슈 키 형식이 아닙니다: <키>")`, 그다음 `attachmentService.resolveViewFileId(callerId, key.projectKey(), key.number(), attachmentId)` 를 그대로 돌려준다(가드를 새로 만들지 않는다 — 주석에 「/text·/view 와 같은 가드」).

- [ ] **Step 4: Run tests to verify they pass**

Run: `./gradlew test --tests "com.workplace.issue.service.IssueStagedCopySourceTest" --tests "com.workplace.issue.service.IssueBodyFilePlaceholderTest"`
Expected: PASS

- [ ] **Step 5: Commit** — `git add` 위 두 파일, 메시지 `feat(api/issue): 이슈 첨부·본문 이미지를 스테이징 파일로 복사할 수 있다 (WP-1705)`, 본문 `- WP-1705` + 「다른 프로젝트 댓글에 넣은 복사본은 그 프로젝트 권한만으로 보인다」 + trailer.

---

### Task 3: issue_chat·drive 출처

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/chat/service/IssueChatStagedCopySource.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/drive/service/DriveStagedCopySource.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/chat/IssueChatStagedCopySourceTest.java`
- Test: `apps/workplace-api/src/test/java/com/workplace/drive/service/DriveStagedCopySourceTest.java`

**Interfaces:**
- Consumes: Task 1 포트·엔드포인트.
- Uses: `IssueStakeholderLookup#findIssue(String projectKey, int number) : Optional<IssueRow>`(`id()`), `ChatThreadRepository#findIdByIssueId(long) : Optional<Long>`, `ChatMessageAttachmentService#resolveContentFileId(long callerId, long threadId, long messageId, long fileId) : long`(= `findGuardedStoredFile`: 스레드 읽기 + 메시지 소속(아니면 400) + 그 메시지에 붙은 첨부·삭제 메시지 제외(아니면 404)), `DriveFileService#resolveViewFileId(long callerId, long driveFileId) : long`(없는·휴지통 404, 공간 VIEWER 이상).
- Produces: `IssueChatStagedCopySource`(`source()` = `"issue_chat"`), `DriveStagedCopySource`(`source()` = `"drive"`), 둘 다 `@Component`.

- [ ] **Step 1: Write the failing tests**
  - `IssueChatStagedCopySourceTest` — `ChatFixtures.setup()` 과 `ChatMessageAttachmentIntegrationTest#sendImage` 방식으로 첨부 메시지를 만든다.

```java
@Test void 이슈_챗_첨부를_복사하면_호출자_소유_임시_파일이_된다()        // reporter 가 {source:"issue_chat", issueKey, messageId, attachmentId} → 201, 바이트 같음
@Test void 프로젝트를_읽을_수_없는_사용자는_403_행이_생기지_않는다()    // outsiderId → 403
@Test void 메시지에서_뺀_첨부나_삭제된_메시지의_첨부는_404_행이_생기지_않는다()
@Test void 다른_스레드의_메시지_id_는_400()
@Test void 챗_스레드가_없는_이슈는_404()
@Test void messageId_가_없으면_400()
```
  - `DriveStagedCopySourceTest` — `DriveFileServiceTest#uploadAs` 방식으로 개인·공유 공간 파일을 만든다.

```java
@Test void 드라이브_파일을_복사하면_현재_버전_바이트의_임시_파일이_된다()  // 새 버전을 올린 파일 → 최신 버전 바이트와 같다
@Test void 공간_멤버가_아니면_거절되고_행이_생기지_않는다()
@Test void 휴지통의_파일은_404_행이_생기지_않는다()
@Test void driveFileId_가_없으면_400()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./gradlew test --tests "com.workplace.chat.IssueChatStagedCopySourceTest" --tests "com.workplace.drive.service.DriveStagedCopySourceTest"`
Expected: FAIL — 성공 케이스가 400(`복사할 수 없는 source`).

- [ ] **Step 3: Implement**
  - `IssueChatStagedCopySource#resolveReadableFileId`: 필수 `issueKey`·`messageId`·`attachmentId`(문구는 Task 2 와 같은 꼴), `IssueKeys.parse`(실패 400) → `findIssue`(없으면 `IssueNotFoundException(projectKey, number)`) → `findIdByIssueId`(없으면 `ChatAttachmentNotFoundException(attachmentId)` — 스레드가 없으면 첨부도 없다; **만들지 않는다**) → `resolveContentFileId(...)`. 주석: 다운로드(/content)와 같은 가드를 쓰는 이유(뺀 첨부·삭제 메시지 차단, WP-1680) — 스레드로 이슈 첨부를 읽는 /text 가드는 쓰지 않는다(이슈 첨부는 source issue 로 복사).
  - `DriveStagedCopySource#resolveReadableFileId`: 필수 `driveFileId` → `driveFileService.resolveViewFileId(callerId, driveFileId)`.

- [ ] **Step 4: Run tests to verify they pass** — Step 2 명령 + `--tests "com.workplace.chat.ChatMessageAttachmentIntegrationTest"`. Expected: PASS

- [ ] **Step 5: Commit** — 메시지 `feat(api/file): 이슈 챗 첨부·드라이브 파일도 스테이징 파일로 복사할 수 있다 (WP-1705)`, 본문 `- WP-1705` + 「다운로드·미리보기와 같은 가드로 읽기 권한을 본다」 + trailer.

---

### Task 4: MCP `upload_file` source 갈래 + 클라이언트 + 소비 앱 테스트

**Files:**
- Modify: `packages/mcp-tools-shared/src/attachment-tools.ts` (`SOURCE_FIELDS`·`IDENTIFIER_FIELDS` 검사를 export 함수로)
- Modify: `packages/mcp-tools-shared/src/file-tools.ts`
- Modify: `packages/mcp-tools-shared/src/tool-client.ts` (`FileToolClient`, 새 타입)
- Modify: `packages/mcp-tools-shared/src/rest-client.ts` (스테이징 절, ~691)
- Modify: 정의 크기를 맞추려 줄이는 도구 설명 파일들(측정 뒤 정한다)
- Modify: `packages/mcp-tools-shared/README.md` (「파일 첨부 (WP-421~424)」 표·AI Chat 줄, 새 절 「첨부 복사 (WP-1705)」, 「도구 수와 정의 크기」의 「지금」 줄)
- Test: `packages/mcp-tools-shared/src/file-tools.test.ts`, `packages/mcp-tools-shared/src/rest-client.test.ts`, `packages/mcp-tools-shared/src/tool-naming.test.ts`(바꾸지 않고 통과만)
- Test: `apps/workplace-ai-agent/src/mcp/tools.test.ts` (mock `copyToStagedFile`, assistant·recurring 테스트)

**Interfaces:**
- Consumes: Task 1 `POST /api/v1/staged-files/copy` 본문 `{source, issueKey?, messageId?, attachmentId?, driveFileId?, name?}` → `StagedFileResponse`.
- Produces:
  - `attachment-tools.ts`: `export function checkSourceFields(v: Record<string, unknown> & { source: keyof typeof SOURCE_FIELDS }, ctx: z.RefinementCtx): void` — 지금 `readFileInputFor` 의 superRefine 본문(필수 누락·남는 식별자 두 문구)을 옮긴 것. `readFileInputFor` 도 이것을 부른다.
  - `tool-client.ts`: `export type StagedCopySourceName = 'issue' | 'issue_chat' | 'drive'`; `export interface StagedCopyRequest { source: StagedCopySourceName; issueKey?: string; messageId?: number; attachmentId?: number; driveFileId?: number; name?: string }`; `FileToolClient#copyToStagedFile(req: StagedCopyRequest): Promise<StagedFile>`.
  - `file-tools.ts`: `uploadFileInput` = `z.object({ name: nullAsOmitted(z.string().min(1).max(255)), content: nullAsOmitted(z.string()), source: nullAsOmitted(z.enum(['issue','issue_chat','drive'])), issueKey: nullAsOmitted(z.string().min(1)), messageId/attachmentId/driveFileId: nullAsOmitted(z.number().int().positive()) }).superRefine(...)` — 최상위는 `z.object`(shape 등록) 그대로. 식별자 이름·모양은 `read_file` 과 같다(`.describe()` 없음 — 정의 크기).

- [ ] **Step 1: Write the failing tests** (`file-tools.test.ts`, mock 에 `copyToStagedFile: vi.fn().mockResolvedValue({ fileId: 77, name: '화면.png', sizeBytes: 16, mimeType: 'image/png', expiresAt: 't' })`)

```ts
it('upload_file source: issue 첨부를 복사한다 — name 생략 가능, 응답은 StagedFile 그대로', async () => {
  const out = await tool.handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
  expect(c.copyToStagedFile).toHaveBeenCalledWith({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
  expect(JSON.parse(out as string)).toEqual({ fileId: 77, name: '화면.png', sizeBytes: 16, mimeType: 'image/png', expiresAt: 't' });
  expect(c.createStagedTextFile).not.toHaveBeenCalled(); expect(c.createStagedUploadLink).not.toHaveBeenCalled();
});
it('upload_file source: name 을 주면 함께 보낸다(issue_chat·drive 도 같은 표로 필수 필드)', ...)   // issue_chat → {issueKey,messageId,attachmentId}, drive → {driveFileId}, name '캡처.png'
it('upload_file source: 필수 식별자가 빠지면 API 를 부르지 않고 거절', ...)                        // {source:'issue_chat', issueKey:'WP-1', attachmentId:5} → rejects /messageId/
it('upload_file source: 다른 source 의 식별자·content 와 함께 주면 거절', ...)                     // {source:'drive', driveFileId:1, issueKey:'WP-1'} → /issueKey/ ; {source:'drive', driveFileId:1, content:'x'} → /content/
it('upload_file: source 없이 식별자만 주거나 name 이 없으면 거절', ...)                            // {issueKey:'WP-1', attachmentId:5, name:'a'} → 거절 ; {content:'x'} → /name/
it('upload_file source: null 로 채운 쓰지 않는 인자는 생략으로 본다', async () => {               // Review Focus 5
  await tool.handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 5, name: null, content: null, driveFileId: null, messageId: null });
  expect(c.copyToStagedFile).toHaveBeenCalledWith({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
});
it('upload_file(allowUploadLink: false): source 갈래는 허용하고, content·source 둘 다 없을 때만 링크 거절', ...)
it('upload_file 설명: 두 판 모두 source 문장이 한 번 있다', ...)                                  // toContain(UPLOAD_FILE_SOURCE_DESCRIPTION)
```
  `rest-client.test.ts`: `copyToStagedFile({ source: 'issue_chat', issueKey: 'WP-1', messageId: 3, attachmentId: 5 })` → `http.post('/staged-files/copy', 같은 객체)` 를 부르고 `data` 를 돌려준다(스레드 조회 GET 없음 — 서버가 issueKey 로 스레드를 찾는다).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @smart-workplace/mcp-tools-shared exec vitest run src/file-tools.test.ts src/rest-client.test.ts`
Expected: FAIL — `copyToStagedFile` 미호출·스키마 거절.

- [ ] **Step 3: Implement**
  - `file-tools.ts`: superRefine 규칙 — source 가 있으면 `content` 금지(「source 와 content 는 함께 줄 수 없습니다 — 복사는 source, 새 텍스트는 content 로 따로 부르세요.」) + `checkSourceFields`; source 가 없으면 식별자 금지(「issueKey·messageId·attachmentId·driveFileId 는 source 와 함께만 줍니다.」) + `name` 필수(「name 이 필요합니다(source 로 복사할 때만 생략할 수 있습니다).」). 핸들러 순서: content 전용 판의 링크 거절 조건을 `source == null && content == null` 로 바꾼다(문구는 그대로 두고 끝에 「읽을 수 있는 첨부는 source 로 복사할 수 있습니다.」 를 더한다) → parse → source 면 null/undefined 를 뺀 `StagedCopyRequest` 로 `copyToStagedFile` → `JSON.stringify` 그대로.
  - 설명: `export const UPLOAD_FILE_SOURCE_DESCRIPTION = 'With source + ids as read_file: copies that readable attachment (name optional).'`(영어 한 문장, 측정 뒤 더 줄여도 된다). 링크 판 = `CONTENT + ' ' + SOURCE + ' ' + LINK`, content 전용 판 = 머리말 + `CONTENT + ' ' + SOURCE`. 머리말 `UPLOAD_FILE_CONTENT_ONLY_PREFIX` 는 「AI Chat 에서는 content(직접 쓴 텍스트)나 source(읽을 수 있는 첨부 복사)로 첨부용 파일을 만들 때만 쓰세요. …」로 고친다(ai-agent 경로라 상한 측정 대상 아님, `^AI Chat 에서는` 유지). 파일 머리 주석·`uploadFileInput` 주석에 WP-1705 갈래를 적는다.
  - `rest-client.ts`: `async copyToStagedFile(req) { return (await http.post('/staged-files/copy', req)).data; }` (스테이징 절 주석에 WP-1705).

- [ ] **Step 4: Run tests to verify they pass** — Step 2 명령. Expected: PASS

- [ ] **Step 5: 정의 크기 맞추기**

Run: `pnpm --filter @smart-workplace/mcp-tools-shared exec vitest run src/tool-naming.test.ts src/tool-apps.test.ts src/tool-definitions.test.ts src/plugin-skills.test.ts`
Expected: 처음엔 `tool-naming` 이 17,700 초과로 FAIL(실패 메시지의 perTool 상위 10개를 본다). 상한은 그대로 두고 큰 설명부터 뜻을 바꾸지 않고 줄여 ≤ 17,700 으로 PASS 시킨다 — 「도구 설명 쓰는 법」 기준(스키마가 이미 말하는 것·출력에 그대로 보이는 필드 나열·같은 뜻 되풀이부터). `read_file` 를 설명에서 부르는 것은 같은 앱(issue·messaging·wiki)이라 `tool-apps.test.ts` 교차 참조 규칙에 걸리지 않아야 한다 — 걸리면 문장을 바꾼다(`CROSS_REF_ALLOWED` 에 넣지 않는다).

- [ ] **Step 6: README** — 「파일 첨부」 표의 `upload_file` 행에 `{source, issueKey?, messageId?, attachmentId?, driveFileId?, name?}` 갈래와 서버 `POST /staged-files/copy`(201, 25MB) 를, 「AI Chat」 줄에 「content 또는 source(복사)」를 더한다. 새 절 `### 첨부 복사 (WP-1705)` 를 「읽은 알림 보관 (WP-1689)」 뒤에: 목적(VOC 반영 댓글에 개발 이슈 캡처 넣기), 출처 셋과 가드, 복사본 모양, 필수 필드 표 재사용(`checkSourceFields`), 그리고 `- **크기**: 17,690 토큰(97개) → <측정값> 토큰(97개, 상한 17,700 그대로). 줄인 것: <도구·문구 목록>` . 「도구 수와 정의 크기」의 「지금(…)」 줄을 WP-1705 측정값으로 바꾼다.

- [ ] **Step 7: 소비 앱 테스트** — 공유 패키지를 먼저 빌드한다(앱은 `dist` 를 import).
  - `apps/workplace-ai-agent/src/mcp/tools.test.ts`: `client()` mock 에 `copyToStagedFile: vi.fn().mockResolvedValue({ fileId: 951, name: '화면.png', sizeBytes: 16, mimeType: 'image/png', expiresAt: 't' })` 를 더하고(WP-1705 주석) 테스트 둘을 더한다.

```ts
it('반복 회차(recurring) upload_file 은 source 로 읽을 수 있는 첨부를 복사한다(content 없이도 링크 거절 없음, WP-1705)', async () => {
  const c = client();
  const out = await find(buildTools(c, AGENT_ID, 'recurring'), 'upload_file').handler({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
  expect(c.sc.copyToStagedFile).toHaveBeenCalledWith({ source: 'issue', issueKey: 'WP-1', attachmentId: 5 });
  expect(JSON.parse(out as string)).toMatchObject({ fileId: 951 });
  expect(c.sc.createStagedUploadLink).not.toHaveBeenCalled();
});
```
  기존 「upload_file 은 assistant 에만 …」 테스트의 단언(`/^AI Chat 에서는/`, 링크 거절 문구, curl 없음)은 그대로 통과해야 한다. 「에이전트 신원 프로필에는 없다」 테스트는 바꾸지 않는다.

Run:
```bash
pnpm --filter @smart-workplace/mcp-tools-shared build
pnpm --filter @smart-workplace/mcp-tools-shared test
pnpm --filter @smart-workplace/workplace-ai-agent exec vitest run src/mcp/tools.test.ts src/agent/subagents
pnpm --filter @smart-workplace/workplace-mcp test
```
Expected: 모두 PASS(workplace-mcp 스냅샷은 도구 이름·kind 만이라 바뀌지 않는다 — 바뀌면 이유를 확인하고 `-u` 로 갱신).

- [ ] **Step 8: Commit** — `git add packages/mcp-tools-shared apps/workplace-ai-agent/src/mcp/tools.test.ts` (+ 줄인 설명 파일), 메시지 `feat(mcp): upload_file 이 읽을 수 있는 첨부를 source 로 복사해 스테이징한다 (WP-1705)`, 본문 `- WP-1705` + 「서버 안 AI 도 이슈 첨부 캡처를 다른 이슈 댓글 이미지로 넣을 수 있다」 + 「정의 크기 상한은 그대로 두고 설명을 줄였다」 + trailer.

---

### Task 5: work-loop 스킬 — 사용 가이드·안내 자료 요청, project.md, 버전 0.1.53

**Files:**
- Modify: `plugins/genia-works/skills/work-loop/process-issue.md` (맨 위 갈래 ~8, 8번 「반영 근거」 ~75-81, 11번 ~112, 기차 7번 ~131, 「분류」 1번 ~137-146, 새 절 「안내 자료 요청」을 「분류 (분류 역할 AI)」 바로 앞에)
- Modify: `plugins/genia-works/skills/work-loop/SKILL.md` (4번 「역할별 처리 파일」 표 ~191 맨 위 행)
- Modify: `.work-loop/project.md` (10절 아래 소절)
- Modify: `plugins/genia-works/README.md` (~131 분류 역할 AI 줄 뒤에 한 줄)
- Modify: `plugins/genia-works/.claude-plugin/plugin.json`, `plugins/genia-works/.codex-plugin/plugin.json`(0.1.53), `apps/workplace-web/public/claude/marketplace.json`, `apps/workplace-web/src/lib/pluginGuide.test.ts`(`genia-works--v0.1.53`) — WP-1659 버전 올림과 같은 파일 묶음
- Test: `plugins/genia-works/tests/skills.test.mjs` (WP-1565 분류 테스트 뒤)

**Interfaces:** 없음(문서). 다른 태스크와 독립.

- [ ] **Step 1: Write the failing tests** (`skills.test.mjs`, 기존 `section`·`lineWith`·`assertBefore`·`workLoop`·`pi` 사용)

```js
// WP-1705 사용 가이드 — 요청자가 그대로 따라 할 순서가 반영 보고에 없으면 VOC 반영 댓글이 「바뀌었다」만 말한다.
test('process-issue.md: 반영 근거에 사용 가이드가 있고 11번 보고 맨 앞에 들어간다 (WP-1705)', () => {
  assert.ok(pi.includes('**사용 가이드**'));
  assert.match(pi, /보고는 맨 앞에 \*\*사용자에게 보이는 변화\*\*[^\n]*\*\*확인 위치\*\*[^\n]*\*\*사용 가이드\*\*[^\n]*\*\*첫 글\*\*/);
  assert.ok(section(pi, '\n### 기차 (저장소가 켰을 때)\n', '\n### 분류 (분류 역할 AI)\n').includes('사용 가이드'));
});
const guideReq = section(pi, '\n### 안내 자료 요청\n', '\n### 분류 (분류 역할 AI)\n');
test('process-issue.md: 안내 자료 요청은 라벨로 분류보다 먼저 가르고, 구현 흐름 없이 확인해 REVIEW 로 보고한다 (WP-1705)', () => {
  const top = section(pi, '**먼저 갈래를 본다**', '\n**notes 파일**');
  assertBefore(top, '「안내 자료 요청」', '「분류 (분류 역할 AI)」');
  for (const s of ['「안내 자료 요청」 소절의 라벨', '다른 프로젝트 이슈는 열지 않는다', '워크트리·브랜치·커밋·PR·게이트 없이',
    "state: 'REVIEW'", '결함 이슈를 만들어', '개발 대기열 라벨을 붙여 넘기고 담당에서 빠진다', '받은 AI 도 이 절로 처리한다']) {
    assert.ok(guideReq.includes(s), `「${s}」 가 없다`);
  }
  assert.ok(triage.includes('안내 자료 요청 라벨이 붙은 이슈는 분류 요청이 아니다'));
});
test('SKILL.md 4번: 안내 자료 요청 라벨 이슈는 역할과 상관없이 맨 위 행으로 process-issue.md 「안내 자료 요청」 (WP-1705)', () => {
  const s4 = section(workLoopSkill, '\n### 4. 이슈를 하나씩 처리\n', '\n### 5. 다음 확인\n');
  assert.match(s4, /^\| 누구든 \| [^\n]*「안내 자료 요청」[^\n]*\|$/m);
  assertBefore(s4, '| 누구든 |', '| 기획 역할 AI |');
});
test('project.md: 안내 자료 요청 소절 — 라벨·제목·본문 머리·담당·분류 제외 (WP-1705)', () => {
  const project = readFileSync(new URL('../../../.work-loop/project.md', import.meta.url), 'utf8');
  const s = section(project, '\n### 안내 자료 요청 (WP-1705)\n', '\n## 11. 기획 역할 AI\n');
  for (const t of ['`VOC 반영 안내`', '「VOC 반영 안내 — <VOC 키> <요약>」',
    '이 이슈는 VOC 가 아니라 출시된 개발 이슈의 사용 안내 자료를 받는 WP 작업입니다. VOC(WPV)는 열어 보지 않아도 되도록 필요한 내용을 모두 아래에 적었습니다.',
    'AI 팀장', '분류 대상이 아니다', '이 이슈의 검토 대기 보고(REVIEW)', '연결된 WPV 키는 열지 않는다']) {
    assert.ok(s.includes(t), `「${t}」 가 없다`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:plugin`
Expected: FAIL — 새 네 테스트(사용 가이드·안내 자료 요청 절 없음).

- [ ] **Step 3: Write the text** (아래 따옴표 문구는 테스트가 고정한다 — 그대로 쓴다)
  - **맨 위 갈래**: 「내가 만든 PR 이거나 PR 이 없으면 1번부터다 — 」 앞에 문장 하나: 「PR 이 없고 이 이슈에 `.work-loop/project.md` 「안내 자료 요청」 소절의 라벨이 붙어 있으면 1~11번·분류 대신 아래 「안내 자료 요청」 절을 따른다(역할과 상관없이 — 분류 판별보다 먼저).」
  - **8번 반영 근거**: 「**어디서 보나**」 다음 하위 항목으로 「**사용 가이드**: 요청자가 그대로 따라 할 1·2·3 단계를 사용자 말투로 쓴다(어느 메뉴에서 무엇을 눌러 무엇을 보는지). 화면 변화가 없으면 「확인 방법과 결과」가 그 자리다.」
  - **11번**: 「보고는 맨 앞에 **사용자에게 보이는 변화**(…)와 **확인 위치**(…)」 뒤, 같은 줄의 「**첫 글**」 앞에 「, **사용 가이드**(8번 「반영 근거」)」를 넣는다.
  - **기차 7번**: 「맨 앞 사용자에게 보이는 변화·확인 위치·사용 가이드」로 맞춘다.
  - **새 절** `### 안내 자료 요청` (「분류 (분류 역할 AI)」 바로 앞):
    - 머리: 「`.work-loop/project.md` 「안내 자료 요청」 소절의 라벨이 붙은 이슈다(맨 위 갈래). 출시된 개발 이슈의 반영 보고가 요청자에게 옮기기에 모자랄 때 이슈 관리자가 만든다 — 본문이 무엇이 모자란지와 대상 개발 이슈를 적는다. 라벨 이름은 그 소절에서 읽는다(저장소마다 다를 수 있다).」
    - 「본문이 VOC 키를 적어도 다른 프로젝트 이슈는 열지 않는다 — 필요한 내용은 본문에 있다. 대상 개발 이슈(같은 프로젝트)는 읽어도 된다.」
    - 「워크트리·브랜치·커밋·PR·게이트 없이 확인한다 — MAIN(앞당긴 origin/main)을 `work-loop` 스택으로 띄우거나(「우선순위」의 스택 이름, 다 쓰면 내린다) project.md 의 운영 검증 테넌트에서, 본문이 「모자란 것」으로 적은 항목만 해 본다. 캡처는 8번 「반영 근거」 형식이다.」
    - 「결과는 `report_agent_work({ issueKey, state: 'REVIEW', note: '안내 자료 — <대상 이슈 키> <한 줄>', message })` 로 이 이슈의 검토 대기 보고에 낸다 — 맨 앞에 바뀐 것·확인 위치·사용 가이드(요청자 말투), 캡처는 `fileIds`(첫 글에 함께).」
    - 「확인 중 기능이 동작하지 않으면 결함 이슈를 만들어(「우선순위」의 대기열 라벨, 재현 캡처 첨부) 이 이슈에 관련으로 연결하고(`add_issue_relation`), 보고에 그 사실을 적는다.」
    - 「직접 하기 어려우면(설정이 큰 데이터 준비 등) 개발 대기열 라벨을 붙여 넘기고 담당에서 빠진다(이유 댓글 — 「우선순위」의 이슈 만들기·담당 바꾸기). 받은 AI 도 이 절로 처리한다.」
    - 「notes 파일은 같은 곳에 두고 `마지막 완료 단계` 는 「안내 자료: 확인 중」·「안내 자료: 보고함」으로 적는다.」
  - **분류 1번**: 조건 목록 뒤(「PR 리뷰 할당 …과는 겹치지 않는다.」 앞)에 「안내 자료 요청 라벨이 붙은 이슈는 분류 요청이 아니다(맨 위 갈래가 「안내 자료 요청」 절로 먼저 보낸다).」
  - **SKILL.md 4번 표** 맨 위 행: `| 누구든 | `.work-loop/project.md` 「안내 자료 요청」 소절의 라벨이 붙고 PR 이 없는 이슈 | `process-issue.md` 「안내 자료 요청」 — 구현·커밋·PR 없이 확인해 검토 대기로 보고 |`. 같은 4번의 멈출 지점 나열에 「안내 자료를 보고함(REVIEW)」은 REVIEW 에 들어 따로 더하지 않는다.
  - **project.md** 10절 끝(11절 앞)에 `### 안내 자료 요청 (WP-1705)`:
    - 「반영 보고(`process-issue.md` 8번 「반영 근거」·11번)가 요청자에게 옮기기에 모자랄 때 이슈 관리자가 AI 팀장에게 맡기는 WP 작업 이슈(TASK)다. 처리는 `process-issue.md` 「안내 자료 요청」.」
    - 「- 라벨: `VOC 반영 안내`」 / 「- 제목: 「VOC 반영 안내 — <VOC 키> <요약>」」 / 「- 담당: AI 팀장(10절 username)」
    - 「- 본문 맨 앞: 「이 이슈는 VOC 가 아니라 출시된 개발 이슈의 사용 안내 자료를 받는 WP 작업입니다. VOC(WPV)는 열어 보지 않아도 되도록 필요한 내용을 모두 아래에 적었습니다.」 그 아래 대상 개발 이슈 키·모자란 것·요청자가 알고 싶은 것.」
    - 「- 팀장은 라벨로 알아본다 — 분류 대상이 아니다(분류 판별 전에 갈린다). 결과는 이 이슈의 검토 대기 보고(REVIEW)에 쓰고, 본문에 적힌 연결된 WPV 키는 열지 않는다.」
  - **README**: 분류 역할 AI 줄 뒤에 「- **안내 자료 요청**(`.work-loop/project.md` 「안내 자료 요청」 소절의 라벨): 출시된 이슈의 반영 보고가 모자랄 때 받는 작업입니다. 맡은 AI 는 구현하지 않고 main 을 띄워(또는 운영 검증 테넌트에서) 모자란 항목을 확인해 바뀐 것·확인 위치·사용 가이드와 캡처를 검토 대기 보고로 냅니다. 검토 대기 보고 맨 앞에는 요청자가 따라 할 사용 가이드도 둡니다(WP-1705).」
  - 버전 네 곳을 0.1.53 으로.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test:plugin
pnpm --filter @smart-workplace/mcp-tools-shared exec vitest run src/plugin-skills.test.ts
pnpm --filter @smart-workplace/workplace-web exec vitest run src/lib/pluginGuide.test.ts
```
Expected: 모두 PASS(WP-1659 의 11번 정규식도 그대로 통과 — 「사용 가이드」를 「확인 위치」와 「첫 글」 사이에 넣었기 때문).

- [ ] **Step 5: Commit** — `git add plugins/genia-works .work-loop/project.md apps/workplace-web/public/claude/marketplace.json apps/workplace-web/src/lib/pluginGuide.test.ts`, 메시지 `feat(plugin): work-loop 검토 보고에 사용 가이드를 넣고 안내 자료 요청을 구현 없이 처리한다 (WP-1705)`, 본문 `- WP-1705` + 「VOC 반영 안내 라벨 이슈는 분류하지 않고 main 을 띄워 확인한 결과를 검토 대기로 보고한다」 + 「플러그인 0.1.53」 + trailer.

---

## 마무리 확인

- `apps/workplace-api`: `./gradlew test --tests "com.workplace.file.*" --tests "com.workplace.issue.service.*" --tests "com.workplace.chat.*" --tests "com.workplace.drive.service.*" --tests "com.workplace.architecture.*"` PASS.
- 라이브(work-loop 8번): 격리 스택에서 MCP `upload_file({source:'issue', issueKey:<P1 이슈>, attachmentId})` → 받은 fileId 로 P2 이슈에 `add_comment` `![](file:<id>)` → P2 만 읽는 사용자로 웹에서 댓글 이미지가 보이는지 캡처(스펙 완료 기준 1).

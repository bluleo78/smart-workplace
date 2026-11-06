package com.workplace.drive.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.repository.DriveFileRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.TableField;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1399: 드라이브에 저장한 첨부(같은 file 행 공유, WP-722)의 드라이브 쪽을 영구 삭제해도 원본 첨부의 file 은 만료되지 않는다. 공유 file 에
 * 만료가 걸리던 경로는 휴지통 비우기와 공간 삭제다. 만료가 없으면 만료 스윕이 건드릴 수 없으므로 스윕은 돌리지 않고 expires_at 을 본다.
 */
@Transactional
class DrivePurgeSharedAttachmentTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService driveFileService;
  @Autowired DriveFileRepository driveFileRepo;
  @Autowired DriveTrashService trashService;
  @Autowired DriveLinkService linkService;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepo;
  @Autowired IssueAttachmentService issueAttachmentService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  @TempDir Path tempDir;

  private long me;

  /** RLS GUC — 모든 시드·삭제를 테넌트#1 로. */
  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    me = TestFixtures.createHuman(dsl);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 이슈 첨부를 실제 import 로 드라이브에 저장 → 휴지통 비우기: 첨부 유지. 이어 원본 첨부를 지우면 file 행까지 정리된다(예전과 같음). */
  @Test
  void 이슈_첨부를_드라이브에_저장후_휴지통을_비워도_첨부가_남는다() throws IOException {
    SeededIssue issue = seedIssue();
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    bind(ISSUE_ATTACHMENT.FILE_ID, ISSUE_ATTACHMENT.ISSUE_ID, issue.id(), fileId);
    long spaceId = newSpace();
    DriveFileResponse imported = linkService.importAttachment(me, spaceId, null, fileId);

    driveFileService.delete(me, imported.id());
    trashService.emptyTrash(me, spaceId);

    assertThat(dsl.fetchExists(DRIVE_FILE, DRIVE_FILE.ID.eq(imported.id()))).isFalse();
    assertKept(fileId, blob, ISSUE_ATTACHMENT.FILE_ID);

    issueAttachmentService.delete(me, issue.projectKey(), 1, fileId);
    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(fileId))).isFalse();
  }

  /** 이슈 첨부 → 드라이브 저장 → 팀 공간 삭제: 첨부 유지. */
  @Test
  void 이슈_첨부를_드라이브에_저장후_공간을_삭제해도_첨부가_남는다() throws IOException {
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    bind(ISSUE_ATTACHMENT.FILE_ID, ISSUE_ATTACHMENT.ISSUE_ID, seedIssue().id(), fileId);
    long spaceId = newSpace();
    saveToDrive(spaceId, fileId);

    spaceService.deleteTeamSpace(me, spaceId);

    assertKept(fileId, blob, ISSUE_ATTACHMENT.FILE_ID);
  }

  /** 이슈 채팅 첨부 → 드라이브 저장 → 휴지통 비우기: 첨부 유지. */
  @Test
  void 이슈_채팅_첨부는_드라이브_휴지통을_비워도_남는다() throws IOException {
    long threadId =
        dsl.insertInto(CHAT_THREAD)
            .set(CHAT_THREAD.ISSUE_ID, seedIssue().id())
            .returning(CHAT_THREAD.ID)
            .fetchOne()
            .getId();
    long messageId =
        dsl.insertInto(CHAT_MESSAGE)
            .set(CHAT_MESSAGE.THREAD_ID, threadId)
            .set(CHAT_MESSAGE.AUTHOR_ID, me)
            .set(CHAT_MESSAGE.BODY, "첨부")
            .returning(CHAT_MESSAGE.ID)
            .fetchOne()
            .getId();
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    bind(CHAT_MESSAGE_ATTACHMENT.FILE_ID, CHAT_MESSAGE_ATTACHMENT.MESSAGE_ID, messageId, fileId);

    emptyTrashOfSharedCopy(fileId);

    assertKept(fileId, blob, CHAT_MESSAGE_ATTACHMENT.FILE_ID);
  }

  /** 팀 채팅 메시지 첨부 → 드라이브 저장 → 휴지통 비우기: 첨부 유지. */
  @Test
  void 팀_채팅_첨부는_드라이브_휴지통을_비워도_남는다() throws IOException {
    long channelId = channelRepo.insertPublic("wp1399-" + suffix(), me);
    channelService.join(me, channelId);
    long messageId = messageService.create(me, channelId, new CreateMessageRequest("첨부")).id();
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    bind(MESSAGE_ATTACHMENT.FILE_ID, MESSAGE_ATTACHMENT.MESSAGE_ID, messageId, fileId);

    emptyTrashOfSharedCopy(fileId);

    assertKept(fileId, blob, MESSAGE_ATTACHMENT.FILE_ID);
  }

  /** 홈 대화 첨부 → (같은 file 을 가리키는 드라이브 파일) → 휴지통 비우기: 첨부 유지. */
  @Test
  void 홈_첨부는_드라이브_휴지통을_비워도_남는다() throws IOException {
    UUID sessionId =
        dsl.insertInto(HOME_SESSION)
            .set(HOME_SESSION.USER_ID, me)
            .returning(HOME_SESSION.ID)
            .fetchOne()
            .getId();
    long messageId =
        dsl.insertInto(HOME_MESSAGE)
            .set(HOME_MESSAGE.SESSION_ID, sessionId)
            .set(HOME_MESSAGE.ROLE, "USER")
            .set(HOME_MESSAGE.CONTENT, "첨부")
            .returning(HOME_MESSAGE.ID)
            .fetchOne()
            .getId();
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    bind(HOME_MESSAGE_ATTACHMENT.FILE_ID, HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, messageId, fileId);

    emptyTrashOfSharedCopy(fileId);

    assertKept(fileId, blob, HOME_MESSAGE_ATTACHMENT.FILE_ID);
  }

  /** 회귀 확인 — 개별 영구삭제도 공유 첨부를 만료시키지 않는다. */
  @Test
  void 회귀_개별_영구삭제도_공유_첨부를_만료시키지_않는다() throws IOException {
    Path blob = blob();
    long fileId = seedPermanentFile(blob);
    bind(ISSUE_ATTACHMENT.FILE_ID, ISSUE_ATTACHMENT.ISSUE_ID, seedIssue().id(), fileId);
    long driveFileId = saveToDrive(newSpace(), fileId);

    driveFileService.delete(me, driveFileId);
    trashService.purgeFile(me, driveFileId);

    assertKept(fileId, blob, ISSUE_ATTACHMENT.FILE_ID);
  }

  /** 대조 — 드라이브에만 있던 파일은 휴지통 비우기로 만료 표시(= 다음 스윕의 회수 대상)가 붙는다. */
  @Test
  void 드라이브_전용_파일은_휴지통_비우기로_만료된다() throws Exception {
    long spaceId = newSpace();
    DriveFileResponse uploaded =
        driveFileService.upload(
            me,
            spaceId,
            null,
            new MockMultipartFile("file", "only.txt", "text/plain", "hello".getBytes()));

    driveFileService.delete(me, uploaded.id());
    trashService.emptyTrash(me, spaceId);

    assertThat(expiresAtOf(uploaded.fileId()))
        .isNotNull()
        .isBeforeOrEqualTo(OffsetDateTime.now(ZoneOffset.UTC));
  }

  // ─── 도우미 ────────────────────────────────────────────────────────────

  /** 프로젝트 키와 이슈 id(번호는 1). */
  private record SeededIssue(String projectKey, long id) {}

  /** 프로젝트 + 이슈 1건을 만든다(이슈 번호 1). */
  private SeededIssue seedIssue() {
    var proj = projectService.create(me, new CreateProjectRequest(uniqueKey(), "P-1399", "x"));
    long issueId =
        IssueSeeds.insert(issueRepo, baseDsl, proj.id(), 1, "공유 첨부", null, "MID", null, me).id();
    return new SeededIssue(proj.key(), issueId);
  }

  /**
   * 첨부 정션 행을 넣는다 — 네 정션 모두 (file_id, 소유 행 id, attached_by) 모양이라 열만 받아 한 도우미로 쓴다. attached_by 는 나.
   */
  private void bind(
      TableField<?, Long> fileIdCol, TableField<?, Long> ownerCol, long ownerId, long fileId) {
    var table = fileIdCol.getTable();
    dsl.insertInto(table)
        .set(fileIdCol, fileId)
        .set(ownerCol, ownerId)
        .set(table.field("attached_by", Long.class), me)
        .execute();
  }

  /** 첨부 file 을 가리키는 드라이브 파일을 만들어 휴지통에 넣고 휴지통을 비운다. */
  private void emptyTrashOfSharedCopy(long fileId) {
    long spaceId = newSpace();
    long driveFileId = saveToDrive(spaceId, fileId);
    driveFileService.delete(me, driveFileId);
    trashService.emptyTrash(me, spaceId);
  }

  /**
   * importAttachment 와 같은 상태(같은 file 로 버전 행 없는 drive_file + 영구화) — 가져오기 제공자가 없는 홈 첨부도 같은 상태로 만든다.
   */
  private long saveToDrive(long spaceId, long fileId) {
    long driveFileId = driveFileRepo.insert(spaceId, null, fileId, "shared-" + suffix() + ".txt");
    driveFileRepo.promoteFile(fileId);
    return driveFileId;
  }

  /** 정션 행·file 행·디스크 blob 이 남고 file 이 영구(expires_at NULL)인지. */
  private void assertKept(long fileId, Path blob, TableField<?, Long> junctionFileId) {
    assertThat(dsl.fetchExists(junctionFileId.getTable(), junctionFileId.eq(fileId))).isTrue();
    assertThat(dsl.fetchExists(FILE, FILE.ID.eq(fileId))).isTrue();
    assertThat(blob).exists();
    assertThat(expiresAtOf(fileId)).isNull();
  }

  /** file 행의 만료 시각(없으면 null). */
  private OffsetDateTime expiresAtOf(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.EXPIRES_AT);
  }

  /** 디스크에 실제 blob 을 만든다(절대경로 — FileStore 가 레거시 경로로 다룬다). */
  private Path blob() throws IOException {
    Path p = tempDir.resolve("blob-" + suffix() + ".txt");
    Files.writeString(p, "attachment");
    return p;
  }

  /** 첨부에 묶인 상태처럼 만료 없는 ATTACHMENT file 행. */
  private long seedPermanentFile(Path blob) {
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "shared.txt")
        .set(FILE.STORED_NAME, blob.getFileName().toString())
        .set(FILE.STORAGE_PATH, blob.toString())
        .set(FILE.MIME_TYPE, "text/plain")
        .set(FILE.SIZE_BYTES, 10L)
        .set(FILE.CATEGORY, "ATTACHMENT")
        .set(FILE.UPLOADED_BY, me)
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 내가 소유한 팀 드라이브 공간을 새로 만든다. */
  private long newSpace() {
    return spaceService.createTeamSpace(me, "공유-" + suffix()).id();
  }

  /** 이름·키 충돌을 피하는 8자 무작위 접미사 — 공유 테스트 DB 에 남은 행과 겹치지 않게 한다. */
  private static String suffix() {
    return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
  }

  /** 프로젝트 키(대문자·숫자 10자) — 다른 테스트가 남긴 프로젝트와 겹치지 않게 접미사를 붙인다. */
  private static String uniqueKey() {
    return ("WS" + suffix().toUpperCase()).substring(0, 10);
  }
}

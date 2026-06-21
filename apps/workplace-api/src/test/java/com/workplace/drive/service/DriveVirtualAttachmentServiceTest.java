// DriveVirtualAttachmentServiceTest.java — 가상 첨부 뷰 + import 통합 테스트
package com.workplace.drive.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.VirtualAttachmentPage;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.jooq.tables.File;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** DriveLinkService.virtualAttachments + importAttachment 통합 테스트. */
@Transactional
class DriveVirtualAttachmentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveLinkService service;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepo;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 유저 INSERT. */
  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + s + "@x.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** drive_space + 멤버 시드. */
  private long seedSpace(long owner, String role) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "TestSpace-" + UUID.randomUUID().toString().substring(0, 4))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();
    return space;
  }

  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  private ProjectResponse newProject(long ownerId, String prefix) {
    return projectService.create(
        ownerId, new CreateProjectRequest(uniqueKey(prefix), "P-" + prefix, "x"));
  }

  /** FILE 행 삽입 (만료 없음). */
  private long seedFile(long uploaderId, String name, OffsetDateTime expiresAt) {
    var F = File.FILE;
    var insert =
        dsl.insertInto(F)
            .set(F.ORIGINAL_NAME, name)
            .set(F.STORED_NAME, UUID.randomUUID().toString())
            .set(F.MIME_TYPE, "text/plain")
            .set(F.SIZE_BYTES, 100L)
            .set(F.CATEGORY, "ATTACHMENT")
            .set(F.STORAGE_PATH, "/tmp/test/" + UUID.randomUUID())
            .set(F.UPLOADED_BY, uploaderId)
            .set(F.CREATED_AT, OffsetDateTime.now());
    if (expiresAt != null) {
      insert = insert.set(F.EXPIRES_AT, expiresAt);
    }
    return insert.returning(F.ID).fetchOne().getId();
  }

  /** ISSUE_ATTACHMENT 직접 삽입. */
  private void bindIssueAttachment(long fileId, long issueId, long userId, OffsetDateTime at) {
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, fileId)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issueId)
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, userId)
        .set(ISSUE_ATTACHMENT.ATTACHED_AT, at)
        .execute();
  }

  /** MESSAGE_ATTACHMENT 직접 삽입. */
  private void bindMessageAttachment(long fileId, long messageId, long userId, OffsetDateTime at) {
    dsl.insertInto(MESSAGE_ATTACHMENT)
        .set(MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_BY, userId)
        .set(MESSAGE_ATTACHMENT.ATTACHED_AT, at)
        .execute();
  }

  // ─── virtualAttachments 테스트 ───────────────────────────────────────

  /** ALL 모드: ISSUE + MESSAGE 첨부를 attachedAt DESC 로 병합. */
  @Test
  void virtualAttachments_all_mergesIssueAndMessage_descOrder() {
    long caller = seedUser("caller");

    // 이슈 첨부 (오래된)
    ProjectResponse proj = newProject(caller, "VA");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "VA 이슈", null, "MID", null, caller);
    long issueFileId = seedFile(caller, "issue.txt", null);
    OffsetDateTime olderAt = OffsetDateTime.now(ZoneOffset.UTC).minusHours(2);
    bindIssueAttachment(issueFileId, issue.id(), caller, olderAt);

    // 메시지 첨부 (최신)
    long channelId = channelRepo.insertPublic("va-ch", caller);
    channelService.join(caller, channelId);
    var msg = messageService.create(caller, channelId, new CreateMessageRequest("hi"));
    long msgFileId = seedFile(caller, "msg.txt", null);
    OffsetDateTime newerAt = OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(10);
    bindMessageAttachment(msgFileId, msg.id(), caller, newerAt);

    VirtualAttachmentPage page = service.virtualAttachments(caller, "ALL", null, null, 50);

    assertThat(page.items()).hasSizeGreaterThanOrEqualTo(2);
    // 최신(메시지)이 앞, 오래된(이슈)이 뒤
    var items = page.items();
    // msg.txt 가 issue.txt 보다 앞에 있어야 함
    int msgIdx = -1, issueIdx = -1;
    for (int i = 0; i < items.size(); i++) {
      if (items.get(i).fileId() == msgFileId) msgIdx = i;
      if (items.get(i).fileId() == issueFileId) issueIdx = i;
    }
    assertThat(msgIdx).isGreaterThanOrEqualTo(0);
    assertThat(issueIdx).isGreaterThanOrEqualTo(0);
    assertThat(msgIdx).isLessThan(issueIdx);
  }

  /** source=ISSUE 필터: 메시지 첨부 제외, 이슈 첨부만 반환. */
  @Test
  void virtualAttachments_sourceFilter_issueOnly() {
    long caller = seedUser("caller2");

    ProjectResponse proj = newProject(caller, "SF");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "SF 이슈", null, "MID", null, caller);
    long issueFileId = seedFile(caller, "issue-sf.txt", null);
    bindIssueAttachment(issueFileId, issue.id(), caller, OffsetDateTime.now(ZoneOffset.UTC));

    long channelId = channelRepo.insertPublic("sf-ch", caller);
    channelService.join(caller, channelId);
    var msg = messageService.create(caller, channelId, new CreateMessageRequest("sf"));
    long msgFileId = seedFile(caller, "msg-sf.txt", null);
    bindMessageAttachment(msgFileId, msg.id(), caller, OffsetDateTime.now(ZoneOffset.UTC));

    VirtualAttachmentPage page = service.virtualAttachments(caller, "ISSUE", null, null, 50);

    assertThat(page.items()).allMatch(item -> item.sourceType().equals("ISSUE"));
    assertThat(page.items().stream().anyMatch(item -> item.fileId() == issueFileId)).isTrue();
    assertThat(page.items().stream().noneMatch(item -> item.fileId() == msgFileId)).isTrue();
  }

  /** q 필터: 파일명 부분일치. */
  @Test
  void virtualAttachments_qFilter() {
    long caller = seedUser("caller3");

    ProjectResponse proj = newProject(caller, "QF2");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "QF 이슈", null, "MID", null, caller);
    long matchId = seedFile(caller, "report-2024.pdf", null);
    long noMatchId = seedFile(caller, "readme.txt", null);
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    bindIssueAttachment(matchId, issue.id(), caller, now);
    bindIssueAttachment(noMatchId, issue.id(), caller, now.minusSeconds(1));

    VirtualAttachmentPage page = service.virtualAttachments(caller, "ALL", "report", null, 50);

    assertThat(page.items().stream().anyMatch(i -> i.fileId() == matchId)).isTrue();
    assertThat(page.items().stream().noneMatch(i -> i.fileId() == noMatchId)).isTrue();
  }

  /** 커서 페이지네이션: nextCursor 존재 시 다음 페이지 조회. */
  @Test
  void virtualAttachments_cursor_paginates() {
    long caller = seedUser("caller4");

    ProjectResponse proj = newProject(caller, "CP");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "CP 이슈", null, "MID", null, caller);

    // 3개 첨부, 시간 간격 두기
    OffsetDateTime base = OffsetDateTime.now(ZoneOffset.UTC).minusHours(1);
    for (int i = 0; i < 3; i++) {
      long fid = seedFile(caller, "page-" + i + ".txt", null);
      bindIssueAttachment(fid, issue.id(), caller, base.plusMinutes(i));
    }

    // limit=2 → nextCursor 있어야 함
    VirtualAttachmentPage page1 = service.virtualAttachments(caller, "ISSUE", null, null, 2);
    assertThat(page1.items()).hasSize(2);
    assertThat(page1.nextCursor()).isNotNull();

    // 커서로 다음 페이지
    VirtualAttachmentPage page2 =
        service.virtualAttachments(caller, "ISSUE", null, page1.nextCursor(), 2);
    assertThat(page2.items()).hasSizeGreaterThanOrEqualTo(1);
  }

  /** 다른 프로젝트 멤버가 아닌 caller 는 해당 첨부 미노출. */
  @Test
  void virtualAttachments_otherProjectExcluded() {
    long owner = seedUser("owner5");
    long stranger = seedUser("stranger5");

    ProjectResponse proj = newProject(owner, "OE");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "OE 이슈", null, "MID", null, owner);
    long fileId = seedFile(owner, "owner-file.txt", null);
    bindIssueAttachment(fileId, issue.id(), owner, OffsetDateTime.now(ZoneOffset.UTC));

    // stranger 는 proj 멤버가 아님 → 결과에 포함 안됨
    VirtualAttachmentPage page = service.virtualAttachments(stranger, "ALL", null, null, 50);
    assertThat(page.items().stream().noneMatch(i -> i.fileId() == fileId)).isTrue();
  }

  /**
   * limit=0 또는 음수를 서비스에 직접 전달해도 예외 없이 빈 페이지를 반환해야 함. (컨트롤러는 Math.max(1, ...) 로 클램프하지만, 서비스 직접 호출 경로
   * 방어 검증)
   */
  @Test
  void virtualAttachments_zeroLimit_doesNotThrow() {
    long caller = seedUser("callerZ");
    // 데이터 없이도 limit=0 으로 호출 시 예외 없어야 함
    VirtualAttachmentPage page = service.virtualAttachments(caller, "ALL", null, null, 0);
    assertThat(page).isNotNull();
    assertThat(page.items()).isNotNull();
  }

  // ─── importAttachment 테스트 ─────────────────────────────────────────

  /** EDITOR가 접근 가능한 첨부 import → drive_file 생성, FILE 행 유지, expires_at NULL. */
  @Test
  void importAttachment_editor_createsNewDriveFile() {
    long caller = seedUser("editor");
    long spaceId = seedSpace(caller, "EDITOR");

    // 이슈 첨부 시드
    ProjectResponse proj = newProject(caller, "IM");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "import 이슈", null, "MID", null, caller);
    // expires_at 설정(비-null)으로 시드 → promote 후 null 확인
    OffsetDateTime expiry = OffsetDateTime.now(ZoneOffset.UTC).plusDays(1);
    long fileId = seedFile(caller, "import.txt", expiry);
    bindIssueAttachment(fileId, issue.id(), caller, OffsetDateTime.now(ZoneOffset.UTC));

    // import 전 file 행 수, drive_file 행 수 캡처
    int fileCountBefore = dsl.fetchCount(FILE);
    int driveFileCountBefore = dsl.fetchCount(DRIVE_FILE);

    DriveFileResponse resp = service.importAttachment(caller, spaceId, null, fileId);

    // FILE 행 수 불변(복사 없음)
    assertThat(dsl.fetchCount(FILE)).isEqualTo(fileCountBefore);
    // drive_file +1
    assertThat(dsl.fetchCount(DRIVE_FILE)).isEqualTo(driveFileCountBefore + 1);
    // 응답 검증
    assertThat(resp.fileId()).isEqualTo(fileId);
    assertThat(resp.name()).isEqualTo("import.txt");
    // expires_at NULL(영구화)
    var F = File.FILE;
    OffsetDateTime expiresAt =
        dsl.select(F.EXPIRES_AT).from(F).where(F.ID.eq(fileId)).fetchOne(F.EXPIRES_AT);
    assertThat(expiresAt).isNull();
  }

  /** VIEWER → DriveForbiddenException. */
  @Test
  void importAttachment_viewer_forbidden() {
    long viewer = seedUser("viewer6");
    long spaceId = seedSpace(viewer, "VIEWER");

    ProjectResponse proj = newProject(viewer, "VB");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "VB 이슈", null, "MID", null, viewer);
    long fileId = seedFile(viewer, "vb.txt", null);
    bindIssueAttachment(fileId, issue.id(), viewer, OffsetDateTime.now(ZoneOffset.UTC));

    assertThatThrownBy(() -> service.importAttachment(viewer, spaceId, null, fileId))
        .isInstanceOf(DriveForbiddenException.class);
  }

  /** EDITOR 지만 fileId 가 접근 불가(다른 프로젝트) → DriveForbiddenException. */
  @Test
  void importAttachment_inaccessibleFile_forbidden() {
    long editor = seedUser("editor7");
    long spaceId = seedSpace(editor, "EDITOR");

    // 다른 유저의 파일 — editor 는 해당 프로젝트 비멤버
    long stranger = seedUser("str7");
    ProjectResponse otherProj = newProject(stranger, "ST");
    IssueRow otherIssue = issueRepo.insert(otherProj.id(), 1, "남의 이슈", null, "MID", null, stranger);
    long otherFileId = seedFile(stranger, "other.txt", null);
    bindIssueAttachment(otherFileId, otherIssue.id(), stranger, OffsetDateTime.now(ZoneOffset.UTC));

    assertThatThrownBy(() -> service.importAttachment(editor, spaceId, null, otherFileId))
        .isInstanceOf(DriveForbiddenException.class);
  }
}

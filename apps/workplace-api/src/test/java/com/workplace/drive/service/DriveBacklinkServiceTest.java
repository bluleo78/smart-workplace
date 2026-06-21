// DriveBacklinkServiceTest.java — 백링크 서비스 통합 테스트
package com.workplace.drive.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.BacklinkResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
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
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** DriveLinkService.backlinks 통합 테스트. VIEWER 이상만 접근, 접근 가능 소스만 반환, 비접근 소스는 숨김. */
@Transactional
class DriveBacklinkServiceTest extends IntegrationTestBase {

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

  /** 유저 INSERT (테스트 격리용). */
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

  /** drive_space + 멤버 + FILE + drive_file 시드. */
  private long seedDriveFile(long owner, String role) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "TestSpace")
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, role)
        .execute();

    var F = File.FILE;
    long fileId =
        dsl.insertInto(F)
            .set(F.ORIGINAL_NAME, "test.txt")
            .set(F.STORED_NAME, UUID.randomUUID().toString())
            .set(F.MIME_TYPE, "text/plain")
            .set(F.SIZE_BYTES, 10L)
            .set(F.STORAGE_PATH, "/tmp/" + UUID.randomUUID())
            .set(F.UPLOADED_BY, owner)
            .set(F.CREATED_AT, OffsetDateTime.now())
            .returning(F.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "test.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
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

  /** FILE 행 직접 삽입 (디스크 I/O 없음). */
  private long seedFile(long uploaderId, String name) {
    var F = File.FILE;
    return dsl.insertInto(F)
        .set(F.ORIGINAL_NAME, name)
        .set(F.STORED_NAME, UUID.randomUUID().toString())
        .set(F.MIME_TYPE, "text/plain")
        .set(F.SIZE_BYTES, 100L)
        .set(F.CATEGORY, "ATTACHMENT")
        .set(F.STORAGE_PATH, "/tmp/test/" + UUID.randomUUID())
        .set(F.UPLOADED_BY, uploaderId)
        .set(F.CREATED_AT, OffsetDateTime.now())
        .returning(F.ID)
        .fetchOne()
        .getId();
  }

  // ── 테스트 ──────────────────────────────────────────────────────────

  /** 이슈 ref(접근 가능) + 메시지 ref(접근 불가) → 이슈 링크만 반환. */
  @Test
  void backlinks_returnsOnlyAccessibleSources() {
    long viewer = seedUser("viewer");
    long stranger = seedUser("stranger");
    long driveFileId = seedDriveFile(viewer, "OWNER");

    // ISSUE ref: viewer 가 멤버인 프로젝트
    ProjectResponse proj = newProject(viewer, "BL");
    IssueRow issue = issueRepo.insert(proj.id(), 1, "백링크 이슈", null, "MID", null, viewer);
    long fileId = seedFile(viewer, "attach.txt");
    dsl.insertInto(ISSUE_ATTACHMENT)
        .set(ISSUE_ATTACHMENT.FILE_ID, fileId)
        .set(ISSUE_ATTACHMENT.ISSUE_ID, issue.id())
        .set(ISSUE_ATTACHMENT.ATTACHED_BY, viewer)
        .set(ISSUE_ATTACHMENT.ATTACHED_AT, OffsetDateTime.now())
        .execute();
    service.createLink(viewer, driveFileId, "ISSUE", issue.id());

    // MESSAGE ref: stranger 채널(viewer 비멤버)
    long channelId = channelRepo.insertPublic("stranger-ch", stranger);
    channelService.join(stranger, channelId);
    var msg = messageService.create(stranger, channelId, new CreateMessageRequest("hi"));
    service.createLink(viewer, driveFileId, "MESSAGE", msg.id());

    List<BacklinkResponse> result = service.backlinks(viewer, driveFileId);

    // ISSUE 만 반환, MESSAGE 는 숨김(viewer 가 채널 멤버 아님)
    assertThat(result).hasSize(1);
    assertThat(result.get(0).sourceType()).isEqualTo("ISSUE");
    assertThat(result.get(0).sourceId()).isEqualTo(issue.id());
    assertThat(result.get(0).label()).isNotBlank();
    assertThat(result.get(0).deepLink()).isNotBlank();
  }

  /** 파일 비멤버(VIEWER 미만) → DriveSpaceNotFoundException(존재 은닉). */
  @Test
  void backlinks_nonMember_throwsSpaceNotFound() {
    long owner = seedUser("owner");
    long stranger = seedUser("stranger");
    long driveFileId = seedDriveFile(owner, "OWNER");

    assertThatThrownBy(() -> service.backlinks(stranger, driveFileId))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }

  /** 존재하지 않는 driveFileId → DriveFileNotFoundException. */
  @Test
  void backlinks_unknownFile_throwsNotFound() {
    long user = seedUser("u");
    assertThatThrownBy(() -> service.backlinks(user, 99999999L))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  /** ref 없음 → 빈 리스트 반환(예외 없음). */
  @Test
  void backlinks_noRefs_returnsEmpty() {
    long owner = seedUser("owner");
    long driveFileId = seedDriveFile(owner, "OWNER");

    List<BacklinkResponse> result = service.backlinks(owner, driveFileId);
    assertThat(result).isEmpty();
  }
}

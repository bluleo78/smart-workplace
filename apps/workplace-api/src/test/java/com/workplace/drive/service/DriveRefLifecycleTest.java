package com.workplace.drive.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.jooq.tables.File;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.MessageService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈/메시지 삭제 시 drive_file_ref 고아 정리 + drive_file CASCADE 검증.
 *
 * <p>- 이슈 soft-delete → ref purge 확인 - 메시지 soft-delete → ref purge 확인 - drive_file 행 삭제(empty
 * trash) → ref CASCADE 삭제 확인
 */
@Transactional
class DriveRefLifecycleTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveLinkService driveLinkService;
  @Autowired IssueService issueService;
  @Autowired IssueTypeRepository issueTypeRepository;
  @Autowired ProjectService projectService;
  @Autowired MessageService messageService;
  @Autowired ChannelService channelService;
  @Autowired ChannelRepository channelRepo;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ── 픽스처 헬퍼 ──────────────────────────────────────────────────────────

  /** 유니크 사용자 INSERT 후 id 반환. */
  private long seedUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  /** 드라이브 파일(스페이스+file 행+drive_file 행) 생성 후 drive_file.id 반환. */
  private long seedDriveFile(long owner) {
    long spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "S-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();

    // 실존 임시 파일 경로 — getLinkContent 가 실제 파일을 읽으므로 필요
    Path tmp;
    try {
      tmp = Files.createTempFile("driveref-lifecycle-", ".txt");
      Files.writeString(tmp, "hello");
    } catch (IOException e) {
      throw new RuntimeException(e);
    }

    var F = File.FILE;
    long fileId =
        dsl.insertInto(F)
            .set(F.ORIGINAL_NAME, "a.txt")
            .set(F.STORED_NAME, "x-" + UUID.randomUUID())
            .set(F.MIME_TYPE, "text/plain")
            .set(F.SIZE_BYTES, 5L)
            .set(F.STORAGE_PATH, tmp.toString())
            .set(F.UPLOADED_BY, owner)
            .set(F.CREATED_AT, OffsetDateTime.now())
            .returning(F.ID)
            .fetchOne()
            .getId();

    return dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  /**
   * 이슈에 드라이브 링크를 추가한 뒤 이슈를 soft-delete 하면 drive_file_ref 행이 정리되어야 한다.
   *
   * <p>이슈 soft-delete 는 source_id(=issue.id) 에 대한 FK 가 없으므로, IssueService.softDelete 내 명시적
   * purgeSource 호출로 정리한다.
   */
  @Test
  void issueSoftDelete_purgesDriveRefs() {
    // given: 오너 + 프로젝트 + 이슈 + 드라이브 파일
    long owner = seedUser("owner");
    String key =
        "LCT" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    projectService.create(owner, new CreateProjectRequest(key, "LifecycleTest", "x"));

    var issue =
        issueService.create(
            owner, key, new CreateIssueRequest("이슈1", null, null, null, null, null, null));
    int issueNumber = issue.number();

    long driveFileId = seedDriveFile(owner);
    // 이슈 내부 drive link: DriveLinkService 직접 사용 (cross-domain link)
    driveLinkService.createLink(owner, driveFileId, "ISSUE", issue.id());

    // 링크 존재 확인
    List<DriveLinkResponse> before = driveLinkService.listLinks("ISSUE", issue.id());
    assertThat(before).hasSize(1);

    // when: 이슈 soft-delete
    issueService.softDelete(owner, key, issueNumber);

    // then: ref 정리됨
    List<DriveLinkResponse> after = driveLinkService.listLinks("ISSUE", issue.id());
    assertThat(after).isEmpty();

    // DB 행 직접 검증
    int refCount =
        dsl.fetchCount(
            DRIVE_FILE_REF,
            DRIVE_FILE_REF.SOURCE_TYPE.eq("ISSUE").and(DRIVE_FILE_REF.SOURCE_ID.eq(issue.id())));
    assertThat(refCount).isZero();
  }

  /**
   * 메시지에 드라이브 링크를 추가한 뒤 메시지를 soft-delete 하면 drive_file_ref 행이 정리되어야 한다.
   *
   * <p>메시지 soft-delete 는 source_id(=message.id) 에 대한 FK 가 없으므로, MessageService.delete 내 명시적
   * purgeSource 호출로 정리한다.
   */
  @Test
  void messageSoftDelete_purgesDriveRefs() {
    // given: 유저 + 채널 + 메시지 + 드라이브 파일
    long author = seedUser("msg-author");
    long channelId = channelRepo.insertPublic("lifecycle-채널", author);
    channelService.join(author, channelId);

    long driveFileId = seedDriveFile(author);
    // 메시지 작성 시 드라이브 링크 포함
    var msg =
        messageService.create(
            author,
            channelId,
            new CreateMessageRequest("본문", null, List.of(), List.of(driveFileId)));
    long messageId = msg.id();

    // 링크 존재 확인
    List<DriveLinkResponse> before = driveLinkService.listLinks("MESSAGE", messageId);
    assertThat(before).hasSize(1);

    // when: 메시지 soft-delete
    messageService.delete(author, messageId);

    // then: ref 정리됨
    List<DriveLinkResponse> after = driveLinkService.listLinks("MESSAGE", messageId);
    assertThat(after).isEmpty();

    // DB 행 직접 검증
    int refCount =
        dsl.fetchCount(
            DRIVE_FILE_REF,
            DRIVE_FILE_REF.SOURCE_TYPE.eq("MESSAGE").and(DRIVE_FILE_REF.SOURCE_ID.eq(messageId)));
    assertThat(refCount).isZero();
  }

  /**
   * 부모 이슈 soft-delete 시 자식 SUBTASK 에 연결된 drive_file_ref 도 함께 정리되어야 한다.
   *
   * <p>IssueService.softDelete → softDeleteChildren cascade 시 자식 id 를 먼저 수집해 purgeSources("ISSUE",
   * childIds) 로 배치 삭제하는 경로를 검증한다.
   */
  @Test
  void issueSoftDelete_purgesChildSubtaskRefs() {
    // given: 오너 + 팀 프로젝트(SUBTASK 유형 존재) + 부모 TASK + 자식 SUBTASK
    long owner = seedUser("child-purge-owner");
    String key =
        "CP" + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
    var project =
        projectService.create(owner, new CreateProjectRequest(key, "ChildPurgeTest", "x"));

    // 부모 이슈 (TASK — typeId null = 기본 TASK)
    var parent =
        issueService.create(
            owner, key, new CreateIssueRequest("부모이슈", null, null, null, null, null, null));

    // SUBTASK typeId 조회
    Long subtaskTypeId =
        issueTypeRepository.findByProjectAndName(project.id(), "SUBTASK").orElseThrow().id();

    // 자식 SUBTASK 이슈 생성 (parentNumber = 부모 번호)
    var child =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest(
                "자식서브태스크", null, null, null, null, subtaskTypeId, parent.number()));

    // 자식에 드라이브 링크 추가
    long driveFileId = seedDriveFile(owner);
    driveLinkService.createLink(owner, driveFileId, "ISSUE", child.id());

    // 링크 존재 확인
    assertThat(driveLinkService.listLinks("ISSUE", child.id())).hasSize(1);

    // when: 부모 soft-delete (자식도 cascade soft-delete)
    issueService.softDelete(owner, key, parent.number());

    // then: 자식의 drive_file_ref 도 정리됨
    assertThat(driveLinkService.listLinks("ISSUE", child.id())).isEmpty();

    int refCount =
        dsl.fetchCount(
            DRIVE_FILE_REF,
            DRIVE_FILE_REF.SOURCE_TYPE.eq("ISSUE").and(DRIVE_FILE_REF.SOURCE_ID.eq(child.id())));
    assertThat(refCount).isZero();
  }

  /**
   * drive_file 행을 삭제하면 drive_file_ref 행이 CASCADE 로 삭제되어야 한다 (V79 ON DELETE CASCADE).
   *
   * <p>이 테스트는 DB 스키마 제약이 올바르게 설정되어 있음을 검증한다.
   */
  @Test
  void driveFileDeletion_cascadesRefs() {
    // given: 드라이브 파일 + ref 행
    long owner = seedUser("cascade-owner");
    long driveFileId = seedDriveFile(owner);
    driveLinkService.createLink(owner, driveFileId, "ISSUE", 9999999L);

    // ref 존재 확인
    int beforeCount = dsl.fetchCount(DRIVE_FILE_REF, DRIVE_FILE_REF.DRIVE_FILE_ID.eq(driveFileId));
    assertThat(beforeCount).isEqualTo(1);

    // when: drive_file 행 삭제 (empty trash 시나리오)
    dsl.deleteFrom(DRIVE_FILE).where(DRIVE_FILE.ID.eq(driveFileId)).execute();

    // then: ref 도 CASCADE 삭제됨
    int afterCount = dsl.fetchCount(DRIVE_FILE_REF, DRIVE_FILE_REF.DRIVE_FILE_ID.eq(driveFileId));
    assertThat(afterCount).isZero();
  }
}

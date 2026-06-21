package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.*;

import com.workplace.drive.dto.DriveLinkResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.repository.ChannelRepository;
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

/** 메시지 driveFileIds 첨부 통합 테스트 — 생성 시 링크 바인딩, 비뷰어 거부, 목록 하이드레이션. */
@Transactional
class MessageDriveLinkTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired MessageService messageService;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ── 픽스처 헬퍼 ──────────────────────────────────────────────────────────

  /** 테스트 격리용 유니크 유저 INSERT. */
  private long seedUser() {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "drv_msg_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "DrvMsg" + suffix)
        .set(USER.EMAIL, "drvmsg_" + suffix + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널 생성 + 작성자 가입. */
  private long seedChannel(long userId, String name) {
    long channelId = channelRepo.insertPublic(name + "-" + UUID.randomUUID(), userId);
    channelService.join(userId, channelId);
    return channelId;
  }

  /** 드라이브 파일 생성(스페이스+파일 row 포함). owner 만 스페이스 멤버로 추가. viewer 는 의도적으로 비멤버로 두어 거부 시나리오에 활용. */
  private long seedDriveFileOwnedBy(long owner) {
    long space =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, "S-" + UUID.randomUUID().toString().substring(0, 6))
            .set(DRIVE_SPACE.OWNER_ID, owner)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, space)
        .set(DRIVE_SPACE_MEMBER.USER_ID, owner)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();

    Path tmp;
    try {
      tmp = Files.createTempFile("drivelink-msg-test-", ".txt");
      Files.writeString(tmp, "hello");
    } catch (IOException e) {
      throw new RuntimeException(e);
    }

    var F = com.workplace.jooq.tables.File.FILE;
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
        .set(DRIVE_FILE.SPACE_ID, space)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "a.txt")
        .returning(DRIVE_FILE.ID)
        .fetchOne()
        .getId();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  /**
   * create_driveLinkOnly_noBodyNoFiles_succeeds: 본문·첨부 없이 driveFileIds 만 있는 메시지는 거부되지 않아야 한다.
   * EmptyMessageException 발생 금지, 반환된 driveLinks 에 해당 파일이 포함되어야 한다.
   */
  @Test
  void create_driveLinkOnly_noBodyNoFiles_succeeds() {
    long u = seedUser();
    long ch = seedChannel(u, "drv-only");
    long df = seedDriveFileOwnedBy(u);

    MessageResponse created =
        messageService.create(u, ch, new CreateMessageRequest(null, null, List.of(), List.of(df)));

    assertThat(created.driveLinks()).extracting(DriveLinkResponse::driveFileId).containsExactly(df);
  }

  /** create_withDriveFileIds_attachesLink: driveFileIds 포함 메시지 작성 시 응답에 드라이브 링크가 채워진다. */
  @Test
  void create_withDriveFileIds_attachesLink() {
    long u = seedUser();
    long ch = seedChannel(u, "drv-link");
    long df = seedDriveFileOwnedBy(u);

    MessageResponse created =
        messageService.create(
            u, ch, new CreateMessageRequest("자료 공유", null, List.of(), List.of(df)));

    assertThat(created.driveLinks()).extracting(DriveLinkResponse::driveFileId).containsExactly(df);
  }

  /** create_driveFileWithoutViewer_rejected: 발신자가 드라이브 스페이스 비멤버이면 RuntimeException 발생. */
  @Test
  void create_driveFileWithoutViewer_rejected() {
    long owner = seedUser();
    long sender = seedUser();
    long ch = seedChannel(sender, "drv-denied");
    long df = seedDriveFileOwnedBy(owner); // sender 는 스페이스 비멤버

    assertThatThrownBy(
            () ->
                messageService.create(
                    sender, ch, new CreateMessageRequest("x", null, List.of(), List.of(df))))
        .isInstanceOf(RuntimeException.class);
  }

  /**
   * list_withDriveLink_hydratesInList: 드라이브 링크 포함 메시지를 만든 뒤 채널 목록 조회 시 driveLinks 가 채워진다(배치 하이드레이션
   * 검증).
   */
  @Test
  void list_withDriveLink_hydratesInList() {
    long u = seedUser();
    long ch = seedChannel(u, "drv-list");
    long df = seedDriveFileOwnedBy(u);

    MessageResponse created =
        messageService.create(
            u, ch, new CreateMessageRequest("목록 하이드레이션 테스트", null, List.of(), List.of(df)));

    var page = messageService.list(u, ch, null, 50);
    MessageResponse fromList =
        page.items().stream().filter(m -> m.id().equals(created.id())).findFirst().orElseThrow();

    assertThat(fromList.driveLinks())
        .extracting(DriveLinkResponse::driveFileId)
        .containsExactly(df);
  }
}

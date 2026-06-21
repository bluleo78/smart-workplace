package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.*;
import static org.assertj.core.api.Assertions.*;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
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

/** 채널 멤버십 기반 드라이브 링크 콘텐츠 다운로드 인가 통합 테스트. */
@Transactional
class MessageDriveLinkContentTest extends IntegrationTestBase {

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
        .set(USER.USERNAME, "drv_cnt_" + suffix)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "DrvCnt" + suffix)
        .set(USER.EMAIL, "drvcnt_" + suffix + "@example.com")
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

  /** 채널에 멤버 추가. */
  private void joinChannel(long userId, long channelId) {
    channelService.join(userId, channelId);
  }

  /** 드라이브 파일 생성(스페이스+파일 row 포함). owner 만 스페이스 멤버로 추가. 콘텐츠 읽기에 실제 temp 파일 필요. */
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

    // 실제 파일이 디스크에 존재해야 getFileContentTrusted 가 Resource 를 반환할 수 있다.
    Path tmp;
    try {
      tmp = Files.createTempFile("drivelink-cnt-test-", ".txt");
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

  /** channelMember_downloadsLinkedFile: 채널 멤버는 메시지에 링크된 드라이브 파일을 다운로드할 수 있다. */
  @Test
  void channelMember_downloadsLinkedFile() throws IOException {
    long owner = seedUser();
    long member = seedUser();
    long ch = seedChannel(owner, "c");
    joinChannel(member, ch);
    long df = seedDriveFileOwnedBy(owner);
    var msg =
        messageService.create(
            owner, ch, new CreateMessageRequest("x", null, List.of(), List.of(df)));

    var content = messageService.driveLinkContent(member, ch, msg.id(), df);
    assertThat(content.originalName()).isNotBlank();
  }

  /** nonMember_cannotDownload: 채널 비멤버는 다운로드 시 예외가 발생한다. */
  @Test
  void nonMember_cannotDownload() {
    long owner = seedUser();
    long stranger = seedUser();
    long ch = seedChannel(owner, "c");
    long df = seedDriveFileOwnedBy(owner);
    var msg =
        messageService.create(
            owner, ch, new CreateMessageRequest("x", null, List.of(), List.of(df)));
    assertThatThrownBy(() -> messageService.driveLinkContent(stranger, ch, msg.id(), df))
        .isInstanceOf(RuntimeException.class);
  }

  /**
   * crossChannel_messageFromOtherChannel_denied: 채널 A 멤버가 채널 B 의 messageId 를 채널 A 경로로 요청하면 거부된다 —
   * 순차 ID 를 이용한 크로스채널 정보 유출 차단.
   */
  @Test
  void crossChannel_messageFromOtherChannel_denied() {
    long owner = seedUser();
    long caller = seedUser();
    // 채널 A: caller 는 멤버
    long channelA = seedChannel(owner, "a");
    joinChannel(caller, channelA);
    // 채널 B: caller 는 비멤버, 메시지+드라이브 파일 존재
    long channelB = seedChannel(owner, "b");
    long df = seedDriveFileOwnedBy(owner);
    var msgInB =
        messageService.create(
            owner, channelB, new CreateMessageRequest("secret", null, List.of(), List.of(df)));

    // caller 는 채널 A 멤버이지만 채널 B 의 messageId 를 사용 → 거부되어야 함
    assertThatThrownBy(() -> messageService.driveLinkContent(caller, channelA, msgInB.id(), df))
        .isInstanceOf(RuntimeException.class);
  }
}

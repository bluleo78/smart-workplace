package com.workplace.drive.outbound;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.api.DriveChannelSpacePort;
import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.service.DriveFileService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelArchivedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelDeletingEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelMembershipChangedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelRenamedEvent;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 채널 이벤트 → drive 연동 공간 투영 리스너. */
@Transactional
class ChannelDriveListenerTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveChannelSpacePort port;
  @Autowired DriveSpaceMemberRepository members;
  @Autowired ApplicationEventPublisher publisher;
  @Autowired DriveFileService fileService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "cdl_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Cdl" + s)
        .set(USER.EMAIL, "cdl_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedChannel(long createdBy) {
    return dsl.insertInto(com.workplace.jooq.Tables.CHANNEL)
        .set(com.workplace.jooq.Tables.CHANNEL.CREATED_BY, createdBy)
        .returning(com.workplace.jooq.Tables.CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void membershipEvent_reconcilesExistingSpace() {
    long owner = seedUser();
    long newMember = seedUser();
    long channelId = seedChannel(owner);
    DriveSpaceResponse sp =
        port.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));
    assertThat(members.findRole(sp.id(), newMember)).isEmpty();

    // newMember 추가된 roster 이벤트 발행 → 리스너 reconcile.
    publisher.publishEvent(
        new ChannelMembershipChangedEvent(
            channelId,
            "채널",
            List.of(
                new ChannelMembershipChangedEvent.Member(owner, "OWNER"),
                new ChannelMembershipChangedEvent.Member(newMember, "MEMBER")),
            Instant.now()));

    assertThat(members.findRole(sp.id(), newMember)).contains("EDITOR");
  }

  @Test
  void archivedEvent_setsReadOnly() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    DriveSpaceResponse sp =
        port.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));

    publisher.publishEvent(new ChannelArchivedEvent(channelId, true, Instant.now()));

    // 보관 반영 — 재조회 시 archived true(같은 트랜잭션, 동기 리스너).
    DriveSpaceResponse after =
        port.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));
    assertThat(after.archived()).isTrue();
  }

  // WP-532 — 채널 이름을 바꾸면 연동 공간 이름도 바뀐다(드라이브 검색·첨부 모아보기·MCP 에 옛 이름이 남던 결함).
  @Test
  void renamedEvent_renamesLinkedSpace() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    DriveSpaceResponse sp =
        port.ensureChannelSpace(
            owner, channelId, "옛이름", List.of(new ChannelMemberSnapshot(owner, "OWNER")));

    publisher.publishEvent(new ChannelRenamedEvent(channelId, "새이름", Instant.now()));

    assertThat(
            dsl.select(com.workplace.jooq.Tables.DRIVE_SPACE.NAME)
                .from(com.workplace.jooq.Tables.DRIVE_SPACE)
                .where(com.workplace.jooq.Tables.DRIVE_SPACE.ID.eq(sp.id()))
                .fetchOne(com.workplace.jooq.Tables.DRIVE_SPACE.NAME))
        .isEqualTo("새이름");
  }

  // 이미 옛 이름으로 남은 공간(수정 전 이름 변경분)은 「파일」 탭이 ensure 할 때 지금 채널 이름으로 맞춘다.
  @Test
  void ensure_healsStaleSpaceName() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    port.ensureChannelSpace(
        owner, channelId, "옛이름", List.of(new ChannelMemberSnapshot(owner, "OWNER")));

    DriveSpaceResponse after =
        port.ensureChannelSpace(
            owner, channelId, "지금이름", List.of(new ChannelMemberSnapshot(owner, "OWNER")));

    assertThat(after.name()).isEqualTo("지금이름");
  }

  // WP-525 — 채널을 삭제하면 연동 공간도 팀 공간 삭제처럼 함께 영구 삭제된다(파일 행 cascade·blob 만료). 전에는 연결만 끊긴 채
  // 남아 예전 멤버가 계속 읽고 쓰고 외부 공유 링크도 살아 있었다.
  @Test
  void deletingEvent_hardDeletesLinkedSpaceAndExpiresBlobs() throws Exception {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    DriveSpaceResponse sp =
        port.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));
    var f =
        fileService.upload(
            owner,
            sp.id(),
            null,
            new MockMultipartFile("file", "회의록.txt", "text/plain", "hello".getBytes()));

    publisher.publishEvent(new ChannelDeletingEvent(channelId, owner, Instant.now()));

    assertThat(
            dsl.fetchExists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.DRIVE_SPACE)
                    .where(com.workplace.jooq.Tables.DRIVE_SPACE.ID.eq(sp.id()))))
        .isFalse();
    assertThat(
            dsl.select(com.workplace.jooq.Tables.FILE.EXPIRES_AT)
                .from(com.workplace.jooq.Tables.FILE)
                .where(com.workplace.jooq.Tables.FILE.ID.eq(f.fileId()))
                .fetchOne(com.workplace.jooq.Tables.FILE.EXPIRES_AT))
        .isNotNull();
  }

  // 연동 공간을 한 번도 만들지 않은 채널 삭제는 아무 일도 하지 않는다.
  @Test
  void deletingEvent_withoutLinkedSpace_isNoop() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    publisher.publishEvent(new ChannelDeletingEvent(channelId, owner, Instant.now()));
  }
}

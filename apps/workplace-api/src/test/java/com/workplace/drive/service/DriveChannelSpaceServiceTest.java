package com.workplace.drive.service;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 채널 연동 공간 서비스 — 생성·멱등·역할매핑·reconcile. */
@Transactional
class DriveChannelSpaceServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveChannelSpaceService service;
  @Autowired DriveSpaceMemberRepository members;

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
        .set(USER.USERNAME, "dcs_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Dcs" + s)
        .set(USER.EMAIL, "dcs_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long seedChannel(long createdBy) {
    return dsl.insertInto(CHANNEL)
        .set(CHANNEL.CREATED_BY, createdBy)
        .returning(CHANNEL.ID)
        .fetchOne()
        .getId();
  }

  /** ensure 생성 + 역할매핑(채널OWNER→OWNER, MEMBER→EDITOR) + 멱등. */
  @Test
  void ensure_createsAndMapsRoles_idempotent() {
    long owner = seedUser();
    long memberA = seedUser();
    long channelId = seedChannel(owner);
    List<ChannelMemberSnapshot> roster =
        List.of(
            new ChannelMemberSnapshot(owner, "OWNER"),
            new ChannelMemberSnapshot(memberA, "MEMBER"));

    DriveSpaceResponse a = service.ensureChannelSpace(owner, channelId, "채널", roster);
    assertThat(a.type()).isEqualTo("CHANNEL");
    assertThat(a.role()).isEqualTo("OWNER"); // 호출자=채널 OWNER
    assertThat(members.findRole(a.id(), memberA)).contains("EDITOR");

    // 2회 호출 멱등 — 동일 공간.
    DriveSpaceResponse b = service.ensureChannelSpace(memberA, channelId, "채널", roster);
    assertThat(b.id()).isEqualTo(a.id());
    assertThat(b.role()).isEqualTo("EDITOR"); // 호출자=MEMBER→EDITOR
  }

  /** syncChannelMembers — roster 변경 시 추가/제거 반영. 공간 없으면 no-op. */
  @Test
  void sync_reconcilesRoster_noopIfNoSpace() {
    long owner = seedUser();
    long memberA = seedUser();
    long memberB = seedUser();
    long channelId = seedChannel(owner);

    // 공간 없을 때 sync → no-op(예외 없음).
    service.syncChannelMembers(channelId, List.of(new ChannelMemberSnapshot(owner, "OWNER")));

    DriveSpaceResponse sp =
        service.ensureChannelSpace(
            owner,
            channelId,
            "채널",
            List.of(
                new ChannelMemberSnapshot(owner, "OWNER"),
                new ChannelMemberSnapshot(memberA, "MEMBER")));
    assertThat(members.findRole(sp.id(), memberA)).contains("EDITOR");

    // memberA 제거 + memberB 추가로 sync.
    service.syncChannelMembers(
        channelId,
        List.of(
            new ChannelMemberSnapshot(owner, "OWNER"),
            new ChannelMemberSnapshot(memberB, "MEMBER")));
    assertThat(members.findRole(sp.id(), memberA)).isEmpty(); // 제거됨
    assertThat(members.findRole(sp.id(), memberB)).contains("EDITOR"); // 추가됨
  }

  /** setChannelSpaceArchived — 보관 반영. 공간 없으면 no-op. */
  @Test
  void archived_reflected_noopIfNoSpace() {
    long owner = seedUser();
    long channelId = seedChannel(owner);
    service.setChannelSpaceArchived(channelId, true); // no-op

    DriveSpaceResponse sp =
        service.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));
    service.setChannelSpaceArchived(channelId, true);
    DriveSpaceResponse after =
        service.ensureChannelSpace(
            owner, channelId, "채널", List.of(new ChannelMemberSnapshot(owner, "OWNER")));
    assertThat(after.archived()).isTrue();
  }
}

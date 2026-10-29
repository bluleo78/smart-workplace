package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.dto.DmParticipant;
import com.workplace.messaging.exception.InactiveMemberException;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-723: 이 워크스페이스에서 정지된 구성원을 메시징이 구분한다 — DM 열기·채널 초대는 실제 이유(비활성)로 거절, 1:1 DM 전송 차단, DM 참여자·채널 멤버
 * 응답에 활성 여부.
 */
@Transactional
class InactiveMemberMessagingTest extends IntegrationTestBase {

  @Autowired DmService dmService;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired MessageService messageService;
  @Autowired DSLContext dsl;

  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /** tenant#1 ACTIVE 멤버 1명. */
  private long seedUser() {
    long id = seedUserWithoutMembership();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 이 워크스페이스 멤버십이 없는 사용자(다른 워크스페이스 사람과 같은 처지). */
  private long seedUserWithoutMembership() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "im_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Im" + s)
            .set(USER.EMAIL, "im_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    return id;
  }

  /** 관리자의 「활성 상태」 끄기와 같은 상태 — 이 워크스페이스 멤버십만 SUSPENDED. */
  private void suspend(long userId) {
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(1L)))
        .execute();
  }

  private static DmParticipant participant(List<DmParticipant> ps, long userId) {
    return ps.stream().filter(p -> p.userId() == userId).findFirst().orElseThrow();
  }

  @Test
  void openDm_withSuspendedMember_isRejectedAsInactive_notAsNonMember() {
    long me = seedUser();
    long left = seedUser();
    suspend(left);

    assertThatThrownBy(() -> dmService.createOrGet(me, List.of(left)))
        .isInstanceOf(InactiveMemberException.class)
        .hasMessage("비활성화된 구성원과는 대화를 시작할 수 없습니다");
  }

  @Test
  void openDm_withUserOutsideWorkspace_keepsNonMemberMessage() {
    long me = seedUser();
    long outsider = seedUserWithoutMembership();

    assertThatThrownBy(() -> dmService.createOrGet(me, List.of(outsider)))
        .isInstanceOf(InvalidDmRequestException.class)
        .hasMessage("현재 워크스페이스의 멤버가 아닌 사용자가 포함되어 있습니다");
  }

  @Test
  void dmParticipants_carryWorkspaceActive() {
    long me = seedUser();
    long other = seedUser();
    long dmId = dmService.createOrGet(me, List.of(other)).dm().id();
    suspend(other);

    var dm = dmService.listMyDms(me).stream().filter(d -> d.id() == dmId).findFirst().orElseThrow();
    assertThat(participant(dm.participants(), me).active()).isTrue();
    assertThat(participant(dm.participants(), other).active()).isFalse();
  }

  @Test
  void sendToOneToOneDm_whoseOtherMemberIsSuspended_isRejected() {
    long me = seedUser();
    long other = seedUser();
    long dmId = dmService.createOrGet(me, List.of(other)).dm().id();
    messageService.create(me, dmId, new CreateMessageRequest("정지 전 메시지"));
    suspend(other);

    assertThatThrownBy(() -> messageService.create(me, dmId, new CreateMessageRequest("정지 후 메시지")))
        .isInstanceOf(InactiveMemberException.class)
        .hasMessage("비활성화된 구성원에게는 메시지를 보낼 수 없습니다");
  }

  @Test
  void sendToGroupDm_withAnActiveMemberLeft_stillWorks() {
    long me = seedUser();
    long active = seedUser();
    long left = seedUser();
    long dmId = dmService.createOrGet(me, List.of(active, left)).dm().id();
    suspend(left);

    assertThat(messageService.create(me, dmId, new CreateMessageRequest("남은 사람에게")).id())
        .isPositive();
  }

  @Test
  void inviteSuspendedMemberToChannel_isRejectedAsInactive_notAsForbidden() {
    long owner = seedUser();
    long left = seedUser();
    suspend(left);
    var ch =
        channelService.create(
            owner, "정지초대-" + UUID.randomUUID().toString().substring(0, 6), "PUBLIC");

    assertThatThrownBy(() -> memberService.add(owner, ch.id(), left))
        .isInstanceOf(InactiveMemberException.class)
        .hasMessage("비활성화된 구성원은 채널에 초대할 수 없습니다");
  }

  /** WP-1148: 웹은 정지된 사람에게 소유자 선택지를 빼지만(WP-1131) API 는 열려 있었다 — 넘기면 관리할 사람이 없는 채널이 된다. */
  @Test
  void transferOwnershipToSuspendedMember_isRejected_andOwnerStays() {
    long owner = seedUser();
    long member = seedUser();
    var ch =
        channelService.create(
            owner, "정지이전-" + UUID.randomUUID().toString().substring(0, 6), "PUBLIC");
    memberService.add(owner, ch.id(), member);
    suspend(member);

    assertThatThrownBy(() -> memberService.updateRole(owner, ch.id(), member, "OWNER"))
        .isInstanceOf(InactiveMemberException.class)
        .hasMessage("비활성화된 구성원에게는 채널 소유권을 넘길 수 없습니다");
    // 거절되면 아무것도 바뀌지 않는다 — 소유자는 그대로, 대상은 멤버 그대로.
    var roles = memberService.listMembers(owner, ch.id());
    assertThat(roles.stream().filter(m -> m.userId() == owner).findFirst().orElseThrow().role())
        .isEqualTo("OWNER");
    assertThat(roles.stream().filter(m -> m.userId() == member).findFirst().orElseThrow().role())
        .isEqualTo("MEMBER");
  }

  /** 정지된 사람이라도 소유권 이전이 아닌 역할 변경(관리자↔멤버)은 지금처럼 된다 — 정리용으로 내리는 길은 막지 않는다. */
  @Test
  void demoteSuspendedAdmin_toMember_stillWorks() {
    long owner = seedUser();
    long admin = seedUser();
    var ch =
        channelService.create(
            owner, "정지강등-" + UUID.randomUUID().toString().substring(0, 6), "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");
    suspend(admin);

    memberService.updateRole(owner, ch.id(), admin, "MEMBER");
    assertThat(
            memberService.listMembers(owner, ch.id()).stream()
                .filter(m -> m.userId() == admin)
                .findFirst()
                .orElseThrow()
                .role())
        .isEqualTo("MEMBER");
  }

  @Test
  void channelMembers_carryWorkspaceActive() {
    long owner = seedUser();
    long member = seedUser();
    var ch =
        channelService.create(
            owner, "정지목록-" + UUID.randomUUID().toString().substring(0, 6), "PUBLIC");
    memberService.add(owner, ch.id(), member);
    suspend(member);

    var members = memberService.listMembers(owner, ch.id());
    assertThat(members)
        .filteredOn(m -> m.userId() == member)
        .extracting(ChannelMemberResponse::active)
        .containsExactly(false);
    assertThat(members)
        .filteredOn(m -> m.userId() == owner)
        .extracting(ChannelMemberResponse::active)
        .containsExactly(true);
  }
}

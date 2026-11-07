package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-511: 비공개 채널의 비멤버가 보내는 참여·이름 변경·보관·멤버 관리 요청은 없는 채널과 같은 404 로 응답해 존재를 숨긴다. 공개 채널과 비공개 채널의 멤버는
 * 기존처럼 403 이다. 하드 삭제(시스템 ADMIN 전용)도 같은 규칙이다(WP-1419) — 시스템 ADMIN 은 멤버가 아니어도 삭제할 수 있다.
 */
@Transactional
class PrivateChannelExistenceHidingTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwt;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ph_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ph" + s)
        .set(USER.EMAIL, "ph_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void nonMemberOfPrivate_getsSame404AsMissingChannel() {
    long owner = seedUser();
    long outsider = seedUser();
    long target = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    long id = priv.id();

    assertThatThrownBy(() -> channelService.join(outsider, id))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> channelService.rename(outsider, id, "새이름-" + UUID.randomUUID()))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> channelService.archive(outsider, id))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> channelService.unarchive(outsider, id))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> memberService.add(outsider, id, target))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> memberService.remove(outsider, id, owner))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> memberService.updateRole(outsider, id, owner, "MEMBER"))
        .isInstanceOf(ChannelNotFoundException.class);
    // WP-1419: 하드 삭제도 같은 404 — 403 이면 비공개 채널 id 의 존재가 새어 나간다.
    assertThatThrownBy(() -> channelService.hardDelete(outsider, id))
        .isInstanceOf(ChannelNotFoundException.class);
  }

  @Test
  void memberWithoutRole_andPublicNonMember_stillGet403() {
    long owner = seedUser();
    long member = seedUser();
    long outsider = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    memberRepo.add(priv.id(), member, "MEMBER");
    ChannelResponse pub = channelService.create(owner, "공개-" + UUID.randomUUID(), "PUBLIC");

    assertThatThrownBy(() -> channelService.rename(member, priv.id(), "x-" + UUID.randomUUID()))
        .isInstanceOf(ChannelForbiddenException.class);
    assertThatThrownBy(() -> channelService.rename(outsider, pub.id(), "y-" + UUID.randomUUID()))
        .isInstanceOf(ChannelForbiddenException.class);
    // WP-1419: 하드 삭제 — 비공개 채널 OWNER(비관리자)는 존재를 아니 403, 공개 채널 비멤버도 403.
    assertThatThrownBy(() -> channelService.hardDelete(owner, priv.id()))
        .isInstanceOf(ChannelForbiddenException.class);
    assertThatThrownBy(() -> channelService.hardDelete(outsider, pub.id()))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  /** WP-1419: 시스템 ADMIN 은 멤버가 아닌 비공개 채널도 하드 삭제할 수 있다(은닉 규칙의 회귀 방지). */
  @Test
  void systemAdmin_canHardDeletePrivateChannelWithoutMembership() {
    long owner = seedUser();
    long admin = seedUser();
    Long adminRole = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, admin)
        .set(USER_ROLE.ROLE_ID, adminRole)
        .execute();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");

    channelService.hardDelete(admin, priv.id());

    assertThatThrownBy(() -> channelService.getDetail(owner, priv.id()))
        .isInstanceOf(ChannelNotFoundException.class);
  }

  /** WP-1402: 비공개 채널 비멤버의 나가기는 없는 채널과 같은 404 — 멱등 204 면 비공개 채널 id 의 존재가 새어 나간다. 보관된 비공개 채널도 같다. */
  @Test
  void leave_nonMemberOfPrivate_getsSame404AsMissingChannel() {
    long owner = seedUser();
    long outsider = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    long id = priv.id();

    assertThatThrownBy(() -> memberService.leave(outsider, id))
        .isInstanceOf(ChannelNotFoundException.class);
    // 없는 채널 id 로 나가기를 했을 때 실제로 던져지는 메시지와 같아야 한다 — 메시지로도 구분되지 않게.
    String missingMessage =
        catchThrowable(() -> memberService.leave(outsider, Long.MAX_VALUE - 7)).getMessage();
    assertThatThrownBy(() -> memberService.leave(outsider, id)).hasMessage(missingMessage);

    channelService.archive(owner, id);
    assertThatThrownBy(() -> memberService.leave(outsider, id))
        .isInstanceOf(ChannelNotFoundException.class);
  }

  /** WP-1402: 공개 채널 비멤버의 나가기는 그대로 멱등(예외 없음). */
  @Test
  void leave_nonMemberOfPublic_staysIdempotent() {
    long owner = seedUser();
    long outsider = seedUser();
    ChannelResponse pub = channelService.create(owner, "공개-" + UUID.randomUUID(), "PUBLIC");

    assertThatCode(() -> memberService.leave(outsider, pub.id())).doesNotThrowAnyException();
  }

  /** WP-1402: 멤버는 나갈 수 있고 OWNER 는 소유권 이전이 먼저(기존 동작 유지). */
  @Test
  void leave_member_succeeds_andOwnerStillBlocked() {
    long owner = seedUser();
    long member = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    memberRepo.add(priv.id(), member, "MEMBER");

    memberService.leave(member, priv.id());

    assertThat(memberRepo.isMember(priv.id(), member)).isFalse();
    assertThatThrownBy(() -> memberService.leave(owner, priv.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);
  }

  /** WP-1402: 확인 카드 dry-run 도 같은 규칙 — 비공개 비멤버 404, 공개 비멤버는 기존 IllegalArgumentException. */
  @Test
  void validateLeavable_hidesPrivate_keepsPublicMessage() {
    long owner = seedUser();
    long outsider = seedUser();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    ChannelResponse pub = channelService.create(owner, "공개-" + UUID.randomUUID(), "PUBLIC");

    assertThatThrownBy(() -> memberService.validateLeavable(outsider, priv.id()))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> memberService.validateLeavable(outsider, pub.id()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** WP-1402: 시스템 ADMIN 은 다른 경로에서도 비공개 채널을 볼 수 있으므로, 비멤버여도 나가기는 숨기지 않고 멱등이다. */
  @Test
  void leave_nonMemberSystemAdminOfPrivate_staysIdempotent() {
    long owner = seedUser();
    long admin = seedUser();
    Long adminRole = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, admin)
        .set(USER_ROLE.ROLE_ID, adminRole)
        .execute();
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");

    assertThatCode(() -> memberService.leave(admin, priv.id())).doesNotThrowAnyException();
  }

  /**
   * WP-1402: HTTP 수준 — 비공개 채널 비멤버의 POST /leave 는 없는 채널과 같은 404(본문 message 도 같다), 공개 채널 비멤버는 204.
   */
  @Test
  void leaveEndpoint_nonMemberOfPrivate_is404_public_is204() throws Exception {
    long owner = seedUser();
    // HTTP 인증은 테넌트 멤버십(ACTIVE)과 USER 역할이 필요하다 — 비멤버(outsider)에게만 부여한다.
    long outsider = withMembership(seedUser());
    grantUserRole(outsider);
    ChannelResponse priv = channelService.create(owner, "비공개-" + UUID.randomUUID(), "PRIVATE");
    ChannelResponse pub = channelService.create(owner, "공개-" + UUID.randomUUID(), "PUBLIC");
    String token = "Bearer " + jwt.generateAccessToken(outsider, "u-" + outsider, 1L);

    // 없는 채널 id 의 404 본문 message 를 기준으로 삼는다.
    String missingMessage =
        JsonPath.read(
            mvc.perform(
                    post("/api/v1/messaging/channels/{id}/leave", Long.MAX_VALUE - 7)
                        .header("Authorization", token))
                .andExpect(status().isNotFound())
                .andReturn()
                .getResponse()
                .getContentAsString(),
            "$.message");
    TenantContext.set(1L);
    mvc.perform(
            post("/api/v1/messaging/channels/{id}/leave", priv.id()).header("Authorization", token))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value(missingMessage));
    TenantContext.set(1L);
    mvc.perform(
            post("/api/v1/messaging/channels/{id}/leave", pub.id()).header("Authorization", token))
        .andExpect(status().isNoContent());
  }
}

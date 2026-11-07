package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
  @Autowired com.workplace.messaging.repository.ChannelMemberRepository memberRepo;

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
}

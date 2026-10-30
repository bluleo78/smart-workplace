package com.workplace.user;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.outbound.AvatarChangeNotifier;
import com.workplace.user.service.AvatarService;
import java.awt.Color;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1226 아바타 변경 실시간 알림 — 아바타를 바꾸거나 되돌리면 그 사람과 워크스페이스를 하나라도 함께 쓰는 ACTIVE 구성원 전원에게 resource.changed
 * 「avatar」 가 한 번 나간다. 지금 테넌트만이 아니라 그 사람이 속한 다른 워크스페이스의 구성원도 받고, 함께 쓰는 워크스페이스가 없는 사람·멈춘 멤버·멈춘
 * 워크스페이스의 구성원은 받지 않는다.
 */
@Transactional
@RecordApplicationEvents
class AvatarChangeNotifyTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AvatarService avatarService;
  @Autowired ApplicationEvents appEvents;

  private void join(long userId, long tenantId, String status) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, status)
        .execute();
  }

  private MockMultipartFile png() {
    byte[] bytes = AvatarTestImages.encode(AvatarTestImages.solid(200, 200, Color.BLUE), "png");
    return new MockMultipartFile("file", "a.png", "image/png", bytes);
  }

  private List<ResourceChangedEvent> avatarEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> AvatarChangeNotifier.RESOURCE_AVATAR.equals(e.resource()))
        .toList();
  }

  @Test
  void 바꾸거나_되돌리면_함께_쓰는_워크스페이스의_구성원_전원에게_한_번씩_알린다() {
    long shared = TestFixtures.createTenant(dsl, "ACTIVE");
    long other = TestFixtures.createTenant(dsl, "ACTIVE");
    long suspendedTenant = TestFixtures.createTenant(dsl, "SUSPENDED");
    long me = TestFixtures.createHuman(dsl);
    long colleague = TestFixtures.createHuman(dsl); // shared 에서 만난다
    long otherColleague = TestFixtures.createHuman(dsl); // 다른 워크스페이스(other)에서 만난다
    long stranger = TestFixtures.createHuman(dsl); // 함께 쓰는 워크스페이스 없음
    long suspendedPeer = TestFixtures.createHuman(dsl); // shared 에서 멈춘 멤버
    long inSuspendedTenant = TestFixtures.createHuman(dsl); // 멈춘 워크스페이스에서만 만난다
    join(me, shared, "ACTIVE");
    join(me, other, "ACTIVE");
    join(me, suspendedTenant, "ACTIVE");
    join(colleague, shared, "ACTIVE");
    join(otherColleague, other, "ACTIVE");
    join(suspendedPeer, shared, "SUSPENDED");
    join(inSuspendedTenant, suspendedTenant, "ACTIVE");
    long strangerTenant = TestFixtures.createTenant(dsl, "ACTIVE");
    join(stranger, strangerTenant, "ACTIVE");

    avatarService.setAvatar(me, png(), null);

    assertThat(avatarEvents()).hasSize(1);
    ResourceChangedEvent set = avatarEvents().getFirst();
    assertThat(set.op()).isEqualTo(ResourceChangedEvent.OP_UPDATED);
    assertThat(set.ids()).containsExactly(me);
    assertThat(set.extraRecipients())
        .contains(me, colleague, otherColleague)
        .doesNotContain(stranger, suspendedPeer, inSuspendedTenant);

    appEvents.clear();
    avatarService.deleteAvatar(me);

    assertThat(avatarEvents())
        .singleElement()
        .extracting(ResourceChangedEvent::op)
        .isEqualTo(ResourceChangedEvent.OP_DELETED);
  }

  @Test
  void 이미_기본_아바타면_되돌려도_알리지_않는다() {
    long me = TestFixtures.createHuman(dsl);

    avatarService.deleteAvatar(me);

    assertThat(avatarEvents()).isEmpty();
  }
}

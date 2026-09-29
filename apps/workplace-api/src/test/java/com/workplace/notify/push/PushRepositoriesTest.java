package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 푸시 저장소 3종(구독·설정·VAPID) 통합 테스트 — 글로벌 테이블 CRUD 와 upsert 의미 검증. */
@Transactional
class PushRepositoriesTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushSubscriptionRepository subs;
  @Autowired NotificationPreferenceRepository prefs;
  @Autowired PushVapidKeyRepository vapid;

  /** 격리된 HUMAN 사용자 1명 시드. */
  @Test
  void upsert_sameEndpoint_transfersOwnerAndResetsFailure() {
    long a = TestFixtures.createHuman(dsl);
    long b = TestFixtures.createHuman(dsl);
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(a, ep, "k1", "s1", "UA");
    long id = subs.findByUserIds(List.of(a)).get(0).id();
    subs.incrementFailure(id);

    subs.upsert(b, ep, "k2", "s2", "UA2");

    assertThat(subs.findByUserIds(List.of(a))).isEmpty();
    PushSubscriptionRow row = subs.findByUserIds(List.of(b)).get(0);
    assertThat(row.p256dh()).isEqualTo("k2");
    assertThat(subs.incrementFailure(row.id())).isEqualTo(1); // 이전 후 0 에서 다시 시작
  }

  @Test
  void trimToLimit_keepsNewest() {
    long a = TestFixtures.createHuman(dsl);
    for (int i = 0; i < 4; i++) {
      subs.upsert(a, "https://203.0.113.10/push/" + i + UUID.randomUUID(), "k", "s", null);
    }
    int removed = subs.trimToLimit(a, 2);
    assertThat(removed).isEqualTo(2);
    assertThat(subs.findByUserIds(List.of(a))).hasSize(2);
  }

  @Test
  void deleteByUserAndEndpoint_onlyOwner() {
    long a = TestFixtures.createHuman(dsl);
    long b = TestFixtures.createHuman(dsl);
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(a, ep, "k", "s", null);
    assertThat(subs.deleteByUserAndEndpoint(b, ep)).isZero();
    assertThat(subs.deleteByUserAndEndpoint(a, ep)).isEqualTo(1);
  }

  @Test
  void preferences_defaultOn_andDisabledUsers() {
    long a = TestFixtures.createHuman(dsl);
    long b = TestFixtures.createHuman(dsl);
    prefs.upsert(a, PushCategory.DM, false);
    prefs.upsert(a, PushCategory.DM, false); // 멱등
    prefs.upsert(b, PushCategory.DM, true);

    assertThat(prefs.findByUser(a)).containsEntry(PushCategory.DM, false);
    assertThat(prefs.findDisabledUsers(List.of(a, b), PushCategory.DM)).isEqualTo(Set.of(a));
    assertThat(prefs.findDisabledUsers(List.of(a, b), PushCategory.ISSUE)).isEmpty();
  }

  @Test
  void vapid_insertIfAbsent_keepsFirst() {
    // 비-@Transactional 발송 테스트가 공유 컨테이너에 실제 키를 커밋했을 수 있다 — 이 트랜잭션 안에서 비우고 시작.
    dsl.deleteFrom(com.workplace.jooq.Tables.PUSH_VAPID_KEY).execute();
    vapid.insertIfAbsent("pub1", "enc1");
    vapid.insertIfAbsent("pub2", "enc2");
    assertThat(vapid.find()).get().satisfies(k -> assertThat(k[0]).isEqualTo("pub1"));
  }

  @Test
  void category_mapsNotificationTypes() {
    assertThat(PushCategory.of(NotificationType.ASSIGNED)).isEqualTo(PushCategory.ISSUE);
    assertThat(PushCategory.of(NotificationType.PRIORITY_CHANGED)).isEqualTo(PushCategory.ISSUE);
    assertThat(PushCategory.of(NotificationType.REMINDER)).isEqualTo(PushCategory.CALENDAR);
    assertThat(PushCategory.of(NotificationType.CALENDAR_RSVP_CHANGED))
        .isEqualTo(PushCategory.CALENDAR);
  }
}

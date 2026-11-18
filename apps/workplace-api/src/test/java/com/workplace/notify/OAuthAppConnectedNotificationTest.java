package com.workplace.notify;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationSettingsResponse.AppSettings;
import com.workplace.notify.dto.NotificationSettingsResponse.ItemSettings;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.service.NotificationService;
import com.workplace.notify.service.NotificationSettingService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「새 앱 연결」 계정 알림(WP-1686) — OAuth 로 새 앱이 연결되면 본인에게 행위자 없이 앱 이름을 실어 보낸다. 모르는 연결을 알아채게 하는 계정 알림이라 알림
 * 설정을 모두 꺼도 들어가야 하고, 연결한 워크스페이스의 인박스에만 있어야 한다(RLS).
 */
@Transactional
@RecordApplicationEvents
class OAuthAppConnectedNotificationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired NotificationSettingService settingService;
  @Autowired ApplicationEvents events;

  private long user;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    user = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, user, 1L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /** 행위자는 없고(null) 앱 이름은 message 에 실린다 — 인박스가 「{앱 이름}」을 보인다. */
  @Test
  void 새_앱_연결_알림은_행위자_없이_앱_이름을_싣는다() {
    service.createOAuthAppConnectedAndFanOut(user, "Claude");

    assertThat(service.listRecent(user, 10, 0))
        .singleElement()
        .satisfies(
            n -> {
              assertThat(n.type()).isEqualTo("OAUTH_APP_CONNECTED");
              assertThat(n.message()).isEqualTo("Claude");
              assertThat(n.actorId()).isNull();
            });
  }

  /**
   * 푸시 요청에 앱 이름이 eventTitle 칸으로 실린다 — 푸시 문구가 「{앱 이름} — …」이다. 생성자 인자 자리가 어긋나면(예: statusName 칸) 푸시가
   * 「앱」으로 떨어져도 인박스 행만 보는 테스트는 알아채지 못해 여기서 본다.
   */
  @Test
  void 푸시_요청에_앱_이름이_eventTitle_로_실린다() {
    service.createOAuthAppConnectedAndFanOut(user, "Claude");

    assertThat(events.stream(InboxPushRequestedEvent.class))
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.tenantId()).isEqualTo(1L);
              assertThat(e.type()).isEqualTo(NotificationType.OAUTH_APP_CONNECTED);
              assertThat(e.category()).isEqualTo(PushCategory.MENTION);
              assertThat(e.recipientIds()).containsExactly(user);
              assertThat(e.actorId()).isNull();
              assertThat(e.eventTitle()).isEqualTo("Claude");
              assertThat(e.statusName()).isNull();
            });
  }

  /** 앱 스위치와 모든 칸을 꺼도 들어간다 — 설정 판정을 거치지 않는 계정 알림이다. */
  @Test
  void 알림_설정을_모두_꺼도_들어간다() {
    Map<com.workplace.notify.dto.NotificationApp, Boolean> apps = new HashMap<>();
    List<CellChange> cells = new ArrayList<>();
    for (AppSettings app : settingService.get(user).apps()) {
      apps.put(app.app(), false);
      for (ItemSettings item : app.items()) {
        if (item.human() != null) {
          cells.add(new CellChange(item.item(), NotificationActor.HUMAN, false));
        }
        if (item.agent() != null) {
          cells.add(new CellChange(item.item(), NotificationActor.AGENT, false));
        }
      }
    }
    settingService.update(user, new UpdateNotificationSettingsRequest(apps, cells));

    service.createOAuthAppConnectedAndFanOut(user, "Claude");

    assertThat(service.listRecent(user, 10, 0)).hasSize(1);
  }

  /**
   * 다른 워크스페이스의 인박스에는 보이지 않는다(RLS). @Transactional 테스트라 TenantContext 만 바꾸면 DB 의 테넌트 설정이 그대로라
   * useTenant 로 둘 다 전환하고, 대조로 원래 워크스페이스에 돌아와 1건이 있음을 본다.
   */
  @Test
  void 다른_워크스페이스_인박스에는_없다() {
    service.createOAuthAppConnectedAndFanOut(user, "Claude");
    long other = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.ensureActiveMember(dsl, user, other);

    useTenant(other);
    assertThat(service.listRecent(user, 10, 0)).isEmpty();

    useTenant(1L);
    assertThat(service.listRecent(user, 10, 0)).hasSize(1);
  }
}

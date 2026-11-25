package com.workplace.notify.service;

import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import com.workplace.auth.outbound.AiLimitWaitNoticeEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.NotificationSettingsResponse.AppSettings;
import com.workplace.notify.dto.NotificationSettingsResponse.ItemSettings;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AI 사용 한도 대기 알림(WP-2108, AI_ASSISTANT_LIMIT_WAIT) — 서비스가 수신자마다 인박스 1행을 넣고, 커밋 뒤 이벤트로도 들어가며, 알림 설정을
 * 모두 꺼도 늘 들어간다. 이벤트 경로가 AFTER_COMMIT + @Async 라 @Transactional 을 쓰지 않는다(외부 트랜잭션 안에서는 AFTER_COMMIT 이
 * 발화하지 않는다).
 */
class AiLimitWaitNotificationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired NotificationSettingService settingService;
  @Autowired ApplicationEventPublisher publisher;
  @Autowired TransactionTemplate tx;

  private final List<Long> userIds = new ArrayList<>();

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    TenantContext.clear();
    // 사용자 삭제 → notification(recipient/actor FK) 동반 삭제.
    if (!userIds.isEmpty()) {
      dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.in(userIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute();
    }
    userIds.clear();
  }

  private long member() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.ensureActiveMember(dsl, id, 1L);
    userIds.add(id);
    return id;
  }

  private int count(long recipient) {
    return dsl.fetchCount(
        NOTIFICATION,
        NOTIFICATION
            .RECIPIENT_ID
            .eq(recipient)
            .and(NOTIFICATION.TYPE.eq("AI_ASSISTANT_LIMIT_WAIT")));
  }

  /** 수신자마다 1행 — type·status_name(scope)·message·actor 가 그대로 들어간다. */
  @Test
  void 수신자마다_한_행씩_넣는다() {
    long a = member();
    long b = member();
    long agent = TestFixtures.createAgentNoToken(dsl);
    userIds.add(agent);

    service.createAiLimitWaitAndFanOut(
        List.of(a, b), agent, "WORKSPACE_ASSISTANT", "공통 AI 비서가 사용 한도에 걸렸어요");

    for (long r : List.of(a, b)) {
      var rows =
          dsl.selectFrom(NOTIFICATION)
              .where(NOTIFICATION.RECIPIENT_ID.eq(r))
              .and(NOTIFICATION.TYPE.eq("AI_ASSISTANT_LIMIT_WAIT"))
              .fetch();
      assertThat(rows).hasSize(1);
      assertThat(rows.get(0).getStatusName()).isEqualTo("WORKSPACE_ASSISTANT");
      assertThat(rows.get(0).getMessage()).isEqualTo("공통 AI 비서가 사용 한도에 걸렸어요");
      assertThat(rows.get(0).getActorId()).isEqualTo(agent);
    }
  }

  /** 커밋 뒤 이벤트 경로 — 트랜잭션 안에서 발행한 AiLimitWaitNoticeEvent 가 커밋되면 수신자 인박스에 1행이 생긴다. */
  @Test
  void 커밋된_이벤트가_수신자_인박스에_들어간다() {
    long a = member();

    tx.executeWithoutResult(
        s ->
            publisher.publishEvent(
                new AiLimitWaitNoticeEvent(1L, List.of(a), null, "PERSONAL_ASSISTANT", "내 비서 대기")));

    await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> assertThat(count(a)).isEqualTo(1));
  }

  /** 롤백되면 알리지 않는다 — AFTER_COMMIT 이라 커밋된 대기만 알린다. */
  @Test
  void 롤백된_이벤트는_알리지_않는다() {
    long a = member();

    tx.executeWithoutResult(
        s -> {
          publisher.publishEvent(
              new AiLimitWaitNoticeEvent(1L, List.of(a), null, "PERSONAL_ASSISTANT", "내 비서 대기"));
          s.setRollbackOnly();
        });

    com.workplace.support.AsyncPools.awaitIdle(notifyEventExecutor);
    assertThat(count(a)).isEqualTo(0);
  }

  @Autowired
  @org.springframework.beans.factory.annotation.Qualifier("notifyEventExecutor")
  java.util.concurrent.Executor notifyEventExecutor;

  /** 알림 설정의 앱 스위치와 모든 칸을 꺼도 들어간다 — 설정 줄이 없는 계정 알림이다. */
  @Test
  void 알림_설정을_모두_꺼도_들어가고_설정_줄이_없다() {
    long a = member();
    Map<com.workplace.notify.dto.NotificationApp, Boolean> apps = new HashMap<>();
    List<CellChange> cells = new ArrayList<>();
    for (AppSettings app : settingService.get(a).apps()) {
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
    settingService.update(a, new UpdateNotificationSettingsRequest(apps, cells));

    service.createAiLimitWaitAndFanOut(List.of(a), null, "AGENT_ACCOUNT", "AI 계정 대기");

    assertThat(count(a)).isEqualTo(1);
    assertThatThrownBy(() -> NotificationSettingItem.of(NotificationType.AI_ASSISTANT_LIMIT_WAIT))
        .isInstanceOf(IllegalArgumentException.class);
  }
}

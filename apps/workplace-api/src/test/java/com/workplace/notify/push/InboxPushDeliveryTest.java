package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/** 인박스 알림 커밋 → 수신자 기기로 푸시 게이트웨이 호출까지 배선 검증. 커밋이 필요해 비-@Transactional + 수동 정리. */
class InboxPushDeliveryTest extends IntegrationTestBase {

  @MockitoBean PushGateway gateway;
  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired PushSubscriptionRepository subs;

  final List<Long> users = new ArrayList<>();
  final List<Long> projects = new ArrayList<>();

  @BeforeEach
  void tenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(NOTIFICATION).where(NOTIFICATION.RECIPIENT_ID.in(users)).execute();
          dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(projects)).execute();
          dsl.deleteFrom(ISSUE_TYPE_DEF).where(ISSUE_TYPE_DEF.PROJECT_ID.in(projects)).execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(projects)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(users)).execute(); // push_subscription CASCADE
        });
    TenantContext.clear();
  }

  /** 공용 픽스처로 사용자 생성 + 정리 대상 등록(커밋되는 테스트라 @AfterEach 에서 지운다). */
  private long seedUser() {
    long id = TestFixtures.createHuman(dsl);
    users.add(id);
    return id;
  }

  @Test
  void assigned_commit_deliversPush() {
    long actor = seedUser();
    long recipient = seedUser();
    String ep = "https://203.0.113.10/push/" + UUID.randomUUID();
    subs.upsert(
        recipient,
        ep,
        EcKeys.b64e(EcKeys.encodePublic((ECPublicKey) EcKeys.generate().getPublic())),
        EcKeys.b64e(new byte[16]),
        null);
    when(gateway.deliver(eq(ep), any(), anyMap())).thenReturn(PushGateway.Result.of(201));

    long issueId =
        new TransactionTemplate(txManager)
            .execute(
                st -> {
                  String k = "D" + UUID.randomUUID().toString().replace("-", "").substring(0, 5);
                  long pid =
                      dsl.insertInto(PROJECT)
                          .set(PROJECT.KEY, k)
                          .set(PROJECT.NAME, "P")
                          .set(PROJECT.OWNER_ID, actor)
                          .returning(PROJECT.ID)
                          .fetchOne()
                          .getId();
                  projects.add(pid);
                  long tid =
                      dsl.insertInto(ISSUE_TYPE_DEF)
                          .set(ISSUE_TYPE_DEF.PROJECT_ID, pid)
                          .set(ISSUE_TYPE_DEF.NAME, "TASK")
                          .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
                          .set(ISSUE_TYPE_DEF.ICON, "Circle")
                          .returning(ISSUE_TYPE_DEF.ID)
                          .fetchOne()
                          .getId();
                  return dsl.insertInto(ISSUE)
                      .set(ISSUE.PROJECT_ID, pid)
                      .set(ISSUE.NUMBER, 1)
                      .set(ISSUE.TITLE, "t")
                      .set(ISSUE.REPORTER_ID, actor)
                      .set(ISSUE.TYPE_ID, tid)
                      .returning(ISSUE.ID)
                      .fetchOne()
                      .getId();
                });

    service.createAndFanOut(NotificationType.ASSIGNED, List.of(recipient), actor, issueId, null);

    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> verify(gateway).deliver(eq(ep), any(), anyMap()));
  }
}

package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.service.NotificationService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * NotificationService 가 인박스 알림 생성 시 InboxPushRequestedEvent 를 발행하는지(수신자 = 실제 insert 대상, actor 제외).
 */
@Transactional
@RecordApplicationEvents
class InboxPushEventTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired ApplicationEvents events;

  private long seedIssue(long owner) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "I" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, owner)
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    long typeId =
        dsl.insertInto(ISSUE_TYPE_DEF)
            .set(ISSUE_TYPE_DEF.PROJECT_ID, projectId)
            .set(ISSUE_TYPE_DEF.NAME, "TASK")
            .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
            .set(ISSUE_TYPE_DEF.ICON, "Circle")
            .returning(ISSUE_TYPE_DEF.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(ISSUE)
        .set(ISSUE.PROJECT_ID, projectId)
        .set(ISSUE.NUMBER, 1)
        .set(ISSUE.TITLE, "t")
        .set(ISSUE.REPORTER_ID, owner)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createAndFanOut_publishesPushEvent_withFilteredRecipients() {
    long actor = TestFixtures.createHuman(dsl);
    long r1 = TestFixtures.createHuman(dsl);
    long issueId = seedIssue(actor);

    service.createAndFanOut(NotificationType.COMMENTED, List.of(actor, r1, r1), actor, issueId, 3L);

    InboxPushRequestedEvent e =
        events.stream(InboxPushRequestedEvent.class).findFirst().orElseThrow();
    assertThat(e.recipientIds()).containsExactly(r1);
    assertThat(e.type()).isEqualTo(NotificationType.COMMENTED);
    assertThat(e.issueId()).isEqualTo(issueId);
    assertThat(e.tenantId()).isEqualTo(1L);
  }

  @Test
  void noTenant_skipsPushButKeepsNotification() {
    long actor = TestFixtures.createHuman(dsl);
    long r1 = TestFixtures.createHuman(dsl);
    long issueId = seedIssue(actor);
    TenantContext.clear(); // 트랜잭션은 이미 GUC 로 열려 있어 insert 는 성공한다
    try {
      service.createAndFanOut(NotificationType.ASSIGNED, List.of(r1), actor, issueId, null);
    } finally {
      TenantContext.set(1L);
    }
    assertThat(service.countUnread(r1)).isEqualTo(1);
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();
  }

  @Test
  void emptyRecipients_noEvent() {
    long actor = TestFixtures.createHuman(dsl);
    long issueId = seedIssue(actor);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(actor), actor, issueId, null);
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();
  }
}

package com.workplace.notify.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.UserSummary;
import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** NotificationService 통합 테스트 — actor 제외·중복 제거·빈 수신자 no-op·스코프. */
@Transactional
@RecordApplicationEvents
class NotificationServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired ApplicationEvents events;
  @Autowired NotificationSettingService settings;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ns_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ns" + s)
        .set(USER.EMAIL, "ns_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** project + issue_type_def + issue 1건 시드 후 issueId 반환. */
  private long seedIssue(long ownerId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "S" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            // 알림 목록은 프로젝트 조회 권한을 따진다(WP-491) — 권한과 무관한 테스트라 누구나 보는 OPEN 으로 둔다.
            .set(PROJECT.TYPE, "OPEN")
            .returning(PROJECT.ID)
            .fetchOne()
            .getId();
    // 새 프로젝트는 V10 백필 대상이 아니므로 type_id(NOT NULL)용 유형 1건 시드.
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
        .set(ISSUE.REPORTER_ID, ownerId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void createAndFanOut_excludesActor_andDedupes() {
    long actor = seedUser();
    long r1 = seedUser();
    long issueId = seedIssue(actor);

    service.createAndFanOut(
        NotificationType.COMMENTED, List.of(actor, r1, r1, actor), actor, issueId, 5L);

    assertThat(service.countUnread(actor)).isZero();
    assertThat(service.countUnread(r1)).isEqualTo(1);
  }

  @Test
  void createAndFanOut_emptyRecipients_isNoOp() {
    long actor = seedUser();
    long issueId = seedIssue(actor);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(actor), actor, issueId, null);
    assertThat(service.countUnread(actor)).isZero();
    assertThat(service.listRecent(actor, 20, 0)).isEmpty();
  }

  @Test
  void markAllRead_isCallerScoped() {
    long a = seedUser();
    long b = seedUser();
    long issueId = seedIssue(a);
    // 읽음 범위만 보는 테스트라 기본 켜짐 타입(COMMENTED)을 쓴다 — 상태 변경은 WP-913 부터 기본 꺼짐.
    service.createAndFanOut(NotificationType.COMMENTED, List.of(a, b), null, issueId, null);

    service.markAllRead(a);
    assertThat(service.countUnread(a)).isZero();
    assertThat(service.countUnread(b)).isEqualTo(1);
  }

  /** WP-869: 상태 변경 알림은 새 상태 이름을 행에 남기고, 목록 응답과 푸시 이벤트에 그대로 싣는다. */
  @Test
  void 상태변경_알림은_새상태이름을_저장한다() {
    long actor = seedUser();
    long assignee = seedUser();
    long issueId = seedIssue(actor);
    // 상태 변경 알림은 기본 꺼짐(WP-913) — 상태 이름 왕복을 보려고 담당자가 그 칸을 켠다.
    settings.update(
        assignee,
        new UpdateNotificationSettingsRequest(
            null,
            List.of(
                new CellChange(
                    NotificationSettingItem.ISSUE_STATUS_CHANGED, NotificationActor.HUMAN, true))));

    service.createWithWatchersAndFanOut(
        NotificationType.STATUS_CHANGED,
        issueId,
        List.of(new UserSummary(assignee, "a", "담당", "HUMAN")),
        actor,
        null,
        "검토 중");

    assertThat(
            dsl.select(NOTIFICATION.STATUS_NAME)
                .from(NOTIFICATION)
                .where(NOTIFICATION.RECIPIENT_ID.eq(assignee))
                .fetchOne(NOTIFICATION.STATUS_NAME))
        .isEqualTo("검토 중");
    assertThat(service.listRecent(assignee, 20, 0))
        .singleElement()
        .satisfies(n -> assertThat(n.statusName()).isEqualTo("검토 중"));
    assertThat(events.stream(InboxPushRequestedEvent.class))
        .singleElement()
        .satisfies(e -> assertThat(e.statusName()).isEqualTo("검토 중"));
  }

  /** 상태 이름이 없는 경로(기존 5인자·다른 유형)는 status_name 을 비워 둔다 — 프론트·푸시가 기존 문구로 돌아간다. */
  @Test
  void 상태이름없는_알림은_statusName이_null이다() {
    long actor = seedUser();
    long r1 = seedUser();
    long issueId = seedIssue(actor);

    service.createWithWatchersAndFanOut(
        NotificationType.COMMENTED,
        issueId,
        List.of(new UserSummary(r1, "b", "담당", "HUMAN")),
        actor,
        null);

    assertThat(service.listRecent(r1, 20, 0))
        .singleElement()
        .satisfies(n -> assertThat(n.statusName()).isNull());
  }
}

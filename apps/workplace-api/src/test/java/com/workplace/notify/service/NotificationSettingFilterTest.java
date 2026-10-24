package com.workplace.notify.service;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.service.CalendarService;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationApp;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest.CellChange;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/**
 * 알림 설정 필터(WP-913) — NotificationService 의 모든 생성 경로가 수신자별 설정(앱 스위치·항목 칸, 행위자 kind 로 칸 선택)을 따르고, 걸러진
 * 사람에게는 인박스 행도 푸시 이벤트도 없는지. AGENT 수신자는 설정과 무관하게 받는다. 「0건」 단언마다 같은 호출에서 설정을 건드리지 않은 다른 수신자가 받는 대조군을
 * 두어 시드 문제(예: 이슈를 못 봄)로 0건이 나오는 거짓 통과를 막는다.
 */
@Transactional
@RecordApplicationEvents
class NotificationSettingFilterTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired NotificationSettingService settings;
  @Autowired CalendarService calendarService;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired ApplicationEvents events;

  private long actor; // 사람 행위자
  private long agent; // AI 행위자
  private long h; // 설정을 바꾸는 사람 수신자
  private long other; // 설정을 건드리지 않는 대조군 사람 수신자
  private long issueId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    actor = withMembership(TestFixtures.createHuman(dsl));
    agent = TestFixtures.createAgentNoToken(dsl);
    h = withMembership(TestFixtures.createHuman(dsl));
    other = withMembership(TestFixtures.createHuman(dsl));
    issueId = seedIssue(actor);
  }

  // ── 이슈 ──

  @Test
  void assigned_byAgent_isOffByDefault() {
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(h), agent, issueId, null);

    assertThat(count(h, NotificationType.ASSIGNED)).isZero();
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();
  }

  @Test
  void assigned_byHuman_isOnByDefault() {
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(h), actor, issueId, null);

    assertThat(count(h, NotificationType.ASSIGNED)).isEqualTo(1);
    assertThat(pushRecipients()).containsExactly(h);
  }

  @Test
  void statusChanged_isOffByDefault_forHumanAndNullActor() {
    service.createAndFanOut(NotificationType.STATUS_CHANGED, List.of(h), actor, issueId, null);
    service.createAndFanOut(NotificationType.STATUS_CHANGED, List.of(h), null, issueId, null);

    assertThat(count(h, NotificationType.STATUS_CHANGED)).isZero();
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();

    // 대조군: 같은 수신자라도 켜 두면 받는다(시드가 정상).
    cell(h, NotificationSettingItem.ISSUE_STATUS_CHANGED, NotificationActor.HUMAN, true);
    service.createAndFanOut(NotificationType.STATUS_CHANGED, List.of(h), null, issueId, null);
    assertThat(count(h, NotificationType.STATUS_CHANGED)).isEqualTo(1);
  }

  @Test
  void enabledAgentComment_isDelivered() {
    // 기본은 AI 코멘트 꺼짐
    service.createAndFanOut(NotificationType.COMMENTED, List.of(h), agent, issueId, 5L);
    assertThat(count(h, NotificationType.COMMENTED)).isZero();

    cell(h, NotificationSettingItem.ISSUE_COMMENTED, NotificationActor.AGENT, true);
    service.createAndFanOut(NotificationType.COMMENTED, List.of(h), agent, issueId, 6L);

    assertThat(count(h, NotificationType.COMMENTED)).isEqualTo(1);
    assertThat(pushRecipients()).containsExactly(h);
  }

  @Test
  void appOff_blocksAll_thenRestores() {
    app(h, NotificationApp.ISSUE, false);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(h, other), actor, issueId, null);

    assertThat(count(h, NotificationType.ASSIGNED)).isZero();
    assertThat(count(other, NotificationType.ASSIGNED)).isEqualTo(1);
    assertThat(pushRecipients()).containsExactly(other);

    app(h, NotificationApp.ISSUE, true);
    service.createAndFanOut(NotificationType.ASSIGNED, List.of(h), actor, issueId, null);
    assertThat(count(h, NotificationType.ASSIGNED)).isEqualTo(1);
  }

  @Test
  void agentRecipient_ignoresSettings() {
    long a = createAgentUserWithMembership("nsf-agent");
    app(a, NotificationApp.ISSUE, false);
    cell(a, NotificationSettingItem.ISSUE_ASSIGNED, NotificationActor.HUMAN, false);

    service.createAndFanOut(NotificationType.ASSIGNED, List.of(a), actor, issueId, null);

    assertThat(count(a, NotificationType.ASSIGNED)).isEqualTo(1);
    assertThat(pushRecipients()).containsExactly(a);
  }

  @Test
  void commentMention_disabledMention_doesNotFallBackToCommented() {
    cell(h, NotificationSettingItem.ISSUE_MENTIONED, NotificationActor.HUMAN, false);

    // h·other 모두 담당자, 본문은 h 만 멘션.
    service.createCommentedAndFanOut(
        issueId, List.of(summary(h), summary(other)), List.of(h), actor, 77L);

    assertThat(count(h, NotificationType.ISSUE_COMMENT_MENTION)).isZero();
    assertThat(count(h, NotificationType.COMMENTED)).isZero();
    // 대조군: 멘션되지 않은 담당자는 COMMENTED 를 받는다.
    assertThat(count(other, NotificationType.COMMENTED)).isEqualTo(1);
    assertThat(pushRecipients()).containsExactly(other);
  }

  @Test
  void aiQuestion_usesNeedsInputCell_forMentionedToo() {
    cell(h, NotificationSettingItem.ISSUE_AI_NEEDS_INPUT, NotificationActor.AGENT, false);

    // h 는 질문 글에서 멘션됨, other 도 멘션됨(대조군). 보고자 actor 는 이해관계자로 받는다.
    service.createAiQuestionAndFanOut(issueId, List.of(h, other), agent);

    assertThat(count(h, NotificationType.AI_QUESTION)).isZero();
    assertThat(count(other, NotificationType.AI_QUESTION)).isEqualTo(1);
    assertThat(pushRecipients()).doesNotContain(h).contains(other);
  }

  // ── 캘린더 ──

  @Test
  void reminder_followsHumanColumn() {
    long eventId = seedEvent(h);
    service.createReminderAndFanOut(h, eventId);
    assertThat(count(h, NotificationType.REMINDER)).isEqualTo(1);

    cell(h, NotificationSettingItem.CALENDAR_REMINDER, NotificationActor.HUMAN, false);
    service.createReminderAndFanOut(h, eventId);

    assertThat(count(h, NotificationType.REMINDER)).isEqualTo(1); // 늘지 않음
    assertThat(pushRecipients()).containsExactly(h); // 첫 번째 것만
  }

  @Test
  void calendarInvite_and_wikiShare_followSettings() {
    long eventId = seedEvent(actor);
    app(h, NotificationApp.CALENDAR, false);
    service.createEventNotificationAndFanOut(h, NotificationType.CALENDAR_INVITED, actor, eventId);
    service.createEventNotificationAndFanOut(
        other, NotificationType.CALENDAR_INVITED, actor, eventId);

    assertThat(count(h, NotificationType.CALENDAR_INVITED)).isZero();
    assertThat(count(other, NotificationType.CALENDAR_INVITED)).isEqualTo(1);

    long pageId = seedWikiPage(actor);
    cell(h, NotificationSettingItem.WIKI_SHARED, NotificationActor.HUMAN, false);
    service.createWikiShareNotificationAndFanOut(
        h, NotificationType.WIKI_SHARED, actor, pageId, null);
    service.createWikiShareNotificationAndFanOut(
        other, NotificationType.WIKI_SHARED, actor, pageId, null);

    assertThat(count(h, NotificationType.WIKI_SHARED)).isZero();
    assertThat(count(other, NotificationType.WIKI_SHARED)).isEqualTo(1);
    assertThat(pushRecipients()).containsOnly(other);
  }

  @Test
  void eventNotices_filterPerRecipient() {
    long eventId = seedEvent(actor);
    cell(h, NotificationSettingItem.CALENDAR_EVENT_UPDATED, NotificationActor.HUMAN, false);

    service.createEventNoticesAndFanOut(
        List.of(h, other),
        NotificationType.CALENDAR_EVENT_UPDATED,
        actor,
        eventId,
        "주간 회의",
        OffsetDateTime.now());

    assertThat(count(h, NotificationType.CALENDAR_EVENT_UPDATED)).isZero();
    assertThat(count(other, NotificationType.CALENDAR_EVENT_UPDATED)).isEqualTo(1);
    assertThat(pushRecipients()).containsExactly(other);
  }

  // ── 헬퍼 ──

  /** 이번 테스트에서 발행된 모든 인박스 푸시 이벤트의 수신자(순서대로 이어 붙임). */
  private List<Long> pushRecipients() {
    return events.stream(InboxPushRequestedEvent.class)
        .flatMap(e -> e.recipientIds().stream())
        .toList();
  }

  private int count(long recipientId, NotificationType type) {
    return dsl.fetchCount(
        NOTIFICATION,
        NOTIFICATION.RECIPIENT_ID.eq(recipientId).and(NOTIFICATION.TYPE.eq(type.name())));
  }

  private void cell(
      long userId, NotificationSettingItem item, NotificationActor column, boolean enabled) {
    settings.update(
        userId,
        new UpdateNotificationSettingsRequest(
            null, List.of(new CellChange(item, column, enabled))));
  }

  private void app(long userId, NotificationApp app, boolean enabled) {
    settings.update(userId, new UpdateNotificationSettingsRequest(Map.of(app, enabled), null));
  }

  private static UserSummary summary(long id) {
    return new UserSummary(id, "u" + id, "U" + id, "HUMAN");
  }

  /** 누구나 보는 OPEN 프로젝트의 이슈 1건(보고자 = ownerId) — 조회 권한 필터와 무관하게 설정만 보려고. */
  private long seedIssue(long ownerId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "F" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, ownerId)
            .set(PROJECT.TYPE, "OPEN")
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
        .set(ISSUE.REPORTER_ID, ownerId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  /** ownerId 의 일정 1건(기본 캘린더 보장 — calendar_id NOT NULL). */
  private long seedEvent(long ownerId) {
    long calId = calendarService.ensureDefault(ownerId);
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.TITLE, "주간 회의")
        .set(CALENDAR_EVENT.STARTS_AT, now.plusHours(1))
        .set(CALENDAR_EVENT.ENDS_AT, now.plusHours(2))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /** ownerId 의 팀 스페이스에 노트 1건. */
  private long seedWikiPage(long ownerId) {
    long spaceId = spaceService.createTeamSpace(ownerId, "설정필터-" + UUID.randomUUID()).id();
    return pageService.create(ownerId, spaceId, new CreatePageRequest(null, "로드맵")).id();
  }
}

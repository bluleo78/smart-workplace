package com.workplace.notify.service;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.PROJECT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.notify.push.InboxPushRequestedEvent;
import com.workplace.notify.push.PushCategory;
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
 * 이슈 챗 알림(WP-452) 통합 테스트 — AI 질문 수신자 해석(사람 관계자 ∪ 멘션, AGENT·작성자 제외, 1인 1건)과 수신자별 푸시 카테고리(멘션된 사람
 * MENTION, 나머지 ISSUE), 이슈 챗 멘션 알림(본인 제외).
 */
@Transactional
@RecordApplicationEvents
class IssueChatNotificationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired NotificationService service;
  @Autowired ApplicationEvents events;

  /** project + issue_type_def + issue 1건 시드 후 issueId 반환(reporter 지정). */
  private long seedIssue(long reporterId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 5);
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, "Q" + s)
            .set(PROJECT.NAME, "P" + s)
            .set(PROJECT.OWNER_ID, reporterId)
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
        .set(ISSUE.REPORTER_ID, reporterId)
        .set(ISSUE.TYPE_ID, typeId)
        .returning(ISSUE.ID)
        .fetchOne()
        .getId();
  }

  private void assign(long issueId, long userId, long by) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, by)
        .execute();
  }

  private void watch(long issueId, long userId) {
    dsl.insertInto(ISSUE_WATCHER)
        .set(ISSUE_WATCHER.ISSUE_ID, issueId)
        .set(ISSUE_WATCHER.USER_ID, userId)
        .execute();
  }

  /** 해당 이슈에 쌓인 (수신자, 유형) 목록. */
  private List<Long> recipientsOf(long issueId, NotificationType type) {
    return dsl.select(NOTIFICATION.RECIPIENT_ID)
        .from(NOTIFICATION)
        .where(NOTIFICATION.ISSUE_ID.eq(issueId).and(NOTIFICATION.TYPE.eq(type.name())))
        .fetch(NOTIFICATION.RECIPIENT_ID);
  }

  @Test
  void aiQuestion_notifiesHumanStakeholdersAndMentions_excludingAgentsAndActor_oncePerPerson() {
    long reporter = TestFixtures.createHuman(dsl);
    long humanAssignee = TestFixtures.createHuman(dsl);
    long watcher = TestFixtures.createHuman(dsl);
    long mentioned = TestFixtures.createHuman(dsl);
    long outsider = TestFixtures.createHuman(dsl);
    long aiActor = TestFixtures.createAgentNoToken(dsl);
    long otherAgent = TestFixtures.createAgentNoToken(dsl);
    long issueId = seedIssue(reporter);
    assign(issueId, humanAssignee, reporter);
    assign(issueId, aiActor, reporter);
    assign(issueId, otherAgent, reporter);
    watch(issueId, watcher);
    watch(issueId, otherAgent);
    // 담당자이자 워처인 사람이 멘션까지 받아도 1건만.
    watch(issueId, humanAssignee);

    service.createAiQuestionAndFanOut(issueId, List.of(mentioned, humanAssignee), aiActor);

    assertThat(recipientsOf(issueId, NotificationType.AI_QUESTION))
        .containsExactlyInAnyOrder(reporter, humanAssignee, watcher, mentioned);
    assertThat(recipientsOf(issueId, NotificationType.AI_QUESTION))
        .doesNotContain(aiActor, otherAgent, outsider);
    // AI_QUESTION 외 다른 유형은 만들지 않는다.
    assertThat(
            dsl.fetchCount(
                NOTIFICATION,
                NOTIFICATION
                    .ISSUE_ID
                    .eq(issueId)
                    .and(NOTIFICATION.TYPE.ne(NotificationType.AI_QUESTION.name()))))
        .isZero();

    // 푸시: 멘션된 수신자는 MENTION, 나머지는 ISSUE — 한 사람이 두 묶음에 겹치지 않는다.
    List<InboxPushRequestedEvent> pushes = events.stream(InboxPushRequestedEvent.class).toList();
    assertThat(pushes).hasSize(2);
    assertThat(pushes).allMatch(p -> p.type() == NotificationType.AI_QUESTION);
    InboxPushRequestedEvent mentionPush =
        pushes.stream().filter(p -> p.category() == PushCategory.MENTION).findFirst().orElseThrow();
    InboxPushRequestedEvent issuePush =
        pushes.stream().filter(p -> p.category() == PushCategory.ISSUE).findFirst().orElseThrow();
    assertThat(mentionPush.recipientIds()).containsExactlyInAnyOrder(mentioned, humanAssignee);
    assertThat(issuePush.recipientIds()).containsExactlyInAnyOrder(reporter, watcher);
    assertThat(mentionPush.issueId()).isEqualTo(issueId);
    assertThat(mentionPush.actorId()).isEqualTo(aiActor);
  }

  @Test
  void aiQuestion_withoutMentions_pushesIssueCategoryOnly() {
    long reporter = TestFixtures.createHuman(dsl);
    long aiActor = TestFixtures.createAgentNoToken(dsl);
    long issueId = seedIssue(reporter);
    assign(issueId, aiActor, reporter);

    service.createAiQuestionAndFanOut(issueId, List.of(), aiActor);

    assertThat(recipientsOf(issueId, NotificationType.AI_QUESTION)).containsExactly(reporter);
    List<InboxPushRequestedEvent> pushes = events.stream(InboxPushRequestedEvent.class).toList();
    assertThat(pushes).hasSize(1);
    assertThat(pushes.get(0).category()).isEqualTo(PushCategory.ISSUE);
    assertThat(pushes.get(0).recipientIds()).containsExactly(reporter);
  }

  @Test
  void aiQuestion_humanActorReporter_isExcludedFromOwnQuestion() {
    // 사람이 자기 AI 도구로 질문을 올린 경우(작성자=보고자) — 본인에게는 알림 없음.
    long reporter = TestFixtures.createHuman(dsl);
    long issueId = seedIssue(reporter);

    service.createAiQuestionAndFanOut(issueId, List.of(reporter), reporter);

    assertThat(recipientsOf(issueId, NotificationType.AI_QUESTION)).isEmpty();
    assertThat(events.stream(InboxPushRequestedEvent.class)).isEmpty();
  }

  @Test
  void issueChatMention_notifiesMentionedExcludingSelf_withMentionPush() {
    long author = TestFixtures.createHuman(dsl);
    long mentioned = TestFixtures.createHuman(dsl);
    long bystander = TestFixtures.createHuman(dsl);
    long issueId = seedIssue(author);
    watch(issueId, bystander);

    service.createAndFanOut(
        NotificationType.ISSUE_CHAT_MENTION, List.of(mentioned, author), author, issueId, null);

    assertThat(recipientsOf(issueId, NotificationType.ISSUE_CHAT_MENTION))
        .containsExactly(mentioned);
    InboxPushRequestedEvent push =
        events.stream(InboxPushRequestedEvent.class).findFirst().orElseThrow();
    assertThat(push.category()).isEqualTo(PushCategory.MENTION);
    assertThat(push.recipientIds()).containsExactly(mentioned);
  }
}

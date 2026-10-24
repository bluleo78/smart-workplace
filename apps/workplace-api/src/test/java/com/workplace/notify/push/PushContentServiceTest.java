package com.workplace.notify.push;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.notify.dto.NotificationType;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 인박스 알림 → 푸시 문구/url/tag 조립. 표시 문구는 프론트 InboxPanel ACTION_LABEL 과 같은 표현을 쓴다. */
@Transactional
class PushContentServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired PushContentService content;

  long actor;
  String key;
  long issueId;

  private void seedIssue() {
    actor = TestFixtures.createHuman(dsl);
    // 푸시 문구가 행위자 이름을 쓰므로 검증용 이름을 지정한다.
    dsl.update(USER).set(USER.NAME, "박민수").where(USER.ID.eq(actor)).execute();
    key = "P" + UUID.randomUUID().toString().replace("-", "").substring(0, 4).toUpperCase();
    long projectId =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "N")
            .set(PROJECT.OWNER_ID, actor)
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
    issueId =
        dsl.insertInto(ISSUE)
            .set(ISSUE.PROJECT_ID, projectId)
            .set(ISSUE.NUMBER, 7)
            .set(ISSUE.TITLE, "로그인 버그")
            .set(ISSUE.REPORTER_ID, actor)
            .set(ISSUE.TYPE_ID, typeId)
            .returning(ISSUE.ID)
            .fetchOne()
            .getId();
  }

  @Test
  void forInbox_assigned_buildsIssueMessage() {
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.ASSIGNED, List.of(99L), actor, issueId, null));

    assertThat(m.category()).isEqualTo(PushCategory.ISSUE);
    assertThat(m.title()).isEqualTo(key + "-7 로그인 버그");
    assertThat(m.body()).isEqualTo("박민수님이 회원님을 배정했습니다");
    assertThat(m.url()).isEqualTo("/projects/" + key + "/issues/7");
    assertThat(m.tag()).isEqualTo("issue-" + issueId);
    assertThat(m.urgency()).isEqualTo("normal");
    assertThat(m.ttlSeconds()).isEqualTo(259200);
    assertThat(m.tenantId()).isEqualTo(1L);
  }

  /**
   * WP-869: 새 상태 이름이 실린 상태 변경 푸시는 인박스와 같은 「상태를 '<이름>'으로/로 변경했습니다」 문구를 쓴다 — 조사는
   * 인박스(directionParticle)처럼 받침에 맞춘다.
   */
  @Test
  void 푸시는_상태이름을_넣은_문구를_쓴다() {
    seedIssue();
    dsl.update(USER).set(USER.NAME, "김리드").where(USER.ID.eq(actor)).execute();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L,
                NotificationType.STATUS_CHANGED,
                PushCategory.ISSUE,
                List.of(99L),
                actor,
                issueId,
                null,
                null,
                null,
                "검토 중"));

    assertThat(m.body()).isEqualTo("김리드님이 상태를 '검토 중'으로 변경했습니다");
  }

  /** 상태 이름이 없는(이름을 남기기 전) 상태 변경 푸시는 기존 문구 그대로. */
  @Test
  void 이름없는_예전알림은_기존문구() {
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.STATUS_CHANGED, List.of(99L), actor, issueId, null));

    assertThat(m.body()).isEqualTo("박민수님이 상태를 변경했습니다");
  }

  @Test
  void forInbox_actorMissing_usesSystemLabel() {
    // 행위자가 없는 경우(actorId == null) — 프론트 InboxPanel 의 `n.actorName ?? '시스템'` 과 표기를 통일한다.
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.STATUS_CHANGED, List.of(99L), null, issueId, null));
    assertThat(m.body()).isEqualTo("시스템님이 상태를 변경했습니다");
  }

  @Test
  void forInbox_deletedIssue_returnsNull() {
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.COMMENTED, List.of(1L), null, -1L, null));
    assertThat(m).isNull();
  }

  @Test
  void forInbox_missingEvent_returnsNull() {
    assertThat(
            content.forInbox(
                new InboxPushRequestedEvent(
                    1L, NotificationType.REMINDER, List.of(1L), null, null, -1L)))
        .isNull();
  }

  /** 일정 취소(WP-712) — 일정 행이 없어도 알림에 담긴 제목으로 푸시하고, 지운 일정 대신 캘린더를 연다. */
  @Test
  void forInbox_calendarCanceled_usesSnapshotTitle() {
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L,
                NotificationType.CALENDAR_EVENT_CANCELED,
                PushCategory.CALENDAR,
                List.of(99L),
                null,
                null,
                null,
                null,
                "분기 리뷰"));

    assertThat(m).isNotNull();
    assertThat(m.category()).isEqualTo(PushCategory.CALENDAR);
    assertThat(m.title()).isEqualTo("분기 리뷰");
    assertThat(m.body()).isEqualTo("시스템님이 일정을 취소했습니다");
    assertThat(m.url()).isEqualTo("/calendar");
  }

  /** 이슈 챗 AI 질문(WP-452) — MENTION 카테고리여도 이슈 문구로 조립되고, 이동 경로는 챗 드로워(?chat=1). */
  @Test
  void forInbox_aiQuestion_mentionCategory_buildsIssueChatMessage() {
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L,
                NotificationType.AI_QUESTION,
                PushCategory.MENTION,
                List.of(99L),
                actor,
                issueId,
                null));

    assertThat(m).isNotNull();
    assertThat(m.category()).isEqualTo(PushCategory.MENTION);
    assertThat(m.title()).isEqualTo(key + "-7 로그인 버그");
    assertThat(m.body()).isEqualTo("박민수님이 이슈 챗에서 질문했습니다");
    assertThat(m.url()).isEqualTo("/projects/" + key + "/issues/7?chat=1");
  }

  /** 이슈 챗 멘션(WP-452) — 기본 카테고리 MENTION, 챗 드로워 경로. */
  @Test
  void forInbox_issueChatMention_buildsMentionMessage() {
    seedIssue();
    PushMessage m =
        content.forInbox(
            new InboxPushRequestedEvent(
                1L, NotificationType.ISSUE_CHAT_MENTION, List.of(99L), actor, issueId, null));

    assertThat(m.category()).isEqualTo(PushCategory.MENTION);
    assertThat(m.body()).isEqualTo("박민수님이 이슈 챗에서 회원님을 멘션했습니다");
    assertThat(m.url()).isEqualTo("/projects/" + key + "/issues/7?chat=1");
  }
}

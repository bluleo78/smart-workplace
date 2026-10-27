package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.notify.dto.NotificationActor;
import com.workplace.notify.dto.NotificationResponse;
import com.workplace.notify.dto.NotificationSettingItem;
import com.workplace.notify.repository.NotificationSettingRepository;
import com.workplace.notify.service.NotificationService;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * AI 작업 상태 알림(WP-913) 통합 테스트 — 실제 HTTP 로 report_agent_work(PUT /agent-work)를 부르고, 커밋 뒤 비동기로 만들어지는
 * 알림 행을 확인한다.
 *
 * <p>규칙: AI 작업자가 보고한 상태가 <b>그 값으로 바뀌는 순간</b>에만 — REVIEW → AI_REVIEW_REQUESTED, FAILED·REJECTED →
 * AI_WORK_FAILED(수신자 = AI 담당 행의 assigned_by, 사람이 아니거나 못 보면 보고자), AUTH_REQUIRED·BLOCKED·글 없는
 * INPUT_REQUIRED → AI_QUESTION(이슈의 사람 관계자). 글 있는 INPUT_REQUIRED 는 이슈 챗 질문 경로 하나뿐.
 * CANCELED·COMPLETED 는 알림 없음.
 *
 * <p>시드(AgentWorkTestSupport): 보고자 = human, 담당자 human·agent(둘 다 assigned_by=human), 비담당 프로젝트 멤버
 * other.
 */
class AgentWorkNoticeTest extends AgentWorkTestSupport {

  private static final String REVIEW_REQUESTED = "AI_REVIEW_REQUESTED";
  private static final String WORK_FAILED = "AI_WORK_FAILED";
  private static final String AI_QUESTION = "AI_QUESTION";
  private static final String MENTION = "ISSUE_CHAT_MENTION";

  @Autowired NotificationSettingRepository settingRepository;
  @Autowired NotificationService notificationService;

  /** 알림 행 — 상태 이름(status_name)도 읽어 AI 작업 상태가 그 칸에 새지 않았는지 본다. */
  record Row(String type, Long actorId, String agentWorkState, String statusName) {}

  // ------------------------------------------------------------------ 검토 요청

  @Test
  void review_firstTransition_notifiesAssigner() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));

    awaitCount(humanId, REVIEW_REQUESTED, 1);
    Row row = ofType(humanId, REVIEW_REQUESTED).get(0);
    assertThat(row.actorId()).isEqualTo(agentId);
    assertThat(row.agentWorkState()).isEqualTo("REVIEW");
    assertThat(row.statusName()).isNull();
    // 서비스 조회 응답에도 그대로 실린다(웹이 상태별 문구를 고르는 값).
    NotificationResponse res =
        inTenant(() -> notificationService.listRecent(humanId, 50, 0)).stream()
            .filter(n -> REVIEW_REQUESTED.equals(n.type()))
            .findFirst()
            .orElseThrow();
    assertThat(res.agentWorkState()).isEqualTo("REVIEW");
    assertThat(res.statusName()).isNull();
    assertStays(otherId, REVIEW_REQUESTED, 0);
  }

  @Test
  void review_sameStateAgain_notNotified() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));
    awaitCount(humanId, REVIEW_REQUESTED, 1);

    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW", "note", "PR 링크 갱신")));

    assertStays(humanId, REVIEW_REQUESTED, 1);
  }

  @Test
  void review_reenteredAfterWorking_notifiesAgain() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));
    awaitCount(humanId, REVIEW_REQUESTED, 1);
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));

    awaitCount(humanId, REVIEW_REQUESTED, 2);
  }

  // ------------------------------------------------------------------ 보고 글의 멘션 — 보고 하나 = 사람당
  // 1건(WP-1009)

  /** 검토 요청을 받는 사람을 글에서 멘션해도 검토 요청 1건만 — 멘션 알림을 따로 만들지 않는다. */
  @Test
  void review_mentioningAssigner_onlyReviewRequested() {
    assertOk(
        putReport(
            akToken, TOOL, Map.of("state", "REVIEW", "message", "<@" + humanId + "> 리뷰 부탁해요")));

    awaitCount(humanId, REVIEW_REQUESTED, 1);
    assertStays(humanId, MENTION, 0);
  }

  /** 검토 요청을 꺼 둔 대리인을 멘션해도 같은 보고가 멘션 알림으로 새어 들어가지 않는다(코멘트 알림과 같은 규칙). */
  @Test
  void review_mentioningAssignerWhoMutedReview_getsNothing() {
    inTenantRun(
        () ->
            settingRepository.upsertCell(
                humanId,
                NotificationSettingItem.ISSUE_AI_REVIEW_REQUESTED,
                NotificationActor.AGENT,
                false));

    assertOk(
        putReport(
            akToken, TOOL, Map.of("state", "REVIEW", "message", "<@" + humanId + "> 리뷰 부탁해요")));

    assertStays(humanId, REVIEW_REQUESTED, 0);
    assertStays(humanId, MENTION, 0);
  }

  /** 검토 요청을 받지 않는 다른 사람을 멘션하면 그 사람은 멘션 알림을 받는다. */
  @Test
  void review_mentioningOther_otherGetsMention() {
    assertOk(
        putReport(akToken, TOOL, Map.of("state", "REVIEW", "message", "<@" + otherId + "> 참고")));

    awaitCount(humanId, REVIEW_REQUESTED, 1);
    awaitCount(otherId, MENTION, 1);
    assertThat(ofType(otherId, MENTION).get(0).actorId()).isEqualTo(agentId);
    assertStays(humanId, MENTION, 0);
  }

  /** 알릴 상태 변화가 없는 진행 보고 — 멘션된 사람만 멘션 알림, 멘션이 없으면 아무 알림도 없다. */
  @Test
  void working_mention_notifiesMentionedOnly() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "진행 중")));
    assertOk(
        putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "<@" + otherId + "> 확인")));

    awaitCount(otherId, MENTION, 1);
    assertStays(humanId, MENTION, 0);
    assertStays(humanId, AI_QUESTION, 0);
  }

  /** 막힘 + 멘션 — 관계자와 멘션된 사람 모두 「답변 필요」 1건씩, 멘션 알림은 따로 없다. */
  @Test
  void blocked_mention_mergedIntoNeedsInput() {
    assertOk(
        putReport(
            akToken,
            TOOL,
            Map.of("state", "BLOCKED", "message", "<@" + humanId + "> <@" + otherId + "> 막혔어요")));

    awaitCount(humanId, AI_QUESTION, 1);
    awaitCount(otherId, AI_QUESTION, 1);
    assertStays(humanId, MENTION, 0);
    assertStays(otherId, MENTION, 0);
  }

  /** 실패를 받는 사람을 멘션해도 실패 알림 1건만. */
  @Test
  void failed_mentioningAssigner_onlyWorkFailed() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(
        putReport(akToken, TOOL, Map.of("state", "FAILED", "message", "<@" + humanId + "> 실패했어요")));

    awaitCount(humanId, WORK_FAILED, 1);
    assertStays(humanId, MENTION, 0);
  }

  /** 사람이 자기 도구로 보고해도 글의 멘션은 알린다(상태 알림은 AI 작업자만). */
  @Test
  void humanWorker_mention_notifiesMentioned() {
    assertOk(
        putReport(
            patToken, TOOL, Map.of("state", "REVIEW", "message", "<@" + otherId + "> 봐 주세요")));

    awaitCount(otherId, MENTION, 1);
    assertThat(ofType(otherId, MENTION).get(0).actorId()).isEqualTo(humanId);
    assertStays(otherId, REVIEW_REQUESTED, 0);
  }

  // ------------------------------------------------------------------ 실패·거절

  @Test
  void failed_and_rejected_notifyAssigner() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "FAILED")));
    awaitCount(humanId, WORK_FAILED, 1);
    assertThat(ofType(humanId, WORK_FAILED).get(0).agentWorkState()).isEqualTo("FAILED");

    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "REJECTED")));
    awaitCount(humanId, WORK_FAILED, 2);
    assertThat(ofType(humanId, WORK_FAILED))
        .extracting(Row::agentWorkState)
        .containsExactlyInAnyOrder("FAILED", "REJECTED");
    assertThat(ofType(humanId, WORK_FAILED)).extracting(Row::statusName).containsOnlyNulls();
  }

  @Test
  void failed_withoutActiveWork_notNotified() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "FAILED")));
    awaitCount(humanId, WORK_FAILED, 1);

    // 이미 끝난 작업에 다시 실패 보고 — 닫을 진행 중 작업이 없어 알림도 없다.
    assertOk(putReport(akToken, TOOL, Map.of("state", "FAILED")));

    assertStays(humanId, WORK_FAILED, 1);
  }

  @Test
  void canceled_and_completed_notNotified() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "CANCELED")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "COMPLETED")));

    assertStays(humanId, REVIEW_REQUESTED, 0);
    assertStays(humanId, WORK_FAILED, 0);
  }

  // ------------------------------------------------------------------ 답변 필요

  @Test
  void authRequired_and_blocked_notifyAsNeedsInput() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "AUTH_REQUIRED")));
    awaitCount(humanId, AI_QUESTION, 1);
    assertThat(ofType(humanId, AI_QUESTION).get(0).agentWorkState()).isEqualTo("AUTH_REQUIRED");

    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(akToken, TOOL, Map.of("state", "BLOCKED")));
    awaitCount(humanId, AI_QUESTION, 2);
    assertThat(ofType(humanId, AI_QUESTION))
        .extracting(Row::agentWorkState)
        .containsExactlyInAnyOrder("AUTH_REQUIRED", "BLOCKED");
    assertThat(ofType(humanId, AI_QUESTION)).extracting(Row::statusName).containsOnlyNulls();
    // 수신자는 기존 AI 질문 규칙(보고자 ∪ 담당자 ∪ 워처, 사람) — 비담당 멤버는 받지 않는다.
    assertStays(otherId, AI_QUESTION, 0);
  }

  @Test
  void inputRequiredWithoutMessage_notifiesOnce() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED")));
    awaitCount(humanId, AI_QUESTION, 1);
    assertOk(putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED")));

    assertStays(humanId, AI_QUESTION, 1);
    assertThat(ofType(humanId, AI_QUESTION).get(0).agentWorkState()).isEqualTo("INPUT_REQUIRED");
  }

  @Test
  void inputRequiredWithMessage_singleAiQuestion() {
    assertOk(putReport(akToken, TOOL, Map.of("state", "INPUT_REQUIRED", "message", "어느 쪽?")));

    awaitCount(humanId, AI_QUESTION, 1);
    assertStays(humanId, AI_QUESTION, 1);
    // 이슈 챗 질문 경로로 만들어진 것이라 AI 작업 상태 칸은 비어 있다.
    assertThat(ofType(humanId, AI_QUESTION).get(0).agentWorkState()).isNull();
  }

  // ------------------------------------------------------------------ 수신자 대체

  @Test
  void assigner_isOther_notReporter() {
    setAgentAssignedBy(otherId);

    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));

    awaitCount(otherId, REVIEW_REQUESTED, 1);
    assertStays(humanId, REVIEW_REQUESTED, 0);
  }

  @Test
  void assigner_isAgent_fallsBackToReporter() {
    // AI 가 스스로 맡았다 — 할당자가 AI 라 보고자에게 간다.
    setAgentAssignedBy(agentId);

    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));

    awaitCount(humanId, REVIEW_REQUESTED, 1);
  }

  @Test
  void assigner_cannotRead_fallsBackToReporter() {
    // 프로젝트 비멤버 — 프로젝트 기본 공개 범위(TEAM)라 이슈를 볼 수 없다.
    long outsider = addHuman("aw-outsider");
    setAgentAssignedBy(outsider);

    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));

    awaitCount(humanId, REVIEW_REQUESTED, 1);
    assertStays(outsider, REVIEW_REQUESTED, 0);
  }

  @Test
  void review_assignerDisabled_noFallbackToReporter() {
    setAgentAssignedBy(otherId);
    inTenantRun(
        () ->
            settingRepository.upsertCell(
                otherId,
                NotificationSettingItem.ISSUE_AI_REVIEW_REQUESTED,
                NotificationActor.AGENT,
                false));

    assertOk(putReport(akToken, TOOL, Map.of("state", "REVIEW")));

    // 할당자가 끈 알림이 보고자에게 넘어가지 않는다.
    assertStays(otherId, REVIEW_REQUESTED, 0);
    assertStays(humanId, REVIEW_REQUESTED, 0);
  }

  // ------------------------------------------------------------------ 사람 작업자·완료 경로

  @Test
  void humanWorker_noNotice() {
    // 사람이 자기 도구로 보고 — AI 작업 알림 대상이 아니다. 할당자를 other 로 두어 가드가 없으면 other 가 받게 한다.
    inTenantRun(
        () ->
            dsl.update(ISSUE_ASSIGNEE)
                .set(ISSUE_ASSIGNEE.ASSIGNED_BY, otherId)
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
                .and(ISSUE_ASSIGNEE.USER_ID.eq(humanId))
                .execute());

    assertOk(putReport(patToken, TOOL, Map.of("state", "REVIEW")));

    assertStays(otherId, REVIEW_REQUESTED, 0);
    assertStays(humanId, REVIEW_REQUESTED, 0);
  }

  @Test
  void humanWorker_failed_noNotice() {
    // 종료 경로(실패)도 작업자 종류로 거른다 — 종료 경로엔 작업 뷰가 없어 담당자 조회에서 얻은 종류로 판정한다.
    inTenantRun(
        () ->
            dsl.update(ISSUE_ASSIGNEE)
                .set(ISSUE_ASSIGNEE.ASSIGNED_BY, otherId)
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
                .and(ISSUE_ASSIGNEE.USER_ID.eq(humanId))
                .execute());

    assertOk(putReport(patToken, TOOL, Map.of("state", "WORKING")));
    assertOk(putReport(patToken, TOOL, Map.of("state", "FAILED")));

    assertStays(otherId, WORK_FAILED, 0);
    assertStays(humanId, WORK_FAILED, 0);
  }

  @Test
  void completePath_workingThenDone_noReviewNotice() {
    // work-done 「완료」 순서 — WORKING 보고(요약 글) → 이슈 DONE. 검토 대기(REVIEW)를 거치지 않는다.
    assertOk(putReport(akToken, TOOL, Map.of("state", "WORKING", "message", "요약")));
    assertOk(patch(akToken, Map.of("status", "DONE"), TOOL));

    List<String> states = allStates(issueId, agentId);
    assertThat(states.get(states.size() - 1)).isEqualTo("COMPLETED");
    assertThat(activeWork(issueId, agentId)).isEmpty();
    assertStays(humanId, REVIEW_REQUESTED, 0);
    assertStays(otherId, REVIEW_REQUESTED, 0);
  }

  // ------------------------------------------------------------------ 헬퍼

  /** agent 담당 행의 할당자(assigned_by)를 바꾼다. */
  private void setAgentAssignedBy(long assignedBy) {
    inTenantRun(
        () ->
            dsl.update(ISSUE_ASSIGNEE)
                .set(ISSUE_ASSIGNEE.ASSIGNED_BY, assignedBy)
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))
                .and(ISSUE_ASSIGNEE.USER_ID.eq(agentId))
                .execute());
  }

  /** 이 이슈에서 그 사람이 받은 알림(id 순). */
  private List<Row> notifs(long recipientId) {
    return inTenant(
        () ->
            dsl.select(
                    NOTIFICATION.TYPE,
                    NOTIFICATION.ACTOR_ID,
                    NOTIFICATION.AGENT_WORK_STATE,
                    NOTIFICATION.STATUS_NAME)
                .from(NOTIFICATION)
                .where(NOTIFICATION.RECIPIENT_ID.eq(recipientId))
                .and(NOTIFICATION.ISSUE_ID.eq(issueId))
                .orderBy(NOTIFICATION.ID.asc())
                .fetch(
                    r ->
                        new Row(
                            r.get(NOTIFICATION.TYPE),
                            r.get(NOTIFICATION.ACTOR_ID),
                            r.get(NOTIFICATION.AGENT_WORK_STATE),
                            r.get(NOTIFICATION.STATUS_NAME))));
  }

  /** 그 유형만 — 자동 상태 전이(TODO → 진행 중)가 남기는 STATUS_CHANGED 등에 개수가 흔들리지 않게. */
  private List<Row> ofType(long recipientId, String type) {
    return notifs(recipientId).stream().filter(r -> type.equals(r.type())).toList();
  }

  /** 알림은 커밋 뒤 비동기로 만들어진다 — 개수가 될 때까지 기다린다. */
  private void awaitCount(long recipientId, String type, int expected) {
    await()
        .atMost(Duration.ofSeconds(5))
        .untilAsserted(() -> assertThat(ofType(recipientId, type)).hasSize(expected));
  }

  /**
   * 개수가 한동안 그대로인지 — 「더 생기지 않음」은 비동기라 일정 시간 지켜볼 수밖에 없다(고정 대기를 피할 수 없는 부재 확인). 800ms 동안 계속 같아야 통과한다.
   */
  private void assertStays(long recipientId, String type, int expected) {
    await()
        .during(Duration.ofMillis(800))
        .atMost(Duration.ofSeconds(3))
        .until(() -> ofType(recipientId, type).size() == expected);
  }
}

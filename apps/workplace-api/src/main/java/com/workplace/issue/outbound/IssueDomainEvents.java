package com.workplace.issue.outbound;

import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 이슈 도메인 이벤트 5종. ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 dispatcher 가 받는다. assignees 는
 * 변경 후 현재 상태.
 */
public final class IssueDomainEvents {
  private IssueDomainEvents() {}

  /** 이슈 생성 직후. assignees 가 비어있을 수도 있음. */
  public record IssueCreatedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      String status,
      String priority,
      UserSummary actor,
      List<UserSummary> assignees,
      Instant occurredAt) {}

  /** 보고자 변경(WP-944). from 은 이전 보고자(사용자 행이 없으면 null), to 는 새 보고자. */
  public record IssueReporterChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      UserSummary from,
      UserSummary to,
      Instant occurredAt) {}

  /**
   * assignee 집합 변경. added/removed 는 diff. wakeAgent=false 면 ai-agent 발사(IssueEventDispatcher)만 건너뛴다
   * — 챗 스레드 멤버 반영·배정 알림 같은 다른 리스너는 그대로 받는다(WP-989: 반복 저장이 비서를 담당에 넣을 때 「지금 시작하라」는 뜻이 아니다).
   */
  public record IssueAssignedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      List<UserSummary> added,
      List<UserSummary> removed,
      Instant occurredAt,
      boolean wakeAgent) {

    /** 보통의 담당 변경 — AI 담당자를 깨운다. */
    public IssueAssignedEvent(
        long issueId,
        String projectKey,
        String issueKey,
        String title,
        UserSummary actor,
        List<UserSummary> assignees,
        List<UserSummary> added,
        List<UserSummary> removed,
        Instant occurredAt) {
      this(
          issueId, projectKey, issueKey, title, actor, assignees, added, removed, occurredAt, true);
    }
  }

  /**
   * 코멘트 추가. commentBody 는 agent 응답 트리거의 핵심 컨텍스트라 포함. issueNumber 는 SSE 브로드캐스트(#579)가 프론트
   * 쿼리키(issueKeys.detail(projectKey, number))를 그대로 구성하는 데 필요 — issueKey 문자열 파싱을 피한다.
   */
  public record IssueCommentedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      int issueNumber,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      String commentBody,
      Instant occurredAt) {}

  /** 코멘트 수정 (#717). commentBody 는 수정된(새) 본문. */
  public record IssueCommentUpdatedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      int issueNumber,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      String commentBody,
      Instant occurredAt) {}

  /** 코멘트 soft-delete (#717). */
  public record IssueCommentDeletedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      int issueNumber,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long commentId,
      Instant occurredAt) {}

  /**
   * 코멘트 반응 추가·취소(WP-504). 실시간 재조회 신호 전용 — 알림·ai-agent 발사·AI 요약 갱신 대상이 아니다(반응은 알림을 만들지 않는다). 무엇이
   * 바뀌었는지는 싣지 않는다: 받는 쪽은 코멘트 목록을 다시 받아 보는 사람별 reacted 를 얻는다.
   */
  public record IssueCommentReactionsChangedEvent(
      Long issueId,
      String issueKey,
      String projectKey,
      int issueNumber,
      Long commentId,
      Long actorId) {}

  /**
   * 상태 전이 (예: TODO → IN_PROGRESS). previousStatus·newStatus 는 범주, previousStatusName·newStatusName
   * 은 사람이 읽는 프로젝트 상태 이름(WP-807). 같은 범주 안 이동(진행 중 → 검토 중)도 발행되며 그때는 범주가 같다.
   */
  public record IssueStatusChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      String previousStatus,
      String newStatus,
      String previousStatusName,
      String newStatusName,
      Instant occurredAt) {}

  /** 우선순위 변경 (예: MID → HIGHEST). 상태 변경과 대칭적으로 모든 변경에 발행(임계치 조건 없음, #613). */
  public record IssuePriorityChangedEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      String previousPriority,
      String newPriority,
      Instant occurredAt) {}

  /**
   * 반복 AI 작업(WP-989)의 회차 실행 — 스케줄러가 회차 시각이 된 반복마다 발행한다. 담당 AI(actingAgentId = 반복에 등록된 비서)가 이슈 본문의
   * 요청을 이번 회차로 수행하고 결과를 내부 보고로 돌려준다. actor 는 반복을 등록한 사람이다.
   *
   * @param ownerUserId 반복을 등록한 사람(이슈 소유자) — 회차의 도구는 이 사람 권한으로 돈다(홈 AI 채팅과 같은 대행)
   * @param runId 회차 id("<issueId>-<runAt epoch 초>") — 결과 보고가 같은 회차를 두 번 반영하지 않게 쓴다
   * @param runAt 이번 회차의 예정 시각(이어 처리는 답을 받은 시각)
   * @param round 몇 번째 회차인지(1부터). 이어 처리(WP-1312)는 null — 페이로드에 싣지 않는다
   * @param time KST 실행 시각 "HH:mm"
   * @param issueBody 이슈 본문(마크다운). 없으면 null
   * @param followUp 회차가 남긴 질문에 소유자가 답해 보내는 이어 처리면 그 질문과 답(WP-1312), 정기 회차면 null. 이어 처리도 같은 이벤트·같은
   *     실행 경로(같은 AI·소유자 권한·recurring 프로필)를 타고, runId 만 이어 처리 id("<issueId>-f<답 글 id>")다
   * @param test 「지금 실행」으로 보낸 테스트 실행이거나 그 질문의 답으로 보낸 이어 처리인지(WP-1313) — ai-agent 가 되돌릴 수 없는 쓰기를 멈추는
   *     도구 프로필(recurring-test)로 돌린다. 테스트 실행의 runId 는 "<issueId>-t<보낸 시각 ms>"다
   * @param recentChat 사람이 이슈 챗에 남긴 최근 글과 담당 AI 의 마지막 글(WP-1375) — 회차 지시문이 이슈 본문만으로는 모르는 사람의 결정·답을
   *     읽게 한다. 둘 다 없으면 null(페이로드에 키를 싣지 않는다)
   */
  public record IssueRecurringRunEvent(
      long issueId,
      String projectKey,
      String issueKey,
      String title,
      UserSummary actor,
      List<UserSummary> assignees,
      long actingAgentId,
      long ownerUserId,
      String runId,
      Instant runAt,
      Integer round,
      String rrule,
      String time,
      String issueBody,
      Instant occurredAt,
      FollowUp followUp,
      boolean test,
      RecentChat recentChat) {

    /**
     * 회차 지시문에 싣는 이슈 챗 맥락(WP-1375). 상한(건수·글자 수)은 만드는 쪽({@code IssueRecurrenceRecentChat})이 이미 적용했다.
     *
     * @param humanMessages 사람(HUMAN)이 이 이슈 챗에 남긴 최근 글 — 오래된 순. 지난 회차 이후 글인지는 각 줄의 isNew. 없으면 빈 목록
     * @param lastResult 담당 AI 가 이 이슈 챗에 남긴 가장 최근 글. 회차 결과 글만 가릴 표시가 저장되지 않아(챗 답글·안내 글과 같은 행) 「직전 회차
     *     결과」가 아니라 「담당 AI 의 마지막 글」이다. 없으면 null
     */
    public record RecentChat(List<ChatLine> humanMessages, ChatLine lastResult) {}

    /**
     * 이슈 챗 글 한 줄(WP-1375).
     *
     * @param authorName 글쓴이 이름 — 담당 AI 의 마지막 글은 페이로드에 싣지 않는다
     * @param body 상한을 적용한 본문(넘치면 잘라 「…」를 붙였다)
     * @param createdAt 글을 남긴 시각
     * @param owner 반복을 맡긴 사람(저장한 사람, created_by)의 글인지 — 회차는 이 글의 결정·답만 따른다(다른 멤버 글이 맡긴 사람 권한의 쓰기를
     *     움직이지 않게). 담당 AI 의 마지막 글은 false
     * @param isNew 지난 회차(이번 실행 전 lastRunAt) 이후 글인지 — 지난 회차가 없으면 모두 true. 담당 AI 의 마지막 글은 false
     */
    public record ChatLine(
        String authorName, String body, Instant createdAt, boolean owner, boolean isNew) {}

    /**
     * 이어 처리의 맥락(WP-1312) — ai-agent 가 「질문 X 에 소유자가 Y 라고 답했다, 이어서 하라」는 지시문을 만든다.
     *
     * @param question 회차·이어 처리가 남긴 질문 본문
     * @param answer 답 글 본문(멘션 토큰 포함 원문). 답한 사람은 이벤트 actor 다 — 정기 회차 질문은 소유자, 테스트 질문은 「지금 실행」을 누른
     *     사람(WP-1313)만 답할 수 있다
     * @param permittedActions 테스트 질문(WP-1313)이 멈춘 되돌릴 수 없는 쓰기 — 답을 받은 이어 처리가 이 쓰기만(하나당 한 번) 실행할 수
     *     있다. 정기 회차 질문은 null
     */
    public record FollowUp(
        String question,
        String answer,
        java.util.List<com.workplace.issue.dto.RecurringPausedAction> permittedActions) {

      /** 정기 회차 질문의 이어 처리 — 허락된 쓰기 목록이 없다. */
      public FollowUp(String question, String answer) {
        this(question, answer, null);
      }
    }
  }
}

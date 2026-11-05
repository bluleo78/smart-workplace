package com.workplace.issue.outbound;

import java.util.Optional;

/**
 * 실행 일정이 걸린 작업의 이슈챗에서 멘션 없이도 답할 담당 AI 를 판정하는 포트(WP-1377).
 *
 * <p>chat 모듈이 사람 글을 저장할 때(멘션 없는 글)와 스레드 화면 응답을 만들 때 부른다 — {@link RecurringQuestionAnswers} 와 같은
 * 자리·같은 의존 방향(chat → issue 포트). 일정·담당자·프로젝트는 issue 데이터라 issue 모듈이 판정하고, 스레드 멤버·직전 글은 chat 데이터라 chat
 * 쪽이 {@link Mode} 를 보고 마저 판정한다.
 */
public interface ImplicitChatAgents {

  /**
   * 이 이슈챗에서 글쓴이(actorId)의 멘션 없는 글에 답할 담당 AI. 조건: 이슈에 실행 일정(지우지 않은 행 — 꺼짐·멈춤·끝난 한 번만 포함)이 있고, 그 일정
   * AI 가 아직 이슈 담당이고 서버 실행(INTERNAL·활성) AI 이고, 이슈 담당자에 외부 실행 AI 가 없고(있으면 그 AI 가 멘션 없는 답을 이어받는다 —
   * WP-373), 글쓴이가 일정을 건 사람이거나 이슈의 사람 담당자이고, 일정 AI 가 남의 개인 비서가 아니다(개인 비서는 주인의 글에만). 개인 작업이면 {@link
   * Mode#ALWAYS}, 팀 이슈면 {@link Mode#AFTER_AI_REPLY} — 팀 이슈의 「스레드 멤버가 글쓴이와 담당 AI 뿐이면 늘」은 chat 쪽이
   * 올린다.
   *
   * @param issueId 이슈 id
   * @param actorId 글쓴이(또는 화면을 보는 사람)
   * @return 답할 담당 AI. 조건이 맞지 않으면 비어 있다
   */
  Optional<ImplicitChatAgent> resolve(long issueId, long actorId);

  /** 멘션 없이도 답하는 방식(WP-1377). */
  enum Mode {
    /** 멘션 없는 글마다 답한다 — 개인 작업, 또는 스레드 멤버가 글쓴이와 담당 AI 뿐인 팀 이슈. */
    ALWAYS,
    /** 직전 글이 그 담당 AI 의 글일 때만 답한다 — 여러 사람이 함께 쓰는 팀 이슈챗에서 사람끼리 대화에 끼지 않게. */
    AFTER_AI_REPLY
  }

  /**
   * 멘션 없이도 답할 담당 AI(WP-1377).
   *
   * @param agentId 일정 담당 AI id
   * @param agentName 화면 안내에 쓸 AI 이름
   * @param mode 답하는 방식
   */
  record ImplicitChatAgent(long agentId, String agentName, Mode mode) {
    /** 같은 AI·이름으로 방식만 바꾼다 — chat 쪽이 스레드 멤버로 ALWAYS 로 올릴 때 쓴다. */
    public ImplicitChatAgent withMode(Mode m) {
      return new ImplicitChatAgent(agentId, agentName, m);
    }
  }
}

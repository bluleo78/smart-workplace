package com.workplace.issue.outbound;

/**
 * 이슈 챗에 글을 올리는 포트(WP-377). issue→chat 직접 의존(순환)을 피하려고 issue 모듈이 인터페이스를 소유하고 chat 모듈이
 * 구현한다(chat→issue 는 기존 의존).
 */
public interface IssueChatPoster {
  /**
   * 호출자 이름으로 이슈 챗에 보고 글을 올리고 메시지 id 를 돌려준다. question 이면 "답변 필요 질문"으로 함께 저장한다(WP-373 — 예전
   * markQuestion 사후 표시를 대체). 보고 글은 사람의 답으로 치지 않는다.
   */
  long post(long callerId, String projectKey, int issueNumber, String body, boolean question);
}

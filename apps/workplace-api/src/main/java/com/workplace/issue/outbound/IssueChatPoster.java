package com.workplace.issue.outbound;

/**
 * 이슈 챗에 글을 올리는 포트(WP-377). issue→chat 직접 의존(순환)을 피하려고 issue 모듈이 인터페이스를 소유하고 chat 모듈이
 * 구현한다(chat→issue 는 기존 의존).
 */
public interface IssueChatPoster {
  /** 호출자 이름으로 이슈 챗에 글을 올리고 메시지 id 를 돌려준다. */
  long post(long callerId, String projectKey, int issueNumber, String body);

  /** 올린 글을 "답변 필요 질문"으로 표시한다. */
  void markQuestion(long messageId);
}

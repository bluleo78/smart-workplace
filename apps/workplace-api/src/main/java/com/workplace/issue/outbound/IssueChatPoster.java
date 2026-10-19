package com.workplace.issue.outbound;

import java.util.List;

/**
 * 이슈 챗에 글을 올리는 포트(WP-377). issue→chat 직접 의존(순환)을 피하려고 issue 모듈이 인터페이스를 소유하고 chat 모듈이
 * 구현한다(chat→issue 는 기존 의존).
 */
public interface IssueChatPoster {
  /**
   * 호출자 이름으로 이슈 챗에 보고 글을 올리고 메시지 id 를 돌려준다. question 이면 "답변 필요 질문"으로 함께 저장한다(WP-373 — 예전
   * markQuestion 사후 표시를 대체). 보고 글은 사람의 답으로 치지 않는다. fileIds 는 호출자가 스테이징한 파일로, 같은 트랜잭션에서 이 글의 첨부로
   * 클레임한다(WP-515) — 쓸 수 없는 파일이면 예외가 나 보고 전체가 되돌려진다.
   */
  long post(
      long callerId,
      String projectKey,
      int issueNumber,
      String body,
      boolean question,
      List<Long> fileIds);
}

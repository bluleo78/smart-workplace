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
   * 클레임한다(WP-515) — 쓸 수 없는 파일이면 예외가 나 보고 전체가 되돌려진다. 답 선택지 없이 올린다 — 질문이면 서버가 커밋 뒤 질문 글에서 선택지를 뽑아
   * 채운다(WP-1569).
   */
  default long post(
      long callerId,
      String projectKey,
      int issueNumber,
      String body,
      boolean question,
      List<Long> fileIds) {
    return post(callerId, projectKey, issueNumber, body, question, fileIds, null);
  }

  /**
   * {@link #post(long, String, int, String, boolean, List)} 에 답 선택지를 더한 형태(WP-1569). options 는
   * 정리·검증을 마친 질문 글의 답 선택지(2~4개)로 question 일 때만 저장하고, null 이면 선택지 없음 — 질문이면 서버가 커밋 뒤 보완 추출한다.
   */
  long post(
      long callerId,
      String projectKey,
      int issueNumber,
      String body,
      boolean question,
      List<Long> fileIds,
      List<String> options);
}

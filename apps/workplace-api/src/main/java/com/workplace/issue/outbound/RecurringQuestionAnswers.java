package com.workplace.issue.outbound;

import java.util.OptionalLong;

/**
 * 이슈 챗 사람 글이 반복 회차(WP-989)가 남긴 질문에 대한 답인지 판정하고, 답이면 같은 AI 의 이어 처리를 보내는 포트(WP-1312).
 *
 * <p>chat 모듈이 사람 글을 저장한 그 트랜잭션에서 부른다(chat→issue 는 기존 의존 — {@link IssueHumanReplyPosted} 와 같은 방향).
 * 이벤트가 아니라 반환값이 있는 호출로 둔 까닭: 이어 처리로 깨운 AI 를 챗 생성 이벤트에 실어야 ChatEventDispatcher 가 같은 글의 @멘션 응답으로 그 AI
 * 를 또 깨우지 않는다(이중 응답 방지). issue 모듈이 소유·구현하고 chat 은 이 인터페이스만 안다.
 */
public interface RecurringQuestionAnswers {

  /**
   * 사람(HUMAN)이 화면에서 이슈 챗에 남긴 글 하나를 받는다 — 그 이슈 반복의 답을 기다리는 질문이 있고, 글쓴이가 반복 소유자이고, 질문 뒤의 글이고, 질문이
   * 기한(7일) 안이면 질문을 소비하고 이어 처리를 보낸다. 판정·발행이 실패해도 던지지 않는다(사람의 글 저장을 되돌리지 않는다). 예외 하나 — 답인데 같은 반복에 결과를
   * 기다리는 실행이 있으면 409 예외를 던진다(WP-1313). 호출자의 글 저장도 되돌려 사람이 결과가 남은 뒤 다시 답하게 한다(질문은 그대로 남는다).
   *
   * @param issueId 글이 달린 이슈
   * @param messageId 저장한 글 id
   * @param actorId 글쓴이(호출자가 사람만 넘긴다)
   * @param body 글 본문(멘션 토큰 포함 원문). 비었으면(첨부만) 답으로 보지 않는다
   * @return 이어 처리로 깨운 AI id. 답이 아니면 비어 있다
   */
  OptionalLong answer(long issueId, long messageId, long actorId, String body);
}

package com.workplace.issue.outbound;

/**
 * 이슈 챗 사람 글이 워크플로우 질문 대기 노드(질문 이동으로 들어간 `returnTo` human_task)의 답인지 판정하고, 답이면 실행을 {@code answered}
 * 로 옮겨 질문한 AI 노드로 돌려보내는 포트(WP-2093).
 *
 * <p>chat 모듈이 사람 글을 저장한 그 트랜잭션에서 부른다 — {@link RecurringQuestionAnswers} 와 같은 모양·같은 방향(chat→issue).
 * 반환값이 있는 호출로 둔 까닭도 같다: 이동으로 깨운 AI 를 챗 생성 이벤트에 실어야 같은 글의 @멘션·암묵 응답이 그 AI 를 또 깨우지 않는다(이중 깨우기 방지).
 */
public interface WorkflowQuestionAnswers {

  /**
   * 사람(HUMAN)이 화면에서 이슈 챗에 남긴 글 하나를 받는다 — 이슈의 활성 실행이 질문 대기(WAITING·지금 노드가 returnTo 가 있는 human_task
   * 이고 answered 결과가 있음)이고 글쓴이가 프로젝트 구성원이면 answered 이동을 한다. 담당 여부·멘션은 보지 않는다. 판정·이동이 실패해도 던지지 않는다 —
   * 구현이 세이브포인트로 감싸 log.warn 하고 「답 아님」으로 본다(사람의 글 저장을 되돌리지 않는다).
   *
   * @param issueId 글이 달린 이슈
   * @param messageId 저장한 글 id
   * @param actorId 글쓴이(호출자가 사람만 넘긴다)
   * @param body 글 본문(멘션 토큰 포함 원문). 보이는 글자가 없으면(첨부만) 답으로 보지 않는다
   * @return 답으로 소비했는지와 이 답으로 깨운 AI(돌아간 AI 노드의 AI 담당 전부). 답이 아니면 {@link WorkflowAnswer#NOT_ANSWER}
   */
  WorkflowAnswer answer(long issueId, long messageId, long actorId, String body);
}

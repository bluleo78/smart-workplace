package com.workplace.issue.outbound;

import java.util.List;

/**
 * {@link WorkflowQuestionAnswers#answer} 의 결과(WP-2093) — 사람 챗 글을 워크플로우 질문 대기의 답으로 「소비」했는지와 그 이동이 깨운
 * AI.
 *
 * <p>둘을 나눈 까닭: 답으로 소비했어도 돌아간 노드가 AI 노드가 아니거나 AI 담당이 없으면 깨운 AI 가 없다. 깨운 AI 만 돌려주면 이 경우가 「답 아님」과 구별되지
 * 않아 chat 이 같은 글로 반복 질문 답·암묵 응답까지 일으킨다(같은 글로 실행 이동과 또 다른 AI 실행이 함께 일어남). chat 은 {@code consumed} 면
 * 반복 답·암묵 응답 판정을 건너뛴다.
 *
 * @param consumed 이 글로 질문 대기 실행을 answered 로 옮겼는지
 * @param wokenAgentIds 이동이 돌아간 AI 노드에서 깨운 AI 담당(노드 담당 순서). 소비하지 않았거나 깨운 AI 가 없으면 빈 목록
 */
public record WorkflowAnswer(boolean consumed, List<Long> wokenAgentIds) {

  /** 답이 아님 — 실행을 움직이지 않았다. */
  public static final WorkflowAnswer NOT_ANSWER = new WorkflowAnswer(false, List.of());

  public WorkflowAnswer {
    wokenAgentIds = wokenAgentIds == null ? List.of() : List.copyOf(wokenAgentIds);
  }

  /** 답으로 소비했고 이 AI 들을 깨웠다(없으면 빈 목록). */
  public static WorkflowAnswer consumed(List<Long> wokenAgentIds) {
    return new WorkflowAnswer(true, wokenAgentIds);
  }
}

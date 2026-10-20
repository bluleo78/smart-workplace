package com.workplace.messaging.exception;

/**
 * AI 제안 카드를 AI(AGENT)가 아닌 호출자가 만들려 할 때(WP-589). 403 매핑 — 사람이 다른 멤버를 위임자로 「AI 제안」을 띄우면 위임자가 AI 제안으로
 * 믿고 승인해 그 사람 명의로 일정·이슈가 생긴다.
 */
public class ProposalAgentOnlyException extends RuntimeException {
  public ProposalAgentOnlyException() {
    super("AI 제안은 AI 만 만들 수 있습니다");
  }
}

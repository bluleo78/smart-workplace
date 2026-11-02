package com.workplace.issue.dto;

/**
 * AI 에이전트가 반복 회차 결과를 알리는 내부 보고(WP-989). ok 면 message 가 회차 결과(마크다운), 아니면 실패 사유다.
 *
 * @param runId 이벤트 issue.recurring_run 이 실어 보낸 회차 id — 같은 runId 두 번째 보고는 무시한다
 * @param question 이슈 본문이 확인을 받으라고 해 쓰기를 멈춘 회차(WP-1311) — 결과 글을 답변이 필요한 질문으로 남긴다. 빠지면 false
 */
public record IssueRecurrenceRunReport(String runId, boolean ok, String message, Boolean question) {

  /** 질문 회차인지 — 성공 보고만 질문일 수 있다(실패 사유 글은 질문이 아니다). */
  public boolean asQuestion() {
    return ok && Boolean.TRUE.equals(question);
  }
}

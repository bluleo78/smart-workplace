package com.workplace.issue.dto;

/**
 * 서버가 돌리는(INTERNAL) AI 의 이슈 실행 보고(WP-1219) — ai-agent 가 담당 지정·코멘트로 깨어난 실행의 시작과 끝을 알린다. 서버는 이것으로 그
 * AI 의 작업 기록(agent_work)을 남겨, 내부 AI 가 맡은 이슈도 AI 위임 작업에 모이게 한다.
 *
 * @param phase {@code STARTED}(실행 시작) 또는 {@code FINISHED}(실행 끝)
 * @param ok FINISHED 일 때 실행이 정상으로 끝났는지 — 아니면 「막힘」으로 남긴다(STARTED 에서는 쓰지 않는다)
 * @param note FINISHED 이고 ok 가 아닐 때의 실패 사유(짧은 한 줄, 길면 서버가 자른다)
 */
public record ServerAgentRunReport(String phase, boolean ok, String note) {

  public static final String STARTED = "STARTED";
  public static final String FINISHED = "FINISHED";
}

package com.workplace.issue.dto;

import java.util.UUID;

/**
 * 서버가 돌리는(INTERNAL) AI 의 이슈 실행 보고(WP-1219) — ai-agent 가 담당 지정·코멘트로 깨어난 실행의 시작과 끝을 알린다. 서버는 이것으로 그
 * AI 의 작업 기록(agent_work)을 남겨, 내부 AI 가 맡은 이슈도 AI 위임 작업에 모이게 한다.
 *
 * @param phase {@code STARTED}(실행 시작) 또는 {@code FINISHED}(실행 끝)
 * @param ok FINISHED 일 때 실행이 정상으로 끝났는지 — 아니면 「차단됨」으로 남긴다(STARTED 에서는 쓰지 않는다)
 * @param note FINISHED 이고 ok 가 아닐 때의 실패 사유(짧은 한 줄, 길면 서버가 자른다)
 * @param runId ai-agent 가 실행마다 만든 id(UUID 문자열, WP-1986) — STARTED·FINISHED 에 같은 값이 실려, 끝 보고가 어느 실행의
 *     것인지 가른다. 옛 ai-agent 는 보내지 않으므로 없어도(null) 받는다. 형식이 틀리면 없는 것으로 본다({@link #runUuid()})
 */
public record ServerAgentRunReport(String phase, boolean ok, String note, String runId) {

  public static final String STARTED = "STARTED";
  public static final String FINISHED = "FINISHED";

  /**
   * runId 를 UUID 로 — 없거나 UUID 형식이 아니면 null. 보고는 결과와 상관없이 조용히 넘기는 경로라 형식 오류로 400 을 내지 않고 「어느 실행인지
   * 모름」으로 다룬다.
   */
  public UUID runUuid() {
    if (runId == null || runId.isBlank()) return null;
    try {
      UUID parsed = UUID.fromString(runId.strip());
      // UUID.fromString 은 「1-2-3-4-5」 같은 짧은 꼴도 받으므로, 다시 쓴 표준 꼴과 같을 때만 받는다.
      return parsed.toString().equalsIgnoreCase(runId.strip()) ? parsed : null;
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}

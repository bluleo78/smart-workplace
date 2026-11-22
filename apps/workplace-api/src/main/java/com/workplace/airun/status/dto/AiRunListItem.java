package com.workplace.airun.status.dto;

import java.time.Instant;

/**
 * 처리 이력 한 줄(WP-1831) — AI 처리(ai_run)와 위임 작업(agent_work)을 같은 모양으로 낸다.
 *
 * @param id "R-&lt;runId&gt;"(AI 처리) 또는 "W-&lt;workId&gt;"(위임 작업)
 * @param kind 종류 코드(위임 작업은 DELEGATED_WORK)
 * @param target 처리 대상(없으면 type·id·label 이 null)
 * @param actor 실행 주체(AUTO 는 id·name 없음)
 * @param status RUNNING·SUCCEEDED·FAILED·SKIPPED
 * @param startedAt 시작 시각(위임 작업은 배정 시각)
 * @param endedAt 종료 시각(진행 중이면 null)
 * @param waitMs 기다린 시간(밀리초). 알 수 없으면 null
 * @param durationMs 처리 시간(밀리초). 끝나지 않았거나 시작 전이면 null
 * @param inputTokens 입력 토큰(위임 작업은 null)
 * @param outputTokens 출력 토큰(위임 작업은 null)
 * @param model 모델(위임 작업은 null)
 * @param errorReason 실패·건너뜀 사유
 */
public record AiRunListItem(
    String id,
    String kind,
    Target target,
    Actor actor,
    String status,
    Instant startedAt,
    Instant endedAt,
    Long waitMs,
    Long durationMs,
    Long inputTokens,
    Long outputTokens,
    String model,
    String errorReason) {

  /** 처리 대상 — 종류·식별자·표시 이름. 위임 작업은 ISSUE·이슈 키·이슈 제목. */
  public record Target(String type, String id, String label) {}

  /** 실행 주체 — 종류(AUTO·USER·AGENT)·사용자 id·이름(지워졌거나 AUTO 면 null). */
  public record Actor(String type, Long id, String name) {}
}

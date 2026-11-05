package com.workplace.issue.outbound.dto;

import java.time.Instant;

/**
 * 이슈 챗 이벤트에 싣는 반복 업무 요약(WP-1375) — 이슈 챗 AI 가 이 이슈가 AI 에게 맡긴 반복 업무임을 알고, 회차 결과를 약속하거나 회차를 대신 실행하지 않게
 * 한다. issue 모듈이 만들어 chat 모듈로 넘기는 경량 DTO.
 *
 * @param rrule 반복 규칙(RRULE 원문). 저장값 그대로
 * @param time KST 실행 시각 "HH:mm"
 * @param enabled 반복이 켜져 있는지 — 꺼졌으면(연속 실패로 멈춤 등) 다음 실행이 없다
 * @param agentName 담당 AI 이름. 사용자를 찾지 못하면 null
 * @param nextRunAt 다음 회차 시각. 없으면 null
 * @param ownerName 반복을 맡긴 사람(저장한 사람) 이름 — 회차는 이 사람의 결정만 따르므로, 이슈챗 AI 가 다른 사람의 지시에 「맡긴 사람이 확인해야 회차에
 *     반영된다」고 답하게 한다. 사용자를 찾지 못하면 null
 */
public record IssueRecurrenceSummary(
    String rrule,
    String time,
    boolean enabled,
    String agentName,
    Instant nextRunAt,
    String ownerName) {}

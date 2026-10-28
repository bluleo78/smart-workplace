package com.workplace.issue.dto;

import java.time.Instant;
import java.time.LocalTime;

/**
 * 이슈 반복(WP-989) 리포지토리 행. 반복은 이슈당 하나라 issueId 가 키다.
 *
 * @param runTime KST 벽시계 실행 시각(분 단위)
 * @param agentUserId 회차를 실행할 AI(등록 당시 해석한 비서)
 * @param createdBy 등록한 사람(이슈 소유자)
 * @param nextRunAt 다음 회차 시각 — 꺼진 반복은 스케줄러가 집지 않는다
 * @param runCount 지금까지 보낸 회차 수(실행 지시문의 「N회차」)
 * @param pendingRunId 보냈지만 결과 보고가 아직 오지 않은 회차 id — 결과 보고는 이 값과 같을 때만 반영한다
 * @param deleted 회차 실행 중에 지운 반복의 묘비 — 조회·목록에서는 없는 반복이고, 진행 중 회차 결과만 받아 글로 남긴 뒤 지운다
 */
public record IssueRecurrenceRow(
    long issueId,
    String rrule,
    LocalTime runTime,
    long agentUserId,
    long createdBy,
    boolean enabled,
    Instant nextRunAt,
    int consecutiveFailures,
    int runCount,
    String pendingRunId,
    Instant lastRunAt,
    boolean deleted) {}

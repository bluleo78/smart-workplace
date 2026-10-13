package com.workplace.issue.dto;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.repository.AgentWorkRepository.AgentWorkWithWorker;
import java.time.Duration;
import java.time.Instant;

/**
 * 이슈 응답에 싣는 진행 중 AI 작업 1건(WP-377). stale 은 "무소식" 표시용 — 작업 중인데 일정 시간 보고가 없는 경우만 true(답변 필요·검토 필요 등
 * 사람이 기다리는 상태는 보고가 없는 게 정상이라 경고하지 않는다).
 */
public record AgentWorkView(
    UserSummary worker,
    String tool,
    String state,
    String note,
    Integer progress,
    Integer stepsDone,
    Integer stepsTotal,
    Instant startedAt,
    Instant updatedAt,
    boolean stale) {

  /** 무소식 판정 기준 — WORKING 인데 마지막 보고가 이 시간 이상 지났으면 stale. */
  public static final Duration STALE_AFTER = Duration.ofHours(2);

  /** 저장 행 + 작업자 → 뷰. stale 은 DB 시계로 조회 시 계산된 값을 그대로 쓴다(앱 서버 시계 차이 배제). */
  public static AgentWorkView of(AgentWorkWithWorker w) {
    var r = w.work();
    return new AgentWorkView(
        w.worker(),
        r.tool(),
        r.state(),
        r.note(),
        r.progress(),
        r.stepsDone(),
        r.stepsTotal(),
        r.startedAt(),
        r.updatedAt(),
        w.stale());
  }
}

package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.repository.AgentWorkRepository.AgentWorkWithWorker;
import java.time.Instant;

/**
 * 이슈 응답에 싣는 AI 작업 1건(WP-377) — 보통 진행 중 작업이고, AI 위임 작업 「완료」 보기에서만 가장 최근 종료 작업이 대표로 실린다(WP-396).
 * stale 은 "무소식" 표시용 — 작업 중인데 일정 시간 보고가 없는 경우만 true(답변 필요·검토 필요 등 사람이 기다리는 상태는 보고가 없는 게 정상이라 경고하지
 * 않는다). overdue(WP-450)는 다음 회차 대기인데 예정 시각이 그만큼 지나도록 시작하지 않은 경우만 true. tool 은 아직 착수 전(SUBMITTED)이라
 * 도구를 모르면 null 일 수 있다.
 */
public record AgentWorkView(
    UserSummary worker,
    /** 수행 도구 — SUBMITTED 처럼 아직 모르면 null. */
    String tool,
    String state,
    String note,
    Integer progress,
    Integer stepsDone,
    Integer stepsTotal,
    Instant startedAt,
    Instant updatedAt,
    boolean stale,
    boolean overdue,
    /** 종료 시각 — 종료 작업(AI 위임 작업 「완료」 보기의 대표)만 있고 진행 중이면 JSON 에서 생략(WP-396). */
    @JsonInclude(JsonInclude.Include.NON_NULL) Instant endedAt,
    /** 다음 실행 시각 — 다음 회차 대기(SCHEDULED)이고 시각을 정했을 때만 있고 아니면 JSON 에서 생략(WP-450). */
    @JsonInclude(JsonInclude.Include.NON_NULL) Instant nextRunAt) {

  /** 저장 행 + 작업자 → 뷰. stale·overdue 는 DB 시계로 조회 시 계산된 값을 그대로 쓴다(앱 서버 시계 차이 배제). */
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
        w.stale(),
        w.overdue(),
        r.endedAt(),
        r.nextRunAt());
  }
}

package com.workplace.issue.service;

import com.workplace.issue.dto.IssueBlockerBadge;
import com.workplace.issue.dto.IssueBlockerBadge.BlockerType;
import com.workplace.issue.dto.IssueResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 이슈 블로커 3종을 결정적으로 계산한다(AI 아님 → 환각 없음). 읽기 경로에서 이미 로드된 IssueResponse 만 사용(새 쿼리 0).
 *
 * <ul>
 *   <li>BLOCKED: 미완료 차단 의존성 존재(IssueResponse.blocked)
 *   <li>OVERDUE: dueDate ≤ 오늘+1 AND 상태가 DONE/CANCELED 아님
 *   <li>STALE: 상태 IN_PROGRESS AND updatedAt 이 STALE_DAYS 이상 지남
 * </ul>
 */
@Component
public class IssueBlockerCalculator {

  /** STALE 판단 기준 일수 — IN_PROGRESS 상태에서 이 일수 이상 갱신 없으면 정체로 간주. */
  static final int STALE_DAYS = 3;

  /** 완료·취소 상태 집합 — OVERDUE 계산에서 제외. */
  private static final Set<String> TERMINAL = Set.of("DONE", "CANCELED");

  /**
   * 이슈의 블로커 배지 목록을 결정적으로 계산한다.
   *
   * @param issue 이미 로드된 이슈 응답 (새 쿼리 0)
   * @param today 오늘 날짜 (OVERDUE 기준)
   * @param now 현재 시각 (STALE 기준)
   * @return 감지된 블로커 배지 목록 (없으면 빈 리스트)
   */
  public List<IssueBlockerBadge> compute(IssueResponse issue, LocalDate today, Instant now) {
    List<IssueBlockerBadge> badges = new ArrayList<>();

    // BLOCKED: 미완료 선행 이슈에 막혀 있음
    if (issue.blocked()) {
      badges.add(new IssueBlockerBadge(BlockerType.BLOCKED, "선행 이슈에 막힘"));
    }

    // OVERDUE: 마감일이 내일 이하이고 아직 종료되지 않음
    if (issue.dueDate() != null
        && !TERMINAL.contains(issue.status())
        && !issue.dueDate().isAfter(today.plusDays(1))) {
      badges.add(new IssueBlockerBadge(BlockerType.OVERDUE, "마감 임박/경과"));
    }

    // STALE: IN_PROGRESS 상태에서 STALE_DAYS 일 이상 갱신 없음
    if ("IN_PROGRESS".equals(issue.status())
        && issue.updatedAt() != null
        && issue.updatedAt().isBefore(now.minus(STALE_DAYS, ChronoUnit.DAYS))) {
      badges.add(new IssueBlockerBadge(BlockerType.STALE, STALE_DAYS + "일 정체"));
    }

    return badges;
  }
}

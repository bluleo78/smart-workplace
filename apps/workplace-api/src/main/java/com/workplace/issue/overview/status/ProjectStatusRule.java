package com.workplace.issue.overview.status;

import com.workplace.issue.overview.ProjectOverviewResponse.Progress;
import java.time.LocalDate;

/**
 * 프로젝트 상태 배지 규칙(WP-1479) — 한곳에 둔다. 리포트 템플릿 지시문과 기준을 맞출 때(WP-1483) 이 자리만 바꾼다.
 *
 * <p>개요 「진행 중」이 사이클·버전일 때만 배지가 움직인다(전체 추이는 늘 순조로움). 범위가 비었거나 다 끝났으면 순조로움. 늦은 일수가 있으면 그것으로 정한다(3일 초과
 * → 위험, 0일 초과 → 주의, 그 밖 순조로움). 예상 완료일은 있는데 종료일이 없어 늦은 일수가 없으면 순조로움(비교할 기한이 없고 진행은 되고 있다). 최근 완료가 없어
 * 예상 완료일 자체가 없으면 — 종료일이 지났는데 남은 일이 있으면 위험(멈춘·넘긴 사이클), 아니면 주의(얼마나 걸릴지 알 수 없다). 기한 지난 이슈 수는 배지에 쓰지
 * 않는다.
 *
 * <p>개요 응답의 배지도 이 규칙으로 조회 때마다 다시 정한다 — AI 글과 함께 저장된 배지는 해시·이력용이고, 화면은 진행 중 위젯과 같은 값을 본다.
 */
public final class ProjectStatusRule {

  /** 이 일수를 넘게 늦으면 위험. */
  static final int RISK_AFTER_DAYS = 3;

  private ProjectStatusRule() {}

  /**
   * 진행 중 위젯 값과 오늘(서울)로 배지를 정한다.
   *
   * @param progress 개요 진행 중 위젯 — 개요가 늘 채운다(사이클·버전이 없으면 전체 추이)
   * @param today 개요의 오늘(서울) — 종료일이 지났는지 본다. 개요가 늘 채운다
   */
  public static StatusBadge badge(Progress progress, LocalDate today) {
    // 사이클·버전 범위가 아니면(전체 추이) 기준 날짜가 없어 순조로움.
    if (!"CYCLE".equals(progress.kind()) && !"VERSION".equals(progress.kind())) {
      return StatusBadge.ON_TRACK;
    }
    int done = progress.done() == null ? 0 : progress.done();
    // 범위가 비었거나 다 끝났으면 남은 일이 없다 — 늦게 끝났어도 지금 걱정할 일은 없다.
    if (progress.total() == 0 || done >= progress.total()) return StatusBadge.ON_TRACK;

    Integer late = progress.lateDays();
    if (late != null) {
      if (late > RISK_AFTER_DAYS) return StatusBadge.RISK;
      if (late > 0) return StatusBadge.WARN;
      return StatusBadge.ON_TRACK;
    }
    // 예상은 섰는데 종료일이 없어 늦은 일수가 없다 — 비교할 기한이 없고 진행은 되고 있으니 순조로움.
    // 「예상 없음」은 늦은 일수가 아니라 예상 완료일로 판단한다(종료일 없는 범위를 주의로 잘못 보지 않게).
    if (progress.projectedDate() != null) return StatusBadge.ON_TRACK;
    // 예상 없음(최근 완료 없음) + 남은 일 — 기간이 끝났으면 위험, 아니면(끝나기 전·종료일 없음) 주의.
    LocalDate end = progress.target() == null ? null : progress.target().end();
    if (end != null && today.isAfter(end)) return StatusBadge.RISK;
    return StatusBadge.WARN;
  }
}

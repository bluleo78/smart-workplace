package com.workplace.issue.dto;

import com.workplace.issue.metrics.MetricsBucket;
import com.workplace.issue.metrics.MetricsGranularity;
import com.workplace.issue.metrics.MetricsSummary;
import java.time.LocalDate;
import java.util.List;

/**
 * 「내 작업 · 개요」 탭 한 화면 전체(WP-1484) — {@code GET /api/v1/me/overview}. 호출자 본인 것만 담는다(다른 사람 id 를 받는 길이
 * 없다).
 *
 * <p>숫자(현재·지난 기간 요약, 추이 칸, 끝낸 이슈 판정)는 모두 지표 모듈({@code IssueMetricsService.forMe})의 결과를 그대로 옮긴다 —
 * 화면마다 따로 세면 같은 「완료한 이슈」가 화면마다 달라진다. 어제/오늘·맡은 이슈·늦게 완료한 이슈의 표시 정보만 이 기능의 조회로 채운다. 완료한 이슈 목록은 싣지 않는다
 * — 화면은 할당 탭(완료일 필터)으로 보낸다.
 *
 * @param period 고른 기간
 * @param granularity 추이 칸 단위
 * @param from 기간 첫날(서울)
 * @param to 기간 마지막 날(= 오늘, 서울)
 * @param previousFrom 직전 같은 기간 첫날 — 같은 길이의 바로 앞 기간. 화면이 비교 문구 툴팁에 실제 날짜로 보인다
 * @param previousTo 직전 같은 기간 마지막 날
 * @param day 어제 한 일 / 오늘 할 일(기간과 무관)
 * @param current 현재 기간 요약(지표 모듈)
 * @param previous 지난 기간 요약(지표 모듈)
 * @param buckets 추이 칸(시간순, 빈 칸 0)
 * @param upcoming 앞으로 할 일(기간과 무관)
 * @param lateTop 늦게 완료한 이슈 상위 2건(늦은 날수 큰 순) — 기간 전체에서 고른다
 */
public record MeOverviewResponse(
    MeOverviewPeriod period,
    MetricsGranularity granularity,
    LocalDate from,
    LocalDate to,
    LocalDate previousFrom,
    LocalDate previousTo,
    MeDaySummary day,
    MetricsSummary current,
    MetricsSummary previous,
    List<MetricsBucket> buckets,
    Upcoming upcoming,
    List<LateItem> lateTop) {

  /**
   * 맡은 이슈 — 맡은 열린 이슈 수와 타일 넷(화면 라벨: 마감 지남 · 7일 안 마감 · 답변 필요 · 마감 여유·없음). 타일은 서로 겹칠 수 있다(마감 지난 이슈가
   * AI 답변도 기다리면 두 타일에 다 센다) — 「오늘」 칸의 마감 지남·답변 필요와 같은 숫자를 보이기 위해서다. 「마감 여유·없음」(other)은 맡은 열린 이슈 중
   * 앞의 세 타일 어디에도 들지 않는 것 — 8일 이후 마감이거나 마감이 없다.
   *
   * @param openAssigned 내가 담당인 열린 이슈 수
   * @param overdue 마감 지남(마감일 &lt; 오늘)
   * @param dueSoon 7일 안 마감(오늘 ≤ 마감일 ≤ 오늘+7)
   * @param waiting 답변 필요(담당이거나 보고자인 열린 이슈의 AI 작업이 답변 필요) — 보고자로만 걸린 이슈도 센다
   * @param other 마감 여유·없음
   * @param overdueTop 마감 지남 상위 3건(마감 오래된 순)
   * @param dueSoonTop 7일 안 마감 상위 3건(마감 가까운 순)
   * @param waitingTop 답변 필요 상위 3건(오래 기다린 순)
   * @param otherTop 마감 여유·없음 상위 3건(마감 있는 것 먼저, 최근 바뀐 순)
   */
  public record Upcoming(
      int openAssigned,
      int overdue,
      int dueSoon,
      int waiting,
      int other,
      List<UpcomingItem> overdueTop,
      List<UpcomingItem> dueSoonTop,
      List<UpcomingItem> waitingTop,
      List<UpcomingItem> otherTop) {}

  /**
   * 맡은 이슈 한 줄.
   *
   * @param issueId 이슈 id
   * @param projectKey 프로젝트 키(이슈 키·링크용)
   * @param number 이슈 번호
   * @param title 제목
   * @param dueDate 현재 마감일(없으면 null)
   * @param aiNames 지금 담당인 AI 이름들(없으면 빈 목록)
   */
  public record UpcomingItem(
      long issueId,
      String projectKey,
      int number,
      String title,
      LocalDate dueDate,
      List<String> aiNames) {}

  /**
   * 마감 준수 카드의 늦게 완료한 이슈 한 줄 — 지표 모듈의 판정({@code ClosedIssueFact})에 키·제목만 붙였다.
   *
   * @param issueId 이슈 id
   * @param projectKey 프로젝트 키
   * @param number 이슈 번호
   * @param title 제목
   * @param lateDays 늦은 날수
   */
  public record LateItem(long issueId, String projectKey, int number, String title, int lateDays) {}
}

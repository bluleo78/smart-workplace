package com.workplace.issue.dto;

import com.workplace.issue.metrics.DueOutcome;
import com.workplace.issue.metrics.MetricsBucket;
import com.workplace.issue.metrics.MetricsGranularity;
import com.workplace.issue.metrics.MetricsSummary;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 「내 작업 · 개요」 탭 한 화면 전체(WP-1484) — {@code GET /api/v1/me/overview}. 호출자 본인 것만 담는다(다른 사람 id 를 받는 길이
 * 없다).
 *
 * <p>숫자(현재·지난 기간 요약, 추이 칸, 끝낸 이슈 판정)는 모두 지표 모듈({@code IssueMetricsService.forMe})의 결과를 그대로 옮긴다 —
 * 화면마다 따로 세면 같은 「끝낸 이슈」가 화면마다 달라진다. 어제/오늘·앞으로 할 일·끝낸 일 표시 정보만 이 기능의 조회로 채운다.
 *
 * @param period 고른 기간
 * @param granularity 추이 칸 단위
 * @param from 기간 첫날(서울)
 * @param to 기간 마지막 날(= 오늘, 서울)
 * @param previousFrom 지난 기간 첫날 — 같은 길이의 바로 앞 기간
 * @param previousTo 지난 기간 마지막 날
 * @param day 어제 한 일 / 오늘 할 일(기간과 무관)
 * @param current 현재 기간 요약(지표 모듈)
 * @param previous 지난 기간 요약(지표 모듈)
 * @param buckets 추이 칸(시간순, 빈 칸 0)
 * @param dailyTotals 기간 안 날짜별 끝냄·만듦(일별 칸) — 끝낸 일 목록의 날짜 줄 합계용. 추이를 주별·월별로 봐도 날짜 줄은 하루 단위라 따로 준다
 * @param upcoming 앞으로 할 일(기간과 무관)
 * @param closed 현재 기간 끝낸 이슈(닫힌 시각 내림차순) 최근 최대 50건 — 끝낸 일 목록
 * @param closedTotal 현재 기간 끝낸 이슈 전체 수 — closed 보다 많으면 목록이 잘렸다(화면이 「모두 보기」로 안내)
 * @param lateTop 늦은 이슈 상위 2건(늦은 날수 큰 순) — 잘린 목록이 아니라 기간 전체에서 고른다. 목록 밖 건은 AI 이름·요청 내용·코멘트를 비운다
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
    List<MetricsBucket> dailyTotals,
    Upcoming upcoming,
    List<ClosedItem> closed,
    int closedTotal,
    List<ClosedItem> lateTop) {

  /**
   * 앞으로 할 일 — 맡은 열린 이슈 수와 타일 넷. 타일은 서로 겹칠 수 있다(마감 지난 이슈가 AI 답변도 기다리면 두 타일에 다 센다) — 「오늘 할 일」의 기한
   * 지남·나를 기다림과 같은 숫자를 보이기 위해서다. 「그 밖」은 맡은 열린 이슈 중 앞의 세 타일 어디에도 들지 않는 것.
   *
   * @param openAssigned 내가 담당인 열린 이슈 수
   * @param overdue 기한 지남(마감일 &lt; 오늘)
   * @param dueSoon 마감 임박(오늘 ≤ 마감일 ≤ 오늘+7)
   * @param waiting 나를 기다림(담당이거나 보고자인 열린 이슈의 AI 작업이 답변 필요) — 보고자로만 걸린 이슈도 센다
   * @param other 그 밖
   * @param overdueTop 기한 지남 상위 3건(마감 오래된 순)
   * @param dueSoonTop 마감 임박 상위 3건(마감 가까운 순)
   * @param waitingTop 나를 기다림 상위 3건(오래 기다린 순)
   * @param otherTop 그 밖 상위 3건(마감 있는 것 먼저, 최근 바뀐 순)
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
   * 앞으로 할 일 한 줄.
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
   * 끝낸 일 한 줄 — 지표 모듈의 판정({@code ClosedIssueFact})에 표시 정보를 붙였다.
   *
   * @param issueId 이슈 id
   * @param projectKey 프로젝트 키
   * @param number 이슈 번호
   * @param title 제목
   * @param closedAt 닫힌 시각
   * @param closedDate 닫힌 서울 날짜
   * @param dueAtClose 닫힐 당시 마감일
   * @param outcome 기한 내/초과/마감 없음
   * @param lateDays 늦은 날수(초과일 때만)
   * @param leadTimeDays 소요 일수(만든 날부터 완료까지)
   * @param withAi AI와 함께 했는가(지표 모듈 판정)
   * @param aiNames 함께한 AI 이름들 — withAi 일 때만 채운다(태그와 「AI와 함께」 숫자가 어긋나지 않게)
   * @param request 요청 내용 — 본문 앞부분 평문(없으면 null)
   * @param lastComment 마지막 코멘트(없으면 null)
   */
  public record ClosedItem(
      long issueId,
      String projectKey,
      int number,
      String title,
      OffsetDateTime closedAt,
      LocalDate closedDate,
      LocalDate dueAtClose,
      DueOutcome outcome,
      Integer lateDays,
      Double leadTimeDays,
      boolean withAi,
      List<String> aiNames,
      String request,
      LastComment lastComment) {}

  /**
   * 마지막 코멘트 미리보기.
   *
   * @param authorName 작성자 이름
   * @param text 본문 앞부분 평문
   */
  public record LastComment(String authorName, String text) {}
}

package com.workplace.issue.overview;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 프로젝트 「개요」 탭 한 화면 전체(WP-1478) — {@code GET /api/v1/projects/{key}/overview}. 웹과 API 가 함께 따르는 응답
 * 모양(계획서 「API 응답 모양」)을 그대로 옮긴다 — 위젯마다 따로 부르지 않고 한 번에 받는다.
 *
 * <p>열린 이슈·마감 임박·기한 지남·살펴볼 이슈·작업량·진행 중 그래프는 이슈 탭 기본 범위(SUBTASK·EPIC 제외)로 센다. 완료·새로 생김 카드는 지표
 * 모듈({@code IssueMetricsService.countsForProject} — 성과 화면 {@code forProject} 와 같은 정의) 값을 쓴다(모듈 정의
 * 우선). 날짜는 모두 서울 기준이다. 사람에는 아바타를 싣지 않는다 — 웹이 앱 전체 아바타 표에서 사용자 id 로 찾는다.
 *
 * @param today 기준 날짜(서울 오늘)
 * @param canManage 사이클·버전을 만들 수 있는가(프로젝트 OWNER 또는 워크스페이스 관리자) — 진행 중 위젯이 비었을 때 안내를 보일지
 * @param cards 숫자 카드 넷
 * @param progress 진행 중 위젯(사이클 → 버전 → 전체 추이) + 에픽
 * @param openIssues 열린 이슈 위젯
 * @param attention 살펴볼 이슈 위젯(세 묶음)
 * @param workload 작업량 위젯
 * @param activity 최근 활동 묶음(최대 6개, 최신 순)
 */
public record ProjectOverviewResponse(
    LocalDate today,
    boolean canManage,
    Cards cards,
    Progress progress,
    OpenIssues openIssues,
    Attention attention,
    Workload workload,
    List<ActivityGroup> activity) {

  /** 숫자 카드 넷. */
  public record Cards(Comparison completed, Comparison created, DueSoon dueSoon, Overdue overdue) {}

  /**
   * 최근 7일(오늘 포함)과 그 앞 7일 비교 — 지표 모듈의 current/previous.
   *
   * @param current 최근 7일 값
   * @param previous 바로 앞 7일 값
   */
  public record Comparison(int current, int previous) {}

  /**
   * 마감 임박 — 열린 이슈 중 마감일이 오늘 ~ 오늘+6.
   *
   * @param count 마감 임박 수
   * @param unassigned 그중 담당자 없는 수
   */
  public record DueSoon(int count, int unassigned) {}

  /**
   * 기한 지남 — 열린 이슈 중 마감일이 오늘보다 이르다.
   *
   * @param count 기한 지남 수
   * @param oldestDays 가장 오래 지난 이슈의 지난 일수. count 0 이면 null
   */
  public record Overdue(int count, Integer oldestDays) {}

  /**
   * 진행 중 위젯.
   *
   * @param kind CYCLE / VERSION / TREND
   * @param target 고른 사이클·버전(TREND 면 null)
   * @param total 범위 이슈 수(TREND 면 지금 열린 이슈 수)
   * @param done 완료 수(TREND 면 null)
   * @param points 그래프 점(날짜 오름차순). TREND 면 scope = 그 시점 열린 수, done = null
   * @param projectedDate 예상 완료일(속도 0·범위 0 이면 null, TREND 면 null)
   * @param lateDays 예상 완료일 − 종료일(일). 0 초과면 늦음, 0 이하면 종료 전 가능. 예상이 없거나 종료일이 없으면 null
   * @param trendDelta 8주 동안 열린 수 변화(마지막 − 처음). TREND 만, 아니면 null
   * @param epics 에픽 요약
   */
  public record Progress(
      String kind,
      Target target,
      int total,
      Integer done,
      List<Point> points,
      LocalDate projectedDate,
      Integer lateDays,
      Integer trendDelta,
      Epics epics) {}

  /**
   * 진행 중 위젯이 고른 사이클·버전.
   *
   * @param id 사이클 id 또는 버전 id
   * @param name 이름
   * @param start 기간 시작일
   * @param end 기간 종료일(사이클 end_date·버전 release_date — 사이클에 종료일이 없으면 null)
   */
  public record Target(long id, String name, LocalDate start, LocalDate end) {}

  /**
   * 그래프 한 점.
   *
   * @param date 날짜(서울)
   * @param scope 범위 선 값(TREND 면 열린 수)
   * @param done 완료 선 값(TREND 면 null)
   */
  public record Point(LocalDate date, int scope, Integer done) {}

  /**
   * 에픽 요약 — 닫히지 않은 EPIC 유형 이슈.
   *
   * @param epicTypeId 프로젝트의 EPIC 유형 id — 웹이 이슈 탭 「에픽」 필터 링크를 만든다. 유형이 없으면(PERSONAL 등) null
   * @param inProgress IN_PROGRESS 범주 에픽 수
   * @param total 닫히지 않은 에픽 수
   * @param items 최근 움직인 에픽 상위 4개
   */
  public record Epics(Long epicTypeId, int inProgress, int total, List<EpicItem> items) {}

  /**
   * 에픽 한 줄.
   *
   * @param issueKey 이슈 키(예 WP-1)
   * @param number 이슈 번호
   * @param title 제목
   * @param done 종료된 자식 수(완료·취소 — 에픽 진행률 규칙 WP-243)
   * @param total 자식 수(삭제 제외)
   */
  public record EpicItem(String issueKey, int number, String title, int done, int total) {}

  /**
   * 열린 이슈 위젯.
   *
   * @param total 열린 이슈 수(todo + inProgress)
   * @param todo TODO 범주 수
   * @param inProgress IN_PROGRESS 범주 수
   * @param unassigned 담당자 없는 열린 이슈 수
   */
  public record OpenIssues(int total, int todo, int inProgress, int unassigned) {}

  /**
   * 살펴볼 이슈 위젯.
   *
   * @param total 세 묶음에 든 서로 다른 이슈 수
   * @param overdue 기한 지남
   * @param stale 오래 멈춤
   * @param waiting 기다리는 중
   */
  public record Attention(
      int total, AttentionGroup overdue, AttentionGroup stale, AttentionGroup waiting) {}

  /**
   * 살펴볼 이슈 한 묶음.
   *
   * @param total 묶음 전체 수
   * @param items 상위 5건(오래된 순)
   */
  public record AttentionGroup(int total, List<AttentionItem> items) {}

  /**
   * 살펴볼 이슈 한 줄.
   *
   * @param issueKey 이슈 키
   * @param number 이슈 번호
   * @param title 제목
   * @param days 지난(기한 지남)·멈춘(오래 멈춤)·기다린(기다리는 중) 일수
   * @param assignees 지금 담당자들(없으면 빈 목록)
   */
  public record AttentionItem(
      String issueKey, int number, String title, int days, List<Person> assignees) {}

  /**
   * 사람(사람·AI) 요약. 아바타는 웹이 앱 전체 아바타 표에서 id 로 찾는다.
   *
   * @param id 사용자 id
   * @param name 이름
   * @param kind HUMAN / AGENT
   * @param active 이 워크스페이스에서 활성인가(WP-417) — 정지된 사람을 웹이 「비활성」으로 구분한다
   */
  public record Person(long id, String name, String kind, boolean active) {}

  /**
   * 작업량 위젯.
   *
   * @param top 열린 이슈를 많이 맡은 순 상위 5명
   * @param unassigned 담당자 없는 열린 이슈 수
   * @param others 상위 밖 사람 수·그들이 맡은 수
   */
  public record Workload(List<WorkloadItem> top, int unassigned, Others others) {}

  /**
   * 작업량 한 사람 — 담당자가 여럿인 이슈는 각자에게 한 번씩 센다.
   *
   * @param active 이 워크스페이스에서 활성인가({@link Person#active})
   * @param count 맡은 열린 이슈 수
   */
  public record WorkloadItem(long id, String name, String kind, boolean active, int count) {}

  /**
   * 작업량 「그 외 n명 · n건」.
   *
   * @param people 상위 5명 밖 사람 수
   * @param issues 그들이 맡은 수의 합(담당 여럿이면 각자 셈)
   */
  public record Others(int people, int issues) {}

  /**
   * 최근 활동 한 묶음 — 같은 사람·같은 종류 이력이 이어지면 한 묶음.
   *
   * @param actor 한 사람
   * @param eventType 이력 종류(IssueHistoryEventType 이름) — 옛 ASSIGNEE_CHANGED 는 ASSIGNEES_CHANGED 로 합쳐
   *     낸다
   * @param count 묶음에 든 서로 다른 이슈 수(같은 이슈를 여러 번 바꿔도 1)
   * @param latestAt 묶음에서 가장 최근 시각
   * @param issue 묶음에 든 이슈가 하나면 그 이슈, 아니면 null
   */
  public record ActivityGroup(
      Person actor, String eventType, int count, OffsetDateTime latestAt, IssueRef issue) {}

  /** 이슈 키·번호·제목. */
  public record IssueRef(String issueKey, int number, String title) {}
}

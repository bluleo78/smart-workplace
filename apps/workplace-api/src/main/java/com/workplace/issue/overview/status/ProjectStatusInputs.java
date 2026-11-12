package com.workplace.issue.overview.status;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.overview.ProjectOverviewResponse;
import com.workplace.issue.overview.ProjectOverviewResponse.Progress;
import java.time.LocalDate;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 프로젝트 상태 AI 요약의 입력(WP-1479) — 개요 계산값 중 요약에 쓰는 것만 정해진 순서로 담는다. 그대로 ai-agent 요청의 {@code inputs} 로
 * 직렬화되고(필드 이름이 ai-agent 스키마와 1:1, 배지는 요청 최상위에 따로 실으므로 직렬화에서 뺀다), {@link #hash()} 로 바뀜을 감지한다.
 *
 * <p>날짜는 ISO 문자열(yyyy-MM-dd)로 둔다 — 해시 문자열과 JSON 이 직렬화 설정에 흔들리지 않게.
 *
 * @param badge 시스템이 정한 배지(해시에 포함)
 * @param completedRecent 완료 — 최근 7일
 * @param completedPrevious 완료 — 그 앞 7일
 * @param createdRecent 새로 생김 — 최근 7일
 * @param createdPrevious 새로 생김 — 그 앞 7일
 * @param dueSoon 마감 임박(다음 7일)
 * @param dueSoonUnassigned 마감 임박 중 담당자 없음
 * @param overdue 기한 지남 수
 * @param overdueOldestDays 가장 오래 지난 일수(없으면 null)
 * @param stale 오래 멈춤 수
 * @param waiting 기다리는 중 수
 * @param openTotal 열린 이슈
 * @param openTodo 열린 이슈 중 할 일
 * @param openInProgress 열린 이슈 중 진행 중
 * @param openUnassigned 열린 이슈 중 담당자 없음
 * @param progressKind 진행 중 묶음 종류(CYCLE / VERSION / TREND)
 * @param progressName 사이클·버전 이름(TREND 면 null)
 * @param progressEnd 종료일(없으면 null)
 * @param progressDone 완료 수(TREND 면 null)
 * @param progressTotal 범위 이슈 수(TREND 면 열린 수)
 * @param projectedDate 예상 완료일(없으면 null)
 * @param lateDays 늦은 일수(없으면 null)
 * @param trendDelta 8주 열린 수 변화(TREND 만)
 */
public record ProjectStatusInputs(
    @JsonIgnore StatusBadge badge,
    int completedRecent,
    int completedPrevious,
    int createdRecent,
    int createdPrevious,
    int dueSoon,
    int dueSoonUnassigned,
    int overdue,
    Integer overdueOldestDays,
    int stale,
    int waiting,
    int openTotal,
    int openTodo,
    int openInProgress,
    int openUnassigned,
    String progressKind,
    String progressName,
    String progressEnd,
    Integer progressDone,
    int progressTotal,
    String projectedDate,
    Integer lateDays,
    Integer trendDelta) {

  /** 개요 응답과 배지에서 입력을 뽑는다. */
  public static ProjectStatusInputs from(ProjectOverviewResponse o, StatusBadge badge) {
    var cards = o.cards();
    var open = o.openIssues();
    var attention = o.attention();
    Progress p = o.progress();
    return new ProjectStatusInputs(
        badge,
        cards.completed().current(),
        cards.completed().previous(),
        cards.created().current(),
        cards.created().previous(),
        cards.dueSoon().count(),
        cards.dueSoon().unassigned(),
        cards.overdue().count(),
        cards.overdue().oldestDays(),
        attention.stale().total(),
        attention.waiting().total(),
        open.total(),
        open.todo(),
        open.inProgress(),
        open.unassigned(),
        p.kind(),
        p.target() == null ? null : p.target().name(),
        iso(p.target() == null ? null : p.target().end()),
        p.done(),
        p.total(),
        iso(p.projectedDate()),
        p.lateDays(),
        p.trendDelta());
  }

  private static String iso(LocalDate d) {
    return d == null ? null : d.toString();
  }

  /**
   * 요약할 것이 없는 프로젝트인가 — 열린 이슈도, 진행 중 범위도, 최근 14일 완료·생성도, 기한 지남·오래 멈춤·기다리는 중도 없다. 이런 프로젝트는 AI 를 부르지
   * 않는다(이슈 0건 프로젝트가 대표). 살펴볼 이슈 셋은 열린 수와 따로 세므로(범위·정의가 다르다) 하나라도 있으면 요약할 거리로 본다.
   */
  @JsonIgnore
  public boolean isEmpty() {
    return openTotal == 0
        && overdue == 0
        && stale == 0
        && waiting == 0
        && progressTotal == 0
        && completedRecent == 0
        && completedPrevious == 0
        && createdRecent == 0
        && createdPrevious == 0;
  }

  /**
   * 바뀜 감지용 지문 — 모든 필드를 정해진 순서로 「|」 로 이은 문자열의 sha256(hex 64자). null 은 「-」. 시간이 지나 기한 지남 일수가 늘어나는 변화도
   * 값이 바뀌어 잡힌다.
   */
  public String hash() {
    String joined =
        Stream.of(
                badge,
                completedRecent,
                completedPrevious,
                createdRecent,
                createdPrevious,
                dueSoon,
                dueSoonUnassigned,
                overdue,
                overdueOldestDays,
                stale,
                waiting,
                openTotal,
                openTodo,
                openInProgress,
                openUnassigned,
                progressKind,
                progressName,
                progressEnd,
                progressDone,
                progressTotal,
                projectedDate,
                lateDays,
                trendDelta)
            .map(v -> Objects.toString(v, "-"))
            .collect(Collectors.joining("|"));
    return CapabilityTokens.sha256Hex(joined);
  }
}

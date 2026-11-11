package com.workplace.issue.service;

import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.MeDaySummary;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.dto.MeOverviewResponse;
import com.workplace.issue.dto.MeOverviewResponse.LateItem;
import com.workplace.issue.dto.MeOverviewResponse.Upcoming;
import com.workplace.issue.dto.MeOverviewResponse.UpcomingItem;
import com.workplace.issue.metrics.ClosedIssueFact;
import com.workplace.issue.metrics.DueOutcome;
import com.workplace.issue.metrics.IssueMetrics;
import com.workplace.issue.metrics.IssueMetricsCalculator;
import com.workplace.issue.metrics.IssueMetricsService;
import com.workplace.issue.metrics.MetricsBucket;
import com.workplace.issue.metrics.MetricsGranularity;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.metrics.MetricsSummary;
import com.workplace.issue.repository.MeOverviewRepository;
import com.workplace.issue.repository.MeOverviewRepository.IssueDisplay;
import com.workplace.issue.repository.MeOverviewRepository.OpenIssueRow;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「내 작업 · 개요」 탭(WP-1484) — 호출자 본인의 개요 한 화면과, 홈 위젯이 쓰는 「어제/오늘」 요약을 만든다.
 *
 * <p>숫자는 지표 모듈({@link IssueMetricsService#forMe})을 그대로 쓴다 — 기간 지표, 어제 완료(어제가 고른 기간 안이고 추이가 일별이면 기간
 * 결과의 일별 칸·완료 판정에서 꺼내고, 아니면 하루짜리 기간으로 한 번 더 부른다), 추이 칸, 완료 판정. 지표 모듈에 없는 것(열린 이슈의 오늘/맡은 이슈, 답변 필요,
 * 늦게 완료한 이슈의 키·제목)만 {@link MeOverviewRepository} 로 채운다. 완료한 이슈 목록은 싣지 않는다 — 화면이 할당 탭(완료일 필터)으로
 * 보낸다(WP-1484 문구 감사로 「끝낸 일」 섹션을 뺐다). 다른 사람 id 를 받는 메서드는 일부러 두지 않는다 — 관리자라도 남의 개요를 볼 길이 없게(설계 「하면 안
 * 되는 것」).
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다: 지표 모듈 호출 1~2번(기간, 어제를 기간 결과에서 꺼낼 수 없으면 어제) + 열린 이슈 1 + 늦은 이슈 표시 정보 1 +
 * 맡은 이슈 AI 이름 1.
 */
@Service
@RequiredArgsConstructor
public class MeOverviewService {

  /** 앞으로 할 일 타일마다 보이는 상위 건수(설계: 고른 타일 상위 3건). */
  static final int TOP_N = 3;

  /** 마감 임박 범위(일) — 오늘부터 7일 뒤까지(설계: 「마감 임박 7일」). */
  static final int DUE_SOON_DAYS = 7;

  /** 마감 준수 카드의 「가장 늦게 완료한 이슈」 건수 — 기간 전체에서 서버가 고른다. */
  static final int LATE_TOP_N = 2;

  private final IssueMetricsService metricsService;
  private final MeOverviewRepository repository;

  /** 「오늘」의 기준 시계 — 서울 날짜로 바꿔 쓴다(JVM 기본 zone 이 UTC 라 그대로 쓰면 00~09시 KST 에 하루 밀린다). */
  private final Clock clock = Clock.systemUTC();

  /** 개요 한 화면 — 지금 시각 기준. */
  @Transactional(readOnly = true)
  public MeOverviewResponse overview(
      Long callerId, MeOverviewPeriod period, MetricsGranularity granularity) {
    return overview(callerId, period, granularity, OffsetDateTime.now(clock));
  }

  /** 홈 위젯·개요 첫 줄의 「어제/오늘」 요약 — 지금 시각 기준. */
  @Transactional(readOnly = true)
  public MeDaySummary today(Long callerId) {
    return today(callerId, OffsetDateTime.now(clock));
  }

  /**
   * 개요 한 화면 — 시각을 받는 판. 테스트가 서울 자정 경계를 고정하려고 같은 패키지에서 부른다(싱글턴 빈의 시계를 바꾸지 않게).
   *
   * @param now 「지금」 — 서울 날짜로 오늘·어제를 정한다
   */
  @Transactional(readOnly = true)
  MeOverviewResponse overview(
      Long callerId, MeOverviewPeriod period, MetricsGranularity granularity, OffsetDateTime now) {
    Objects.requireNonNull(callerId, "callerId");
    if (period == null) throw new IllegalArgumentException("기간을 지정해 주세요");
    if (granularity == null) throw new IllegalArgumentException("칸 묶음 단위를 지정해 주세요");
    LocalDate today = IssueDueWindow.seoulDate(now);
    MetricsPeriod range = period.resolve(today);

    IssueMetrics metrics = metricsService.forMe(callerId, range, granularity);

    List<OpenIssueRow> open = repository.findOpenIssues(callerId);
    // 추이가 일별이면 기간 결과(완료 판정 전부 + 일별 칸)에서 어제 숫자를 꺼낸다 — 지표 모듈을 한 번 덜 부른다. 주별·월별이면 어제 만든 수를 칸에서
    // 꺼낼 수 없으므로 하루짜리 기간으로 따로 묻는다(기간 전체를 일별로 다시 받는 것보다 싸다).
    InRange inRange =
        granularity == MetricsGranularity.DAY
            ? new InRange(range, metrics.closedIssues(), metrics.buckets())
            : null;
    MeDaySummary day = daySummary(callerId, today, open, inRange);
    Upcoming upcoming = upcoming(open, today);

    return new MeOverviewResponse(
        period,
        granularity,
        range.from(),
        range.to(),
        metrics.previousPeriod().from(),
        metrics.previousPeriod().to(),
        day,
        metrics.current(),
        metrics.previous(),
        metrics.buckets(),
        withAiNames(upcoming),
        lateTop(metrics.closedIssues()));
  }

  /**
   * 「어제/오늘」 요약 — 시각을 받는 판({@link #overview(Long, MeOverviewPeriod, MetricsGranularity,
   * OffsetDateTime)} 참조).
   */
  @Transactional(readOnly = true)
  MeDaySummary today(Long callerId, OffsetDateTime now) {
    Objects.requireNonNull(callerId, "callerId");
    LocalDate today = IssueDueWindow.seoulDate(now);
    return daySummary(callerId, today, repository.findOpenIssues(callerId), null);
  }

  /**
   * 개요가 이미 받은 기간 결과 — 어제 숫자를 다시 묻지 않고 꺼내는 데 쓴다.
   *
   * @param range 고른 기간
   * @param facts 기간의 완료 판정 전부
   * @param daily 기간의 일별 칸(추이가 일별일 때의 칸)
   */
  private record InRange(
      MetricsPeriod range, List<ClosedIssueFact> facts, List<MetricsBucket> daily) {}

  /**
   * 어제 한 일은 지표 모듈과 같은 정의(닫힐 때 담당자·닫힐 당시 마감일·AI와 함께)로 센다 — 어제가 기간 안이면 기간 결과에서, 아니면(홈 위젯 요약 포함) 하루짜리
   * 기간(달력상 어제)을 지표 모듈에 따로 묻는다. 오늘 할 일은 열린 이슈에서 센다.
   *
   * @param inRange 개요가 받은 기간 결과(홈 위젯 요약이거나 추이가 일별이 아니면 null)
   */
  private MeDaySummary daySummary(
      long callerId, LocalDate today, List<OpenIssueRow> open, InRange inRange) {
    LocalDate yesterday = today.minusDays(1);
    MetricsSummary y = yesterdaySummary(callerId, yesterday, inRange);
    int overdue = 0;
    int dueToday = 0;
    LocalDate oldestDue = null;
    for (OpenIssueRow r : open) {
      if (!r.assignedToMe() || r.dueDate() == null) continue;
      if (r.dueDate().isBefore(today)) {
        overdue++;
        if (oldestDue == null || r.dueDate().isBefore(oldestDue)) oldestDue = r.dueDate();
      } else if (r.dueDate().isEqual(today)) {
        dueToday++;
      }
    }
    int waiting = (int) open.stream().filter(OpenIssueRow::waiting).count();
    return new MeDaySummary(
        yesterday,
        y.completed(),
        y.completedWithAi(),
        y.onTime(),
        y.created(),
        today,
        overdue,
        oldestDue == null ? null : (int) ChronoUnit.DAYS.between(oldestDue, today),
        dueToday,
        waiting);
  }

  /**
   * 어제 요약 — 기간 결과에 어제가 들어 있으면 그날 닫힌 판정과 그날 일별 칸의 만듦으로 지표 모듈과 같은 요약 함수를 돌린다(정의가 갈라지지 않게). 기간 밖(이번 주의
   * 월요일, 이번 달 1일)이거나 기간 결과가 없으면 지표 모듈을 하루짜리 기간으로 부른다.
   */
  private MetricsSummary yesterdaySummary(long callerId, LocalDate yesterday, InRange inRange) {
    if (inRange != null && inRange.range().contains(yesterday)) {
      List<ClosedIssueFact> closedYesterday =
          inRange.facts().stream().filter(f -> yesterday.equals(f.closedDate())).toList();
      int created =
          inRange.daily().stream()
              .filter(b -> yesterday.equals(b.start()))
              .mapToInt(MetricsBucket::created)
              .findFirst()
              .orElse(0);
      return IssueMetricsCalculator.summarize(closedYesterday, created);
    }
    return metricsService
        .forMe(callerId, new MetricsPeriod(yesterday, yesterday), MetricsGranularity.DAY)
        .current();
  }

  /**
   * 맡은 이슈 — 타일은 서로 겹칠 수 있다({@link Upcoming} 참조). 「마감 여유·없음」(other)은 맡은 열린 이슈 중 마감 지남·7일 안 마감·답변 필요
   * 어디에도 들지 않는 것.
   */
  static Upcoming upcoming(List<OpenIssueRow> open, LocalDate today) {
    LocalDate soonLimit = today.plusDays(DUE_SOON_DAYS);
    Predicate<OpenIssueRow> overdue =
        r -> r.assignedToMe() && r.dueDate() != null && r.dueDate().isBefore(today);
    Predicate<OpenIssueRow> dueSoon =
        r ->
            r.assignedToMe()
                && r.dueDate() != null
                && !r.dueDate().isBefore(today)
                && !r.dueDate().isAfter(soonLimit);
    Predicate<OpenIssueRow> waiting = OpenIssueRow::waiting;
    Predicate<OpenIssueRow> other =
        r -> r.assignedToMe() && !overdue.test(r) && !dueSoon.test(r) && !waiting.test(r);

    Comparator<OpenIssueRow> byDue =
        Comparator.comparing(OpenIssueRow::dueDate).thenComparing(OpenIssueRow::issueId);
    Comparator<OpenIssueRow> byWaiting =
        Comparator.comparing(
                OpenIssueRow::waitingSince, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(OpenIssueRow::issueId);
    // 마감 여유·없음은 마감이 있는 것 먼저(가까운 순), 마감 없으면 최근 바뀐 순 — 손댈 차례가 가까운 것부터.
    Comparator<OpenIssueRow> byOther =
        Comparator.comparing(OpenIssueRow::dueDate, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(OpenIssueRow::updatedAt, Comparator.reverseOrder())
            .thenComparing(OpenIssueRow::issueId);

    return new Upcoming(
        (int) open.stream().filter(OpenIssueRow::assignedToMe).count(),
        count(open, overdue),
        count(open, dueSoon),
        count(open, waiting),
        count(open, other),
        top(open, overdue, byDue),
        top(open, dueSoon, byDue),
        top(open, waiting, byWaiting),
        top(open, other, byOther));
  }

  private static int count(List<OpenIssueRow> rows, Predicate<OpenIssueRow> p) {
    return (int) rows.stream().filter(p).count();
  }

  private static List<UpcomingItem> top(
      List<OpenIssueRow> rows, Predicate<OpenIssueRow> p, Comparator<OpenIssueRow> order) {
    return rows.stream()
        .filter(p)
        .sorted(order)
        .limit(TOP_N)
        .map(
            r ->
                new UpcomingItem(
                    r.issueId(), r.projectKey(), r.number(), r.title(), r.dueDate(), List.of()))
        .toList();
  }

  /** 맡은 이슈 상위 줄에 지금 담당인 AI 이름을 붙인다 — 타일 넷의 상위 id 를 모아 한 번에 조회. */
  private Upcoming withAiNames(Upcoming u) {
    Set<Long> ids = new LinkedHashSet<>();
    for (List<UpcomingItem> list :
        List.of(u.overdueTop(), u.dueSoonTop(), u.waitingTop(), u.otherTop())) {
      list.forEach(i -> ids.add(i.issueId()));
    }
    Map<Long, List<String>> names = repository.findCurrentAiNames(ids);
    return new Upcoming(
        u.openAssigned(),
        u.overdue(),
        u.dueSoon(),
        u.waiting(),
        u.other(),
        named(u.overdueTop(), names),
        named(u.dueSoonTop(), names),
        named(u.waitingTop(), names),
        named(u.otherTop(), names));
  }

  private static List<UpcomingItem> named(List<UpcomingItem> items, Map<Long, List<String>> names) {
    return items.stream()
        .map(
            i ->
                new UpcomingItem(
                    i.issueId(),
                    i.projectKey(),
                    i.number(),
                    i.title(),
                    i.dueDate(),
                    names.getOrDefault(i.issueId(), List.of())))
        .toList();
  }

  /**
   * 마감 준수 카드의 「가장 늦게 완료한 이슈」 — 기간 전체의 완료 판정에서 늦은 날수 큰 순(같으면 최근 닫힌 순) 상위 {@link #LATE_TOP_N} 건을 골라
   * 키·제목만 붙인다. 지표 모듈이 센 직후 이슈가 지워진 경합이면 표시 정보가 없어 그 건만 뺀다(숫자는 지표 모듈 것을 그대로 둔다).
   */
  private List<LateItem> lateTop(List<ClosedIssueFact> facts) {
    List<ClosedIssueFact> late =
        facts.stream()
            .filter(f -> f.outcome() == DueOutcome.OVERDUE)
            .sorted(
                Comparator.comparingInt((ClosedIssueFact f) -> f.lateDays())
                    .reversed()
                    .thenComparing(IssueMetricsCalculator.CLOSED_DESC))
            .limit(LATE_TOP_N)
            .toList();
    if (late.isEmpty()) return List.of();
    Map<Long, IssueDisplay> displays =
        repository.findDisplays(late.stream().map(ClosedIssueFact::issueId).toList());
    return late.stream()
        .filter(f -> displays.containsKey(f.issueId()))
        .map(
            f -> {
              IssueDisplay d = displays.get(f.issueId());
              return new LateItem(f.issueId(), d.projectKey(), d.number(), d.title(), f.lateDays());
            })
        .toList();
  }
}

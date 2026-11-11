package com.workplace.issue.service;

import com.workplace.global.util.ChatMarkdownText;
import com.workplace.global.util.MentionParser;
import com.workplace.global.util.Texts;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.MeDaySummary;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.dto.MeOverviewResponse;
import com.workplace.issue.dto.MeOverviewResponse.ClosedItem;
import com.workplace.issue.dto.MeOverviewResponse.LastComment;
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
import com.workplace.issue.repository.MeOverviewRepository.CommentHead;
import com.workplace.issue.repository.MeOverviewRepository.IssueDisplay;
import com.workplace.issue.repository.MeOverviewRepository.OpenIssueRow;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「내 작업 · 개요」 탭(WP-1484) — 호출자 본인의 개요 한 화면과, 홈 위젯이 쓰는 「어제/오늘」 요약을 만든다.
 *
 * <p>숫자는 지표 모듈({@link IssueMetricsService#forMe})을 그대로 쓴다 — 기간 지표, 어제 끝냄(어제가 고른 기간 안이면 기간 결과의 일별
 * 칸·끝낸 이슈 판정에서 꺼내고, 기간 밖이거나 홈 위젯 요약이면 하루짜리 기간으로 한 번 더 부른다), 추이 칸, 끝낸 이슈 판정. 지표 모듈에 없는 것(열린 이슈의
 * 오늘/앞으로 할 일, 나를 기다림, 끝낸 일 표시 정보)만 {@link MeOverviewRepository} 로 채운다. 다른 사람 id 를 받는 메서드는 일부러 두지
 * 않는다 — 관리자라도 남의 개요를 볼 길이 없게(설계 「하면 안 되는 것」).
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다: 지표 모듈 호출 1~3번(기간, 칸 단위가 일별이 아니면 날짜 줄용 일별, 어제가 기간 밖이면 어제) + 열린 이슈 1 + 표시
 * 정보 1 + 마지막 코멘트 1 + AI 이름 2 + 멘션 이름 1. 끝낸 일 목록은 최근 {@link #CLOSED_LIMIT} 건만 표시 정보를 채운다.
 */
@Service
@RequiredArgsConstructor
public class MeOverviewService {

  /** 앞으로 할 일 타일마다 보이는 상위 건수(설계: 고른 타일 상위 3건). */
  static final int TOP_N = 3;

  /** 마감 임박 범위(일) — 오늘부터 7일 뒤까지(설계: 「마감 임박 7일」). */
  static final int DUE_SOON_DAYS = 7;

  /** 요청 내용·마지막 코멘트 미리보기 글자 수 — 펼친 줄에서 두세 줄 정도. */
  static final int EXCERPT_CHARS = 200;

  /** 끝낸 일 목록에 싣는 최대 건수(최근 끝낸 순) — 석 달 치를 통째로 내려 코멘트·AI 이름·멘션까지 붙이지 않게. 나머지는 「모두 보기」로 간다. */
  static final int CLOSED_LIMIT = 50;

  /** 기한 준수 카드의 「늦은 이슈 상위」 건수 — 목록을 잘라도 기간 전체에서 고르도록 서버가 따로 계산한다. */
  static final int LATE_TOP_N = 2;

  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

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
    LocalDate today = seoulToday(now);
    MetricsPeriod range = period.resolve(today);

    IssueMetrics metrics = metricsService.forMe(callerId, range, granularity);
    // 끝낸 일 목록의 날짜 줄(「끝냄 n · 만듦 n」)은 하루 단위라, 추이를 주별·월별로 볼 때만 일별 칸을 한 번 더 받는다.
    List<MetricsBucket> daily =
        granularity == MetricsGranularity.DAY
            ? metrics.buckets()
            : metricsService.forMe(callerId, range, MetricsGranularity.DAY).buckets();

    List<OpenIssueRow> open = repository.findOpenIssues(callerId);
    // 어제가 고른 기간 안이면 이미 받은 기간 결과(자르기 전 끝낸 이슈 전부 + 일별 칸)에서 어제 숫자를 꺼낸다 — 지표 모듈을 한 번 덜 부른다.
    MeDaySummary day =
        daySummary(callerId, today, open, new InRange(range, metrics.closedIssues(), daily));
    Upcoming upcoming = upcoming(open, today);
    ClosedList closed = closedList(metrics.closedIssues());

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
        daily,
        withAiNames(upcoming),
        closed.items(),
        closed.total(),
        closed.lateTop());
  }

  /**
   * 「어제/오늘」 요약 — 시각을 받는 판({@link #overview(Long, MeOverviewPeriod, MetricsGranularity,
   * OffsetDateTime)} 참조).
   */
  @Transactional(readOnly = true)
  MeDaySummary today(Long callerId, OffsetDateTime now) {
    Objects.requireNonNull(callerId, "callerId");
    LocalDate today = seoulToday(now);
    return daySummary(callerId, today, repository.findOpenIssues(callerId), null);
  }

  private static LocalDate seoulToday(OffsetDateTime now) {
    return now.atZoneSameInstant(IssueDueWindow.ZONE).toLocalDate();
  }

  /**
   * 개요가 이미 받은 기간 결과 — 어제 숫자를 다시 묻지 않고 꺼내는 데 쓴다.
   *
   * @param range 고른 기간
   * @param facts 기간의 끝낸 이슈 판정 전부(목록 자르기 전)
   * @param daily 기간의 일별 칸
   */
  private record InRange(
      MetricsPeriod range, List<ClosedIssueFact> facts, List<MetricsBucket> daily) {}

  /**
   * 어제 한 일은 지표 모듈과 같은 정의(닫힐 때 담당자·닫힐 당시 마감일·AI와 함께)로 센다 — 어제가 기간 안이면 기간 결과에서, 아니면(홈 위젯 요약 포함) 하루짜리
   * 기간(달력상 어제)을 지표 모듈에 따로 묻는다. 오늘 할 일은 열린 이슈에서 센다.
   *
   * @param inRange 개요가 받은 기간 결과(홈 위젯 요약이면 null)
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
   * 앞으로 할 일 — 타일은 서로 겹칠 수 있다({@link Upcoming} 참조). 「그 밖」은 맡은 열린 이슈 중 기한 지남·마감 임박·나를 기다림 어디에도 들지 않는
   * 것.
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
    // 그 밖은 마감이 있는 것 먼저(가까운 순), 마감 없으면 최근 바뀐 순 — 손댈 차례가 가까운 것부터.
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

  /** 앞으로 할 일 상위 줄에 지금 담당인 AI 이름을 붙인다 — 타일 넷의 상위 id 를 모아 한 번에 조회. */
  private Upcoming withAiNames(Upcoming u) {
    Set<Long> ids = new LinkedHashSet<>();
    for (List<UpcomingItem> list :
        List.of(u.overdueTop(), u.dueSoonTop(), u.waitingTop(), u.otherTop())) {
      list.forEach(i -> ids.add(i.issueId()));
    }
    Map<Long, List<String>> names = repository.findAiNames(ids, true);
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
   * 끝낸 일 목록 결과.
   *
   * @param items 최근 끝낸 순 최대 {@link #CLOSED_LIMIT} 건(표시 정보가 사라진 경합 건은 빠진다)
   * @param total 기간에 끝낸 이슈 전체 수(지표 모듈 판정 수 — 목록이 잘렸는지 화면이 안다)
   * @param lateTop 기간 전체에서 늦은 날수 큰 순 상위 {@link #LATE_TOP_N} 건
   */
  private record ClosedList(List<ClosedItem> items, int total, List<ClosedItem> lateTop) {}

  /**
   * 지표 모듈의 끝낸 이슈 판정에 키·제목·AI 이름·요청 내용·마지막 코멘트를 붙인다(순서 = 닫힌 시각 내림차순 유지). 표시 정보는 최근 {@link
   * #CLOSED_LIMIT} 건에만 붙이고, 늦은 이슈 상위는 기간 전체에서 골라 키·제목만 붙인다(목록에 들어 있으면 그 줄을 그대로 쓴다).
   */
  private ClosedList closedList(List<ClosedIssueFact> facts) {
    if (facts.isEmpty()) return new ClosedList(List.of(), 0, List.of());
    List<ClosedIssueFact> shown = facts.stream().limit(CLOSED_LIMIT).toList();
    // 늦은 날수 큰 순, 같으면 최근 닫힌 순(지표 모듈 기본 순서) — 화면이 하던 정렬을 기간 전체로 옮겼다.
    List<ClosedIssueFact> late =
        facts.stream()
            .filter(f -> f.outcome() == DueOutcome.OVERDUE)
            .sorted(
                Comparator.comparingInt((ClosedIssueFact f) -> f.lateDays())
                    .reversed()
                    .thenComparing(IssueMetricsCalculator.CLOSED_DESC))
            .limit(LATE_TOP_N)
            .toList();

    List<Long> shownIds = shown.stream().map(ClosedIssueFact::issueId).toList();
    Set<Long> displayIds = new LinkedHashSet<>(shownIds);
    late.forEach(f -> displayIds.add(f.issueId()));
    Map<Long, IssueDisplay> displays = repository.findDisplays(displayIds);
    // 코멘트·AI 이름·멘션은 목록에 보이는 줄에만 필요하다.
    Map<Long, CommentHead> comments = repository.findLastComments(shownIds);
    List<Long> withAiIds =
        shown.stream().filter(ClosedIssueFact::withAi).map(ClosedIssueFact::issueId).toList();
    Map<Long, List<String>> aiNames = repository.findAiNames(withAiIds, false);

    // 본문·코멘트의 멘션 토큰(<@id>)을 이름으로 — 나온 사람 id 를 모아 한 번에 조회한다.
    Set<Long> mentioned = new LinkedHashSet<>();
    for (Long id : shownIds) {
      IssueDisplay d = displays.get(id);
      if (d != null) mentioned.addAll(MentionParser.parse(d.bodyHead()));
    }
    comments.values().forEach(c -> mentioned.addAll(MentionParser.parse(c.bodyHead())));
    Map<Long, String> names = repository.findNames(mentioned);

    List<ClosedItem> items = new ArrayList<>(shown.size());
    Map<Long, ClosedItem> byId = new HashMap<>();
    for (ClosedIssueFact f : shown) {
      IssueDisplay d = displays.get(f.issueId());
      // 지표 모듈이 센 직후 이슈가 지워진 경합 — 표시 정보가 없으면 목록에서만 뺀다(숫자는 지표 모듈 것을 그대로 둔다).
      if (d == null) continue;
      CommentHead c = comments.get(f.issueId());
      String commentText = c == null ? null : excerpt(c.bodyHead(), names);
      ClosedItem item =
          closedItem(
              f,
              d,
              f.withAi() ? aiNames.getOrDefault(f.issueId(), List.of()) : List.of(),
              excerpt(d.bodyHead(), names),
              commentText == null ? null : new LastComment(c.authorName(), commentText));
      items.add(item);
      byId.put(f.issueId(), item);
    }

    List<ClosedItem> lateTop = new ArrayList<>(late.size());
    for (ClosedIssueFact f : late) {
      ClosedItem full = byId.get(f.issueId());
      if (full != null) {
        lateTop.add(full);
        continue;
      }
      IssueDisplay d = displays.get(f.issueId());
      if (d == null) continue; // 위와 같은 삭제 경합
      // 목록 밖 늦은 이슈 — 카드는 키·제목·늦은 날수만 보이므로 AI 이름·요청 내용·코멘트는 채우지 않는다.
      lateTop.add(closedItem(f, d, List.of(), null, null));
    }
    return new ClosedList(items, facts.size(), lateTop);
  }

  private static ClosedItem closedItem(
      ClosedIssueFact f,
      IssueDisplay d,
      List<String> aiNames,
      String request,
      LastComment lastComment) {
    return new ClosedItem(
        f.issueId(),
        d.projectKey(),
        d.number(),
        d.title(),
        f.closedAt(),
        f.closedDate(),
        f.dueAtClose(),
        f.outcome(),
        f.lateDays(),
        f.leadTimeDays(),
        f.withAi(),
        aiNames,
        request,
        lastComment);
  }

  /**
   * 본문 앞부분 → 한 줄 미리보기 평문. 마크다운 기호를 지우고(채팅 미리보기와 같은 규칙), 멘션은 {@code @이름}(모르는 사람은 {@code @사용자}),
   * 공백·줄바꿈은 한 칸으로 접어 {@link #EXCERPT_CHARS} 자에서 자른다. 비면 null.
   */
  static String excerpt(String raw, Map<Long, String> names) {
    if (raw == null || raw.isBlank()) return null;
    String named = MentionParser.replace(raw, id -> "@" + names.getOrDefault(id, "사용자"));
    String plain = WHITESPACE.matcher(ChatMarkdownText.toPlain(named)).replaceAll(" ").strip();
    if (plain.isEmpty()) return null;
    String head = Texts.headUtf16(plain, EXCERPT_CHARS);
    return head.length() < plain.length() ? head + "…" : head;
  }
}

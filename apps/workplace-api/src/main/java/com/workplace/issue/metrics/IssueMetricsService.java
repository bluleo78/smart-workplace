package com.workplace.issue.metrics;

import com.workplace.issue.metrics.IssueMetricsCalculator.AssigneeChange;
import com.workplace.issue.metrics.IssueMetricsCalculator.DueChange;
import com.workplace.issue.metrics.IssueMetricsCalculator.Evaluated;
import com.workplace.issue.metrics.IssueMetricsCalculator.IssueInput;
import com.workplace.issue.metrics.IssueMetricsRepository.ClosedCandidate;
import com.workplace.issue.metrics.IssueMetricsRepository.CurrentAssignee;
import com.workplace.issue.metrics.IssueMetricsRepository.HistoryEvent;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Predicate;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 성과 지표 계산 공통 모듈의 공개 진입점(WP-1476). REST 엔드포인트는 두지 않는다 — 화면 이슈(WP-1478 프로젝트 성과, WP-1484 내 성과,
 * WP-1483 등)가 자기 컨트롤러에서 이 서비스를 불러 응답 모양으로 바꿔 노출한다.
 *
 * <h2>쓰는 법</h2>
 *
 * <pre>{@code
 * // 프로젝트 성과 — 프로젝트를 읽을 수 있는 사람만. 못 읽으면 ProjectNotFoundException(404) 이 그대로 나간다.
 * IssueMetrics m = issueMetricsService.forProject(
 *     callerId, "WP", new MetricsPeriod(from, to), MetricsGranularity.WEEK);
 *
 * // 내 성과 — 호출자 본인 지표만. 다른 사람 지표를 묻는 메서드는 일부러 두지 않는다(개인 성과 노출 방지).
 * IssueMetrics mine = issueMetricsService.forMe(
 *     callerId, new MetricsPeriod(from, to), MetricsGranularity.DAY);
 * }</pre>
 *
 * <ul>
 *   <li>기간은 서울 날짜(양 끝 포함). {@link MetricsPeriod} 가 from &gt; to·400일 초과를 {@link
 *       IllegalArgumentException} 으로 거절하므로, 컨트롤러는 이를 400 으로 바꾸면 된다.
 *   <li>결과의 {@code current}/{@code previous} 는 같은 길이의 바로 앞 기간과의 비교, {@code buckets} 는 추이 그래프(빈 칸
 *       0), {@code closedIssues} 는 「늦은 이슈 상위」「끝낸 일 목록」용 이슈별 사실(닫힌 시각 내림차순, 표시 정보는 issueId 로 따로
 *       채운다).
 *   <li>정의(완료 = DONE·closed_at 기준, 닫힐 때 담당자, 닫힐 당시 마감일, AI와 함께)는 {@link IssueMetricsCalculator} 에
 *       있다. 화면마다 따로 세지 말고 이 모듈 하나로 맞춘다 — 같은 「완료 수」가 화면마다 다르게 보이지 않게.
 * </ul>
 *
 * <h2>성능</h2>
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정(최대 6개 + 권한 확인)이다 — {@link IssueMetricsRepository} 참조. 현재·지난 기간을 한 번에 가져와
 * 자바에서 나눈다. 최근 3개월·일별 기준 1초 목표는 테스트로 재지 않고(환경 의존) 이 고정 쿼리 수와 V278 인덱스로 담보한다.
 *
 * <p>공개 메서드는 {@code @Transactional(readOnly = true)} — TenantAwareTransactionManager 가 테넌트 GUC 를
 * 걸어야 RLS 가 행을 보여 준다(빠지면 fail-closed 로 전부 0 이 된다).
 */
@Service
@RequiredArgsConstructor
public class IssueMetricsService {

  private final IssueMetricsRepository repository;
  private final ProjectAccessGuard accessGuard;

  /**
   * 프로젝트 기준 지표 — 그 프로젝트 이슈 전체. 호출자가 프로젝트를 읽을 수 없으면(없음·삭제·비공개) {@code ProjectNotFoundException} 을
   * 그대로 던진다(존재를 드러내지 않는 404, WP-588).
   */
  @Transactional(readOnly = true)
  public IssueMetrics forProject(
      Long callerId, String projectKey, MetricsPeriod period, MetricsGranularity granularity) {
    validate(period, granularity);
    ProjectRow project = accessGuard.assertReadable(projectKey, callerId);
    Condition scope = repository.projectScope(project.id());
    return compute(period, granularity, scope, scope, ev -> true);
  }

  /**
   * 프로젝트의 완료·새로 생김 수만(현재·지난 기간) — {@link #forProject} 의 {@code completed}·{@code created} 와 같은 값을 한
   * 문장으로 센다(WP-1478 개요 숫자 카드). 권한은 부르는 쪽이 이미 확인한 프로젝트 행을 넘긴다 — 같은 요청에서 읽기 판정을 두 번 하지 않게.
   *
   * @param project 호출자가 읽을 수 있음을 확인한 프로젝트
   */
  @Transactional(readOnly = true)
  public MetricsCounts countsForProject(ProjectRow project, MetricsPeriod period) {
    if (period == null) throw new IllegalArgumentException("기간을 지정해 주세요");
    Objects.requireNonNull(project, "project");
    return repository.countPeriods(repository.projectScope(project.id()), period);
  }

  /**
   * 사람 기준 지표 — 호출자 본인. 완료는 「닫힐 때 내가 담당자」인 이슈(담당 여럿이어도 1건), 새로 생김은 내가 보고자인 이슈. 지금 읽을 수 있는 프로젝트(개인
   * 프로젝트 포함)의 이슈만 센다 — 멤버에서 빠진 프로젝트의 지난 일은 보이지 않는다.
   */
  @Transactional(readOnly = true)
  public IssueMetrics forMe(Long callerId, MetricsPeriod period, MetricsGranularity granularity) {
    validate(period, granularity);
    Objects.requireNonNull(callerId, "callerId");
    long me = callerId;
    Condition readable = repository.readableBy(me);
    return compute(
        period,
        granularity,
        readable.and(repository.assigneeCandidate(me)),
        readable.and(repository.reportedBy(me)),
        assignedAtClose(me));
  }

  /**
   * 호출자 본인이 기간 안에 끝낸 이슈만(닫힌 시각 내림차순) — {@link #forMe} 의 {@code closedIssues} 와 같은 정의·같은 결과(WP-1485
   * 업무 프로파일용). 지난 기간 조회·새로 생김·칸 묶음을 하지 않아 끝낸 이슈 목록만 필요한 곳에서 가볍다.
   */
  @Transactional(readOnly = true)
  public List<ClosedIssueFact> closedIssuesForMe(Long callerId, MetricsPeriod period) {
    if (period == null) throw new IllegalArgumentException("기간을 지정해 주세요");
    Objects.requireNonNull(callerId, "callerId");
    long me = callerId;
    Condition closedScope = repository.readableBy(me).and(repository.assigneeCandidate(me));
    List<ClosedIssueFact> facts = new ArrayList<>();
    for (Evaluated ev :
        evaluateClosed(
            closedScope, period.startInclusive(), period.endExclusive(), assignedAtClose(me))) {
      if (period.contains(ev.fact().closedDate())) facts.add(ev.fact());
    }
    facts.sort(IssueMetricsCalculator.CLOSED_DESC);
    return List.copyOf(facts);
  }

  /** 사람 기준 완료 조건 — 닫힐 때 담당자 중에 그 사람이 있다(forMe·closedIssuesForMe 공통). */
  private static Predicate<Evaluated> assignedAtClose(long me) {
    return ev -> ev.assigneesAtClose().contains(me);
  }

  private static void validate(MetricsPeriod period, MetricsGranularity granularity) {
    if (period == null) throw new IllegalArgumentException("기간을 지정해 주세요");
    if (granularity == null) throw new IllegalArgumentException("칸 묶음 단위를 지정해 주세요");
  }

  /**
   * 공통 계산 — 현재+지난 기간을 한 번에 조회해 이슈별로 평가하고, 사람 기준이면 {@code include} 로 닫힐 때 담당자를 거른 뒤 기간별로 나눈다.
   *
   * @param closedScope 완료 후보 범위
   * @param createdScope 새로 생김 범위
   * @param include 평가 결과 중 셀 것(프로젝트 기준은 전부)
   */
  private IssueMetrics compute(
      MetricsPeriod period,
      MetricsGranularity granularity,
      Condition closedScope,
      Condition createdScope,
      Predicate<Evaluated> include) {
    MetricsPeriod prev = period.previous();
    OffsetDateTime from = prev.startInclusive();
    OffsetDateTime toExclusive = period.endExclusive();

    // ①~⑥ 완료 후보 평가 후 현재·지난 기간으로 나눈다
    List<ClosedIssueFact> currentFacts = new ArrayList<>();
    List<ClosedIssueFact> previousFacts = new ArrayList<>();
    for (Evaluated ev : evaluateClosed(closedScope, from, toExclusive, include)) {
      if (period.contains(ev.fact().closedDate())) {
        currentFacts.add(ev.fact());
      } else if (prev.contains(ev.fact().closedDate())) {
        previousFacts.add(ev.fact());
      }
    }
    currentFacts.sort(IssueMetricsCalculator.CLOSED_DESC);

    // ⑤ 새로 생김 — 서울 날짜로 나눠 기간별 수와 칸에 쓴다
    List<LocalDate> createdCurrent = new ArrayList<>();
    int createdPrevious = 0;
    for (OffsetDateTime t : repository.findCreatedAts(createdScope, from, toExclusive)) {
      LocalDate d = IssueMetricsCalculator.seoulDate(t);
      if (period.contains(d)) {
        createdCurrent.add(d);
      } else if (prev.contains(d)) {
        createdPrevious++;
      }
    }

    return new IssueMetrics(
        period,
        prev,
        granularity,
        IssueMetricsCalculator.summarize(currentFacts, createdCurrent.size()),
        IssueMetricsCalculator.summarize(previousFacts, createdPrevious),
        IssueMetricsCalculator.buckets(period, granularity, currentFacts, createdCurrent),
        List.copyOf(currentFacts));
  }

  /**
   * 완료 후보 평가 — [from, toExclusive) 에 닫힌 DONE 후보를 모아 이슈별로 평가하고 {@code include} 를 통과한 것만 후보 순서대로
   * 돌려준다. 「완료」 정의(DONE·closed_at·닫힐 때 담당자)를 compute·closedIssuesForMe 가 한 경로로 공유하게 한 것. 기간 나누기·정렬은
   * 호출부 몫.
   */
  private List<Evaluated> evaluateClosed(
      Condition closedScope,
      OffsetDateTime from,
      OffsetDateTime toExclusive,
      Predicate<Evaluated> include) {
    // ① 후보 → ②③④ 원재료(쿼리 수 고정)
    List<ClosedCandidate> candidates = repository.findClosedDone(closedScope, from, toExclusive);
    List<Long> ids = candidates.stream().map(ClosedCandidate::issueId).toList();
    Map<Long, List<AssigneeChange>> assigneeChanges = new HashMap<>();
    Map<Long, List<DueChange>> dueChanges = new HashMap<>();
    for (HistoryEvent e : repository.findHistory(ids)) {
      if (IssueMetricsRepository.ASSIGNEES_CHANGED.equals(e.eventType())) {
        IssueMetricsCalculator.parseAssigneeChange(e)
            .ifPresent(
                c -> assigneeChanges.computeIfAbsent(e.issueId(), k -> new ArrayList<>()).add(c));
      } else {
        IssueMetricsCalculator.parseDueChange(e)
            .ifPresent(c -> dueChanges.computeIfAbsent(e.issueId(), k -> new ArrayList<>()).add(c));
      }
    }
    Map<Long, Set<Long>> current = new HashMap<>();
    for (CurrentAssignee a : repository.findCurrentAssignees(ids)) {
      current.computeIfAbsent(a.issueId(), k -> new LinkedHashSet<>()).add(a.userId());
    }
    Map<Long, OffsetDateTime> agentStarts = repository.findFirstAgentRunAt(ids);

    // ⑥ 이력·현재 담당자에 나오는 사람 전부의 종류를 한 번에 조회(이슈마다 묻지 않는다)
    Set<Long> people = new HashSet<>();
    current.values().forEach(people::addAll);
    assigneeChanges.values().forEach(list -> list.forEach(c -> c.userIds().forEach(people::add)));
    Map<Long, String> kinds = repository.findKinds(people);

    List<Evaluated> out = new ArrayList<>();
    for (ClosedCandidate c : candidates) {
      IssueInput in =
          new IssueInput(
              c,
              assigneeChanges.getOrDefault(c.issueId(), List.of()),
              dueChanges.getOrDefault(c.issueId(), List.of()),
              current.getOrDefault(c.issueId(), Set.of()),
              agentStarts.get(c.issueId()));
      Evaluated ev = IssueMetricsCalculator.evaluate(in, kinds);
      if (include.test(ev)) out.add(ev);
    }
    return out;
  }
}

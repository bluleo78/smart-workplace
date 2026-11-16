package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.LABEL;
import static com.workplace.jooq.Tables.PROJECT;

import com.workplace.issue.metrics.ClosedIssueFact;
import com.workplace.issue.metrics.IssueMetricsRepository;
import com.workplace.issue.report.PersonalReportWork.EpicWork;
import com.workplace.issue.report.PersonalReportWork.ProjectWork;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 개인 주간·월간 보고의 끝낸 일 집계 쿼리(WP-1632) — 지표 모듈이 이미 고른 끝낸 이슈(끝냄 건수와 같은 집합)를 받아 프로젝트 → 가장 가까운 에픽으로 묶는다.
 * 건수를 새로 세지 않고 받은 집합만 묶으므로 프로젝트 합이 끝냄 건수와 같다(그 사이 지워진 이슈만 빠진다).
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다(끝낸 이슈 1 + 에픽 1 + 라벨 1). 에픽은 프로젝트 리포트와 같은 규칙({@link NearestEpic})이고, 에픽이
 * 다른 프로젝트에 있어도 묶음은 이슈의 프로젝트다. 에픽의 프로젝트를 지금 읽을 수 없거나(권한·삭제) 에픽이 지워졌으면 제목을 숨기고 「에픽 없음」 으로 센다. 취소·닫힌
 * 에픽 아래 끝낸 하위도 그 에픽으로 묶는다 — 개인 보고는 「내가 끝낸 일」 중심이라 프로젝트 리포트의 「에픽 밖 완료」 와 다르다. RLS 보호 테이블이라 트랜잭션 안에서
 * 부른다.
 */
@Repository
public class PersonalReportWorkRepository {

  private final DSLContext dsl;

  /** 읽을 수 있는 프로젝트 조건(지표 모듈 사람 기준과 같은 규칙). */
  private final IssueMetricsRepository metricsRepository;

  /** 에픽 주소 만들기(프로젝트 리포트와 공유). */
  private final ReportIssueDetails details;

  public PersonalReportWorkRepository(
      DSLContext dsl, IssueMetricsRepository metricsRepository, ReportIssueDetails details) {
    this.dsl = dsl;
    this.metricsRepository = metricsRepository;
    this.details = details;
  }

  /** 끝낸 이슈 한 건 — epicId 는 가장 가까운 EPIC 조상(이슈 자체가 EPIC 이면 자기 id), 없으면 null. */
  private record Done(
      long id, String title, long projectId, String projectKey, String projectName, Long epicId) {}

  /** 읽을 수 있는 에픽 한 건 — key 는 에픽 프로젝트의 키 기준. */
  private record Epic(long id, int number, String title, String projectKey) {}

  /**
   * 끝낸 일을 프로젝트 → 에픽으로 묶는다.
   *
   * @param userId 보고 주인 — 에픽 프로젝트를 읽을 수 있는지 볼 때 쓴다
   * @param closed 지표 모듈의 끝낸 이슈(닫힌 시각 내림차순, 끝냄 건수와 같은 집합)
   */
  public PersonalReportWork doneWork(long userId, List<ClosedIssueFact> closed) {
    if (closed.isEmpty()) return new PersonalReportWork(List.of());
    List<Long> ids = closed.stream().map(ClosedIssueFact::issueId).toList();

    // ① 끝낸 이슈와 가장 가까운 에픽.
    Map<Long, Done> byId = doneIssues(ids);

    // ② 에픽 — 지금 읽을 수 있는 것만(못 읽으면 「에픽 없음」).
    List<Long> epicIds =
        byId.values().stream().map(Done::epicId).filter(Objects::nonNull).distinct().toList();
    Map<Long, Epic> epics = readableEpics(userId, epicIds);

    // ③ 라벨 — 에픽의 「상시」, 끝낸 이슈의 「AI 탐색」(둘 다 그 이슈 프로젝트의 라벨). 프로젝트 리포트와 같은 조회 규칙, 한 쿼리.
    Map<String, Set<Long>> labeled =
        ReportLabels.issueIdsWithLabels(
            dsl,
            LABEL.PROJECT_ID.eq(ISSUE.PROJECT_ID),
            Map.of(
                ProjectReportEpics.ONGOING_LABEL,
                ReportLabels.issueIdIn(epics.keySet()),
                ProjectReportEpics.AI_TESTER_LABEL,
                ReportLabels.issueIdIn(byId.keySet())));
    Set<Long> ongoing = labeled.get(ProjectReportEpics.ONGOING_LABEL);
    Set<Long> aiTester = labeled.get(ProjectReportEpics.AI_TESTER_LABEL);

    // 묶기 — 받은 순서(최근 끝낸 순)대로 넣어 제목 순서가 최신순이 되게 한다. 에픽 키 null = 「에픽 없음」.
    Map<Long, Map<Long, List<Done>>> grouped = new LinkedHashMap<>();
    for (ClosedIssueFact f : closed) {
      Done d = byId.get(f.issueId());
      if (d == null) continue; // 그 사이 지워진 이슈
      Long epicKey = d.epicId() != null && epics.containsKey(d.epicId()) ? d.epicId() : null;
      grouped
          .computeIfAbsent(d.projectId(), k -> new LinkedHashMap<>())
          .computeIfAbsent(epicKey, k -> new ArrayList<>())
          .add(d);
    }

    // AI 입력 크기 — 에픽당 상한(100)과 전체 제목 예산(600)으로 에픽당 제목 수를 먼저 정해, 남길 제목만 한 줄로 만든다. 건수는 그대로.
    int titleLimit =
        PersonalReportWork.titleLimit(
            grouped.values().stream()
                .flatMap(perEpic -> perEpic.values().stream())
                .map(List::size)
                .toList());

    List<ProjectWork> projects = new ArrayList<>();
    for (Map<Long, List<Done>> perEpic : grouped.values()) {
      Done first = perEpic.values().iterator().next().get(0);
      List<EpicWork> epicWorks = new ArrayList<>();
      for (Map.Entry<Long, List<Done>> e : perEpic.entrySet()) {
        List<Done> items = e.getValue();
        // 「에픽 없음」 기본값 — 읽을 수 있는 에픽이 있으면 그 에픽 값으로 바꾼다.
        Epic epic = e.getKey() == null ? null : epics.get(e.getKey());
        String key = null;
        String url = null;
        String title = PersonalReportWork.NO_EPIC;
        boolean isOngoing = false;
        boolean epicDone = false;
        if (epic != null) {
          key = epic.projectKey() + "-" + epic.number();
          url = details.issueUrl(epic.projectKey(), epic.number());
          title = ReportIssueDetails.oneLine(epic.title());
          isOngoing = ongoing.contains(epic.id());
          epicDone = items.stream().anyMatch(d -> d.id() == epic.id());
        }
        int found = (int) items.stream().filter(d -> aiTester.contains(d.id())).count();
        List<String> titles =
            ProjectReportEpics.capTitles(
                items, d -> ReportIssueDetails.oneLine(d.title()), titleLimit);
        epicWorks.add(
            new EpicWork(key, url, title, isOngoing, epicDone, items.size(), found, titles));
      }
      // 에픽은 끝낸 일 많은 순 → 프로젝트 키 → 번호 숫자 순, 「에픽 없음」 은 맨 뒤.
      epicWorks.sort(PersonalReportWork.EPIC_ORDER);
      int done = epicWorks.stream().mapToInt(EpicWork::done).sum();
      int found = epicWorks.stream().mapToInt(EpicWork::foundByAiTester).sum();
      projects.add(
          new ProjectWork(
              first.projectKey(), first.projectName(), done, found, List.copyOf(epicWorks)));
    }
    // 프로젝트는 끝낸 일 많은 순 → 이름 → 키.
    projects.sort(
        Comparator.comparing(ProjectWork::done, Comparator.reverseOrder())
            .thenComparing(ProjectWork::projectName)
            .thenComparing(ProjectWork::projectKey));
    return new PersonalReportWork(List.copyOf(projects));
  }

  // ───────────────────────── 쿼리 ─────────────────────────

  /** 끝낸 이슈 id → 제목·프로젝트·가장 가까운 에픽(이슈 자체가 EPIC 이면 자기 id). 없는 id(지워짐)는 빠진다. */
  private Map<Long, Done> doneIssues(List<Long> ids) {
    var ownType = ISSUE_TYPE_DEF.as("prw_own_type");
    NearestEpic ne = NearestEpic.of("prw_");
    Field<Long> epicId =
        DSL.when(ownType.NAME.eq(ProjectReportEpicRepository.EPIC_TYPE), ISSUE.ID)
            .otherwise(ne.epicId())
            .as("prw_epic_id");
    Map<Long, Done> out = new HashMap<>();
    dsl.select(ISSUE.ID, ISSUE.TITLE, ISSUE.PROJECT_ID, PROJECT.KEY, PROJECT.NAME, epicId)
        .from(ne.table())
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(ownType)
        .on(ownType.ID.eq(ISSUE.TYPE_ID))
        .where(ISSUE.ID.eq(DSL.any(ids.toArray(Long[]::new))))
        .and(ISSUE.DELETED_AT.isNull())
        .fetch()
        .forEach(
            r ->
                out.put(
                    r.get(ISSUE.ID),
                    new Done(
                        r.get(ISSUE.ID),
                        r.get(ISSUE.TITLE),
                        r.get(ISSUE.PROJECT_ID),
                        r.get(PROJECT.KEY),
                        r.get(PROJECT.NAME),
                        r.get(epicId))));
    return out;
  }

  /** 에픽 id 중 지금 읽을 수 있는 것(에픽·프로젝트 삭제 안 됨, 읽을 수 있는 프로젝트) → 번호·제목·프로젝트 키. */
  private Map<Long, Epic> readableEpics(long userId, List<Long> epicIds) {
    Map<Long, Epic> out = new HashMap<>();
    if (epicIds.isEmpty()) return out;
    dsl.select(ISSUE.ID, ISSUE.NUMBER, ISSUE.TITLE, PROJECT.KEY)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE.ID.eq(DSL.any(epicIds.toArray(Long[]::new))))
        .and(ISSUE.DELETED_AT.isNull())
        .and(PROJECT.DELETED_AT.isNull())
        .and(metricsRepository.readableBy(userId))
        .fetch()
        .forEach(
            r ->
                out.put(
                    r.get(ISSUE.ID),
                    new Epic(
                        r.get(ISSUE.ID),
                        r.get(ISSUE.NUMBER),
                        r.get(ISSUE.TITLE),
                        r.get(PROJECT.KEY))));
    return out;
  }
}

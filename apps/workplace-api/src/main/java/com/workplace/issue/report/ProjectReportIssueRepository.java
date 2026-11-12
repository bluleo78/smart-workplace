package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.util.CapabilityTokens;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.repository.IssueAttentionConditions;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

/**
 * 리포트 기간 이슈 목록(WP-1483) — 기간 안에 DONE 으로 닫힌 것, 기간 안에 생긴 것, 지금 열려 있고 기한 지난 것을 AI 입력용으로 모은다.
 *
 * <p>범위는 표 숫자와 맞춘다: 완료·생김은 지표 모듈({@code IssueMetricsRepository.countPeriods})처럼 모든 유형(삭제 제외), 기한
 * 지남은 개요 숫자처럼 작업 이슈 범위({@link IssueAttentionConditions#workScope}, SUBTASK·EPIC 제외). 한 이슈가 여러 이유에
 * 들면 기한 지남 → 닫힘 → 생김 순으로 앞의 이유 하나로만 싣는다. 정렬은 그 순서로 묶고 묶음 안은 최신순(기한 지남은 마감일, 닫힘은 닫힌 시각, 생김은 생긴 시각).
 *
 * <p>쿼리 수는 이슈 수와 무관하게 고정이다(후보 1 + 표시 정보 1 + 담당자 1 + 코멘트 1). RLS 보호 테이블이라 트랜잭션 안에서 부른다.
 */
@Repository
public class ProjectReportIssueRepository {

  /** 상한 밖 이슈 중 에픽이 없는 것의 묶음 이름. */
  public static final String NO_EPIC = "에픽 없음";

  /** 제목 자르기 길이. */
  static final int TITLE_MAX = 80;

  /** 마지막 코멘트 자르기 길이. */
  static final int COMMENT_MAX = 120;

  private final DSLContext dsl;

  /** 공개 웹 주소(끝 「/」 제거) — 이슈 주소를 앱 링크 칩이 알아보는 모양으로 만든다. */
  private final String baseUrl;

  public ProjectReportIssueRepository(
      DSLContext dsl, @Value("${workplace.public-base-url:}") String publicBaseUrl) {
    this.dsl = dsl;
    this.baseUrl = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
  }

  /** 상한까지 자른 목록과 밀린 이슈의 에픽별 건수. */
  public record Selection(List<ReportIssue> issues, Map<String, Integer> omittedByEpic) {}

  /** 후보 한 건 — 이유·정렬 키·에픽 제목만(표시 정보는 상한 안의 것만 따로 읽는다). */
  private record Candidate(
      long id, String reason, int rank, OffsetDateTime sortAt, LocalDate due, String epic) {}

  /**
   * 기간 이슈 목록(최대 {@code limit} 건, 정렬 순)과 상한 밖으로 밀린 이슈의 에픽 제목 → 건수(많은 순, 같으면 이름순, 에픽이 없으면 {@link
   * #NO_EPIC})를 후보 쿼리 한 번으로 함께 만든다.
   */
  public Selection select(long projectId, ReportPeriod period, LocalDate today, int limit) {
    List<Candidate> all = candidates(projectId, period, today);
    List<Candidate> shown = all.subList(0, Math.min(limit, all.size()));
    List<Candidate> rest = all.subList(shown.size(), all.size());
    return new Selection(details(shown), groupByEpic(rest));
  }

  /** 세 이유 중 하나라도 든 이슈를 모아 이유·정렬 키를 정하고 정렬한다. */
  private List<Candidate> candidates(long projectId, ReportPeriod period, LocalDate today) {
    OffsetDateTime from = period.toMetrics().startInclusive();
    OffsetDateTime to = period.toMetrics().endExclusive();
    Condition overdue =
        IssueAttentionConditions.overdue(today).and(IssueAttentionConditions.workScope(projectId));
    Condition done =
        ISSUE
            .STATUS
            .eq(IssueStatuses.DONE)
            .and(ISSUE.CLOSED_AT.ge(from))
            .and(ISSUE.CLOSED_AT.lt(to));
    Condition created = ISSUE.CREATED_AT.ge(from).and(ISSUE.CREATED_AT.lt(to));
    Field<Boolean> isOverdue = DSL.field(overdue).as("is_overdue");
    Field<Boolean> isDone = DSL.field(done).as("is_done");
    var parent = ISSUE.as("rp_parent");
    var parentType = ISSUE_TYPE_DEF.as("rp_parent_type");

    List<Candidate> out = new ArrayList<>();
    dsl.select(
            ISSUE.ID,
            ISSUE.DUE_DATE,
            ISSUE.CLOSED_AT,
            ISSUE.CREATED_AT,
            isOverdue,
            isDone,
            parent.TITLE,
            parentType.ID)
        .from(ISSUE)
        .leftJoin(parent)
        .on(parent.ID.eq(ISSUE.PARENT_ISSUE_ID))
        .leftJoin(parentType)
        .on(parentType.ID.eq(parent.TYPE_ID).and(parentType.NAME.eq("EPIC")))
        .where(ISSUE.PROJECT_ID.eq(projectId))
        .and(ISSUE.DELETED_AT.isNull())
        .and(overdue.or(done).or(created))
        .fetch()
        .forEach(
            r -> {
              // 부모 유형이 에픽으로 붙었을 때만 에픽 제목으로 본다.
              String epic = r.get(parentType.ID) == null ? null : r.get(parent.TITLE);
              LocalDate due = r.get(ISSUE.DUE_DATE);
              if (Boolean.TRUE.equals(r.get(isOverdue))) {
                out.add(new Candidate(r.get(ISSUE.ID), "OVERDUE", 0, null, due, epic));
              } else if (Boolean.TRUE.equals(r.get(isDone))) {
                out.add(
                    new Candidate(r.get(ISSUE.ID), "DONE", 1, r.get(ISSUE.CLOSED_AT), due, epic));
              } else {
                out.add(
                    new Candidate(
                        r.get(ISSUE.ID), "CREATED", 2, r.get(ISSUE.CREATED_AT), due, epic));
              }
            });
    // 묶음 순 → 묶음 안 최신순(기한 지남은 마감일, 나머지는 시각) → id 역순(같은 시각이면 나중 것 먼저).
    Comparator<Candidate> latest =
        Comparator.comparing(
                (Candidate c) -> c.rank() == 0 ? c.due().toString() : null,
                Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(Candidate::sortAt, Comparator.nullsLast(Comparator.reverseOrder()));
    out.sort(
        Comparator.comparingInt(Candidate::rank)
            .thenComparing(latest)
            .thenComparing(Candidate::id, Comparator.reverseOrder()));
    return out;
  }

  /** 상한 안 후보의 표시 정보(키·제목·상태·담당자·마지막 코멘트)를 읽어 후보 순서대로 만든다. */
  private List<ReportIssue> details(List<Candidate> shown) {
    if (shown.isEmpty()) return List.of();
    List<Long> ids = shown.stream().map(Candidate::id).toList();
    Map<Long, org.jooq.Record> rows = new HashMap<>();
    dsl.select(ISSUE.ID, PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE, ISSUE.STATUS, PROJECT_STATUS.NAME)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(PROJECT_STATUS)
        .on(PROJECT_STATUS.ID.eq(ISSUE.STATUS_ID))
        .where(ISSUE.ID.in(ids))
        .fetch()
        .forEach(r -> rows.put(r.get(ISSUE.ID), r));
    Map<Long, List<String>> assignees = assigneeNames(ids);
    Map<Long, String> comments = lastComments(ids);

    List<ReportIssue> out = new ArrayList<>(shown.size());
    for (Candidate c : shown) {
      var r = rows.get(c.id());
      if (r == null) continue;
      String key = r.get(PROJECT.KEY);
      int number = r.get(ISSUE.NUMBER);
      String comment = comments.get(c.id());
      out.add(
          new ReportIssue(
              key + "-" + number,
              baseUrl + "/projects/" + key + "/issues/" + number,
              cut(oneLine(r.get(ISSUE.TITLE)), TITLE_MAX),
              r.get(PROJECT_STATUS.NAME),
              r.get(ISSUE.STATUS),
              assignees.getOrDefault(c.id(), List.of()),
              c.epic(),
              c.due(),
              comment == null ? null : cut(oneLine(comment), COMMENT_MAX),
              c.reason()));
    }
    return out;
  }

  /** 이슈별 담당자 이름(이름순, 같으면 id 순). */
  private Map<Long, List<String>> assigneeNames(Collection<Long> ids) {
    return dsl
        .select(ISSUE_ASSIGNEE.ISSUE_ID, USER.NAME)
        .from(ISSUE_ASSIGNEE)
        .join(USER)
        .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
        .where(ISSUE_ASSIGNEE.ISSUE_ID.in(ids))
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch()
        .stream()
        .collect(
            Collectors.groupingBy(
                r -> r.value1(), Collectors.mapping(r -> r.value2(), Collectors.toList())));
  }

  /** 이슈별 지워지지 않은 마지막 코멘트 본문(DISTINCT ON). */
  private Map<Long, String> lastComments(Collection<Long> ids) {
    Map<Long, String> out = new HashMap<>();
    dsl.select(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.BODY)
        .distinctOn(ISSUE_COMMENT.ISSUE_ID)
        .from(ISSUE_COMMENT)
        .where(ISSUE_COMMENT.ISSUE_ID.in(ids), ISSUE_COMMENT.DELETED_AT.isNull())
        .orderBy(ISSUE_COMMENT.ISSUE_ID, ISSUE_COMMENT.CREATED_AT.desc(), ISSUE_COMMENT.ID.desc())
        .fetch()
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /** 밀린 후보를 에픽 제목별로 센다(많은 순, 같으면 이름순). */
  private static Map<String, Integer> groupByEpic(List<Candidate> rest) {
    Map<String, Integer> counts = new HashMap<>();
    for (Candidate c : rest) {
      counts.merge(c.epic() == null ? NO_EPIC : c.epic(), 1, Integer::sum);
    }
    Map<String, Integer> sorted = new LinkedHashMap<>();
    counts.entrySet().stream()
        .sorted(
            Map.Entry.<String, Integer>comparingByValue()
                .reversed()
                .thenComparing(Map.Entry.comparingByKey()))
        .forEach(e -> sorted.put(e.getKey(), e.getValue()));
    return sorted;
  }

  /** 줄바꿈·연속 공백을 한 칸으로 — AI 입력 한 줄로 만든다. */
  private static String oneLine(String s) {
    return s == null ? null : s.strip().replaceAll("\\s+", " ");
  }

  /** 코드포인트 기준 {@code max} 자로 자른다(넘치면 마지막 자리에 「…」). */
  static String cut(String s, int max) {
    if (s == null || s.codePointCount(0, s.length()) <= max) return s;
    return s.substring(0, s.offsetByCodePoints(0, max - 1)) + "…";
  }
}

package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;

import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.repository.IssueAttentionConditions;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 리포트 기간 이슈 목록(WP-1483) — 기간 안에 DONE 으로 닫힌 것, 기간 안에 생긴 것, 지금 열려 있고 기한 지난 것을 AI 입력용으로 모은다.
 *
 * <p>범위는 표 숫자와 맞춘다: 완료·생김은 지표 모듈({@code IssueMetricsRepository.countPeriods})처럼 모든 유형(삭제 제외), 기한
 * 지남은 개요 숫자처럼 작업 이슈 범위({@link IssueAttentionConditions#workScope}, SUBTASK·EPIC 제외). 한 이슈가 여러 이유에
 * 들면 기한 지남 → 닫힘 → 생김 순으로 앞의 이유 하나로만 싣는다. 정렬은 그 순서로 묶고 묶음 안은 최신순(기한 지남은 마감일, 닫힘은 닫힌 시각, 생김은 생긴 시각).
 *
 * <p>표시 정보(키·제목·담당자·코멘트)와 밀린 이슈 세기는 개인 보고와 나눠 쓰는 {@link ReportIssueDetails}(WP-1486) 가 맡고, 여기는 후보
 * 쿼리만 둔다. 쿼리 수는 이슈 수와 무관하게 고정이다(후보 1 + 표시 정보 1 + 담당자 1 + 코멘트 1). RLS 보호 테이블이라 트랜잭션 안에서 부른다.
 */
@Repository
public class ProjectReportIssueRepository {

  /** 상한 밖 이슈 중 에픽이 없는 것의 묶음 이름. */
  public static final String NO_EPIC = "에픽 없음";

  private final DSLContext dsl;

  /** 후보 → 표시 정보·밀린 건수(개인 보고와 공유). */
  private final ReportIssueDetails details;

  public ProjectReportIssueRepository(DSLContext dsl, ReportIssueDetails details) {
    this.dsl = dsl;
    this.details = details;
  }

  /** 상한까지 자른 목록과 밀린 이슈의 에픽별 건수. */
  public record Selection(List<ReportIssue> issues, Map<String, Integer> omittedByEpic) {}

  /** 후보 한 건 — 이유·정렬 키·에픽 제목만(표시 정보는 상한 안의 것만 {@link ReportIssueDetails} 가 따로 읽는다). */
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
    return new Selection(
        details.details(shown.stream().map(ProjectReportIssueRepository::shared).toList()).stream()
            .map(ProjectReportIssueRepository::withoutProject)
            .toList(),
        ReportIssueDetails.countByGroup(
            rest.stream().map(ProjectReportIssueRepository::shared).toList()));
  }

  /** 정렬을 마친 후보 → 공유 후보. 묶음은 에픽 제목, 에픽이 없으면 {@link #NO_EPIC}. 늦은 날수·AI와 함께는 개인 보고 전용이라 비운다. */
  private static ReportIssueDetails.Candidate shared(Candidate c) {
    return new ReportIssueDetails.Candidate(
        c.id(), c.reason(), c.epic(), c.due(), c.epic() == null ? NO_EPIC : c.epic(), null, false);
  }

  /**
   * 프로젝트 이름을 비운다 — 프로젝트 리포트는 한 프로젝트라 이슈마다 「프로젝트: …」 를 실을 이유가 없다. ai-agent 의 공유 스키마가 project 를 알게 돼
   * 값이 있으면 프롬프트 이슈 줄마다 덧붙으므로, WP-1483 프롬프트를 그대로 두려고 개인 보고 전용 값으로 남긴다.
   */
  private static ReportIssue withoutProject(ReportIssue i) {
    return new ReportIssue(
        i.key(),
        i.url(),
        i.title(),
        i.statusName(),
        i.category(),
        i.assignees(),
        i.epic(),
        i.dueDate(),
        i.lastComment(),
        i.reason(),
        null,
        i.lateDays(),
        i.withAi());
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
}

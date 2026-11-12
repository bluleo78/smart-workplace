package com.workplace.issue.report;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;

import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.metrics.IssueMetricsRepository;
import com.workplace.issue.metrics.MetricsPeriod;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 개인 보고 후보 쿼리(WP-1486) — 지표 모듈·개요가 이미 세는 것(끝냄·새로 만듦 수·열린 이슈) 밖의 두 가지만 여기서 읽는다: 기간 안 상태 바꿈 이슈와 내가 만든
 * 이슈의 후보, 그리고 후보의 에픽·프로젝트 이름. 표시 정보는 프로젝트 리포트와 나눠 쓰는 {@link ReportIssueDetails} 가 맡는다.
 *
 * <p>범위는 지표 모듈의 사람 기준과 같다 — 지금 읽을 수 있는 프로젝트({@link IssueMetricsRepository#readableBy}), 이슈·프로젝트 삭제
 * 안 됨, 기간은 서울 날짜 경계({@link MetricsPeriod}). RLS 보호 테이블이라 트랜잭션 안에서 부른다.
 */
@Repository
public class PersonalReportIssueRepository {

  private static final String STATUS_CHANGED = IssueHistoryEventType.STATUS_CHANGED.name();

  private final DSLContext dsl;
  private final IssueMetricsRepository metricsRepository;

  public PersonalReportIssueRepository(DSLContext dsl, IssueMetricsRepository metricsRepository) {
    this.dsl = dsl;
    this.metricsRepository = metricsRepository;
  }

  /**
   * 기간(KST) 안에 상태가 바뀐 이슈 id(중복 없이, 마지막으로 바뀐 시각 최신순) — 바꾼 사람이 나이거나 지금 담당자에 내가 있는 이슈만(남이 내 일을 옮긴 것도
   * 「내 일의 움직임」으로 센다, 제안 P3).
   */
  public List<Long> statusChangedIssueIds(long userId, PersonalReportPeriod p) {
    MetricsPeriod m = p.toMetrics();
    var lastAt = DSL.max(ISSUE_HISTORY.CREATED_AT);
    Condition mine =
        ISSUE_HISTORY
            .ACTOR_ID
            .eq(userId)
            .or(
                DSL.exists(
                    DSL.selectOne()
                        .from(ISSUE_ASSIGNEE)
                        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                        .and(ISSUE_ASSIGNEE.USER_ID.eq(userId))));
    return dsl.select(ISSUE.ID, lastAt)
        .from(ISSUE_HISTORY)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_HISTORY.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(ISSUE_HISTORY.EVENT_TYPE.eq(STATUS_CHANGED))
        .and(ISSUE_HISTORY.CREATED_AT.ge(m.startInclusive()))
        .and(ISSUE_HISTORY.CREATED_AT.lt(m.endExclusive()))
        .and(alive())
        .and(metricsRepository.readableBy(userId))
        .and(mine)
        .groupBy(ISSUE.ID)
        .orderBy(lastAt.desc(), ISSUE.ID.desc())
        .fetch(ISSUE.ID);
  }

  /**
   * 기간 안에 내가 만든(보고자) 이슈 후보 — 생긴 시각 최신순, 이유 CREATED. 범위는 지표 모듈 「새로 생김」(보고자·읽을 수 있음·삭제 안 됨)과 같다. 에픽
   * 제목은 부모 유형이 EPIC 일 때만, 밀렸을 때 묶음은 에픽 제목(없으면 프로젝트 이름).
   */
  public List<ReportIssueDetails.Candidate> createdCandidates(long userId, PersonalReportPeriod p) {
    MetricsPeriod m = p.toMetrics();
    var parent = ISSUE.as("pr_parent");
    var parentType = ISSUE_TYPE_DEF.as("pr_parent_type");
    List<ReportIssueDetails.Candidate> out = new ArrayList<>();
    dsl.select(ISSUE.ID, ISSUE.DUE_DATE, PROJECT.NAME, parent.TITLE, parentType.ID)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(parent)
        .on(parent.ID.eq(ISSUE.PARENT_ISSUE_ID))
        .leftJoin(parentType)
        .on(parentType.ID.eq(parent.TYPE_ID).and(parentType.NAME.eq("EPIC")))
        .where(metricsRepository.readableBy(userId))
        .and(metricsRepository.reportedBy(userId))
        .and(alive())
        .and(ISSUE.CREATED_AT.ge(m.startInclusive()))
        .and(ISSUE.CREATED_AT.lt(m.endExclusive()))
        .orderBy(ISSUE.CREATED_AT.desc(), ISSUE.ID.desc())
        .fetch()
        .forEach(
            r -> {
              String epic = r.get(parentType.ID) == null ? null : r.get(parent.TITLE);
              String group = epic == null ? r.get(PROJECT.NAME) : epic;
              out.add(
                  new ReportIssueDetails.Candidate(
                      r.get(ISSUE.ID), "CREATED", epic, r.get(ISSUE.DUE_DATE), group, null, false));
            });
    return out;
  }

  /**
   * 이슈의 에픽 제목과 프로젝트 이름.
   *
   * @param epic 부모 에픽 제목(부모 유형이 EPIC 일 때만), 아니면 null
   * @param project 소속 프로젝트 이름
   */
  public record EpicProject(String epic, String project) {

    /** 「밀린 이슈」 묶음 이름 — 에픽 제목, 없으면 프로젝트 이름. */
    public String group() {
      return epic == null ? project : epic;
    }
  }

  /**
   * 이슈 id → 에픽 제목·프로젝트 이름. 지표 모듈·개요에서 온 후보(기한 지남·끝냄·상태 바꿈 등)의 에픽과 「밀린 이슈」 묶음 이름을 한 번에 채운다. 없는 id 는
   * 빠진다.
   */
  public Map<Long, EpicProject> epicAndProject(Collection<Long> ids) {
    Map<Long, EpicProject> out = new HashMap<>();
    if (ids.isEmpty()) return out;
    var parent = ISSUE.as("pr_parent");
    var parentType = ISSUE_TYPE_DEF.as("pr_parent_type");
    dsl.select(ISSUE.ID, PROJECT.NAME, parent.TITLE, parentType.ID)
        .from(ISSUE)
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .leftJoin(parent)
        .on(parent.ID.eq(ISSUE.PARENT_ISSUE_ID))
        .leftJoin(parentType)
        .on(parentType.ID.eq(parent.TYPE_ID).and(parentType.NAME.eq("EPIC")))
        .where(ISSUE.ID.eq(DSL.any(ids.toArray(Long[]::new))))
        .fetch()
        .forEach(
            r ->
                out.put(
                    r.get(ISSUE.ID),
                    new EpicProject(
                        r.get(parentType.ID) == null ? null : r.get(parent.TITLE),
                        r.get(PROJECT.NAME))));
    return out;
  }

  /** 살아 있는 이슈 — 이슈도 소속 프로젝트도 삭제되지 않았다(지표 모듈과 같은 규칙, PROJECT 조인 전제). */
  private static Condition alive() {
    return ISSUE.DELETED_AT.isNull().and(PROJECT.DELETED_AT.isNull());
  }
}

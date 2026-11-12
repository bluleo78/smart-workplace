package com.workplace.wiki.report;

import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.name;
import static org.jooq.impl.DSL.table;

import com.workplace.issue.report.ReportPeriod;
import com.workplace.issue.report.ReportSnapshot;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * 프로젝트 리포트 회차(project_report, V288) 저장소(WP-1483). (project_id, period_start, period_end) 유일이라 같은
 * 회차를 두 번 만들지 않는다. 회차는 시작일과 끝날로 구분한다 — 주기를 바꾸면 길이가 다른 회차가 같은 날 시작할 수 있어서(매주 → 격주).
 *
 * <p>상태: PENDING(생성 중 예약) → GENERATED(페이지 만듦) 또는 SKIPPED(변화 없음 — 페이지 없이 스냅숏만). 실패하면 PENDING 을
 * 지운다(release). 페이지를 만든 뒤 연속 실패 상한에 닿으면 FAILED(페이지는 남김 — 리포트가 아니라 카드·지난 배지·변화 기준에 쓰지 않는다).
 * 스냅숏(완료·새로 생김·열린 이슈·기한 지남·배지)은 다음 회차 「변화」의 기준이다.
 *
 * <p>jOOQ 코드 생성 없이 이름(DSL.name)으로 다룬다. 테넌트 격리는 RLS 와 tenant_id 기본값이 맡는다 — 모든 메서드는 트랜잭션 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectReportRepository {

  /** PENDING 예약을 다른 실행이 이어받을 수 있게 되는 시간 — 생성(AI 호출 포함)이 이보다 오래 걸리면 실행 중 파드가 죽은 것으로 본다. */
  static final long STALE_PENDING_MINUTES = 30;

  private static final String TBL = "project_report";
  private static final Table<?> T = table(name(TBL));
  private static final Field<Long> PROJECT_ID = field(name(TBL, "project_id"), Long.class);
  private static final Field<LocalDate> PERIOD_START =
      field(name(TBL, "period_start"), LocalDate.class);
  private static final Field<LocalDate> PERIOD_END =
      field(name(TBL, "period_end"), LocalDate.class);
  private static final Field<String> STATUS = field(name(TBL, "status"), String.class);
  private static final Field<Long> PAGE_ID = field(name(TBL, "page_id"), Long.class);
  private static final Field<String> BADGE = field(name(TBL, "badge"), String.class);
  private static final Field<Integer> COMPLETED = field(name(TBL, "completed"), Integer.class);
  private static final Field<Integer> CREATED = field(name(TBL, "created"), Integer.class);
  private static final Field<Integer> OPEN_ISSUES = field(name(TBL, "open_issues"), Integer.class);
  private static final Field<Integer> OVERDUE = field(name(TBL, "overdue"), Integer.class);
  private static final Field<OffsetDateTime> RESERVED_AT =
      field(name(TBL, "reserved_at"), OffsetDateTime.class);
  private static final Field<OffsetDateTime> CREATED_AT =
      field(name(TBL, "created_at"), OffsetDateTime.class);

  /** 푼 예약의 reserved_at — 30분 조건과 상관없이 바로 이어받게 아주 옛날로 둔다. */
  private static final OffsetDateTime RELEASED_AT = OffsetDateTime.parse("1970-01-01T00:00:00Z");

  private static final String PENDING = "PENDING";
  private static final String GENERATED = "GENERATED";
  private static final String SKIPPED = "SKIPPED";
  private static final String FAILED = "FAILED";

  private final DSLContext dsl;

  /** 예약 결과 — RESERVED 면 이 실행이 그 회차를 만든다. */
  public enum Reserve {
    /** 새로 예약했거나 30분 넘게 묵은 PENDING 을 이어받았다. */
    RESERVED,
    /** 이미 만들었거나(GENERATED/SKIPPED) 포기했거나(FAILED) 다른 실행이 만드는 중(30분 안의 PENDING)이다. */
    DUPLICATE
  }

  /**
   * 지난 리포트 한 편(카드 목록용).
   *
   * @param badge 생성 때 시스템 배지(ON_TRACK|WARN|RISK)
   * @param createdAt 만든 시각
   */
  public record ReportRow(
      long pageId,
      LocalDate periodStart,
      LocalDate periodEnd,
      String badge,
      OffsetDateTime createdAt) {}

  /**
   * 회차를 예약한다 — 행이 없으면 PENDING 으로 넣고(ON CONFLICT DO NOTHING), 있으면 30분 넘은 PENDING 일 때만 예약 시각을 새로 적어
   * 이어받는다. 둘 다 한 SQL 의 조건부 쓰기라 동시에 불러도 한 쪽만 RESERVED 다.
   */
  public Reserve reserve(long projectId, ReportPeriod p, OffsetDateTime now) {
    int inserted =
        dsl.insertInto(T)
            .columns(PROJECT_ID, PERIOD_START, PERIOD_END, STATUS, RESERVED_AT, CREATED_AT)
            .values(projectId, p.start(), p.end(), PENDING, now, now)
            .onConflictDoNothing()
            .execute();
    if (inserted == 1) return Reserve.RESERVED;
    int takenOver =
        dsl.update(T)
            .set(RESERVED_AT, now)
            .where(PROJECT_ID.eq(projectId))
            .and(isPeriod(p))
            .and(STATUS.eq(PENDING))
            .and(RESERVED_AT.lt(now.minusMinutes(STALE_PENDING_MINUTES)))
            .execute();
    return takenOver == 1 ? Reserve.RESERVED : Reserve.DUPLICATE;
  }

  /**
   * 예약을 푼다(실패·비서 없음). 페이지가 아직 없으면 PENDING 행을 지운다. 페이지가 이미 있으면 행을 지우지 않고 예약 시각만 아주 옛날로 돌려 다음 재시도가 바로
   * 이어받게 한다 — 행을 지우면 재시도가 페이지를 또 만들어 같은 회차에 페이지가 둘 생긴다. 만든 기록(GENERATED/SKIPPED)은 건드리지 않는다.
   */
  public void release(long projectId, ReportPeriod p) {
    dsl.deleteFrom(T)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .and(STATUS.eq(PENDING))
        .and(PAGE_ID.isNull())
        .execute();
    dsl.update(T)
        .set(RESERVED_AT, RELEASED_AT)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .and(STATUS.eq(PENDING))
        .and(PAGE_ID.isNotNull())
        .execute();
  }

  /** 예약한 회차에 방금 만든 페이지를 적는다 — 이후 실패해도 재시도가 이 페이지를 다시 쓴다(회차당 페이지 하나). */
  public void attachPage(long projectId, ReportPeriod p, long pageId) {
    dsl.update(T)
        .set(PAGE_ID, pageId)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .and(STATUS.eq(PENDING))
        .execute();
  }

  /** 예약 중(PENDING) 회차에 이미 만든 페이지 — 앞선 시도가 페이지를 만든 뒤 실패했으면 있다(페이지가 지워졌으면 비어 있다). */
  public Optional<Long> pendingPageId(long projectId, ReportPeriod p) {
    return dsl.select(PAGE_ID)
        .from(T)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .and(STATUS.eq(PENDING))
        .and(PAGE_ID.isNotNull())
        .fetchOptional(PAGE_ID);
  }

  /**
   * 페이지가 있는 예약 회차를 포기하며 닫는다(연속 실패 상한) — 페이지는 남기고(사람이 보고 지울 수 있다) FAILED 로 적어 중복을 막는다. GENERATED 로
   * 적으면 덜 쓴 페이지가 개요 카드의 최신 리포트로 보이므로 리포트가 아닌 상태로 둔다(코드 리뷰 #2). 스냅숏·배지는 비워 두어 다음 회차의 「변화」 기준으로 쓰지
   * 않는다.
   */
  public void closeWithPage(long projectId, ReportPeriod p, OffsetDateTime at) {
    dsl.update(T)
        .set(STATUS, FAILED)
        .set(CREATED_AT, at)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .and(STATUS.eq(PENDING))
        .and(PAGE_ID.isNotNull())
        .execute();
  }

  /** 만든 기록 — 페이지·시스템 배지·스냅숏·만든 시각. */
  public void markGenerated(
      long projectId,
      ReportPeriod p,
      long pageId,
      String badge,
      ReportSnapshot s,
      OffsetDateTime at) {
    dsl.update(T)
        .set(STATUS, GENERATED)
        .set(PAGE_ID, pageId)
        .set(BADGE, badge)
        .set(COMPLETED, s.completed())
        .set(CREATED, s.created())
        .set(OPEN_ISSUES, s.openIssues())
        .set(OVERDUE, s.overdue())
        .set(CREATED_AT, at)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .execute();
  }

  /** 변화 없음 기록 — 페이지 없이 스냅숏(배지 포함)만 남긴다. */
  public void markSkipped(long projectId, ReportPeriod p, ReportSnapshot s, OffsetDateTime at) {
    dsl.update(T)
        .set(STATUS, SKIPPED)
        .setNull(PAGE_ID)
        .set(BADGE, s.badge())
        .set(COMPLETED, s.completed())
        .set(CREATED, s.created())
        .set(OPEN_ISSUES, s.openIssues())
        .set(OVERDUE, s.overdue())
        .set(CREATED_AT, at)
        .where(PROJECT_ID.eq(projectId))
        .and(isPeriod(p))
        .execute();
  }

  /** before 보다 앞 회차(GENERATED/SKIPPED) 중 최신의 스냅숏 — 열린 이슈·기한 지남 변화의 기준. 스냅숏이 비어 있는 행은 없다고 본다. */
  public Optional<ReportSnapshot> lastSnapshot(long projectId, LocalDate before) {
    return dsl.select(COMPLETED, CREATED, OPEN_ISSUES, OVERDUE, BADGE)
        .from(T)
        .where(PROJECT_ID.eq(projectId))
        .and(PERIOD_START.lt(before))
        .and(STATUS.in(GENERATED, SKIPPED))
        .and(OPEN_ISSUES.isNotNull())
        .orderBy(PERIOD_START.desc())
        .limit(1)
        .fetchOptional(
            r ->
                new ReportSnapshot(
                    nz(r.get(COMPLETED)),
                    nz(r.get(CREATED)),
                    nz(r.get(OPEN_ISSUES)),
                    nz(r.get(OVERDUE)),
                    r.get(BADGE)));
  }

  /** before 보다 앞 GENERATED 회차 중 최신의 배지 — 리포트의 「지난 배지」(SKIPPED 회차는 리포트가 아니라 건너뛴다). */
  public Optional<String> lastGeneratedBadge(long projectId, LocalDate before) {
    return dsl.select(BADGE)
        .from(T)
        .where(PROJECT_ID.eq(projectId))
        .and(PERIOD_START.lt(before))
        .and(STATUS.eq(GENERATED))
        .and(BADGE.isNotNull())
        .orderBy(PERIOD_START.desc())
        .limit(1)
        .fetchOptional(BADGE);
  }

  /**
   * 최근 GENERATED 회차(최신 회차 먼저, 최대 limit 개) — 페이지가 지워져 page_id 가 비었으면 뺀다. FAILED(포기한 회차)는 리포트가 아니라
   * 뺀다.
   */
  public List<ReportRow> recentGenerated(long projectId, int limit) {
    return dsl.select(PAGE_ID, PERIOD_START, PERIOD_END, BADGE, CREATED_AT)
        .from(T)
        .where(PROJECT_ID.eq(projectId))
        .and(STATUS.eq(GENERATED))
        .and(PAGE_ID.isNotNull())
        .orderBy(PERIOD_START.desc())
        .limit(limit)
        .fetch(
            r ->
                new ReportRow(
                    r.get(PAGE_ID),
                    r.get(PERIOD_START),
                    r.get(PERIOD_END),
                    r.get(BADGE),
                    r.get(CREATED_AT)));
  }

  /** 그 회차(시작일·끝날 둘 다 같음) — 같은 날 시작하는 다른 길이의 회차와 섞이지 않게. */
  private static Condition isPeriod(ReportPeriod p) {
    return PERIOD_START.eq(p.start()).and(PERIOD_END.eq(p.end()));
  }

  private static int nz(Integer v) {
    return v == null ? 0 : v;
  }
}

package com.workplace.issue.repository;

import static com.workplace.issue.repository.KeysetSeek.after;
import static com.workplace.issue.repository.KeysetSeek.utc;
import static com.workplace.jooq.Tables.ISSUE;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.inline;
import static org.jooq.impl.DSL.max;
import static org.jooq.impl.DSL.min;
import static org.jooq.impl.DSL.noCondition;
import static org.jooq.impl.DSL.partitionBy;
import static org.jooq.impl.DSL.when;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.MeGroupedCursor;
import com.workplace.issue.dto.MeIssueGrouping;
import com.workplace.issue.repository.KeysetSeek.SeekKey;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.SelectField;
import org.jooq.SortField;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * /me/issues 프로젝트 묶음 정렬(WP-915, opt-in) — 한 프로젝트의 행이 페이지를 넘어서도 연속으로 나오도록 프로젝트 단위로 정렬하고 복합 커서({@link
 * MeGroupedCursor})로 이어 읽는다. 화면(내 작업 목록)이 프로젝트 구간을 무한 스크롤로 그리는 데 쓴다.
 *
 * <p>AI 위임 작업 목록({@link AiTaskRepository})과 같은 모양의 파생 테이블 두 단으로 계산한다 — 1단: 필터를 통과한 행의 기본 키(닫힘·행
 * 마감), 2단: 프로젝트 창 함수(묶음 마감·묶음 최근 수정·묶음 건수). 창 함수는 커서 조건 <b>앞</b>에서 필터 통과 행만으로 계산하므로, 페이지가 달라도 묶음 값과
 * 건수가 같다. 바깥에서 정렬 키와 같은 키·방향으로 seek 한다({@link KeysetSeek}). 마감이 없는 행·묶음은 센티널 날짜로 채워 NULL 이 없으므로
 * lt·eq 비교가 안전하다.
 */
@Repository
@RequiredArgsConstructor
public class MeIssueGroupedRepository {

  /** 마감 없음 자리 — 가장 늦은 마감보다 뒤에 서게 하는 센티널(NULL 대신 써서 seek 비교가 NULL 이 되지 않게). */
  static final LocalDate SENTINEL = LocalDate.of(9999, 12, 31);

  /**
   * 열린 이슈는 있으나 모두 마감이 없는 프로젝트의 묶음 마감 — SENTINEL 하루 앞. 완료만 남은 프로젝트(SENTINEL)와 같은 값이면 project_id 순으로
   * 섞이는데, 화면은 완료만 남은 프로젝트를 맨 뒤에 두어야 해서(설계 문서) 둘을 다른 날짜로 가른다. 커서 형식은 그대로(날짜가 그대로 왕복)다.
   */
  static final LocalDate OPEN_NO_DUE = SENTINEL.minusDays(1);

  private final DSLContext dsl;
  private final IssueRepository issueRepository;

  /**
   * 목록 행 — 다음 커서를 만들 수 있게 정렬 키와 묶음 건수를 함께 싣는다. projectSize 는 필터 적용 후 그 프로젝트의 행 수(페이지와 무관하게 같은 값).
   * groupDue·closed·rowDue 는 DUE 에서만, groupUpdatedAt 은 RECENT 에서만 뜻이 있고 쓰지 않는 쪽은 null(closed 는 0).
   */
  public record GroupedRow(
      IssueRow row,
      long projectId,
      int projectSize,
      LocalDate groupDue,
      Instant groupUpdatedAt,
      int closed,
      LocalDate rowDue) {

    /** 이 행 다음부터 이어 읽는 커서 — 정렬 키를 그대로 옮긴다. */
    public MeGroupedCursor toCursor() {
      return new MeGroupedCursor(
          groupDue, groupUpdatedAt, projectId, closed, rowDue, row.updatedAt(), row.id());
    }
  }

  /**
   * 프로젝트 묶음 순 한 페이지.
   *
   * <ul>
   *   <li>DUE: 묶음 마감(열린 행의 최소 마감, 열린 행이 있으나 마감이 없으면 OPEN_NO_DUE, 완료만이면 센티널) ASC → 프로젝트 id ASC → 닫힘
   *       ASC → 행 마감(닫힌 행·마감 없음은 센티널) ASC → 수정 시각 DESC → id DESC. hideClosed 면 1단에서 닫힌 행을 빼 묶음
   *       값·건수에서도 빠진다.
   *   <li>RECENT: 묶음 최근 수정 DESC → 프로젝트 id DESC → 수정 시각 DESC → id DESC. hideClosed 는 무시한다(모든 상태를
   *       보인다). 묶음 키가 수정마다 바뀌는 값이라 스크롤 중 수정된 이슈는 다시 오거나 빠질 수 있다 — 기존 (updated_at, id) 커서와 같은 성질이고,
   *       "최근 움직인 프로젝트 먼저" 의도를 지키려고 id 를 먼저 비교하지 않는다.
   * </ul>
   *
   * @param base 범위·필터가 이미 적용된 ISSUE 조건(커서 조건 제외)
   * @param cursor 이전 페이지 마지막 행의 커서, 첫 페이지면 null — 같은 묶음 기준에서 나온 것이어야 한다
   */
  public List<GroupedRow> search(
      Condition base, MeIssueGrouping g, boolean hideClosed, MeGroupedCursor cursor, int size) {
    boolean due = g == MeIssueGrouping.DUE;
    Field<Integer> closedCase =
        when(ISSUE.STATUS.in(IssueStatuses.CLOSED), inline(1)).otherwise(inline(0));
    Field<LocalDate> sentinel = inline(SENTINEL);
    Condition where = due && hideClosed ? base.and(closedCase.eq(0)) : base;

    // 1단: 필터를 통과한 행의 기본 키 — 닫힘, 행 마감(닫힌 행·마감 없음은 센티널).
    Table<?> b =
        dsl.select(
                ISSUE.ID.as("b_id"),
                ISSUE.PROJECT_ID.as("b_project"),
                ISSUE.UPDATED_AT.as("b_updated"),
                ISSUE.DUE_DATE.as("b_due"),
                closedCase.as("b_closed"),
                when(closedCase.eq(1), sentinel)
                    .otherwise(coalesce(ISSUE.DUE_DATE, sentinel))
                    .as("b_row_due"))
            .from(ISSUE)
            .where(where)
            .asTable("mg_base");
    Field<Long> bProject = b.field("b_project", Long.class);
    Field<LocalDate> bDue = b.field("b_due", LocalDate.class);
    Field<Integer> bClosed = b.field("b_closed", Integer.class);

    // 2단: 프로젝트 창 함수 — 묶음 마감(열린 행만), 묶음 최근 수정, 묶음 건수. 1단 열은 그대로 넘긴다.
    List<SelectField<?>> cols = new ArrayList<>(Arrays.asList(b.fields()));
    // 묶음 마감: 열린 행의 최소 마감 → 없으면 열린 행이 있으면 OPEN_NO_DUE, 열린 행이 없으면(완료만) SENTINEL — 완료만 남은 묶음이 맨 뒤.
    cols.add(
        coalesce(
                min(bDue).filterWhere(bClosed.eq(0)).over(partitionBy(bProject)),
                when(
                        count().filterWhere(bClosed.eq(0)).over(partitionBy(bProject)).gt(0),
                        inline(OPEN_NO_DUE))
                    .otherwise(sentinel))
            .as("p_due"));
    cols.add(
        max(b.field("b_updated", OffsetDateTime.class))
            .over(partitionBy(bProject))
            .as("p_updated"));
    cols.add(count().over(partitionBy(bProject)).as("p_size"));
    Table<?> s = dsl.select(cols).from(b).asTable("mg_sorted");

    // 바깥 select·seek·ORDER BY 는 2단 열만 볼 수 있다.
    Field<Long> id = s.field("b_id", Long.class);
    Field<Long> project = s.field("b_project", Long.class);
    Field<OffsetDateTime> updated = s.field("b_updated", OffsetDateTime.class);
    Field<Integer> closed = s.field("b_closed", Integer.class);
    Field<LocalDate> rowDue = s.field("b_row_due", LocalDate.class);
    Field<LocalDate> groupDue = s.field("p_due", LocalDate.class);
    Field<OffsetDateTime> groupUpdated = s.field("p_updated", OffsetDateTime.class);
    Field<Integer> projectSize = s.field("p_size", Integer.class);

    // 정렬 키 표 하나에서 ORDER BY 와 seek 를 함께 만든다 — 두 목록을 따로 적으면 방향이 어긋나 페이지 경계에서 누락·중복이 숨는다.
    MeGroupedCursor c = cursor;
    List<SeekKey<?>> keys = new ArrayList<>();
    if (due) {
      keys.add(SeekKey.asc(groupDue, c == null ? null : c.groupDue()));
      keys.add(SeekKey.asc(project, c == null ? null : c.projectId()));
      keys.add(SeekKey.asc(closed, c == null ? null : c.closed()));
      keys.add(SeekKey.asc(rowDue, c == null ? null : c.rowDue()));
    } else {
      keys.add(SeekKey.desc(groupUpdated, c == null ? null : utc(c.groupUpdatedAt())));
      keys.add(SeekKey.desc(project, c == null ? null : c.projectId()));
    }
    keys.add(SeekKey.desc(updated, c == null ? null : utc(c.updatedAt())));
    keys.add(SeekKey.desc(id, c == null ? null : c.id()));

    List<SortField<?>> order = new ArrayList<>();
    for (SeekKey<?> k : keys) order.add(k.desc() ? k.field().desc() : k.field().asc());
    Condition seek = c == null ? noCondition() : after(keys);

    List<SelectField<?>> fields = new ArrayList<>(Arrays.asList(IssueRepository.ROW_FIELDS));
    fields.addAll(List.of(project, projectSize, groupDue, groupUpdated, closed, rowDue));

    // ROW_FIELDS 의 상태 이름·색은 상태 조인에서 읽는다(WP-870) — ISSUE 만으로는 project_status 가 FROM 에 없다
    return dsl.select(fields)
        .from(IssueRepository.ISSUE_WITH_STATUS)
        .join(s)
        .on(id.eq(ISSUE.ID))
        .where(seek)
        .orderBy(order)
        .limit(size)
        .fetch(
            r ->
                new GroupedRow(
                    issueRepository.mapToRow(r),
                    r.get(project),
                    r.get(projectSize),
                    due ? r.get(groupDue) : null,
                    due ? null : r.get(groupUpdated).toInstant(),
                    due ? r.get(closed) : 0,
                    due ? r.get(rowDue) : null));
  }
}

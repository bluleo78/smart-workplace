package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.PROJECT_STATUS;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.inline;
import static org.jooq.impl.DSL.lateral;
import static org.jooq.impl.DSL.min;
import static org.jooq.impl.DSL.noCondition;
import static org.jooq.impl.DSL.select;
import static org.jooq.impl.DSL.trueCondition;
import static org.jooq.impl.DSL.when;

import com.workplace.issue.dto.IssuePriorities;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueSearchQuery;
import com.workplace.issue.dto.IssueSort;
import com.workplace.issue.dto.IssueSortCursor;
import com.workplace.issue.exception.InvalidCursorException;
import com.workplace.issue.repository.KeysetSeek.SeekKey;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Function;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Result;
import org.jooq.SelectField;
import org.jooq.SortField;
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * 이슈 목록 사용자 지정 정렬 한 페이지(WP-1238, {@link IssueSort}). 프로젝트 목록·보드 컬럼(같은 목록 API)·/me/issues 가 범위·필터
 * 조건만 달리 넘기고 정렬·커서는 여기 한 곳에서 만든다.
 *
 * <p>정렬 키는 파생 테이블 없이 바깥 질의(ISSUE + 상태 조인)에 바로 건다 — 범위 전체를 파생 테이블로 먼저 계산하지 않고, 마감·생성·수정 시각처럼 issue
 * 컬럼 키는 그 컬럼에 바로 ORDER BY·seek 가 걸려 인덱스(예: 보드 컬럼의 (project_id, status_id, updated_at))를 쓸 수 있다. 상태
 * position 은 행 모양이 이미 들고 있는 상태 LEFT JOIN 의 컬럼을, 담당자 이름은 담당자 정렬일 때만 붙이는 LATERAL 한 번을 읽는다. 우선순위·범주
 * 순위는 행 단위 CASE 라 추가 조회가 없다. 계산 키(우선순위·상태·담당자)로 정렬하면 그 순서에 맞는 인덱스가 없어 범위 행을 정렬해야 하는 것은 피할 수
 * 없다(top-N 정렬).
 *
 * <p>정렬 키 값에는 NULL 이 없다 — {@link KeysetSeek} 의 lt·eq 비교가 NULL 이 되지 않게. 비어 있을 수 있는 키(마감·담당자)는 「비어 있음
 * 플래그(0/1, 항상 ASC)」와 「coalesce 값(요청 방향)」 두 칸으로 나눈다: 센티널 하나로는 ASC·DESC 모두에서 맨 뒤에 둘 수 없지만, 플래그가 먼저 갈라
 * 두면 비어 있는 행은 방향과 무관하게 맨 뒤이고 그 안에서 센티널끼리의 비교는 동률이라 해가 없다. ORDER BY 와 seek 는 같은 키 목록에서 만든다(따로 적으면
 * 방향이 어긋나 페이지 경계에서 누락·중복이 숨는다).
 */
@Repository
@RequiredArgsConstructor
public class IssueSortedRepository {

  /** 비어 있는 마감 자리 — 플래그가 먼저 가르므로 값 자체는 아무 날짜여도 된다. */
  private static final LocalDate NO_DATE = LocalDate.of(1, 1, 1);

  /** 상태 position 이 없을 때(이론상 없음 — status_id NOT NULL) 범주 안 맨 뒤. */
  private static final int NO_POSITION = Integer.MAX_VALUE;

  /**
   * 담당자 이름 최솟값 LATERAL — 이슈마다 한 번 계산해 플래그·값·seek 가 같은 열을 읽는다(스칼라 서브쿼리면 세 자리에서 세 번 돈다). 집계라 담당자가 없어도
   * NULL 한 행이 나와 행이 빠지지 않는다. issue_assignee 는 issue_id 로 찾는다(PK 선두 열).
   */
  private static final Table<?> ASSIGNEE_NAME =
      lateral(
              select(min(USER.NAME).as("sk_assignee_name"))
                  .from(ISSUE_ASSIGNEE)
                  .join(USER)
                  .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
                  .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID)))
          .as("sk_as");

  private final DSLContext dsl;
  private final IssueRepository issueRepository;

  /** 한 페이지 — 행과 마지막 행 다음부터 이어 읽는 커서(행이 없으면 null). 다음 페이지가 있는지는 호출자가 size 와 견줘 정한다. */
  public record SortedPage(List<IssueRow> rows, IssueSortCursor lastCursor) {}

  /**
   * 정렬 키 한 칸 — 읽기 별칭·식·방향, 커서 문자열 → 값 해석기.
   *
   * @param parse 커서에 적힌 값(문자열)을 이 칸의 비교 값으로 되돌린다 — 칸마다 형식(날짜·시각·숫자·문자열)이 달라 칸이 들고 다닌다
   */
  private record Part<T>(String alias, Field<T> expr, boolean desc, Function<String, T> parse) {

    /** 커서 값 → 이 칸의 seek 키. 형식이 틀리면 400. */
    SeekKey<T> seekKey(String cursorValue) {
      T value;
      try {
        value = cursorValue == null ? null : parse.apply(cursorValue);
      } catch (RuntimeException e) {
        throw new InvalidCursorException("cursor 디코딩 실패");
      }
      return new SeekKey<>(expr, value, desc);
    }
  }

  // 칸 값 해석기 — 시각은 Instant 문자열(마이크로초 보존)로 적혀 있다.
  private static final Function<String, Integer> INT = Integer::parseInt;
  private static final Function<String, Long> LONG = Long::parseLong;
  private static final Function<String, LocalDate> DATE = LocalDate::parse;
  private static final Function<String, OffsetDateTime> TIME =
      v -> KeysetSeek.utc(Instant.parse(v));
  private static final Function<String, String> TEXT = Function.identity();

  /**
   * 사용자 지정 정렬 한 페이지. 키 뒤에 동률 깨기로 수정 시각 DESC(이미 키면 생략) → id DESC 를 붙인다.
   *
   * <ul>
   *   <li>dueDate: 마감 없음은 방향과 무관하게 맨 뒤.
   *   <li>priority: 순위 HIGHEST 0 → HIGH 1 → MID 2 → LOW 3 → LOWEST 4({@link
   *       IssuePriorities#ORDER}). asc = 높은 우선순위 먼저(화면 표시 순서·체크리스트 정렬의 ASC 와 같은 뜻), desc 는 그 반대.
   *       체크리스트의 3단계 CASE 는 HIGHEST·LOWEST 를 「그 밖」으로 뭉치므로 쓰지 않고 5단계 전체로 매긴다. 컬럼이 NOT NULL 이라 플래그가
   *       없다.
   *   <li>createdAt·updatedAt: 시각 그대로(NOT NULL).
   *   <li>status: 범주 순위(TODO 0 → IN_PROGRESS 1 → DONE 2 → CANCELED 3) → 프로젝트 상태 position →
   *       status_id. 횡단 목록에서도 같은 식이라 프로젝트가 달라도 범주 순서가 먼저다. status_id 는 position 이 같은 다른 프로젝트 상태끼리
   *       섞이지 않게 묶는다.
   *   <li>assignee: 담당자 이름(user.name) 중 가장 앞서는 것(min) — 담당자가 여럿이어도 정해진 하나로 정렬하려고 「추가 순서」 대신 이름 최솟값을
   *       쓴다(추가 시각은 같은 트랜잭션에서 같을 수 있다). 담당자 없음은 방향과 무관하게 맨 뒤.
   * </ul>
   *
   * @param cursor 이전 페이지 마지막 행의 커서, 첫 페이지면 null — 같은 정렬에서 나온 것이어야 한다({@link IssueSortCursor#fits})
   */
  public SortedPage searchProject(
      long projectId, IssueSearchQuery query, IssueSort sort, IssueSortCursor cursor) {
    return search(
        issueRepository.projectFilterCondition(projectId, query), sort, cursor, query.size());
  }

  /**
   * /me/issues 횡단 사용자 지정 정렬 한 페이지 — 범위는 {@link IssueRepository#memberOfFilterCondition}, 규칙은 {@link
   * #searchProject}.
   */
  public SortedPage searchMemberOf(
      long memberUserId, IssueSearchQuery query, IssueSort sort, IssueSortCursor cursor) {
    return search(
        issueRepository.memberOfFilterCondition(memberUserId, query), sort, cursor, query.size());
  }

  /** 범위·필터 조건(base, 커서 조건 제외) 위의 정렬 한 페이지 — 규칙은 {@link #searchProject}. */
  private SortedPage search(Condition base, IssueSort sort, IssueSortCursor cursor, int size) {
    List<Part<?>> parts = parts(sort);
    if (cursor != null && cursor.values().size() != parts.size()) {
      // 서명은 같은데 값 수가 다르면 손상된 커서 — 값 자리를 맞출 수 없다.
      throw new InvalidCursorException("cursor 형식 오류");
    }

    List<SeekKey<?>> keys = new ArrayList<>(parts.size());
    for (int i = 0; i < parts.size(); i++) {
      keys.add(parts.get(i).seekKey(cursor == null ? null : cursor.values().get(i)));
    }
    List<SortField<?>> orderBy = new ArrayList<>();
    for (SeekKey<?> k : keys) orderBy.add(k.desc() ? k.field().desc() : k.field().asc());
    Condition seek = cursor == null ? noCondition() : KeysetSeek.after(keys);

    // 정렬 키 값은 별칭으로 함께 읽어 다음 커서를 만든다(식 그대로 ORDER BY·seek 에 쓰고, SELECT 는 읽기용).
    List<SelectField<?>> fields = new ArrayList<>(Arrays.asList(IssueRepository.ROW_FIELDS));
    for (Part<?> p : parts) fields.add(p.expr().as(p.alias()));
    // ROW_FIELDS 의 상태 이름·색과 상태 position 은 같은 상태 조인에서 읽는다(WP-870).
    Table<?> from = IssueRepository.ISSUE_WITH_STATUS;
    if (sort.has(IssueSort.Field.ASSIGNEE)) {
      from = from.leftJoin(ASSIGNEE_NAME).on(trueCondition());
    }
    Result<Record> result =
        dsl.select(fields).from(from).where(base.and(seek)).orderBy(orderBy).limit(size).fetch();
    List<IssueRow> rows = result.map(issueRepository::mapToRow);
    if (result.isEmpty()) return new SortedPage(rows, null);
    // 다음 커서는 마지막 행 하나만 만든다.
    Record last = result.get(result.size() - 1);
    List<String> values = new ArrayList<>(parts.size());
    for (Part<?> p : parts) values.add(encode(last.get(p.alias())));
    return new SortedPage(rows, new IssueSortCursor(sort.signature(), List.copyOf(values)));
  }

  /** 정렬 → 키 칸 목록(사용자 키 → 동률 깨기 updatedAt DESC → id DESC). 마지막 칸은 항상 sk_id. */
  private static List<Part<?>> parts(IssueSort sort) {
    List<Part<?>> parts = new ArrayList<>();
    int n = 0;
    for (IssueSort.Key k : sort.keys()) {
      String a = "sk_" + (n++) + "_";
      boolean d = k.desc();
      switch (k.field()) {
        case DUE_DATE -> nullsLast(parts, a, ISSUE.DUE_DATE, NO_DATE, d, DATE);
        // 우선순위 순위 — IssuePriorities.ORDER 순서(HIGHEST 0 … LOWEST 4), 상태 범주 순위 — CATEGORY_ORDER(TODO
        // 0 …
        // CANCELED 3). 둘 다 상태 목록과 같은 CASE(ProjectStatusRepository.rank)를 쓴다.
        case PRIORITY ->
            parts.add(
                new Part<>(
                    a + "v",
                    ProjectStatusRepository.rank(ISSUE.PRIORITY, IssuePriorities.ORDER),
                    d,
                    INT));
        case CREATED_AT -> parts.add(new Part<>(a + "v", ISSUE.CREATED_AT, d, TIME));
        case UPDATED_AT -> parts.add(new Part<>(a + "v", ISSUE.UPDATED_AT, d, TIME));
        case STATUS -> {
          parts.add(
              new Part<>(a + "cat", ProjectStatusRepository.categoryRank(ISSUE.STATUS), d, INT));
          parts.add(new Part<>(a + "pos", statusPosition(), d, INT));
          parts.add(new Part<>(a + "sid", ISSUE.STATUS_ID, d, LONG));
        }
        case ASSIGNEE ->
            nullsLast(parts, a, ASSIGNEE_NAME.field("sk_assignee_name", String.class), "", d, TEXT);
      }
    }
    if (!sort.has(IssueSort.Field.UPDATED_AT)) {
      parts.add(new Part<>("sk_updated", ISSUE.UPDATED_AT, true, TIME));
    }
    parts.add(new Part<>("sk_id", ISSUE.ID, true, LONG));
    return parts;
  }

  /**
   * 비어 있을 수 있는 키 두 칸 — 비어 있음 플래그(값 있음 0, 없음 1, 항상 ASC 라 비어 있는 행이 방향과 무관하게 맨 뒤)와 coalesce 값(요청 방향).
   * 플래그가 먼저 가르므로 빈자리 값(blank)은 아무 값이어도 된다.
   */
  private static <T> void nullsLast(
      List<Part<?>> parts,
      String a,
      Field<T> value,
      T blank,
      boolean desc,
      Function<String, T> parse) {
    parts.add(
        new Part<>(a + "null", when(value.isNull(), inline(1)).otherwise(inline(0)), false, INT));
    parts.add(new Part<>(a + "v", coalesce(value, inline(blank)), desc, parse));
  }

  /**
   * 이슈 프로젝트 상태의 보드 순서(position) — 행 모양의 상태 LEFT JOIN({@link IssueRepository#ISSUE_WITH_STATUS}) 열.
   */
  private static Field<Integer> statusPosition() {
    return coalesce(PROJECT_STATUS.POSITION, inline(NO_POSITION));
  }

  /** 정렬 키 값 → 커서 문자열. 시각은 마이크로초까지 보존한다(밀리초로 자르면 같은 시각 행 동률 비교가 어긋난다 — MeGroupedCursor 와 같은 이유). */
  private static String encode(Object v) {
    if (v instanceof OffsetDateTime t) return t.toInstant().toString();
    return String.valueOf(v);
  }
}

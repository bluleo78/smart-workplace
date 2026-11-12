package com.workplace.help.repository;

import static com.workplace.jooq.Tables.HELP_METRIC_DAILY;

import com.workplace.help.dto.HelpMetricKind;
import com.workplace.help.dto.HelpMetricRow;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Repository;

/**
 * 도움말 일별 지표 저장소(WP-1512). 날짜는 JVM 시계가 아니라 DB 의 KST 날짜로 계산해 파드 간 시계·시간대 차이를 피한다. tenant_id 는 DB
 * 기본값(GUC)이 채우고 RLS 가 테넌트를 가른다.
 */
@Repository
public class HelpMetricRepository {

  /** DB 기준 KST 오늘 날짜. */
  private static final Field<LocalDate> KST_TODAY =
      DSL.field("(now() AT TIME ZONE 'Asia/Seoul')::date", SQLDataType.LOCALDATE);

  private final DSLContext dsl;

  public HelpMetricRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 오늘(KST) 같은 키의 건수를 1 올린다 — 없으면 새 행(count=1). 세 문자열은 null 이 아니어야 한다(없는 값은 ''; 정규화는 서비스 몫이라 여기서는
   * 있는 그대로 저장).
   */
  public void increment(HelpMetricKind kind, String route, String helpId, String term) {
    dsl.insertInto(HELP_METRIC_DAILY)
        .set(HELP_METRIC_DAILY.DAY, KST_TODAY)
        .set(HELP_METRIC_DAILY.KIND, kind.name())
        .set(HELP_METRIC_DAILY.ROUTE, route)
        .set(HELP_METRIC_DAILY.HELP_ID, helpId)
        .set(HELP_METRIC_DAILY.TERM, term)
        // tenant_id 는 생략 — DB 기본값이 GUC 에서 채운다.
        .onConflict(
            HELP_METRIC_DAILY.TENANT_ID,
            HELP_METRIC_DAILY.DAY,
            HELP_METRIC_DAILY.KIND,
            HELP_METRIC_DAILY.ROUTE,
            HELP_METRIC_DAILY.HELP_ID,
            HELP_METRIC_DAILY.TERM)
        .doUpdate()
        .set(HELP_METRIC_DAILY.COUNT, HELP_METRIC_DAILY.COUNT.plus(1L))
        .set(HELP_METRIC_DAILY.LAST_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /**
   * 최근 days 일(오늘 포함) 합계 상위 limit 개. OPEN 은 (경로, 도움말), SEARCH_MISS 는 검색어만, AI_GAP 은 (검색어, 도움말) 단위로
   * 묶고 묶지 않은 컬럼은 ''로 돌려준다. 건수 내림차순, 같으면 최근 발생 순.
   */
  public List<HelpMetricRow> top(HelpMetricKind kind, int days, int limit) {
    Field<String> blank = DSL.inline("");
    Field<String> route;
    Field<String> helpId;
    Field<String> term;
    List<Field<?>> groupBy;
    switch (kind) {
      case OPEN -> {
        route = HELP_METRIC_DAILY.ROUTE;
        helpId = HELP_METRIC_DAILY.HELP_ID;
        term = blank;
        groupBy = List.of(HELP_METRIC_DAILY.ROUTE, HELP_METRIC_DAILY.HELP_ID);
      }
      // 결과 없는 검색어는 "무엇을 찾았나" 가 궁금한 것이라 화면(도움말)별로 쪼개지 않고 검색어 하나로 합친다.
      case SEARCH_MISS -> {
        route = blank;
        helpId = blank;
        term = HELP_METRIC_DAILY.TERM;
        groupBy = List.of(HELP_METRIC_DAILY.TERM);
      }
      case AI_GAP -> {
        route = blank;
        helpId = HELP_METRIC_DAILY.HELP_ID;
        term = HELP_METRIC_DAILY.TERM;
        groupBy = List.of(HELP_METRIC_DAILY.TERM, HELP_METRIC_DAILY.HELP_ID);
      }
      default -> throw new IllegalArgumentException("지원하지 않는 종류: " + kind);
    }
    Field<Long> sum = DSL.sum(HELP_METRIC_DAILY.COUNT).cast(SQLDataType.BIGINT);
    Field<OffsetDateTime> lastAt = DSL.max(HELP_METRIC_DAILY.LAST_AT);
    return dsl.select(route, helpId, term, sum, lastAt)
        .from(HELP_METRIC_DAILY)
        .where(HELP_METRIC_DAILY.KIND.eq(kind.name()))
        // 오늘 포함 days 일 창 — days=7 이면 오늘-6 일부터.
        .and(HELP_METRIC_DAILY.DAY.ge(KST_TODAY.minus(days - 1)))
        .groupBy(groupBy)
        .orderBy(sum.desc(), lastAt.desc())
        .limit(limit)
        .fetch(r -> new HelpMetricRow(r.value1(), r.value2(), r.value3(), r.value4(), r.value5()));
  }

  /** 보존 기간(days 일)을 넘긴 행을 지운다 — 기준일 당일 행은 남긴다. 지운 행 수를 돌려준다. */
  public int deleteOlderThan(int days) {
    return dsl.deleteFrom(HELP_METRIC_DAILY)
        .where(HELP_METRIC_DAILY.DAY.lt(KST_TODAY.minus(days)))
        .execute();
  }
}

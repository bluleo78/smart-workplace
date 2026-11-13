package com.workplace.help.repository;

import static com.workplace.help.dto.HelpMetricKind.OPEN;
import static com.workplace.help.dto.HelpMetricKind.SEARCH_MISS;
import static com.workplace.jooq.Tables.HELP_METRIC_DAILY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.help.dto.HelpMetricKind;
import com.workplace.help.dto.HelpMetricRow;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 도움말 지표 저장소 통합 시험(WP-1512) — upsert·KST 날짜·기간 합산·보존 삭제. */
@Transactional
public class HelpMetricRepositoryTest extends IntegrationTestBase {

  @Autowired HelpMetricRepository repo;
  @Autowired com.workplace.help.service.HelpMetricService service;

  /** 다른 시험이 남긴 행을 비운다 — 시험 트랜잭션이 롤백한다. */
  @BeforeEach
  void clean() {
    baseDsl.execute("DELETE FROM help_metric_daily");
  }

  /** 오늘(KST) 에서 dayOffset 일 전 날짜로 행을 직접 넣는다. */
  private void seed(
      HelpMetricKind kind, String route, String helpId, String term, long count, int dayOffset) {
    baseDsl.execute(
        "INSERT INTO help_metric_daily (day, kind, route, help_id, term, count)"
            + " VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date - ?, ?, ?, ?, ?, ?)",
        dayOffset,
        kind.name(),
        route,
        helpId,
        term,
        count);
  }

  @Test
  void incrementUpsertsOneRowPerKey() {
    repo.increment(OPEN, "/mail", "mail", "");
    repo.increment(OPEN, "/mail", "mail", "");
    assertThat(repo.top(OPEN, 7, 100))
        .singleElement()
        .satisfies(
            r -> {
              assertThat(r.count()).isEqualTo(2);
              assertThat(r.route()).isEqualTo("/mail");
            });
  }

  /** Review Focus 2 — 저장소는 '' 만 받으므로 서비스 정규화를 통해 확인한다. */
  @Test
  void nullAndEmptyHelpIdShareOneRow() {
    service.recordOpen("/mail", null);
    service.recordOpen("/mail", "");
    service.recordOpen("/mail", "  ");
    assertThat(baseDsl.fetchCount(HELP_METRIC_DAILY)).isEqualTo(1);
  }

  @Test
  void dayIsKstDate() {
    repo.increment(OPEN, "/", "", "");
    LocalDate kst =
        baseDsl
            .select(DSL.field("(now() AT TIME ZONE 'Asia/Seoul')::date", SQLDataType.LOCALDATE))
            .fetchOne(0, LocalDate.class);
    assertThat(
            baseDsl
                .select(HELP_METRIC_DAILY.DAY)
                .from(HELP_METRIC_DAILY)
                .fetchOne(0, LocalDate.class))
        .isEqualTo(kst);
  }

  @Test
  void topSumsAcrossDaysWithinWindowOrdersByCountAndLimits() {
    seed(SEARCH_MISS, "/", "home", "토큰", 2, 0);
    seed(SEARCH_MISS, "/", "home", "토큰", 3, 6); // 7일 창 안(오늘 포함 7일)
    seed(SEARCH_MISS, "/", "home", "토큰", 50, 7); // 7일 창 밖
    seed(SEARCH_MISS, "/", "home", "위젯", 1, 0);
    assertThat(repo.top(SEARCH_MISS, 7, 100))
        .extracting(HelpMetricRow::term, HelpMetricRow::count)
        .containsExactly(tuple("토큰", 5L), tuple("위젯", 1L));
    assertThat(repo.top(SEARCH_MISS, 30, 1)).extracting(HelpMetricRow::count).containsExactly(55L);
  }

  /** 결과 없는 검색어는 검색어만으로 묶는다 — 여러 화면에서 같은 말을 찾아도 한 줄로 합산하고 도움말·경로는 ''. */
  @Test
  void searchMissGroupsByTermOnly() {
    seed(SEARCH_MISS, "/mail", "mail", "토큰", 2, 0);
    seed(SEARCH_MISS, "/drive", "drive", "토큰", 3, 1);
    assertThat(repo.top(SEARCH_MISS, 7, 100))
        .extracting(
            HelpMetricRow::term, HelpMetricRow::helpId, HelpMetricRow::route, HelpMetricRow::count)
        .containsExactly(tuple("토큰", "", "", 5L));
  }

  /** 도움말 열기는 그대로 (경로, 도움말) 단위로 나눈다. */
  @Test
  void openStillGroupsByRouteAndHelpId() {
    seed(OPEN, "/mail", "mail", "", 2, 0);
    seed(OPEN, "/mail", "mail-compose", "", 1, 0);
    seed(OPEN, "/drive", "mail", "", 1, 0);
    assertThat(repo.top(OPEN, 7, 100))
        .extracting(HelpMetricRow::route, HelpMetricRow::helpId, HelpMetricRow::count)
        .containsExactlyInAnyOrder(
            tuple("/mail", "mail", 2L),
            tuple("/mail", "mail-compose", 1L),
            tuple("/drive", "mail", 1L));
  }

  @Test
  void deleteOlderThanKeepsBoundaryDay() {
    seed(OPEN, "/a", "", "", 1, 181);
    seed(OPEN, "/b", "", "", 1, 180);
    assertThat(repo.deleteOlderThan(180)).isEqualTo(1);
    assertThat(repo.top(OPEN, 90, 100)).isEmpty(); // /b 는 남았지만 90일 창 밖
    assertThat(baseDsl.fetchCount(HELP_METRIC_DAILY)).isEqualTo(1);
  }
}

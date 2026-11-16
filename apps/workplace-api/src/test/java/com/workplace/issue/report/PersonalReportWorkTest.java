package com.workplace.issue.report;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.report.PersonalReportWork.EpicWork;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * 개인 보고 끝낸 일 집계의 순수 규칙(WP-1632 리뷰) — AI 입력 전체 제목 예산(에픽당 상한)과 에픽 정렬(같은 건수면 프로젝트 키 → 번호 숫자 순)을 고정한다.
 * DB 없는 단위 테스트.
 */
class PersonalReportWorkTest {

  /** 제목 n 건짜리 에픽(끝낸 일 = n). */
  private static EpicWork epic(String key, int n) {
    List<String> titles = IntStream.range(0, n).mapToObj(i -> key + " 일 " + i).toList();
    return new EpicWork(key, null, key, false, false, n, 0, titles);
  }

  /** 에픽당 상한을 건 제목(저장소와 같은 방식 — titleLimit 로 정한 상한으로 capTitles). */
  private static List<String> capped(EpicWork e, int limit) {
    return ProjectReportEpics.capTitles(e.doneTitles(), limit);
  }

  /** 「외 N건」 줄을 뺀 실제 제목 수. */
  private static long realTitles(List<String> titles) {
    return titles.stream().filter(t -> !t.matches("외 \\d+건")).count();
  }

  /** 5 프로젝트 × 20 에픽 × 100 제목 — 전체 제목은 예산 안, 에픽마다 최소 몇 건은 남고, 남은 것은 「외 N건」. */
  @Test
  void titleLimit_capsTotalTitles() {
    List<EpicWork> epics = new ArrayList<>();
    for (int p = 0; p < 5; p++) {
      for (int e = 0; e < 20; e++) epics.add(epic("P" + p + "-" + (e + 1), 100));
    }

    int limit =
        PersonalReportWork.titleLimit(epics.stream().map(e -> e.doneTitles().size()).toList());

    long total = epics.stream().mapToLong(e -> realTitles(capped(e, limit))).sum();
    assertThat(total).isLessThanOrEqualTo(PersonalReportWork.TITLE_BUDGET).isPositive();
    for (EpicWork e : epics) {
      List<String> titles = capped(e, limit);
      long shown = realTitles(titles);
      assertThat(shown).isGreaterThanOrEqualTo(PersonalReportWork.MIN_TITLES_PER_EPIC);
      assertThat(titles.get(titles.size() - 1)).isEqualTo("외 " + (100 - shown) + "건");
    }
  }

  /** 예산 안이면 에픽당 상한(100)만 — 작은 에픽은 그대로, 큰 에픽은 100 뒤 「외 N건」. */
  @Test
  void titleLimit_underBudget_onlyPerEpicLimit() {
    EpicWork big = epic("WP-1", 105);
    EpicWork small = epic("WP-2", 2);

    int limit = PersonalReportWork.titleLimit(List.of(105, 2));

    assertThat(limit).isEqualTo(ProjectReportEpics.TITLE_LIMIT);
    assertThat(capped(big, limit))
        .hasSize(ProjectReportEpics.TITLE_LIMIT + 1)
        .last()
        .isEqualTo("외 5건");
    assertThat(capped(small, limit)).hasSize(2);
  }

  /** 에픽 정렬 — 끝낸 일 많은 순, 같으면 프로젝트 키 → 번호 숫자 순(WP-9 가 WP-10 앞), 「에픽 없음」 맨 뒤. */
  @Test
  void epicOrder_doneThenProjectKeyThenNumber_noEpicLast() {
    EpicWork noEpic =
        new EpicWork(null, null, PersonalReportWork.NO_EPIC, false, false, 9, 0, List.of());
    List<EpicWork> epics =
        new ArrayList<>(
            List.of(epic("WP-10", 2), noEpic, epic("WP-9", 2), epic("CP-1", 2), epic("WP-3", 7)));

    epics.sort(PersonalReportWork.EPIC_ORDER);

    assertThat(epics.stream().map(EpicWork::title))
        .containsExactly("WP-3", "CP-1", "WP-9", "WP-10", PersonalReportWork.NO_EPIC);
  }
}

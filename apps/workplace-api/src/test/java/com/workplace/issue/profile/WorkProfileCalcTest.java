package com.workplace.issue.profile;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.issue.metrics.ClosedIssueFact;
import com.workplace.issue.metrics.DueOutcome;
import com.workplace.issue.outbound.dto.WorkProfileAiResult.Classified;
import com.workplace.issue.profile.WorkProfileCalc.Count;
import com.workplace.issue.profile.WorkProfileCalc.Tally;
import com.workplace.issue.profile.WorkProfileInputRepository.IssueBrief;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** WP-1485 — 업무 프로파일 순수 계산(세기·역량 정리·지문·마감 결과)을 Spring 없이 고정한다. */
class WorkProfileCalcTest {

  private static Classified c(String key, String task, String area) {
    return new Classified(key, task, area);
  }

  private static IssueBrief brief(long id, String updatedAt) {
    return new IssueBrief(
        id, "WP-" + id, "t" + id, null, "TASK", null, "P", OffsetDateTime.parse(updatedAt));
  }

  private static ClosedIssueFact fact(DueOutcome outcome, Integer lateDays) {
    return new ClosedIssueFact(
        1L,
        1L,
        OffsetDateTime.parse("2026-11-05T01:00:00Z"),
        LocalDate.parse("2026-11-05"),
        null,
        outcome,
        lateDays,
        1.0,
        false);
  }

  @Test
  void tally_countsByTaskAndArea_sortedDescThenName() {
    Tally t =
        WorkProfileCalc.tally(
            List.of(
                c("WP-1", "기능 개발", "이슈 트래커"),
                c("WP-2", "기능 개발", "이슈 트래커"),
                c("WP-3", "결함 수정", "채팅")),
            Set.of("WP-1", "WP-2", "WP-3"));

    assertThat(t.tasks()).containsExactly(new Count("기능 개발", 2), new Count("결함 수정", 1));
    assertThat(t.areas()).containsExactly(new Count("이슈 트래커", 2), new Count("채팅", 1));
  }

  @Test
  void tally_unknownTaskIsEtc_unknownKeyDropped_duplicateKeyFirstWins() {
    Tally t =
        WorkProfileCalc.tally(
            List.of(c("WP-1", "춤추기", "채팅"), c("ZZ-9", "기능 개발", "x"), c("WP-1", "결함 수정", "y")),
            Set.of("WP-1"));

    assertThat(t.tasks()).containsExactly(new Count("기타", 1));
    assertThat(t.areas()).containsExactly(new Count("채팅", 1));
  }

  @Test
  void tally_keepsTop6_andSkipsBlankArea() {
    List<String> tasks =
        List.of("결함 수정", "기능 개발", "설계·기획", "릴리스·배포", "매뉴얼·문서", "테스트", "운영·지원", "개선·정리");
    List<Classified> items = new ArrayList<>();
    for (int i = 0; i < tasks.size(); i++) {
      items.add(c("WP-" + i, tasks.get(i), i == 0 ? "  " : "영역" + i));
    }
    Set<String> keys = new java.util.HashSet<>();
    items.forEach(it -> keys.add(it.key()));

    Tally t = WorkProfileCalc.tally(items, keys);

    assertThat(t.tasks()).hasSize(WorkProfileCalc.TOP_N);
    assertThat(t.areas()).extracting(Count::name).doesNotContain("  ", "");
  }

  @Test
  void tasks_areTheNineFixedNames() {
    assertThat(WorkProfileCalc.TASKS)
        .containsExactly(
            "결함 수정", "기능 개발", "설계·기획", "릴리스·배포", "매뉴얼·문서", "테스트", "운영·지원", "개선·정리", "기타");
  }

  @Test
  void skills_trimDedupeMax5() {
    List<String> raw = new ArrayList<>(List.of(" Java ", "Java", "", "  ", "React", "SQL", "K8s"));
    raw.add(null);
    raw.addAll(List.of("Spring", "Kotlin"));

    assertThat(WorkProfileCalc.skills(raw))
        .containsExactly("Java", "React", "SQL", "K8s", "Spring");
    assertThat(WorkProfileCalc.skills(null)).isEmpty();
  }

  @Test
  void fingerprint_orderIndependent_changesWithUpdatedAt() {
    IssueBrief a = brief(1, "2026-11-01T00:00:00Z");
    IssueBrief b = brief(2, "2026-11-02T00:00:00Z");
    String fp = WorkProfileCalc.fingerprint(List.of(a, b));

    assertThat(WorkProfileCalc.fingerprint(List.of(b, a))).isEqualTo(fp);
    IssueBrief bLater = brief(2, "2026-11-02T00:00:00.000001Z");
    assertThat(WorkProfileCalc.fingerprint(List.of(a, bLater))).isNotEqualTo(fp);
    assertThat(WorkProfileCalc.fingerprint(List.of(a))).isNotEqualTo(fp);
  }

  @Test
  void dueResult() {
    assertThat(WorkProfileCalc.dueResult(fact(DueOutcome.OVERDUE, 3))).isEqualTo("늦음 3일");
    assertThat(WorkProfileCalc.dueResult(fact(DueOutcome.ON_TIME, null))).isEqualTo("제때");
    assertThat(WorkProfileCalc.dueResult(fact(DueOutcome.NO_DUE, null))).isEqualTo("마감 없음");
  }
}

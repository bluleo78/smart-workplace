package com.workplace.issue.overview.status;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 프로젝트 상태 요약 저장소(WP-1479) — 실행권 점유·간격 당기기·대상 선별(삭제·개인 제외). */
@Transactional
class ProjectStatusSummaryRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectStatusSummaryRepository repository;

  private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-11T03:00:00Z");

  /** 테스트용 사용자 id. */
  private long user() {
    String s = UUID.randomUUID().toString().substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ss-" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "ss")
        .set(USER.EMAIL, "ss-" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 지정 유형 프로젝트를 만들고 id 를 돌려준다(deleted 면 soft-delete 표시). */
  private long project(String type, boolean deleted) {
    String key =
        ("SS" + UUID.randomUUID().toString().replace("-", "").toUpperCase()).substring(0, 8);
    var step =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, key)
            .set(PROJECT.NAME, "요약-" + key)
            .set(PROJECT.OWNER_ID, user())
            .set(PROJECT.TYPE, type)
            .set(PROJECT.IS_DEFAULT, false);
    if (deleted) step = step.set(PROJECT.DELETED_AT, NOW);
    return step.returning(PROJECT.ID).fetchOne().getId();
  }

  @Test
  void claimCreatesRow() {
    long p = project("TEAM", false);

    assertThat(repository.find(p)).isEmpty();
    assertThat(repository.claim(p, NOW, NOW.plusHours(2))).isTrue();

    StatusSummaryRow row = repository.find(p).orElseThrow();
    assertThat(row.nextRunAt().toInstant()).isEqualTo(NOW.plusHours(2).toInstant());
    assertThat(row.summary()).isNull();
  }

  @Test
  void claimOnlyOnceWhenDue() {
    long p = project("TEAM", false);

    assertThat(repository.claim(p, NOW, NOW.plusHours(2))).isTrue();
    // 같은 now 로 다시 — next_run_at 이 미래라 거절.
    assertThat(repository.claim(p, NOW, NOW.plusHours(2))).isFalse();
    // 주기가 지나면 다시 점유할 수 있다.
    assertThat(repository.claim(p, NOW.plusHours(2), NOW.plusHours(4))).isTrue();
  }

  @Test
  void shorterIntervalPullsNextRunForward() {
    long p = project("TEAM", false);
    repository.claim(p, NOW, NOW.plus(StatusSummaryInterval.H4.duration()));

    repository.pullNextRunForward(p, NOW.plus(StatusSummaryInterval.H1.duration()));

    assertThat(repository.find(p).orElseThrow().nextRunAt().toInstant())
        .isEqualTo(NOW.plusHours(1).toInstant());
    // 더 늦은 후보로는 되돌리지 않는다.
    repository.pullNextRunForward(p, NOW.plusHours(4));
    assertThat(repository.find(p).orElseThrow().nextRunAt().toInstant())
        .isEqualTo(NOW.plusHours(1).toInstant());
  }

  @Test
  void saveGeneratedAndTouchChecked() {
    long p = project("TEAM", false);

    repository.saveGenerated(p, "WARN", "지연 이슈가 있어요", "h1", NOW);
    repository.touchChecked(p, NOW.plusHours(2));

    StatusSummaryRow row = repository.find(p).orElseThrow();
    assertThat(row.badge()).isEqualTo("WARN");
    assertThat(row.summary()).isEqualTo("지연 이슈가 있어요");
    assertThat(row.inputHash()).isEqualTo("h1");
    assertThat(row.generatedAt().toInstant()).isEqualTo(NOW.toInstant());
    assertThat(row.checkedAt().toInstant()).isEqualTo(NOW.plusHours(2).toInstant());
  }

  @Test
  void dueProjectIdsExcludesArchivedAndPersonal() {
    long due = project("TEAM", false);
    long notYet = project("TEAM", false);
    long personal = project("PERSONAL", false);
    long archived = project("TEAM", true);
    repository.claim(notYet, NOW, NOW.plusHours(2));

    assertThat(repository.dueProjectIds(NOW, Integer.MAX_VALUE))
        .contains(due)
        .doesNotContain(notYet, personal, archived);
    // 간격이 지나면 대상이 된다.
    assertThat(repository.dueProjectIds(NOW.plusHours(2), Integer.MAX_VALUE)).contains(notYet);
  }

  /** 상한만큼만 id 순으로 돌려준다 — 스케줄러가 회차 상한의 남은 자리만큼만 받아 간다. */
  @Test
  void dueProjectIdsHonorsLimitInIdOrder() {
    long first = project("TEAM", false);
    long second = project("TEAM", false);

    var all = repository.dueProjectIds(NOW, Integer.MAX_VALUE);
    var limited = repository.dueProjectIds(NOW, 1);
    assertThat(limited).hasSize(1).containsExactly(all.get(0));
    assertThat(all).containsSubsequence(first, second);
  }
}

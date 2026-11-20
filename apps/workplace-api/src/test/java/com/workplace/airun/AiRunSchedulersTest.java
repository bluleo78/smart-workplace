package com.workplace.airun;

import static com.workplace.jooq.Tables.AI_RUN;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.service.AiRunRetentionScheduler;
import com.workplace.airun.service.AiRunStaleSweeper;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1827 보고 없음 정리·90일 보관 스케줄러 시험. 러너가 별도 트랜잭션을 열어 미커밋 시드가 보이지 않으므로 {@code @Transactional} 없이 커밋된
 * 행으로 검증한다.
 */
class AiRunSchedulersTest extends IntegrationTestBase {

  @Autowired AiRunStaleSweeper sweeper;
  @Autowired AiRunRetentionScheduler retention;

  /** 테넌트 1 에 행을 직접 넣는다. */
  private UUID seed(String kind, String status, OffsetDateTime startedAt) {
    UUID id = UUID.randomUUID();
    callInTenant(
        1L,
        () ->
            baseDsl
                .insertInto(AI_RUN)
                .set(AI_RUN.RUN_ID, id)
                .set(AI_RUN.KIND, kind)
                .set(AI_RUN.STATUS, status)
                .set(AI_RUN.STARTED_AT, startedAt)
                .execute());
    return id;
  }

  private com.workplace.jooq.tables.records.AiRunRecord row(UUID id) {
    return callInTenant(
        1L, () -> baseDsl.selectFrom(AI_RUN).where(AI_RUN.RUN_ID.eq(id)).fetchOne());
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(1L, () -> baseDsl.deleteFrom(AI_RUN).execute());
  }

  @Test
  void sweep_defaultKindRunning31MinAgo_failedWithReason() {
    UUID id = seed("MAIL_SUMMARY", "RUNNING", OffsetDateTime.now().minusMinutes(31));
    sweeper.sweep();
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("보고 없음");
    assertThat(r.getEndedAt()).isNotNull();
  }

  @Test
  void sweep_defaultKindRunning29MinAgo_untouched() {
    UUID id = seed("MAIL_SUMMARY", "RUNNING", OffsetDateTime.now().minusMinutes(29));
    sweeper.sweep();
    assertThat(row(id).getStatus()).isEqualTo("RUNNING");
  }

  @Test
  void sweep_aiChatRunning45MinAgo_untouched_61MinAgo_failed() {
    UUID young = seed("AI_CHAT", "RUNNING", OffsetDateTime.now().minusMinutes(45));
    UUID old = seed("AI_CHAT", "RUNNING", OffsetDateTime.now().minusMinutes(61));
    sweeper.sweep();
    assertThat(row(young).getStatus()).isEqualTo("RUNNING");
    var r = row(old);
    assertThat(r.getStatus()).isEqualTo("FAILED");
    assertThat(r.getErrorReason()).isEqualTo("보고 없음");
  }

  @Test
  void sweep_succeededOldRow_untouched() {
    UUID id = seed("MAIL_SUMMARY", "SUCCEEDED", OffsetDateTime.now().minusHours(5));
    sweeper.sweep();
    var r = row(id);
    assertThat(r.getStatus()).isEqualTo("SUCCEEDED");
    assertThat(r.getErrorReason()).isNull();
  }

  @Test
  void purge_91DaysOld_deleted_89DaysKept() {
    UUID old = seed("MAIL_SUMMARY", "SUCCEEDED", OffsetDateTime.now().minusDays(91));
    UUID kept = seed("MAIL_SUMMARY", "SUCCEEDED", OffsetDateTime.now().minusDays(89));
    retention.purge();
    assertThat(row(old)).isNull();
    assertThat(row(kept)).isNotNull();
  }
}

package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;

import com.workplace.fileai.ExtractionProfile;
import com.workplace.fileai.inbound.ExtractionBackfillSource;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-244: 백스톱 스케줄러가 추출 행 없는 기존 첨부를 TEXT_ONLY 로 시드하고, 행 생성 판정(PENDING/SKIPPED)을 writer 로 공유한다. 도메인
 * 픽스처 없이 스케줄러 시드만 보도록 테스트 전용 소스를 쓴다(실 소스는 Task 1 테스트가 검증).
 */
@TestPropertySource(properties = "workplace.worker.enabled=true")
@Import(AttachmentExtractionBackfillTest.FakeSourceConfig.class)
class AttachmentExtractionBackfillTest extends IntegrationTestBase {

  private static final long TENANT = 1L;

  /** 테스트 전용 소스 — 지정한 대상만 돌려준다. */
  @TestConfiguration
  static class FakeSourceConfig {
    static final List<ExtractionBackfillSource.Target> TARGETS = new CopyOnWriteArrayList<>();

    @Bean
    ExtractionBackfillSource fakeBackfillSource() {
      return limit -> TARGETS.stream().limit(limit).toList();
    }
  }

  @Autowired DSLContext dsl;
  @Autowired FileExtractionScheduler scheduler;
  @Autowired FileExtractionRowWriter rowWriter;

  @MockitoBean WorkerClient workerClient;
  @MockitoBean AiAgentDriveClient driveClient;

  private final List<Long> fileIds = new ArrayList<>();
  private final List<Long> userIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    FakeSourceConfig.TARGETS.clear();
    if (!fileIds.isEmpty()) {
      cleanupInTenant(
          TENANT,
          () -> {
            dsl.execute(
                "DELETE FROM worker_job WHERE params ->> 'fileId' IN ("
                    + String.join(",", fileIds.stream().map(id -> "'" + id + "'").toList())
                    + ")");
            dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(fileIds)).execute();
            dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
          });
      fileIds.clear();
    }
    if (!userIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(s -> dsl.deleteFrom(USER).where(USER.ID.in(userIds)).execute());
      userIds.clear();
    }
  }

  @Test
  void 추출_가능_첨부는_TEXT_ONLY_PENDING_으로_시드된다() {
    long fileId = seedFile("application/pdf");
    FakeSourceConfig.TARGETS.add(new ExtractionBackfillSource.Target(fileId, "application/pdf"));
    inTenantRun(() -> scheduler.seedMissingAttachments(TENANT));
    assertThat(row(fileId)).containsExactly("PENDING", "TEXT_ONLY");
  }

  @Test
  void 이미지_첨부는_SKIPPED_로_시드된다() {
    long fileId = seedFile("image/png");
    FakeSourceConfig.TARGETS.add(new ExtractionBackfillSource.Target(fileId, "image/png"));
    inTenantRun(() -> scheduler.seedMissingAttachments(TENANT));
    assertThat(row(fileId)).containsExactly("SKIPPED", "TEXT_ONLY");
  }

  @Test
  void 재실행해도_기존_행을_바꾸지_않는다() {
    long fileId = seedFile("application/pdf");
    FakeSourceConfig.TARGETS.add(new ExtractionBackfillSource.Target(fileId, "application/pdf"));
    inTenantRun(() -> scheduler.seedMissingAttachments(TENANT));
    inTenantRun(
        () ->
            dsl.update(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.STATUS, "DONE")
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .execute());
    inTenantRun(() -> scheduler.seedMissingAttachments(TENANT));
    assertThat(row(fileId).get(0)).isEqualTo("DONE");
  }

  @Test
  void runOnce_는_시드한_PENDING_을_같은_회차에_디스패치한다() {
    long fileId = seedFile("application/pdf");
    FakeSourceConfig.TARGETS.add(new ExtractionBackfillSource.Target(fileId, "application/pdf"));
    scheduler.runOnce();
    // 공유 DB 에 다른 테스트 잔여 행이 있을 수 있어 최소 1회 호출 + 시드한 파일의 행이 EXTRACTING 으로 넘어갔는지로 확인한다.
    verify(workerClient, atLeastOnce())
        .dispatchExtract(anyLong(), any(), eq("application/pdf"), anyLong(), eq(true));
    assertThat(row(fileId).get(0)).isEqualTo("EXTRACTING");
  }

  @Test
  void 다른_테넌트_첨부는_시드하지_않는다() {
    // writer 가 tenantId 인자로 행을 쓰므로, GUC(테넌트 1) 와 다른 tenant 로의 삽입이 막히는지 확인한다.
    long fileId = seedFile("application/pdf");
    assertThatThrownBy(
            () ->
                inTenantRun(
                    () ->
                        rowWriter.write(
                            fileId, 999L, "application/pdf", ExtractionProfile.TEXT_ONLY)))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
  }

  // ── 헬퍼 ──────────────────────────────────────────────

  private List<String> row(long fileId) {
    return inTenant(
        () ->
            dsl.select(FILE_EXTRACTION.STATUS, FILE_EXTRACTION.PROFILE)
                .from(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                .fetchOne(r -> List.of(r.value1(), r.value2())));
  }

  private long seedFile(String mime) {
    String suffix = String.valueOf(System.nanoTime());
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "bf-" + suffix)
                        .set(USER.NAME, "BF")
                        .set(USER.EMAIL, "bf-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    userIds.add(userId);
    long fileId =
        inTenant(
            () ->
                dsl.insertInto(FILE)
                    .set(FILE.ORIGINAL_NAME, "a-" + suffix)
                    .set(FILE.STORED_NAME, "a-" + suffix)
                    .set(FILE.MIME_TYPE, mime)
                    .set(FILE.SIZE_BYTES, 10L)
                    .set(FILE.STORAGE_PATH, "x/a-" + suffix)
                    .set(FILE.UPLOADED_BY, userId)
                    .returning(FILE.ID)
                    .fetchOne()
                    .getId());
    fileIds.add(fileId);
    return fileId;
  }

  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(TENANT);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }

  private void inTenantRun(Runnable body) {
    inTenant(
        () -> {
          body.run();
          return null;
        });
  }
}

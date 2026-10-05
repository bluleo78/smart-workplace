package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-244: findResumable 이 상한을 넘을 때 FULL(드라이브) 행을 TEXT_ONLY(첨부 백필) 행보다 먼저 돌려주는지 검증한다. 첨부 백필이 재개 큐를
 * 채워도 드라이브 요약 재시도·lease 만료 복구가 굶지 않아야 한다.
 *
 * <p>상한을 2 로 작게 둔 별도 컨텍스트. 공유 DB 잔여 행이 있어도 깨지지 않게 "특정 id 포함" 대신 "돌려준 행이 모두 FULL" 만 단언한다(이 테스트가 FULL
 * 재개 행을 2건 이상 보장하므로, FULL 우선이면 상한 2 는 전부 FULL 로 채워진다).
 */
@TestPropertySource(properties = "workplace.worker.extract.resume-batch-size=2")
class FindResumableOrderTest extends IntegrationTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired WorkerJobRepository jobRepo;

  private final List<Long> fileIds = new ArrayList<>();
  private final List<Long> userIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!fileIds.isEmpty()) {
      cleanupInTenant(
          TENANT,
          () -> {
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
  void 상한을_넘으면_FULL_행을_TEXT_ONLY_보다_먼저_돌려준다() {
    // TEXT_ONLY 를 먼저(더 작은 file_id) 만들어, 순서 없이 잘리면 TEXT_ONLY 가 먼저 뽑히기 쉬운 배치로 둔다.
    for (int i = 0; i < 3; i++) seedPending(ExtractionProfile.TEXT_ONLY);
    for (int i = 0; i < 3; i++) seedPending(ExtractionProfile.FULL);

    List<Long> resumable = inTenant(() -> jobRepo.findResumable());

    assertThat(resumable).hasSize(2);
    List<String> profiles =
        inTenant(
            () ->
                dsl.select(FILE_EXTRACTION.PROFILE)
                    .from(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.in(resumable))
                    .fetch(FILE_EXTRACTION.PROFILE));
    assertThat(profiles).containsOnly(ExtractionProfile.FULL.name());
  }

  // ── 헬퍼 ──────────────────────────────────────────────

  /** 파일 + 해당 프로파일의 PENDING 추출 행을 만든다. */
  private void seedPending(ExtractionProfile profile) {
    String suffix = String.valueOf(System.nanoTime());
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "ro-" + suffix)
                        .set(USER.NAME, "RO")
                        .set(USER.EMAIL, "ro-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    userIds.add(userId);
    long fileId =
        inTenant(
            () -> {
              long id =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, "r-" + suffix)
                      .set(FILE.STORED_NAME, "r-" + suffix)
                      .set(FILE.MIME_TYPE, "application/pdf")
                      .set(FILE.SIZE_BYTES, 10L)
                      .set(FILE.STORAGE_PATH, "x/r-" + suffix)
                      .set(FILE.UPLOADED_BY, userId)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(FILE_EXTRACTION)
                  .set(FILE_EXTRACTION.FILE_ID, id)
                  .set(FILE_EXTRACTION.STATUS, "PENDING")
                  .set(FILE_EXTRACTION.PROFILE, profile.name())
                  .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                  .execute();
              return id;
            });
    fileIds.add(fileId);
  }

  private <T> T inTenant(Supplier<T> body) {
    TenantContext.set(TENANT);
    try {
      return new TransactionTemplate(txManager).execute(s -> body.get());
    } finally {
      TenantContext.clear();
    }
  }
}

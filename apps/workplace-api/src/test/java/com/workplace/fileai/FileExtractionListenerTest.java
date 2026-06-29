package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

import com.workplace.drive.outbound.DriveFileUploadedEvent;
import com.workplace.fileai.outbound.WorkerClient;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * DriveFileUploadedEvent → FileExtractionListener → file_extraction 행 생성 통합 검증.
 *
 * <p>AFTER_COMMIT 리스너가 실제로 커밋 후 PENDING/SKIPPED 행을 생성하는지 확인한다. REQUIRES_NEW 로 커밋되므로 단일 롤백-트랜잭션 패턴
 * 사용 불가 — @AfterEach 에서 cleanupInTenant 로 잔여 행을 삭제한다(#512 방지).
 */
@TestPropertySource(properties = "workplace.worker.enabled=true")
class FileExtractionListenerTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ApplicationEventPublisher publisher;

  /** WorkerClient mock — 리스너 nudge 의 HTTP push 차단(실제 워커 미기동 환경). */
  @MockitoBean WorkerClient workerClient;

  /** 테스트에서 삽입한 file_id 목록 — @AfterEach 정리용. */
  private final List<Long> createdFileIds = new ArrayList<>();

  /** 테스트에서 생성한 user_id 목록 — @AfterEach 정리용. */
  private final List<Long> createdUserIds = new ArrayList<>();

  /** 테스트 종료 후 삽입한 행을 삭제해 공유 테스트 DB 오염 방지(#512). */
  @AfterEach
  void cleanup() {
    if (!createdFileIds.isEmpty()) {
      cleanupInTenant(
          1L,
          () -> {
            // FK 순서: file_extraction 먼저, 이후 file
            dsl.deleteFrom(FILE_EXTRACTION)
                .where(FILE_EXTRACTION.FILE_ID.in(createdFileIds))
                .execute();
            dsl.deleteFrom(FILE).where(FILE.ID.in(createdFileIds)).execute();
          });
      createdFileIds.clear();
    }
    // USER 는 RLS 비대상 — 트랜잭션 없이 삭제 가능(FileExtractionRlsTest 패턴)
    if (!createdUserIds.isEmpty()) {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              s -> dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute());
      createdUserIds.clear();
    }
  }

  @Test
  void textFile_createsPendingRow() {
    // text/plain(TEXT 카테고리) 업로드 이벤트 → PENDING 행 생성 후 즉시 dispatchPending nudge → EXTRACTING
    // FileExtractionListener 가 PENDING 생성 후 dispatchPending 을 호출해 PENDING→EXTRACTING CAS 전이함
    doNothing().when(workerClient).dispatchExtract(any(Long.class), any(), any(), any(Long.class));
    long fileId = createFileInTenant(1L, "text/plain");
    publishInTenant(
        1L, new DriveFileUploadedEvent(fileId, 1L, "text/plain", "TEXT", 10, "x/f.txt"));
    String status = readStatusInTenant(1L, fileId);
    // nudge 로 EXTRACTING 까지 전이 (PENDING 은 nudge 성공 시 즉시 소비됨)
    assertThat(status).isEqualTo("EXTRACTING");
  }

  @Test
  void imageFile_isSkipped() {
    // image/png(IMAGE 카테고리) → 추출 불가 → SKIPPED 행 생성 검증
    long fileId = createFileInTenant(1L, "image/png");
    publishInTenant(
        1L, new DriveFileUploadedEvent(fileId, 1L, "image/png", "IMAGE", 10, "x/f.png"));
    assertThat(readStatusInTenant(1L, fileId)).isEqualTo("SKIPPED");
  }

  /**
   * 지정 테넌트(GUC 주입) 트랜잭션 안에서 FILE 행을 생성하고 file_id 를 반환한다. FK file_extraction.file_id → file(id) 를
   * 충족하기 위해 실제 FILE 행이 필요. USER 도 FK 로 필요하므로 테스트용 유저를 먼저 생성한다.
   */
  private long createFileInTenant(long tenantId, String mimeType) {
    // USER 는 RLS 비대상 — 별도 트랜잭션(GUC 불필요)에서 생성
    String suffix = String.valueOf(System.nanoTime() % 1_000_000_000L);
    Long userId =
        new TransactionTemplate(txManager)
            .execute(
                status ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "fe-test-" + suffix)
                        .set(USER.NAME, "FE Test User")
                        .set(USER.EMAIL, "fe-test-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
    createdUserIds.add(userId);

    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      Long fileId =
          new TransactionTemplate(txManager)
              .execute(
                  status ->
                      dsl.insertInto(FILE)
                          .set(FILE.ORIGINAL_NAME, "test-" + suffix + ".txt")
                          .set(FILE.STORED_NAME, "test-" + suffix + ".txt")
                          .set(FILE.MIME_TYPE, mimeType)
                          .set(FILE.SIZE_BYTES, 10L)
                          .set(FILE.STORAGE_PATH, "x/test-" + suffix + ".txt")
                          .set(FILE.UPLOADED_BY, userId)
                          .returning(FILE.ID)
                          .fetchOne()
                          .getId());
      createdFileIds.add(fileId);
      return fileId;
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /**
   * 지정 테넌트 컨텍스트에서 이벤트를 발행한다. TransactionTemplate 으로 커밋이 발생해야 AFTER_COMMIT 리스너가 실행된다. TenantContext
   * 는 REQUIRES_NEW 리스너의 GUC 주입에도 사용된다.
   */
  private void publishInTenant(long tenantId, DriveFileUploadedEvent event) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(status -> publisher.publishEvent(event));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 지정 테넌트 컨텍스트(GUC)에서 file_extraction 상태를 조회해 반환한다. */
  private String readStatusInTenant(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status ->
                  dsl.select(FILE_EXTRACTION.STATUS)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.STATUS));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }
}

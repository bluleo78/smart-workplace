package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.verifyNoInteractions;

import com.workplace.fileai.inbound.FileExtractionRequestedEvent;
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
 * FileExtractionRequestedEvent → FileExtractionListener → file_extraction 행 생성 통합 검증.
 *
 * <p>추출 행(PENDING/SKIPPED)은 발행 트랜잭션 안에서 동기 생성되고(원자성), AFTER_COMMIT 단계는 워커 디스패치(nudge)만 맡는다. 커밋이 필요한
 * 흐름이라 단일 롤백-트랜잭션 패턴 사용 불가 — @AfterEach 에서 cleanupInTenant 로 잔여 행을 삭제한다(#512 방지).
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
    // text/plain(추출 가능 mime) 이벤트 → 발행 트랜잭션에서 PENDING 행 생성, 커밋 후 AFTER_COMMIT 이
    // dispatchPending 으로 PENDING→EXTRACTING CAS 전이시킨다
    doNothing()
        .when(workerClient)
        .dispatchExtract(any(Long.class), any(), any(), any(Long.class), anyBoolean());
    long fileId = createFileInTenant(1L, "text/plain");
    publishInTenant(
        1L, new FileExtractionRequestedEvent(fileId, 1L, "text/plain", ExtractionProfile.FULL));
    String status = readStatusInTenant(1L, fileId);
    // nudge 로 EXTRACTING 까지 전이 (PENDING 은 nudge 성공 시 즉시 소비됨)
    assertThat(status).isEqualTo("EXTRACTING");
  }

  @Test
  void imageFile_isSkipped() {
    // image/png(mime 기반 추출 불가 판정) → SKIPPED 행 생성 검증
    long fileId = createFileInTenant(1L, "image/png");
    publishInTenant(
        1L, new FileExtractionRequestedEvent(fileId, 1L, "image/png", ExtractionProfile.FULL));
    assertThat(readStatusInTenant(1L, fileId)).isEqualTo("SKIPPED");
  }

  @Test
  void 프로파일이_행에_기록된다() {
    doNothing()
        .when(workerClient)
        .dispatchExtract(any(Long.class), any(), any(), any(Long.class), anyBoolean());
    long fileId = createFileInTenant(1L, "application/pdf");
    publishInTenant(
        1L,
        new FileExtractionRequestedEvent(
            fileId, 1L, "application/pdf", ExtractionProfile.TEXT_ONLY));
    assertThat(readProfileInTenant(1L, fileId)).isEqualTo("TEXT_ONLY");
  }

  @Test
  void 미지원_형식도_프로파일과_함께_SKIPPED() {
    long fileId = createFileInTenant(1L, "application/zip");
    publishInTenant(
        1L,
        new FileExtractionRequestedEvent(
            fileId, 1L, "application/zip", ExtractionProfile.TEXT_ONLY));
    assertThat(readStatusInTenant(1L, fileId)).isEqualTo("SKIPPED");
    assertThat(readProfileInTenant(1L, fileId)).isEqualTo("TEXT_ONLY");
  }

  @Test
  void 발행_트랜잭션이_롤백되면_추출_행도_없다() {
    // 행 생성이 발행 트랜잭션 안에서 일어나므로 업로드/바인딩이 롤백되면 추출 행도 함께 사라져야 한다(WP-242 원자성).
    long fileId = createFileInTenant(1L, "text/plain");
    Long prev = TenantContext.get();
    TenantContext.set(1L);
    try {
      new TransactionTemplate(txManager)
          .executeWithoutResult(
              status -> {
                publisher.publishEvent(
                    new FileExtractionRequestedEvent(
                        fileId, 1L, "text/plain", ExtractionProfile.TEXT_ONLY));
                // 같은 트랜잭션 안에서 이미 PENDING 행이 보여야 한다 — 동기 생성의 증거(AFTER_COMMIT 이면 아직 null)
                assertThat(
                        dsl.select(FILE_EXTRACTION.STATUS)
                            .from(FILE_EXTRACTION)
                            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                            .fetchOne(FILE_EXTRACTION.STATUS))
                    .isEqualTo("PENDING");
                status.setRollbackOnly();
              });
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
    assertThat(readStatusInTenant(1L, fileId)).isNull();
    verifyNoInteractions(workerClient);
  }

  @Test
  void 트랜잭션_밖에서_발행하면_IllegalStateException() {
    // 원자성 계약 위반(트랜잭션 없는 발행)은 조용히 넘기지 않고 예외로 드러내야 한다.
    Long prev = TenantContext.get();
    TenantContext.set(1L);
    try {
      assertThatThrownBy(
              () ->
                  publisher.publishEvent(
                      new FileExtractionRequestedEvent(
                          1L, 1L, "text/plain", ExtractionProfile.TEXT_ONLY)))
          .isInstanceOf(IllegalStateException.class);
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
  }

  /** 지정 테넌트 컨텍스트(GUC)에서 file_extraction.profile 을 조회한다. */
  private String readProfileInTenant(long tenantId, long fileId) {
    Long prev = TenantContext.get();
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              status ->
                  dsl.select(FILE_EXTRACTION.PROFILE)
                      .from(FILE_EXTRACTION)
                      .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                      .fetchOne(FILE_EXTRACTION.PROFILE));
    } finally {
      if (prev == null) TenantContext.clear();
      else TenantContext.set(prev);
    }
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
   * 지정 테넌트 컨텍스트에서 이벤트를 발행한다. 행 생성은 이 트랜잭션 안에서 동기로 일어나고, 커밋되어야 AFTER_COMMIT 디스패치가 실행된다.
   * TenantContext 는 트랜잭션·REQUIRES_NEW 디스패치의 GUC 주입에 사용된다.
   */
  private void publishInTenant(long tenantId, FileExtractionRequestedEvent event) {
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

package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.MailAttachmentBlobRepository;
import com.workplace.support.IntegrationTestBase;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MailAttachmentBlobGcSweeper 통합 테스트.
 *
 * <p>비-@Transactional: sweeper 가 자체 트랜잭션(txTemplate)으로 커밋하므로, 검증은 커밋 후 상태를 보아야 한다.
 *
 * <p>Teeth(진짜 이빨): 파일 삭제까지 검증 — DB 행만 지우고 디스크가 남으면 FAIL.
 *
 * <p>seed 직전 {@code TenantContext.clear()} 로 ambient GUC 마스킹 방지(슬라이스② 교훈). RLS FORCE 테이블이므로 GUC 없이
 * autocommit INSERT 하면 tenant_id 기본값(NULL)이 들어가거나 RLS WITH CHECK 에 걸린다 — 따라서 seed 도 txTemplate(GUC
 * 주입) 안에서 실행한다.
 */
class MailAttachmentBlobGcIntegrationTest extends IntegrationTestBase {

  private static final long T = 1L;

  @Autowired private MailAttachmentBlobGcSweeper sweeper;
  @Autowired private MailAttachmentBlobRepository blobRepo;
  @Autowired private MailAttachmentBlobStore blobStore;
  @Autowired private ContentAttachmentRepository contentAttachmentRepo;
  @Autowired private DSLContext dsl;

  /**
   * @AfterEach 에서 정리할 content_hash 목록.
   */
  private final List<String> seededHashes = new ArrayList<>();

  /**
   * @AfterEach 에서 정리할 디스크 파일 ref.
   */
  private final List<String> seededFileRefs = new ArrayList<>();

  /**
   * @AfterEach 에서 정리할 content_attachment id 목록.
   */
  private final List<Long> seededContentAttachmentIds = new ArrayList<>();

  /**
   * @AfterEach 에서 정리할 email_content id 목록.
   */
  private final List<Long> seededEmailContentIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    // ambient GUC 마스킹 방지
    TenantContext.clear();

    // DB 행 정리 — cleanupInTenant(IntegrationTestBase 헬퍼): GUC 주입 트랜잭션 안에서 삭제
    // FK 역순: content_attachment → email_content 순으로 정리
    if (!seededHashes.isEmpty()
        || !seededContentAttachmentIds.isEmpty()
        || !seededEmailContentIds.isEmpty()) {
      cleanupInTenant(
          T,
          () -> {
            if (!seededHashes.isEmpty()) {
              dsl.deleteFrom(MAIL_ATTACHMENT_BLOB)
                  .where(MAIL_ATTACHMENT_BLOB.CONTENT_HASH.in(seededHashes))
                  .execute();
            }
            if (!seededContentAttachmentIds.isEmpty()) {
              dsl.deleteFrom(CONTENT_ATTACHMENT)
                  .where(CONTENT_ATTACHMENT.ID.in(seededContentAttachmentIds))
                  .execute();
            }
            if (!seededEmailContentIds.isEmpty()) {
              dsl.deleteFrom(EMAIL_CONTENT)
                  .where(EMAIL_CONTENT.ID.in(seededEmailContentIds))
                  .execute();
            }
          });
    }
    // 디스크 파일 best-effort 정리
    for (String ref : seededFileRefs) {
      try {
        Files.deleteIfExists(blobStore.resolve(ref));
      } catch (Exception ignored) {
      }
    }
    seededHashes.clear();
    seededFileRefs.clear();
    seededContentAttachmentIds.clear();
    seededEmailContentIds.clear();
  }

  /** refcount-0 blob — content_attachment 미참조 → sweepTenant 후 DB 행 + 디스크 파일 모두 삭제됨. */
  @Test
  @DisplayName("refcount-0 blob: DB 행 + 디스크 파일 삭제(teeth)")
  void refcount0_blob_행과_파일_삭제() {
    // ── seed: ambient GUC 마스킹 방지 → 먼저 clear
    TenantContext.clear();

    // blobStore.store 는 디스크 파일 기록 → 이후 DB insertIfAbsent(GUC 필요)
    String ref = blobStore.store(T, "orphan-gc-hash", "x".getBytes());
    seededFileRefs.add(ref); // AfterEach 백스톱

    // GUC 주입 트랜잭션 안에서 DB 행 삽입
    TenantContext.set(T);
    new TransactionTemplate(txManager)
        .executeWithoutResult(status -> blobRepo.insertIfAbsent("orphan-gc-hash", ref, 1L));
    seededHashes.add("orphan-gc-hash");

    // blob 행 + 파일 존재 사전 확인
    assertThat(blobRepo.findByHash("orphan-gc-hash")).isPresent();
    assertThat(Files.exists(blobStore.resolve(ref))).isTrue();

    // ── sweepTenant 실행 (GUC 주입 필요)
    // sweepTenant 내부가 txTemplate 으로 GUC 를 자체 주입하므로 TenantContext.set 은 TenantContext 레지스트리용
    TenantContext.set(T);
    try {
      sweeper.sweepTenant();
    } finally {
      TenantContext.clear();
    }

    // ── 검증: DB 행 삭제
    assertThat(blobRepo.findByHash("orphan-gc-hash")).as("refcount-0 blob DB 행이 삭제되어야 함").isEmpty();

    // ── 검증: 디스크 파일 삭제 (teeth)
    assertThat(Files.exists(blobStore.resolve(ref)))
        .as("refcount-0 blob 디스크 파일이 삭제되어야 함 (teeth)")
        .isFalse();

    // 이미 지워졌으므로 AfterEach 정리 목록에서 제거
    seededHashes.remove("orphan-gc-hash");
    seededFileRefs.remove(ref);
  }

  /**
   * 참조 있고(content_attachment.content_hash = H) 최근 접근된 blob → sweepTenant 후 반드시 보존.
   *
   * <p>이 테스트는 "GC 가 살아있는 blob 을 지우면 안 된다"는 핵심 불변을 검증한다. refcount predicate 가 항상-true 버그를 가지거나, TTL
   * 계산이 잘못되어 최근 blob 을 만료시키면 이 테스트가 FAIL 한다.
   *
   * <p>Teeth: blobRepo.findByHash(H) present + Files.exists(file) true.
   */
  @Test
  @DisplayName("참조있고_최근접근_blob_은_보존된다")
  void 참조있고_최근접근_blob_은_보존된다() {
    TenantContext.clear();

    final String H = "retained-referenced-gc-hash-" + System.nanoTime();
    final byte[] data = "keep-me".getBytes();

    // ── 디스크 파일 먼저 기록 (blobStore.store 는 GUC 불필요) ──────────────
    String ref = blobStore.store(T, H, data);
    seededFileRefs.add(ref);

    // ── GUC 주입 트랜잭션 안에서 DB 행 삽입 ──────────────────────────────────
    TenantContext.set(T);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              // 1) email_content 행 (content_attachment FK 부모)
              long contentId =
                  dsl.insertInto(EMAIL_CONTENT)
                      .set(EMAIL_CONTENT.TENANT_ID, T)
                      .set(EMAIL_CONTENT.MESSAGE_ID, "msg-" + H + "@test.local")
                      .set(EMAIL_CONTENT.THREAD_ID, "thread-" + H)
                      .returning(EMAIL_CONTENT.ID)
                      .fetchOne()
                      .getId();
              seededEmailContentIds.add(contentId);

              // 2) content_attachment 행 — content_hash = H (refcount > 0 의 근거)
              long caId =
                  contentAttachmentRepo.findOrCreate(
                      contentId, 0, "keep.txt", "text/plain", (long) data.length, null);
              contentAttachmentRepo.setContentHashIfNull(caId, H);
              seededContentAttachmentIds.add(caId);

              // 3) mail_attachment_blob 행 — last_accessed_at = now() (TTL 미만)
              blobRepo.insertIfAbsent(H, ref, (long) data.length);
            });
    seededHashes.add(H);

    // 사전 확인: blob 행 + 파일 존재
    assertThat(blobRepo.findByHash(H)).as("sweep 전 blob 행 존재").isPresent();
    assertThat(Files.exists(blobStore.resolve(ref))).as("sweep 전 파일 존재").isTrue();

    // ── sweepTenant 실행 ───────────────────────────────────────────────────
    TenantContext.set(T);
    try {
      sweeper.sweepTenant();
    } finally {
      TenantContext.clear();
    }

    // ── 검증: 참조 있고 최근 접근된 blob 은 보존되어야 함 ──────────────────
    assertThat(blobRepo.findByHash(H)).as("참조 있는 최근 blob — DB 행이 보존되어야 함 (teeth)").isPresent();
    assertThat(Files.exists(blobStore.resolve(ref)))
        .as("참조 있는 최근 blob — 디스크 파일이 보존되어야 함 (teeth)")
        .isTrue();
  }

  /** TTL 초과(last_accessed_at 8일 전) blob → evict. */
  @Test
  @DisplayName("TTL 초과 blob(8일 전 접근): DB 행 + 디스크 파일 삭제")
  void ttl_초과_blob_evict() {
    TenantContext.clear();

    String ref = blobStore.store(T, "ttl-expired-gc-hash", "old".getBytes());
    seededFileRefs.add(ref);

    TenantContext.set(T);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              blobRepo.insertIfAbsent("ttl-expired-gc-hash", ref, 3L);
              // last_accessed_at 을 8일 전으로 강제 업데이트
              dsl.execute(
                  "UPDATE mail_attachment_blob SET last_accessed_at = now() - interval '8 days'"
                      + " WHERE content_hash = 'ttl-expired-gc-hash'");
            });
    seededHashes.add("ttl-expired-gc-hash");

    // 파일·DB 행 사전 확인
    assertThat(blobRepo.findByHash("ttl-expired-gc-hash")).isPresent();
    assertThat(Files.exists(blobStore.resolve(ref))).isTrue();

    TenantContext.set(T);
    try {
      sweeper.sweepTenant();
    } finally {
      TenantContext.clear();
    }

    // DB 행 삭제
    assertThat(blobRepo.findByHash("ttl-expired-gc-hash")).as("TTL 초과 blob DB 행 삭제").isEmpty();
    // 디스크 파일 삭제 (teeth)
    assertThat(Files.exists(blobStore.resolve(ref))).as("TTL 초과 blob 디스크 파일 삭제 (teeth)").isFalse();

    seededHashes.remove("ttl-expired-gc-hash");
    seededFileRefs.remove(ref);
  }
}

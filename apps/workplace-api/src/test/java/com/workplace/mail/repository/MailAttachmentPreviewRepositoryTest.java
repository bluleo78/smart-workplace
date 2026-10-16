package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_PREVIEW;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.filepreview.repository.PreviewStateStore.Row;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부 미리보기 상태 저장소(WP-432) 통합 테스트 — 공용 CAS 선점이 (tenant_id, content_hash) 키에서도 맞게 동작하는지, READY 결정적
 * 경로·테넌트 분리·RLS·refcount-0 정리를 본다.
 *
 * <p>클래스 레벨 {@code @Transactional} 없이 기본 테넌트(1)와 다른 fixture 테넌트 둘에 커밋하고 {@code @AfterEach} 에서 자기 행만
 * 지운다({@code FilePreviewRepositoryTest} 패턴).
 */
class MailAttachmentPreviewRepositoryTest extends IntegrationTestBase {

  private static final String TENANT_A_SLUG = "mail-preview-fixture-tenant-a";
  private static final String TENANT_B_SLUG = "mail-preview-fixture-tenant-b";
  private static final Duration LEASE = Duration.ofMinutes(3);
  private static final int MAX_ATTEMPTS = 3;
  private static final Duration COOLDOWN = Duration.ofMinutes(10);

  @Autowired DSLContext dsl;
  @Autowired MailAttachmentPreviewRepository repo;
  @Autowired PlatformTransactionManager txManager;

  private long tidA;
  private long tidB;
  private String hash;
  private MailPreviewKey keyA;
  // @AfterEach 정리용 — 테스트가 만든 해시·email_content.
  private final List<String> hashes = new ArrayList<>();
  private final List<Long> contentIds = new ArrayList<>();

  @BeforeEach
  void seed() {
    tidA = ensureFixtureTenant(TENANT_A_SLUG);
    tidB = ensureFixtureTenant(TENANT_B_SLUG);
    hash = newHash();
    keyA = new MailPreviewKey(tidA, hash);
  }

  @AfterEach
  void cleanup() {
    for (long tid : List.of(tidA, tidB)) {
      inTx(
          tid,
          () -> {
            // content_attachment 는 email_content CASCADE 로 함께 지워진다.
            dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.in(contentIds)).execute();
            return dsl.deleteFrom(MAIL_ATTACHMENT_PREVIEW)
                .where(MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.in(hashes))
                .execute();
          });
    }
    hashes.clear();
    contentIds.clear();
  }

  @Test
  void 행이_없으면_선점되고_CONVERTING_중이면_다시_선점되지_않는다() {
    Optional<OffsetDateTime> token = claim(tidA, keyA, "v1", true);

    assertThat(token).isPresent();
    Row row = find(tidA, keyA).orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.attempts()).isEqualTo(1);
    assertThat(row.leasedUntil()).isEqualTo(token.get());

    assertThat(claim(tidA, keyA, "v1", true)).isEmpty();
    assertThat(find(tidA, keyA).orElseThrow().attempts()).isEqualTo(1);
  }

  @Test
  void 오래된_리스_토큰의_기록은_무시된다() {
    OffsetDateTime tokenA = claim(tidA, keyA, "v1", true).orElseThrow();
    expireLease(tidA);
    OffsetDateTime tokenB = claim(tidA, keyA, "v1", true).orElseThrow();
    assertThat(tokenB).isNotEqualTo(tokenA);

    assertThat(inTx(tidA, () -> repo.isCurrentLease(keyA, tokenA))).isFalse();
    assertThat(inTx(tidA, () -> repo.markReady(keyA, tokenA, 5))).isFalse();
    assertThat(inTx(tidA, () -> repo.markFailed(keyA, tokenA, "BUSY", true))).isFalse();
    assertThat(inTx(tidA, () -> repo.release(keyA, tokenA))).isFalse();
    Row row = find(tidA, keyA).orElseThrow();
    assertThat(row.status()).isEqualTo("CONVERTING");
    assertThat(row.leasedUntil()).isEqualTo(tokenB);
    assertThat(blobPath(tidA)).isNull();
  }

  @Test
  void 일시_FAILED_는_재시도_허용일_때_attempts_3_미만에서만_선점된다() {
    OffsetDateTime token = claim(tidA, keyA, "v1", true).orElseThrow();
    assertThat(inTx(tidA, () -> repo.markFailed(keyA, token, "BUSY", true))).isTrue();

    // 폴링(재시도 비허용)은 FAILED 를 다시 잡지 않는다.
    assertThat(claim(tidA, keyA, "v1", false)).isEmpty();

    setAttempts(tidA, 2);
    OffsetDateTime third = claim(tidA, keyA, "v1", true).orElseThrow();
    assertThat(find(tidA, keyA).orElseThrow().attempts()).isEqualTo(3);

    assertThat(inTx(tidA, () -> repo.markFailed(keyA, third, "TIMEOUT", true))).isTrue();
    assertThat(claim(tidA, keyA, "v1", true)).isEmpty();
    Row row = find(tidA, keyA).orElseThrow();
    assertThat(row.status()).isEqualTo("FAILED");
    assertThat(row.failureCode()).isEqualTo("TIMEOUT");
    assertThat(row.failureTransient()).isTrue();
  }

  @Test
  void markReady_는_blob_path_를_결정적_경로로_채운다() {
    OffsetDateTime token = claim(tidA, keyA, "v1", true).orElseThrow();

    assertThat(inTx(tidA, () -> repo.markReady(keyA, token, 4))).isTrue();

    Row row = find(tidA, keyA).orElseThrow();
    assertThat(row.status()).isEqualTo("READY");
    assertThat(row.pageCount()).isEqualTo(4);
    String expected =
        "tenant-" + tidA + "/mail-preview/" + hash.substring(0, 2) + "/" + hash + ".enc";
    assertThat(keyA.previewRef()).isEqualTo(expected);
    assertThat(blobPath(tidA)).isEqualTo(expected);
  }

  @Test
  void 같은_해시라도_테넌트가_다르면_행이_따로다() {
    MailPreviewKey keyB = new MailPreviewKey(tidB, hash);

    assertThat(claim(tidA, keyA, "v1", true)).isPresent();
    assertThat(claim(tidB, keyB, "v1", true)).isPresent();

    assertThat(find(tidA, keyA)).isPresent();
    assertThat(find(tidB, keyB)).isPresent();
  }

  @Test
  void 다른_테넌트_GUC_로는_행이_보이지_않는다() {
    assertThat(claim(tidA, keyA, "v1", true)).isPresent();

    assertThat(find(tidB, keyA)).isEmpty();
    assertThat(find(1L, keyA)).isEmpty();
    assertThat(find(tidA, keyA)).isPresent();
  }

  @Test
  void deleteUnreferenced_는_참조가_남은_해시를_지우지_않는다() {
    String hashB = newHash();
    MailPreviewKey keyB = new MailPreviewKey(tidA, hashB);
    // 해시 A 는 content_attachment 가 참조하고, 해시 B 는 참조가 없다. 둘 다 READY.
    insertAttachment(tidA, hash);
    OffsetDateTime tokenA = claim(tidA, keyA, "v1", true).orElseThrow();
    assertThat(inTx(tidA, () -> repo.markReady(keyA, tokenA, 1))).isTrue();
    OffsetDateTime tokenB = claim(tidA, keyB, "v1", true).orElseThrow();
    assertThat(inTx(tidA, () -> repo.markReady(keyB, tokenB, 1))).isTrue();
    // 다른 테넌트의 같은 해시 B 행은 이 테넌트 정리에서 건드리지 않는다(RLS).
    assertThat(claim(tidB, new MailPreviewKey(tidB, hashB), "v1", true)).isPresent();

    List<String> deleted = inTx(tidA, () -> repo.deleteUnreferenced(List.of(hash, hashB)));

    assertThat(deleted).containsExactly(keyB.previewRef());
    assertThat(find(tidA, keyA)).isPresent();
    assertThat(find(tidA, keyB)).isEmpty();
    assertThat(find(tidB, new MailPreviewKey(tidB, hashB))).isPresent();
    assertThat(inTx(tidA, () -> repo.deleteUnreferenced(List.of()))).isEmpty();
  }

  @Test
  void deleteAllUnreferenced_는_유효_리스의_CONVERTING_을_남긴다() {
    // 참조 없는 READY 행 하나와 참조 없는 진행 중(유효 리스) 행 하나.
    OffsetDateTime token = claim(tidA, keyA, "v1", true).orElseThrow();
    assertThat(inTx(tidA, () -> repo.markReady(keyA, token, 1))).isTrue();
    MailPreviewKey converting = new MailPreviewKey(tidA, newHash());
    assertThat(claim(tidA, converting, "v1", true)).isPresent();

    List<String> deleted = inTx(tidA, () -> repo.deleteAllUnreferenced());

    assertThat(deleted).contains(keyA.previewRef());
    assertThat(find(tidA, keyA)).isEmpty();
    assertThat(find(tidA, converting)).isPresent();
  }

  @Test
  void deleteAllUnreferenced_는_참조가_남은_행을_지우지_않는다() {
    insertAttachment(tidA, hash);
    OffsetDateTime token = claim(tidA, keyA, "v1", true).orElseThrow();
    assertThat(inTx(tidA, () -> repo.markReady(keyA, token, 1))).isTrue();

    List<String> deleted = inTx(tidA, () -> repo.deleteAllUnreferenced());

    assertThat(deleted).doesNotContain(keyA.previewRef());
    assertThat(find(tidA, keyA)).isPresent();
  }

  @Test
  void deleteAllUnreferenced_는_리스가_끝난_CONVERTING_을_지운다() {
    // 변환 중 API 가 죽어 리스가 끝난 CONVERTING — 진행 중이 아니므로 참조가 없으면 지운다.
    assertThat(claim(tidA, keyA, "v1", true)).isPresent();
    expireLease(tidA);

    inTx(tidA, () -> repo.deleteAllUnreferenced());

    // blob_path 가 NULL 이라 반환 목록에는 없다 — 행 존재로 판정한다.
    assertThat(find(tidA, keyA)).isEmpty();
  }

  // ── helpers ──

  private Optional<OffsetDateTime> claim(
      long tid, MailPreviewKey key, String engineVersion, boolean allowFailedRetry) {
    return inTx(
        tid,
        () -> repo.claim(key, tid, engineVersion, LEASE, MAX_ATTEMPTS, COOLDOWN, allowFailedRetry));
  }

  private Optional<Row> find(long tid, MailPreviewKey key) {
    return inTx(tid, () -> repo.find(key));
  }

  private String blobPath(long tid) {
    return inTx(
        tid,
        () ->
            dsl.select(MAIL_ATTACHMENT_PREVIEW.BLOB_PATH)
                .from(MAIL_ATTACHMENT_PREVIEW)
                .where(MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.eq(hash))
                .fetchOne(MAIL_ATTACHMENT_PREVIEW.BLOB_PATH));
  }

  /** 리스를 1초 전으로 당겨 "변환 중 API 가 죽은" CONVERTING 을 만든다. */
  private void expireLease(long tid) {
    inTx(
        tid,
        () ->
            dsl.update(MAIL_ATTACHMENT_PREVIEW)
                .set(
                    MAIL_ATTACHMENT_PREVIEW.LEASED_UNTIL,
                    DSL.field("now() - interval '1 second'", OffsetDateTime.class))
                .where(MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.eq(hash))
                .execute());
  }

  private void setAttempts(long tid, int attempts) {
    inTx(
        tid,
        () ->
            dsl.update(MAIL_ATTACHMENT_PREVIEW)
                .set(MAIL_ATTACHMENT_PREVIEW.ATTEMPTS, attempts)
                .where(MAIL_ATTACHMENT_PREVIEW.CONTENT_HASH.eq(hash))
                .execute());
  }

  /** 해시를 참조하는 email_content + content_attachment 한 벌을 만든다. */
  private void insertAttachment(long tid, String contentHash) {
    String nano = UUID.randomUUID().toString();
    inTx(
        tid,
        () -> {
          long contentId =
              dsl.insertInto(EMAIL_CONTENT)
                  .set(EMAIL_CONTENT.TENANT_ID, tid)
                  .set(EMAIL_CONTENT.MESSAGE_ID, "msg-preview-" + nano + "@test.local")
                  .set(EMAIL_CONTENT.THREAD_ID, "thread-preview-" + nano)
                  .returning(EMAIL_CONTENT.ID)
                  .fetchOne()
                  .getId();
          contentIds.add(contentId);
          return dsl.insertInto(CONTENT_ATTACHMENT)
              .set(CONTENT_ATTACHMENT.TENANT_ID, tid)
              .set(CONTENT_ATTACHMENT.CONTENT_ID, contentId)
              .set(CONTENT_ATTACHMENT.ORDINAL, 0)
              .set(CONTENT_ATTACHMENT.FILENAME, "보고서.hwp")
              .set(CONTENT_ATTACHMENT.CONTENT_TYPE, "application/x-hwp")
              .set(CONTENT_ATTACHMENT.SIZE_BYTES, 100L)
              .set(CONTENT_ATTACHMENT.CONTENT_HASH, contentHash)
              .execute();
        });
  }

  /** 테스트마다 다른 64자 hex 해시 — 정리 목록에 올린다. */
  private String newHash() {
    String h = (UUID.randomUUID().toString() + UUID.randomUUID().toString()).replace("-", "");
    hashes.add(h);
    return h;
  }

  /** 주어진 테넌트 GUC 가 심긴 트랜잭션에서 실행·커밋한다. */
  private <T> T inTx(long tenantId, Supplier<T> body) {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
              return body.get();
            });
  }
}

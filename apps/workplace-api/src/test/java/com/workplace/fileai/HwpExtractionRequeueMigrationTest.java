package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;

import com.workplace.jooq.tables.records.FileExtractionRecord;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import org.assertj.core.api.SoftAssertions;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;

/**
 * V184(WP-433) — LibreOffice 내장 필터가 HWP5 를 열지 못해 추출 실패·빈 텍스트로 SKIPPED 에 굳은 {@code .hwp} 행을
 * converter 추출로 한 번 다시 시도하도록 PENDING 으로 되돌리는 데이터 정리.
 *
 * <p>Testcontainers 는 빈 DB 에서 마이그레이션을 돌려 대상이 없으므로, 옛 상태 행을 시드한 뒤 같은 SQL 파일을 런타임 롤(app_tenant, 테넌트 1
 * GUC)로 다시 실행해 결과를 본다(V174 ImageMimeBackfillMigrationTest 관례). {@code inRollbackTx} 가 테넌트 1 로 같은 롤의
 * 트랜잭션을 열고 끝에 롤백하므로 시드·재실행·확인이 한 트랜잭션 안에서 이뤄지고 정리가 따로 필요 없다. 운영의 Flyway 유저는 BYPASSRLS 라 전 테넌트에 같은
 * 조건이 적용된다. 메일 추출 사본·oversize·HWPX·다른 레거시 형식·정상/요약실패 행은 건드리지 않아야 하고, 두 번 돌려도 결과가 같아야 한다.
 */
class HwpExtractionRequeueMigrationTest extends IntegrationTestBase {

  private static final long TENANT = 1L;
  private static final String MIGRATION = "db/migration/V184__hwp_extraction_requeue.sql";
  private static final String HWP = "application/x-hwp";

  @Autowired DSLContext dsl;

  /** 현재 시나리오의 업로더 — inRollbackTx 안에서 시드하고 함께 롤백된다. */
  private Long userId;

  @Test
  void 추출_실패나_빈_텍스트로_굳은_hwp_행은_PENDING_으로_돌아간다() {
    inRollbackTx(
        soft -> {
          userId = createAgentUser("v183");
          long failed =
              seed("a.hwp", HWP, "DOCUMENT", "SKIPPED", "extract-error:soffice 변환 실패 rc=1", "FULL");
          long empty = seed("b.hwp", HWP, "DOCUMENT", "SKIPPED", "empty", "FULL");
          // category null = 레거시 행 — IS DISTINCT FROM 이 NULL 도 대상으로 잡는지 확인.
          long emptyText = seed("c.hwp", HWP, null, "SKIPPED", "empty-text:DONE", "TEXT_ONLY");
          // WP-242 이전(#735~)엔 워커 실패가 extract-error: 접두 없이 저장됐다.
          long legacySoffice =
              seed("h.hwp", HWP, "DOCUMENT", "SKIPPED", "soffice 변환 실패 rc=1", "FULL");
          // #735 이전엔 HWP 를 추출 대상으로 보지 않아 한 번도 추출되지 않았다.
          long neverExtracted =
              seed(
                  "i.hwp",
                  HWP,
                  "DOCUMENT",
                  "SKIPPED",
                  "unsupported-mime:application/x-hwp",
                  "FULL");
          long nullError = seed("j.hwp", HWP, "DOCUMENT", "SKIPPED", null, "FULL");

          runMigration();

          for (long id :
              List.of(failed, empty, emptyText, legacySoffice, neverExtracted, nullError)) {
            assertRequeued(soft, row(id));
          }
        });
  }

  @Test
  void 대상이_아닌_행은_그대로_둔다() {
    inRollbackTx(
        soft -> {
          userId = createAgentUser("v183");
          // 메일 평문 사본은 확정 직후 바이너리가 지워져 재추출하면 FileNotFound 로 사유만 덮어쓴다.
          long mailCopy =
              seed("m.hwp", HWP, "MAIL_EXTRACT", "SKIPPED", "extract-error:x", "TEXT_ONLY");
          long oversize = seed("big.hwp", HWP, "DOCUMENT", "SKIPPED", "oversize", "FULL");
          long hwpx =
              seed(
                  "d.hwpx",
                  "application/hwp+zip",
                  "DOCUMENT",
                  "SKIPPED",
                  "extract-error:x",
                  "FULL");
          long doc =
              seed("e.doc", "application/msword", "DOCUMENT", "SKIPPED", "extract-error:x", "FULL");
          long image = seed("k.hwp", HWP, "DOCUMENT", "SKIPPED", "image:application/x-hwp", "FULL");
          long nonExtractable =
              seed("l.hwp", HWP, "DOCUMENT", "SKIPPED", "non-extractable:OTHER", "FULL");
          // HWP 가 아닌 형식으로 미지원 판정된 사유는 형식 탓이라 다시 돌려도 같다.
          long otherUnsupported =
              seed("n.hwp", HWP, "DOCUMENT", "SKIPPED", "unsupported-mime:application/zip", "FULL");
          long ok = seed("f.hwp", HWP, "DOCUMENT", "TEXT_READY", null, "FULL");
          // DB 의 FAILED 는 요약 상한 소진 전용 — 텍스트는 이미 있었으므로 대상 아님.
          long summaryFailed = seed("g.hwp", HWP, "DOCUMENT", "FAILED", "summary-error", "FULL");

          runMigration();

          FileExtractionRecord mail = row(mailCopy);
          soft.assertThat(mail.getStatus()).isEqualTo("SKIPPED");
          soft.assertThat(mail.getError()).isEqualTo("extract-error:x");
          soft.assertThat(mail.getAttempts()).isEqualTo(2);
          FileExtractionRecord over = row(oversize);
          soft.assertThat(over.getStatus()).isEqualTo("SKIPPED");
          soft.assertThat(over.getError()).isEqualTo("oversize");
          for (long id : List.of(image, nonExtractable, otherUnsupported)) {
            FileExtractionRecord r = row(id);
            soft.assertThat(r.getStatus()).isEqualTo("SKIPPED");
            soft.assertThat(r.getAttempts()).isEqualTo(2);
          }
          soft.assertThat(row(image).getError()).isEqualTo("image:application/x-hwp");
          soft.assertThat(row(nonExtractable).getError()).isEqualTo("non-extractable:OTHER");
          soft.assertThat(row(otherUnsupported).getError())
              .isEqualTo("unsupported-mime:application/zip");
          soft.assertThat(row(hwpx).getStatus()).isEqualTo("SKIPPED");
          soft.assertThat(row(doc).getStatus()).isEqualTo("SKIPPED");
          soft.assertThat(row(ok).getStatus()).isEqualTo("TEXT_READY");
          FileExtractionRecord sf = row(summaryFailed);
          soft.assertThat(sf.getStatus()).isEqualTo("FAILED");
          soft.assertThat(sf.getError()).isEqualTo("summary-error");
        });
  }

  @Test
  void 두_번_실행해도_결과가_같다() {
    inRollbackTx(
        soft -> {
          userId = createAgentUser("v183");
          long failed = seed("a.hwp", HWP, "DOCUMENT", "SKIPPED", "extract-error:x", "FULL");
          long legacy = seed("b.hwp", HWP, "DOCUMENT", "SKIPPED", "soffice 산출물 없음", "FULL");
          long oversize = seed("c.hwp", HWP, "DOCUMENT", "SKIPPED", "oversize", "FULL");

          runMigration();
          runMigration();

          soft.assertThat(row(legacy).getStatus()).isEqualTo("PENDING");
          FileExtractionRecord over = row(oversize);
          soft.assertThat(over.getStatus()).isEqualTo("SKIPPED");
          soft.assertThat(over.getError()).isEqualTo("oversize");
          assertRequeued(soft, row(failed));
        });
  }

  // ── 헬퍼 ──

  /** 재큐된 행 — PENDING·사유/리스 비움·시도 횟수 0. */
  private static void assertRequeued(SoftAssertions soft, FileExtractionRecord r) {
    soft.assertThat(r.getStatus()).isEqualTo("PENDING");
    soft.assertThat(r.getError()).isNull();
    soft.assertThat(r.getAttempts()).isZero();
    soft.assertThat(r.getLeasedUntil()).isNull();
  }

  /** 마이그레이션 SQL 을 현재 트랜잭션(런타임 롤·테넌트 1 GUC)에서 다시 실행한다. */
  private void runMigration() {
    try {
      dsl.execute(new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** 옛 상태 흉내 — file 행과 추출 행(시도 2회·리스 잡힌 채로 굳은 값까지 채운다). */
  private long seed(
      String name, String mime, String category, String status, String error, String profile) {
    String suffix = String.valueOf(System.nanoTime());
    long id =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, name)
            .set(FILE.STORED_NAME, "f-" + suffix)
            .set(FILE.MIME_TYPE, mime)
            .set(FILE.CATEGORY, category)
            .set(FILE.SIZE_BYTES, 10L)
            .set(FILE.STORAGE_PATH, "x/f-" + suffix)
            .set(FILE.UPLOADED_BY, userId)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, id)
        .set(FILE_EXTRACTION.STATUS, status)
        .set(FILE_EXTRACTION.ERROR, error)
        .set(FILE_EXTRACTION.PROFILE, profile)
        .set(FILE_EXTRACTION.ATTEMPTS, 2)
        .set(FILE_EXTRACTION.LEASED_UNTIL, OffsetDateTime.now())
        .set(FILE_EXTRACTION.TENANT_ID, TENANT)
        .execute();
    return id;
  }

  /** 추출 행을 한 번에 읽는다. */
  private FileExtractionRecord row(long fileId) {
    return dsl.fetchOne(FILE_EXTRACTION, FILE_EXTRACTION.FILE_ID.eq(fileId));
  }
}

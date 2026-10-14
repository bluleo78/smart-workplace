package com.workplace.fileai;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.service.ExtractedTextService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V172(WP-250) — 확장자 매핑이 생기기 전에 octet-stream·빈 값으로 저장된 HEIC·TIFF·BMP 사진을 새 업로드와 같은 이미지 mime·추출 사유로
 * 바로잡는 데이터 정리.
 *
 * <p>Testcontainers 는 빈 DB 에서 마이그레이션을 돌려 정리 대상이 없으므로, 옛 상태 행을 시드한 뒤 같은 SQL 파일을 다시 실행해 결과를 본다(V147
 * StaleNeedsReplyMigrationTest 관례). 바뀐 뒤 구간 읽기가 사유 코드 IMAGE 를 내는지도 함께 확인한다 — 도구가 이 값으로 이미지 길을 고른다.
 */
class ImageMimeBackfillMigrationTest extends IntegrationTestBase {

  private static final long TENANT = 1L;
  private static final String MIGRATION = "db/migration/V172__file_image_mime_backfill.sql";

  @Autowired DSLContext dsl;
  @Autowired ExtractedTextService texts;

  private final List<Long> fileIds = new ArrayList<>();
  private Long userId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT);
    String suffix = String.valueOf(System.nanoTime());
    userId =
        tx().execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "v172-" + suffix)
                        .set(USER.NAME, "V172")
                        .set(USER.EMAIL, "v172-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
  }

  @AfterEach
  void tearDown() {
    tx().executeWithoutResult(
            s -> {
              dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(fileIds)).execute();
              dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
              dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
            });
    fileIds.clear();
    TenantContext.clear();
  }

  @Test
  void 옛_octet_stream_사진은_이미지_mime_과_IMAGE_사유로_바뀐다() throws IOException {
    long heic =
        seed(
            "IMG_0001.HEIC",
            "application/octet-stream",
            "unsupported-mime:application/octet-stream");
    long tiff = seed("scan.tiff", "application/octet-stream; charset=binary", "unsupported-mime:x");
    long tif = seed("scan.tif", "", "unsupported-mime:");
    long heif = seed("a.heif", "application/octet-stream", "non-extractable:OTHER");
    long bmp =
        seed("pic.bmp", "application/octet-stream", "unsupported-mime:application/octet-stream");

    runMigration();

    assertThat(mime(heic)).isEqualTo("image/heic");
    assertThat(mime(tiff)).isEqualTo("image/tiff");
    assertThat(mime(tif)).isEqualTo("image/tiff");
    assertThat(mime(heif)).isEqualTo("image/heif");
    assertThat(mime(bmp)).isEqualTo("image/bmp");
    // 새 업로드 이미지와 같은 원시 사유(ExtractableTypes.skipReason) — 상태는 SKIPPED 그대로.
    assertThat(error(heic)).isEqualTo("image:image/heic");
    assertThat(error(heif)).isEqualTo("image:image/heif");
    ExtractedTextSlice slice = texts.read(heic, 0, 10);
    assertThat(slice.status()).isEqualTo("SKIPPED");
    assertThat(slice.reasonCode()).isEqualTo("IMAGE");
  }

  @Test
  void 대상이_아닌_행은_그대로_둔다() throws IOException {
    // 이미지가 아닌 확장자, 브라우저가 준 구체적 mime(이름과 달라도 신뢰), 형식 미지원이 아닌 사유.
    long zip =
        seed("bundle.zip", "application/octet-stream", "unsupported-mime:application/octet-stream");
    long png = seed("a.heic", "image/png", "image:image/png");
    long oversize = seed("big.heic", "application/octet-stream", "oversize");

    runMigration();

    assertThat(mime(zip)).isEqualTo("application/octet-stream");
    assertThat(error(zip)).isEqualTo("unsupported-mime:application/octet-stream");
    assertThat(mime(png)).isEqualTo("image/png");
    assertThat(error(png)).isEqualTo("image:image/png");
    // 크기 초과 사유는 바꾸지 않는다 — mime 만 바로잡힌다.
    assertThat(mime(oversize)).isEqualTo("image/heic");
    assertThat(error(oversize)).isEqualTo("oversize");
  }

  // ── 헬퍼 ──

  private TransactionTemplate tx() {
    return new TransactionTemplate(txManager);
  }

  private void runMigration() throws IOException {
    String sql = new ClassPathResource(MIGRATION).getContentAsString(StandardCharsets.UTF_8);
    tx().executeWithoutResult(s -> dsl.execute(sql));
  }

  /** 옛 업로드 흉내 — file 행과 SKIPPED 추출 행. */
  private long seed(String name, String mime, String error) {
    String suffix = String.valueOf(System.nanoTime());
    long id =
        tx().execute(
                s ->
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, name)
                        .set(FILE.STORED_NAME, "f-" + suffix)
                        .set(FILE.MIME_TYPE, mime)
                        .set(FILE.SIZE_BYTES, 10L)
                        .set(FILE.STORAGE_PATH, "x/f-" + suffix)
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId());
    fileIds.add(id);
    tx().executeWithoutResult(
            s ->
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, id)
                    .set(FILE_EXTRACTION.STATUS, "SKIPPED")
                    .set(FILE_EXTRACTION.ERROR, error)
                    .set(FILE_EXTRACTION.PROFILE, "TEXT_ONLY")
                    .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                    .execute());
    return id;
  }

  private String mime(long fileId) {
    return tx().execute(
            s ->
                dsl.select(FILE.MIME_TYPE)
                    .from(FILE)
                    .where(FILE.ID.eq(fileId))
                    .fetchOne()
                    .value1());
  }

  private String error(long fileId) {
    return tx().execute(
            s ->
                dsl.select(FILE_EXTRACTION.ERROR)
                    .from(FILE_EXTRACTION)
                    .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
                    .fetchOne()
                    .value1());
  }
}

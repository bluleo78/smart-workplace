package com.workplace.fileai.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.dto.ExtractionInfo;
import com.workplace.fileai.exception.InvalidTextRangeException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/** WP-242: 추출 텍스트 구간 읽기·상태 매핑·사유 검증. 서비스는 자체 readOnly 트랜잭션으로 RLS GUC 를 받는다. */
class ExtractedTextServiceTest extends IntegrationTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired ExtractedTextService service;

  private final List<Long> fileIds = new ArrayList<>();
  private Long userId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT);
    String suffix = String.valueOf(System.nanoTime());
    userId =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(USER)
                        .set(USER.USERNAME, "ets-" + suffix)
                        .set(USER.NAME, "ETS")
                        .set(USER.EMAIL, "ets-" + suffix + "@example.com")
                        .set(USER.KIND, "HUMAN")
                        .returning(USER.ID)
                        .fetchOne()
                        .getId());
  }

  @AfterEach
  void tearDown() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s -> {
              dsl.deleteFrom(FILE_EXTRACTION).where(FILE_EXTRACTION.FILE_ID.in(fileIds)).execute();
              dsl.deleteFrom(FILE).where(FILE.ID.in(fileIds)).execute();
              dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
            });
    fileIds.clear();
    TenantContext.clear();
  }

  @Test
  void 처음_구간과_nextOffset() {
    long id = seed("application/pdf", "DONE", "abcdefghij", false, null);
    ExtractedTextSlice s = service.read(id, 0, 4);
    assertThat(s.status()).isEqualTo("READY");
    assertThat(s.text()).isEqualTo("abcd");
    assertThat(s.totalChars()).isEqualTo(10);
    assertThat(s.nextOffset()).isEqualTo(4);
  }

  @Test
  void 마지막_구간이면_nextOffset_null_끝을_넘으면_빈_텍스트() {
    long id = seed("text/plain", "DONE", "abcdefghij", false, null);
    assertThat(service.read(id, 8, 4).text()).isEqualTo("ij");
    assertThat(service.read(id, 8, 4).nextOffset()).isNull();
    ExtractedTextSlice past = service.read(id, 50, 4);
    assertThat(past.text()).isEmpty();
    assertThat(past.nextOffset()).isNull();
    assertThat(past.totalChars()).isEqualTo(10);
  }

  @Test
  void limit_은_32000으로_클램프되고_잘못된_범위는_400() {
    long id = seed("text/plain", "DONE", "x".repeat(40_000), false, null);
    ExtractedTextSlice s = service.read(id, 0, 100_000);
    assertThat(s.text()).hasSize(32_000);
    assertThat(s.nextOffset()).isEqualTo(32_000);
    assertThatThrownBy(() -> service.read(id, -1, 10)).isInstanceOf(InvalidTextRangeException.class);
    assertThatThrownBy(() -> service.read(id, 0, 0)).isInstanceOf(InvalidTextRangeException.class);
  }

  @Test
  void 이모지가_있어도_구간을_이어_붙이면_원문과_같다() {
    // 코드포인트 기준(SQL substr) — Java UTF-16 기준으로 자르면 서로게이트가 반으로 갈라진다.
    String text = "가😀나😀다😀라";
    long id = seed("text/plain", "DONE", text, false, null);
    StringBuilder sb = new StringBuilder();
    Integer offset = 0;
    while (offset != null) {
      ExtractedTextSlice s = service.read(id, offset, 3);
      sb.append(s.text());
      offset = s.nextOffset();
    }
    assertThat(sb.toString()).isEqualTo(text);
    assertThat(service.read(id, 0, 1).totalChars()).isEqualTo(text.codePointCount(0, text.length()));
  }

  @Test
  void truncated_전달() {
    long id = seed("text/plain", "DONE", "abc", true, null);
    assertThat(service.read(id, 0, 10).truncated()).isTrue();
  }

  @Test
  void 추출_중이면_PENDING_텍스트_없음() {
    long id = seed("application/pdf", "EXTRACTING", null, false, null);
    ExtractedTextSlice s = service.read(id, 0, 10);
    assertThat(s.status()).isEqualTo("PENDING");
    assertThat(s.text()).isNull();
    assertThat(s.nextOffset()).isNull();
  }

  @Test
  void TEXT_READY_와_SUMMARIZING_도_READY() {
    assertThat(service.read(seed("text/plain", "TEXT_READY", "ab", false, null), 0, 10).status()).isEqualTo("READY");
    assertThat(service.read(seed("text/plain", "SUMMARIZING", "ab", false, null), 0, 10).status()).isEqualTo("READY");
  }

  @Test
  void 스캔_PDF_사유() {
    long id = seed("application/pdf", "SKIPPED", null, false, "empty");
    ExtractedTextSlice s = service.read(id, 0, 10);
    assertThat(s.status()).isEqualTo("SKIPPED");
    assertThat(s.reasonCode()).isEqualTo("SCANNED_PDF");
    assertThat(s.reason()).isEqualTo("스캔된 PDF로 보여 읽을 수 있는 글자가 없습니다.");
  }

  @Test
  void 추출_행이_없으면_NONE() {
    long id = seedFileOnly("application/pdf");
    assertThat(service.read(id, 0, 10).status()).isEqualTo("NONE");
  }

  @Test
  void 목록용_info_는_행이_있는_파일만_담는다() {
    long ready = seed("text/plain", "DONE", "abc", false, null);
    long image = seed("image/png", "SKIPPED", null, false, "image:image/png");
    long none = seedFileOnly("application/pdf");
    Map<Long, ExtractionInfo> m = service.info(List.of(ready, image, none));
    assertThat(m.get(ready).status()).isEqualTo("READY");
    assertThat(m.get(ready).totalChars()).isEqualTo(3);
    assertThat(m.get(image).reasonCode()).isEqualTo("IMAGE");
    assertThat(m).doesNotContainKey(none);
    assertThat(service.info(List.of())).isEmpty();
  }

  // ── 헬퍼 ──
  private long seed(String mime, String status, String text, boolean truncated, String error) {
    long id = seedFileOnly(mime);
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            s ->
                dsl.insertInto(FILE_EXTRACTION)
                    .set(FILE_EXTRACTION.FILE_ID, id)
                    .set(FILE_EXTRACTION.STATUS, status)
                    .set(FILE_EXTRACTION.EXTRACTED_TEXT, text)
                    .set(FILE_EXTRACTION.CHAR_COUNT, text == null ? null : text.codePointCount(0, text.length()))
                    .set(FILE_EXTRACTION.TRUNCATED, truncated)
                    .set(FILE_EXTRACTION.ERROR, error)
                    .set(FILE_EXTRACTION.PROFILE, "TEXT_ONLY")
                    .set(FILE_EXTRACTION.TENANT_ID, TENANT)
                    .execute());
    return id;
  }

  private long seedFileOnly(String mime) {
    String suffix = String.valueOf(System.nanoTime());
    long id =
        new TransactionTemplate(txManager)
            .execute(
                s ->
                    dsl.insertInto(FILE)
                        .set(FILE.ORIGINAL_NAME, "f-" + suffix)
                        .set(FILE.STORED_NAME, "f-" + suffix)
                        .set(FILE.MIME_TYPE, mime)
                        .set(FILE.SIZE_BYTES, 10L)
                        .set(FILE.STORAGE_PATH, "x/f-" + suffix)
                        .set(FILE.UPLOADED_BY, userId)
                        .returning(FILE.ID)
                        .fetchOne()
                        .getId());
    fileIds.add(id);
    return id;
  }
}

package com.workplace.fileai;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.fileai.ExtractionReasons.Code;
import org.junit.jupiter.api.Test;

/** file_extraction.error 원시값 → 사유 코드·사용자 문구 변환 검증(WP-242). DB 없이 도는 순수 단위 테스트. */
class ExtractionReasonsTest {

  @Test
  void 진행_중이거나_읽을_수_있으면_사유가_없다() {
    assertThat(ExtractionReasons.classify("PENDING", null, "application/pdf")).isNull();
    assertThat(ExtractionReasons.classify("DONE", null, "application/pdf")).isNull();
  }

  @Test
  void SKIPPED_원시값을_코드로_분류한다() {
    assertThat(ExtractionReasons.classify("SKIPPED", "image:image/png", "image/png")).isEqualTo(Code.IMAGE);
    assertThat(ExtractionReasons.classify("SKIPPED", "unsupported-mime:application/zip", "application/zip"))
        .isEqualTo(Code.UNSUPPORTED_TYPE);
    assertThat(ExtractionReasons.classify("SKIPPED", "non-extractable:OTHER", "x/y"))
        .isEqualTo(Code.UNSUPPORTED_TYPE);
    assertThat(ExtractionReasons.classify("SKIPPED", "oversize", "application/pdf")).isEqualTo(Code.TOO_LARGE);
    assertThat(ExtractionReasons.classify("SKIPPED", "extract-error:boom", "application/pdf"))
        .isEqualTo(Code.EXTRACTION_ERROR);
    // 과거 행: 워커 예외 메시지가 접두 없이 남아 있다 → 알 수 없는 값은 추출 오류로 본다.
    assertThat(ExtractionReasons.classify("SKIPPED", "Traceback ...", "text/plain"))
        .isEqualTo(Code.EXTRACTION_ERROR);
  }

  @Test
  void 빈_텍스트는_PDF면_스캔_PDF_아니면_EMPTY() {
    assertThat(ExtractionReasons.classify("SKIPPED", "empty", "application/pdf")).isEqualTo(Code.SCANNED_PDF);
    assertThat(ExtractionReasons.classify("SKIPPED", "empty-text:DONE", "application/pdf"))
        .isEqualTo(Code.SCANNED_PDF);
    assertThat(ExtractionReasons.classify("SKIPPED", "empty", "text/plain")).isEqualTo(Code.EMPTY);
    assertThat(ExtractionReasons.classify("SKIPPED", "empty", null)).isEqualTo(Code.EMPTY);
  }

  @Test
  void FAILED_는_요약_실패() {
    assertThat(ExtractionReasons.classify("FAILED", "timeout", "application/pdf")).isEqualTo(Code.SUMMARY_FAILED);
  }

  @Test
  void 모든_코드에_사용자_문구가_있다() {
    for (Code c : Code.values()) {
      assertThat(ExtractionReasons.message(c)).isNotBlank();
    }
    assertThat(ExtractionReasons.message(Code.SCANNED_PDF)).isEqualTo("스캔된 PDF로 보여 읽을 수 있는 글자가 없습니다.");
    assertThat(ExtractionReasons.message(null)).isNull();
  }
}

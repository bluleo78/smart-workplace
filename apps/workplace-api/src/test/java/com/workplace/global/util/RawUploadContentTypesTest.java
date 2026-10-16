package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.util.RawUploadContentTypes.Rejection;
import org.junit.jupiter.api.Test;

/**
 * RawUploadContentTypes — 드라이브·스테이징 업로드 링크가 함께 쓰는 원시 PUT Content-Type 규칙. 없음·정상 MIME 은 받고, 폼·멀티파트와
 * 깨진·와일드카드 값은 사유별로 거부하며, 매개변수를 뗀 소문자 MIME 을 돌려준다.
 */
class RawUploadContentTypesTest {

  @Test
  void 없거나_정상_MIME_은_받는다() {
    assertThat(RawUploadContentTypes.rejectReason(null)).isEmpty();
    assertThat(RawUploadContentTypes.rejectReason("  ")).isEmpty();
    assertThat(RawUploadContentTypes.rejectReason("text/plain; charset=utf-8")).isEmpty();
    assertThat(RawUploadContentTypes.rejectReason("application/pdf")).isEmpty();
  }

  @Test
  void 폼_멀티파트는_원시_바이트_안내로_거부() {
    assertThat(RawUploadContentTypes.rejectReason("application/x-www-form-urlencoded"))
        .contains(Rejection.FORM_OR_MULTIPART);
    assertThat(RawUploadContentTypes.rejectReason("Multipart/Form-Data; boundary=x"))
        .contains(Rejection.FORM_OR_MULTIPART);
    assertThat(Rejection.FORM_OR_MULTIPART.message()).contains("curl -T");
  }

  @Test
  void 깨졌거나_와일드카드면_내려받을_수_없어_거부() {
    for (String ct : new String[] {"text", "*/*", "text/*", ";x"}) {
      assertThat(RawUploadContentTypes.rejectReason(ct)).as(ct).contains(Rejection.UNSERVABLE);
    }
    assertThat(Rejection.UNSERVABLE.message()).contains("Content-Type");
  }

  @Test
  void bare_는_매개변수를_떼고_소문자_빈_본체는_null() {
    assertThat(RawUploadContentTypes.bare("Text/Markdown; charset=UTF-8"))
        .isEqualTo("text/markdown");
    assertThat(RawUploadContentTypes.bare(null)).isNull();
    assertThat(RawUploadContentTypes.bare(" ")).isNull();
    assertThat(RawUploadContentTypes.bare(";x")).isNull();
  }
}

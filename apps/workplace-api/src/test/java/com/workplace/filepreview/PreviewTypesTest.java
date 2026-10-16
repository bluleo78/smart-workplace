package com.workplace.filepreview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 미리보기(서버 변환 PDF) 대상 형식 판정(WP-431) — 별칭·파라미터·범용 mime 의 확장자 폴백. */
class PreviewTypesTest {

  private static final String PPTX =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  @Test
  void HWP_정규형과_별칭은_x_hwp_로() {
    assertThat(PreviewTypes.targetMime("application/x-hwp", "a.hwp"))
        .isEqualTo("application/x-hwp");
    assertThat(PreviewTypes.targetMime("application/haansofthwp", "a.hwp"))
        .isEqualTo("application/x-hwp");
    assertThat(PreviewTypes.targetMime("application/vnd.hancom.hwp", null))
        .isEqualTo("application/x-hwp");
  }

  @Test
  void HWPX_별칭은_hwp_zip_으로() {
    assertThat(PreviewTypes.targetMime("application/vnd.hancom.hwpx", "a.hwpx"))
        .isEqualTo("application/hwp+zip");
    assertThat(PreviewTypes.targetMime("application/haansofthwpx", "a.hwpx"))
        .isEqualTo("application/hwp+zip");
  }

  @Test
  void 범용_mime_이면_확장자로_판정한다() {
    assertThat(PreviewTypes.targetMime("application/octet-stream", "발표.PPTX")).isEqualTo(PPTX);
    assertThat(PreviewTypes.targetMime("", "a.ppt")).isEqualTo("application/vnd.ms-powerpoint");
    assertThat(PreviewTypes.targetMime(null, "a.hwp")).isEqualTo("application/x-hwp");
    assertThat(PreviewTypes.targetMime("application/octet-stream", "a.zip")).isNull();
    assertThat(PreviewTypes.targetMime("application/octet-stream", null)).isNull();
  }

  @Test
  void mime_파라미터는_떼고_판정한다() {
    assertThat(PreviewTypes.targetMime("application/msword; charset=binary", "a.doc"))
        .isEqualTo("application/msword");
  }

  @Test
  void 변환_대상이_아닌_형식은_null() {
    assertThat(
            PreviewTypes.targetMime(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "a.docx"))
        .isNull();
    assertThat(PreviewTypes.targetMime("application/vnd.ms-excel", "a.xls")).isNull();
    assertThat(PreviewTypes.targetMime("application/pdf", "a.pdf")).isNull();
  }

  @Test
  void 미리보기_경로는_보기_캐시_디렉터리_아래_preview_pdf() {
    assertThat(PreviewTypes.previewPath("t/a.hwp")).isEqualTo("t/a.hwp.view/preview.pdf");
  }
}

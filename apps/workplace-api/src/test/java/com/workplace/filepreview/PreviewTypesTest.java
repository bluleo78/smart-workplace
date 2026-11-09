package com.workplace.filepreview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 미리보기(서버 변환 PDF) 대상 형식 판정(WP-431) — 별칭·파라미터·범용 mime 의 확장자 폴백. */
class PreviewTypesTest {

  private static final String PPTX =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  private static final String DOCX =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
  void DOCX_는_정규형으로_판정한다() {
    // 웹 mammoth 렌더 대신 서버 변환 PDF 로 통일한다(WP-1457).
    assertThat(PreviewTypes.targetMime(DOCX, "a.docx")).isEqualTo(DOCX);
    assertThat(PreviewTypes.targetMime(DOCX + "; charset=binary", null)).isEqualTo(DOCX);
  }

  @Test
  void 범용_mime_이면_확장자로_판정한다() {
    assertThat(PreviewTypes.targetMime("application/octet-stream", "발표.PPTX")).isEqualTo(PPTX);
    assertThat(PreviewTypes.targetMime("", "a.ppt")).isEqualTo("application/vnd.ms-powerpoint");
    assertThat(PreviewTypes.targetMime(null, "a.hwp")).isEqualTo("application/x-hwp");
    assertThat(PreviewTypes.targetMime("application/octet-stream", "회의록.DOCX")).isEqualTo(DOCX);
    assertThat(PreviewTypes.targetMime("application/octet-stream", "a.zip")).isNull();
    // 웹 GENERIC_MIMES 와 같은 범용 목록 — 팀 채팅이 원문 저장한 force-download 도 확장자로 판정(웹과 드리프트 방지).
    assertThat(PreviewTypes.targetMime("application/force-download", "report.docx"))
        .isEqualTo(DOCX);
    assertThat(PreviewTypes.targetMime("binary/octet-stream", "a.hwp"))
        .isEqualTo("application/x-hwp");
    assertThat(PreviewTypes.targetMime("application/x-download", "a.pptx")).isEqualTo(PPTX);
    assertThat(PreviewTypes.targetMime("application/unknown", "a.doc"))
        .isEqualTo("application/msword");
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
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"))
        .isNull();
    assertThat(PreviewTypes.targetMime("application/vnd.ms-excel", "a.xls")).isNull();
    assertThat(PreviewTypes.targetMime("application/pdf", "a.pdf")).isNull();
  }

  @Test
  void 미리보기_경로는_보기_캐시_디렉터리_아래_preview_pdf() {
    assertThat(PreviewTypes.previewPath("t/a.hwp")).isEqualTo("t/a.hwp.view/preview.pdf");
  }
}

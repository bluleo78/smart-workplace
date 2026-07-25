package com.workplace.fileai;

import java.util.Set;

/**
 * 텍스트 추출 가능 mime 판정 단일 소스(#735).
 *
 * <p>기존에는 {@code FileExtractionListener} 가 카테고리(PDF/TEXT/DATA/DOCUMENT) 축으로 게이트했으나, 카테고리는
 * MIME_TO_CATEGORY 매핑에 없는 신규 형식(예: text/html)을 놓쳐 실제로 추출 가능한 파일을 SKIPPED 로 굳혀버렸다(#735 진범). 이 클래스는
 * mime 자체를 판정 축으로 삼아 그 드리프트를 제거한다.
 *
 * <p><b>워커 {@code apps/workplace-worker/app/extract.py::_dispatch} 와 1:1 미러</b> — 한쪽만 고치면 드리프트가
 * 재발한다. 지원 목록을 바꿀 때는 반드시 양쪽을 함께 수정할 것(계획서 Global Constraints 표 참조).
 */
public final class ExtractableTypes {

  private ExtractableTypes() {}

  /** 텍스트 계열 중 {@code text/} 접두사가 아닌 명시적 추가 mime. */
  private static final Set<String> TEXT_LIKE_EXTRA =
      Set.of(
          "application/json",
          "application/xml",
          "application/x-yaml",
          "application/yaml",
          "application/javascript",
          "application/x-sh");

  /** OOXML(docx/xlsx/pptx) + 한글(hwp/hwpx) + 레거시 OLE(doc/ppt/xls) + PDF. */
  private static final Set<String> DOCUMENT_LIKE =
      Set.of(
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/x-hwp",
          "application/hwp+zip",
          "application/msword",
          "application/vnd.ms-powerpoint",
          "application/vnd.ms-excel");

  /** 이 mime 으로 텍스트 추출이 가능한지 판정한다. null·빈 문자열은 false(NPE 없음). */
  public static boolean supports(String mime) {
    if (mime == null || mime.isEmpty()) {
      return false;
    }
    if (mime.startsWith("image/")) {
      return false;
    }
    return mime.startsWith("text/")
        || TEXT_LIKE_EXTRA.contains(mime)
        || DOCUMENT_LIKE.contains(mime);
  }

  /**
   * 추출 불가 사유 문자열. {@code file_extraction.error} 에 기록되어 UI 사용자 문구 매핑(DriveFileService.toReason)의 입력이
   * 된다.
   *
   * @return {@code "image:<mime>"} 또는 {@code "unsupported-mime:<mime>"}
   */
  public static String skipReason(String mime) {
    if (mime != null && mime.startsWith("image/")) {
      return "image:" + mime;
    }
    return "unsupported-mime:" + mime;
  }
}

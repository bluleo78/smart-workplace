package com.workplace.fileai;

/**
 * file_extraction 의 원시 error 문자열을 사유 코드와 사용자 문구로 바꾸는 단일 지점(WP-242).
 *
 * <p>error 컬럼에는 워커·리스너가 남긴 원시값({@code image:…}, {@code unsupported-mime:…}, {@code oversize},
 * {@code empty}, {@code extract-error:…} 등)이 들어 있다. 이를 API 응답에 그대로 노출하면 내부 예외 메시지·경로가 새므로, 드라이브 요약과
 * 첨부 구간 읽기가 모두 이 클래스를 거쳐 정해진 코드·문구만 내보낸다. 스키마는 바꾸지 않고 문자열을 해석한다.
 */
public final class ExtractionReasons {

  private ExtractionReasons() {}

  /** 외부 계약의 reasonCode. 이름이 그대로 JSON 값이 된다. */
  public enum Code {
    IMAGE,
    UNSUPPORTED_TYPE,
    TOO_LARGE,
    SCANNED_PDF,
    EMPTY,
    EXTRACTION_ERROR,
    SUMMARY_FAILED
  }

  /**
   * 내부 상태·원시 error·mime 으로 사유 코드를 정한다.
   *
   * @param internalStatus file_extraction.status
   *     (PENDING/EXTRACTING/TEXT_READY/SUMMARIZING/DONE/SKIPPED/FAILED)
   * @param error file_extraction.error 원시값(없을 수 있음)
   * @param mime file.mime_type — 빈 텍스트를 스캔 PDF 와 구분하는 데만 쓴다(없을 수 있음)
   * @return SKIPPED/FAILED 가 아니면 null
   */
  public static Code classify(String internalStatus, String error, String mime) {
    // FAILED 는 요약 재시도 소진(FULL 프로파일)에서만 생긴다 — 추출 자체는 성공했을 수 있다.
    if ("FAILED".equals(internalStatus)) return Code.SUMMARY_FAILED;
    if (!"SKIPPED".equals(internalStatus)) return null;
    if (error == null) return Code.EXTRACTION_ERROR;
    if (error.startsWith("image:")) return Code.IMAGE;
    if (error.startsWith("unsupported-mime:") || error.startsWith("non-extractable:")) {
      return Code.UNSUPPORTED_TYPE;
    }
    if ("oversize".equals(error)) return Code.TOO_LARGE;
    if ("empty".equals(error) || error.startsWith("empty-text:")) {
      // 텍스트 레이어 없는 PDF 는 대개 스캔본이다 — 사용자가 "왜 비었는지" 알 수 있게 따로 안내한다.
      return "application/pdf".equals(mime) ? Code.SCANNED_PDF : Code.EMPTY;
    }
    // extract-error: 접두 또는 접두 없는 과거 워커 예외 메시지
    return Code.EXTRACTION_ERROR;
  }

  /** 사유 코드 → 사용자 문구. null 이면 null. */
  public static String message(Code code) {
    if (code == null) return null;
    return switch (code) {
      case IMAGE -> "이미지 파일은 글자를 추출하지 않습니다.";
      case UNSUPPORTED_TYPE -> "이 형식은 텍스트 추출을 지원하지 않습니다.";
      case TOO_LARGE -> "파일이 커서(25MB 초과) 텍스트를 추출하지 않았습니다.";
      case SCANNED_PDF -> "스캔된 PDF로 보여 읽을 수 있는 글자가 없습니다.";
      case EMPTY -> "파일에서 글자를 찾지 못했습니다.";
      case EXTRACTION_ERROR -> "텍스트 추출 중 오류가 발생했습니다.";
      case SUMMARY_FAILED -> "요약에 실패했습니다.";
    };
  }
}

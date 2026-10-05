package com.workplace.fileai.dto;

import com.workplace.fileai.ExtractionReasons;

/**
 * 첨부 목록의 extraction 블록(WP-242 공통 계약). 내부 상태 머신을 숨기고 "읽을 수 있나·기다리면 되나·못 읽나"만 알린다.
 *
 * @param status PENDING | READY | SKIPPED | FAILED | NONE
 * @param totalChars READY 일 때 전체 글자 수(코드포인트)
 * @param truncated READY 일 때 100만 자 초과로 앞부분만 저장됐는지
 * @param reasonCode SKIPPED/FAILED 일 때 {@link ExtractionReasons.Code} 이름
 * @param reason SKIPPED/FAILED 일 때 사용자 문구
 */
public record ExtractionInfo(
    String status, Integer totalChars, Boolean truncated, String reasonCode, String reason) {

  /** 추출 행이 없는 파일(배포 전 첨부 등). */
  public static final ExtractionInfo NONE = new ExtractionInfo("NONE", null, null, null, null);

  /**
   * 내부 상태 → 외부 계약 변환. 요약 실패(FAILED)여도 텍스트가 있으면 읽을 수 있으므로 READY 로 본다.
   *
   * @param hasText extracted_text 가 null 이 아닌지
   */
  public static ExtractionInfo of(
      String internalStatus, String error, String mime, Integer totalChars, Boolean truncated, boolean hasText) {
    if (internalStatus == null) return NONE;
    switch (internalStatus) {
      case "PENDING", "EXTRACTING":
        return new ExtractionInfo("PENDING", null, null, null, null);
      case "TEXT_READY", "SUMMARIZING", "DONE":
        return new ExtractionInfo("READY", totalChars, Boolean.TRUE.equals(truncated), null, null);
      case "FAILED":
        if (hasText) return new ExtractionInfo("READY", totalChars, Boolean.TRUE.equals(truncated), null, null);
        break;
      default:
        break;
    }
    ExtractionReasons.Code code = ExtractionReasons.classify(internalStatus, error, mime);
    String external = "FAILED".equals(internalStatus) ? "FAILED" : "SKIPPED";
    return new ExtractionInfo(
        external, null, null, code == null ? null : code.name(), ExtractionReasons.message(code));
  }
}

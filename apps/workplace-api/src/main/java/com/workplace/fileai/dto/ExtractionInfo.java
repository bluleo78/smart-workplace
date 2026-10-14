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
 * @param pageCount PDF 총 페이지 수(WP-250). 상태와 무관하게 알고 있으면 싣는다 — 스캔 PDF(SKIPPED)도 AI 가 페이지 이미지를 요청하려면
 *     쪽수가 필요하다. PDF 가 아니거나 아직 모르면 null
 */
public record ExtractionInfo(
    String status,
    Integer totalChars,
    Boolean truncated,
    String reasonCode,
    String reason,
    Integer pageCount) {

  /** 추출 행이 없는 파일(배포 전 첨부 등). */
  public static final ExtractionInfo NONE =
      new ExtractionInfo("NONE", null, null, null, null, null);

  /**
   * 내부 상태 → 외부 계약 변환. 요약 실패(FAILED)여도 텍스트가 있으면 읽을 수 있으므로 READY 로 본다.
   *
   * @param hasText extracted_text 가 null 이 아닌지
   * @param pageCount file_extraction.page_count(없으면 null) — 모든 상태에 그대로 싣는다
   */
  public static ExtractionInfo of(
      String internalStatus,
      String error,
      String mime,
      Integer totalChars,
      Boolean truncated,
      boolean hasText,
      Integer pageCount) {
    if (internalStatus == null) return NONE;
    if ("PENDING".equals(internalStatus) || "EXTRACTING".equals(internalStatus)) {
      return new ExtractionInfo("PENDING", null, null, null, null, pageCount);
    }
    // 요약 단계 상태이거나, 요약만 실패(FAILED)했어도 텍스트가 남아 있으면 읽을 수 있다.
    boolean ready =
        switch (internalStatus) {
          case "TEXT_READY", "SUMMARIZING", "DONE" -> true;
          case "FAILED" -> hasText;
          default -> false;
        };
    if (ready) {
      return new ExtractionInfo(
          "READY", totalChars, Boolean.TRUE.equals(truncated), null, null, pageCount);
    }
    ExtractionReasons.Code code = ExtractionReasons.classify(internalStatus, error, mime);
    String external = "FAILED".equals(internalStatus) ? "FAILED" : "SKIPPED";
    return new ExtractionInfo(
        external,
        null,
        null,
        code == null ? null : code.name(),
        ExtractionReasons.message(code),
        pageCount);
  }
}

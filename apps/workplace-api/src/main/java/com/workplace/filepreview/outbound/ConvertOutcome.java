package com.workplace.filepreview.outbound;

/**
 * 변환 서비스 {@code POST /convert/pdf} 한 번의 결과(WP-431) — 성공(PDF) 또는 실패(코드·일시 여부).
 *
 * <p>예외 대신 값으로 돌려주는 이유: 호출자(미리보기 서비스)는 실패도 정상 흐름으로 {@code file_preview} 행에 기록해야 하므로, 일시/영구 구분을 타입으로
 * 강제하는 편이 빠뜨리지 않는다.
 */
public sealed interface ConvertOutcome permits ConvertOutcome.Success, ConvertOutcome.Failure {

  /**
   * 변환 성공.
   *
   * @param pdf 변환된 PDF 바이트
   * @param pageCount {@code X-Page-Count} 헤더 값(없거나 숫자가 아니면 null)
   */
  record Success(byte[] pdf, Integer pageCount) implements ConvertOutcome {}

  /**
   * 변환 실패.
   *
   * @param code file_preview.failure_code
   *     값(UNSUPPORTED·TOO_LARGE·TOO_MANY_PAGES·CONVERT_FAILED·BUSY·TIMEOUT· UNAVAILABLE)
   * @param transientFailure true 면 일시 실패 — 다음 열람 때 다시 시도할 수 있다
   */
  record Failure(String code, boolean transientFailure) implements ConvertOutcome {}
}

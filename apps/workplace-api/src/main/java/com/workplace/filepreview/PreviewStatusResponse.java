package com.workplace.filepreview;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 문서 미리보기의 PDF 가 아닌 응답 본문(WP-431, 드라이브·메일 공용 WP-432) — 202 {@code {"status":"CONVERTING"}}, 422
 * {@code {"status":"FAILED","code","transient"}}, 404 {@code {"status":"NOT_APPLICABLE"}}. 실패가 아니면
 * code·transient 는 null 이라 직렬화에서 빠진다.
 *
 * @param status CONVERTING·FAILED·NOT_APPLICABLE
 * @param code 실패 코드(FAILED 만)
 * @param transientFailure true 면 웹이 [다시 시도]를 보인다(FAILED 만) — JSON 이름은 {@code transient}
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PreviewStatusResponse(
    String status, String code, @JsonProperty("transient") Boolean transientFailure) {

  public static PreviewStatusResponse converting() {
    return new PreviewStatusResponse("CONVERTING", null, null);
  }

  public static PreviewStatusResponse failed(String code, boolean transientFailure) {
    return new PreviewStatusResponse("FAILED", code, transientFailure);
  }

  public static PreviewStatusResponse notApplicable() {
    return new PreviewStatusResponse("NOT_APPLICABLE", null, null);
  }
}

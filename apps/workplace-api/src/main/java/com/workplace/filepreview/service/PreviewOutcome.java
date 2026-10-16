package com.workplace.filepreview.service;

import org.springframework.core.io.Resource;

/**
 * 미리보기 열람 한 번의 응답(WP-431) — 컨트롤러가 200(PDF)·202·422·404 로 그대로 옮긴다.
 *
 * <p>값 타입으로 둔 이유: 변환 중·실패도 정상 흐름이라 예외로 표현하면 일시/영구 구분을 빠뜨리기 쉽다.
 */
public sealed interface PreviewOutcome
    permits PreviewOutcome.Ready,
        PreviewOutcome.Converting,
        PreviewOutcome.Failed,
        PreviewOutcome.NotApplicable {

  /**
   * 변환 PDF 준비됨 → 200 application/pdf.
   *
   * @param body PDF 본문 — 드라이브는 {@code FileSystemResource}, 메일은 복호화한 {@code ByteArrayResource}
   * @param sizeBytes PDF 크기(Content-Length)
   * @param etag 따옴표 없는 ETag 값 — 대상이 만든다(원본·엔진·재변환 중 하나라도 바뀌면 달라진다)
   * @param lastModifiedMillis 결과의 수정 시각(Last-Modified) — 다시 변환하면 바뀐다
   */
  record Ready(Resource body, long sizeBytes, String etag, long lastModifiedMillis)
      implements PreviewOutcome {}

  /** 변환 중(방금 선점했거나 다른 작업이 리스를 쥐고 있음) → 202. */
  record Converting() implements PreviewOutcome {}

  /**
   * 변환 실패 → 422.
   *
   * @param code file_preview.failure_code 값(또는 실행기 거절 시 BUSY)
   * @param transientFailure true 면 웹이 [다시 시도] 를 보인다 — 일시 실패는 시도 상한에 닿아도 true 로 둔다(쿨다운이 지나면 다시 시도할 수
   *     있으므로)
   */
  record Failed(String code, boolean transientFailure) implements PreviewOutcome {}

  /** 변환 대상 형식이 아니거나 변환 서비스가 꺼짐 → 404 {@code {"status":"NOT_APPLICABLE"}}(다른 404 와 구분). */
  record NotApplicable() implements PreviewOutcome {}
}

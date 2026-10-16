package com.workplace.filepreview;

import com.workplace.filepreview.service.PreviewOutcome;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * 미리보기 판정({@link PreviewOutcome}) → HTTP 응답 매핑(WP-431 컨트롤러에서 뽑아냄, WP-432). 드라이브·메일 미리보기가 같은 계약을 갖게
 * 한 곳에 둔다.
 *
 * <p>200 PDF / 202 {@code {"status":"CONVERTING"}} / 422 {@code
 * {"status":"FAILED","code","transient"}} / 404 {@code {"status":"NOT_APPLICABLE"}}.
 * 202·422·NOT_APPLICABLE 은 정상 흐름이라 예외 봉투(GlobalExceptionHandler)를 거치지 않고 본문을 직접 만든다 — 웹이 이 404 만
 * "미지원"으로 보고, 다른 404(권한 없음·원본 유실)는 오류 화면으로 보이게 본문으로 구분한다.
 *
 * <p>200 은 ETag·Last-Modified 를 단다. 같은 결과면 {@code If-None-Match} 에 304 — 판정은 ResponseEntity 반환
 * 처리(HttpEntityMethodProcessor)의 조건부 GET 이 맡는다.
 */
public final class PreviewResponses {

  private PreviewResponses() {}

  /** 판정 결과를 응답으로 옮긴다. */
  public static ResponseEntity<?> of(PreviewOutcome outcome) {
    return switch (outcome) {
      case PreviewOutcome.Ready ready -> {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentLength(ready.sizeBytes());
        // 같은 URL 이라도 원본이 바뀌면(새 버전 등) 결과가 바뀌므로 매번 재검증한다.
        headers.setCacheControl("private, no-cache");
        // 재검증용 — 원본·엔진·재변환 중 하나라도 바뀌면 대상이 다른 값을 만든다.
        headers.setETag("\"" + ready.etag() + "\"");
        headers.setLastModified(ready.lastModifiedMillis());
        yield ResponseEntity.ok().headers(headers).body(ready.body());
      }
      case PreviewOutcome.Converting c ->
          ResponseEntity.status(HttpStatus.ACCEPTED).body(PreviewStatusResponse.converting());
      case PreviewOutcome.Failed failed ->
          ResponseEntity.unprocessableEntity()
              .body(PreviewStatusResponse.failed(failed.code(), failed.transientFailure()));
      case PreviewOutcome.NotApplicable n ->
          ResponseEntity.status(HttpStatus.NOT_FOUND).body(PreviewStatusResponse.notApplicable());
    };
  }
}

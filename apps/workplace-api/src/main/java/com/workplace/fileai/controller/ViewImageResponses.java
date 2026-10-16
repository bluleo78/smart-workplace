package com.workplace.fileai.controller;

import com.workplace.fileai.dto.ViewImage;
import java.time.Duration;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * {@link ViewImage} 를 HTTP 응답으로 바꾼다(WP-250) — 도메인 컨트롤러 7곳(이슈·챗·노트·메시지·드라이브·홈·메일)의 {@code GET
 * .../view} 가 공유한다. HTTP 타입은 컨트롤러 계층에만 두려고 서비스({@code AttachmentViewService}) 밖에 둔다.
 */
public final class ViewImageResponses {

  private ViewImageResponses() {}

  /**
   * Content-Type 은 워커가 그린 형식(PNG/JPEG), 캐시는 사용자별 {@code private} 5분(권한이 바뀔 수 있어 공유 캐시를 금지), PDF 면
   * 전체 쪽수를 {@link ViewImage#PAGE_COUNT_HEADER} 로 알려 준다(AI 가 범위를 넘지 않게). 쪽수를 모르거나 이미지 파일이면 헤더를 생략한다.
   */
  public static ResponseEntity<byte[]> of(ViewImage v) {
    ResponseEntity.BodyBuilder b =
        ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(v.contentType()))
            .cacheControl(CacheControl.maxAge(Duration.ofSeconds(300)).cachePrivate());
    if (v.pageCount() != null) b.header(ViewImage.PAGE_COUNT_HEADER, String.valueOf(v.pageCount()));
    return b.body(v.data());
  }
}

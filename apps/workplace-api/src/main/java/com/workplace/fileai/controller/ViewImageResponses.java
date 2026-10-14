package com.workplace.fileai.controller;

import com.workplace.fileai.dto.ViewImage;
import java.time.Duration;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * 첨부 이미지 보기({@code /view}) 응답 만들기(WP-250) — 도메인 컨트롤러 6곳이 같은 헤더 규칙을 쓰도록 한곳에 둔다.
 *
 * <p>Content-Type 은 워커가 그린 형식(PNG/JPEG), 캐시는 사용자별 {@code private} 5분(권한이 바뀔 수 있어 공유 캐시를 금지), PDF 면
 * 전체 쪽수를 {@code X-Page-Count} 로 알려 준다(AI 가 범위를 넘지 않게).
 */
public final class ViewImageResponses {

  private ViewImageResponses() {}

  /** 쪽수 헤더 이름 — 웹·ai-agent 가 같은 이름으로 읽는다. */
  public static final String PAGE_COUNT_HEADER = "X-Page-Count";

  /** 이미지 응답을 만든다. pageCount 가 null(이미지 파일·아직 모름)이면 헤더를 생략한다. */
  public static ResponseEntity<byte[]> of(ViewImage v) {
    ResponseEntity.BodyBuilder b =
        ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(v.contentType()))
            .cacheControl(CacheControl.maxAge(Duration.ofSeconds(300)).cachePrivate());
    if (v.pageCount() != null) b.header(PAGE_COUNT_HEADER, String.valueOf(v.pageCount()));
    return b.body(v.data());
  }
}

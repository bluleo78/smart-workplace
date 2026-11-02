package com.workplace.wiki.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 「HTML 문서」 원본 저장 요청(WP-1307) — 소스 저장·다시 올리기·MCP 원본 바꾸기가 쓴다. 저장할 때마다 직전 판을 버전 기록에 남긴다.
 *
 * @param title null 이면 제목 유지
 * @param html 새 원본 HTML. 크기 상한(5MB, UTF-8 바이트)은 서비스가 지킨다
 * @param version 낙관적 저장 기준 version — 그 사이 다른 저장이 있었으면 409
 */
public record SaveHtmlPageRequest(
    @Size(max = 255) String title, @NotNull String html, @NotNull Integer version) {
  public SaveHtmlPageRequest {
    title = SingleLineTitles.normalize(title);
  }
}

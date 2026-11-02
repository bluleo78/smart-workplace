package com.workplace.wiki.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 「HTML 문서」 페이지 만들기 요청(WP-1307).
 *
 * @param parentId 부모 페이지(없으면 최상위)
 * @param title 제목 — 빈 문자열 허용(노트와 같다), 받을 때 한 줄로 다듬는다
 * @param html 원본 HTML — 빈 문서면 빈 문자열. 크기 상한(5MB, UTF-8 바이트)은 서비스가 지킨다
 */
public record CreateHtmlPageRequest(
    Long parentId, @NotNull @Size(max = 255) String title, @NotNull String html) {
  public CreateHtmlPageRequest {
    title = SingleLineTitles.normalize(title);
  }
}

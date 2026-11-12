package com.workplace.global.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonUnwrapped;

/**
 * 응답 본문에 웹 화면 주소({@code url})를 덧붙인 것(WP-1523).
 *
 * <p>본문 필드를 그대로 펼쳐(@JsonUnwrapped) 기존 JSON 모양은 바뀌지 않고 {@code url} 하나만 늘어난다 — 생성 지점이 많은 응답
 * 레코드(IssueResponse 등)에 컴포넌트를 더하지 않고 컨트롤러에서 감싼다. url 이 null 이면(공개 웹 주소 미설정) 키를 뺀다.
 *
 * <p>주의: 감싼 본문에 나중에 {@code url} 필드가 생기면 펼친 필드와 이름이 겹친다 — 그때는 본문 쪽 이름을 바꾸거나 이 래퍼를 걷어낸다.
 *
 * @param body 원래 응답 본문
 * @param url 화면 주소({@link com.workplace.global.util.AppWebLinks}). 없으면 null
 */
public record WithWebUrl<T>(
    @JsonUnwrapped T body, @JsonInclude(JsonInclude.Include.NON_NULL) String url) {

  /** 본문과 주소로 만든다. */
  public static <T> WithWebUrl<T> of(T body, String url) {
    return new WithWebUrl<>(body, url);
  }
}

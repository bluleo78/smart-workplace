package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 메모리 고치기(WP-55·WP-379) — 생략한 필드는 그대로 둔다. scope 는 present-flag: 키가 있으면 적용하고 null 은 공통으로 옮긴다. record
 * 는 "키 없음"과 "null"을 구분하지 못해 setter 로 키 존재를 기록한다 — 구 웹은 {@code {content}} 만 보내므로 범위가 그대로 남는다.
 */
public final class UpdateAiMemoryRequest {

  private String content;
  private String kind;
  private String scope;
  private boolean scopePresent;

  /** Jackson 역직렬화용. */
  public UpdateAiMemoryRequest() {}

  /** 내용·종류만 고치는 요청(서비스 호환 오버로드·테스트). */
  public UpdateAiMemoryRequest(String content, String kind) {
    this.content = content;
    this.kind = kind;
  }

  @JsonProperty("content")
  public void setContent(String content) {
    this.content = content;
  }

  @JsonProperty("kind")
  public void setKind(String kind) {
    this.kind = kind;
  }

  /** scope 키가 오면(null 포함) 존재를 기록한다 — null = 공통으로 옮기기. */
  @JsonProperty("scope")
  public void setScope(String scope) {
    this.scope = scope;
    this.scopePresent = true;
  }

  public String content() {
    return content;
  }

  public String kind() {
    return kind;
  }

  /** 옮길 범위(null = 공통) — {@link #hasScope()} 가 true 일 때만 의미가 있다. */
  public String scope() {
    return scope;
  }

  /** 본문에 scope 키가 있었는가. */
  public boolean hasScope() {
    return scopePresent;
  }

  /** 바꿀 값이 하나라도 있는가 — 없으면 400. */
  public boolean hasChanges() {
    return content != null || kind != null || scopePresent;
  }
}

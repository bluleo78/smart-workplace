package com.workplace.auth.oauth.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 내 연결이 아니거나 없거나 이미 끊긴 OAuth 연결(WP-1685) — 남의 연결이 있는지 드러내지 않도록 모두 404 로 통일한다. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class OAuthConnectionNotFoundException extends RuntimeException {
  public OAuthConnectionNotFoundException() {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나간다(WP-619 와 같은 이유).
    super("앱 연결을 찾을 수 없습니다");
  }
}

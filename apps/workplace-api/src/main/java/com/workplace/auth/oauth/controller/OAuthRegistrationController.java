package com.workplace.auth.oauth.controller;

import com.workplace.auth.oauth.dto.OAuthErrorResponse;
import com.workplace.auth.oauth.dto.RegisterClientRequest;
import com.workplace.auth.oauth.dto.RegisteredClient;
import com.workplace.auth.oauth.exception.OAuthClientException;
import com.workplace.auth.oauth.exception.OAuthErrors;
import com.workplace.auth.oauth.service.OAuthClientService;
import com.workplace.global.security.ratelimit.PublicRateLimitFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 동적 클라이언트 등록(RFC 7591, WP-1685) — {@code POST /api/v1/oauth/register}. 로그인 없이 열리고(SecurityConfig
 * permitAll) IP 당 속도 제한(OAUTH_REGISTER, 기본 분당 10)과 공개 CORS 를 받는다. 오류는 RFC 7591 §3.2.2 모양({@code
 * {"error","error_description"}} snake_case)이고, 이 컨트롤러 안의 예외 처리기가 전역 오류 모양보다 먼저 잡는다.
 */
@RestController
@RequiredArgsConstructor
public class OAuthRegistrationController {

  private final OAuthClientService clientService;

  /** 등록 — 201 + 발급한 client_id(swc_…)와 받아들인 메타데이터. */
  @PostMapping(PublicRateLimitFilter.OAUTH_REGISTER_PATH)
  public ResponseEntity<RegisteredClient> register(
      @RequestBody(required = false) RegisterClientRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .cacheControl(CacheControl.noStore())
        .body(clientService.register(req));
  }

  /** 규칙 위반(redirect_uri·메타데이터) → 400 표준 오류. */
  @ExceptionHandler(OAuthClientException.class)
  public ResponseEntity<OAuthErrorResponse> handle(OAuthClientException e) {
    return badRequest(e.error(), e.description());
  }

  /** JSON 이 아니거나 필드 형식이 틀린 본문 → 400 invalid_client_metadata(전역 오류 모양 대신 RFC 모양으로). */
  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    HttpMediaTypeNotSupportedException.class
  })
  public ResponseEntity<OAuthErrorResponse> handleUnreadable(Exception e) {
    return badRequest(OAuthErrors.INVALID_CLIENT_METADATA, "등록 본문은 올바른 JSON 객체여야 합니다.");
  }

  private static ResponseEntity<OAuthErrorResponse> badRequest(String error, String description) {
    return ResponseEntity.badRequest()
        .cacheControl(CacheControl.noStore())
        .body(new OAuthErrorResponse(error, description));
  }
}

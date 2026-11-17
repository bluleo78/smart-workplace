package com.workplace.auth.oauth.controller;

import com.workplace.auth.oauth.dto.AuthorizationServerMetadata;
import com.workplace.auth.oauth.service.OAuthIssuer;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 인가 서버 메타데이터(RFC 8414, WP-1685) — Claude 앱 커넥터가 보호 리소스 메타데이터(RFC 9728)의 authorization_servers 를
 * 따라와 여기서 인가·토큰·등록 엔드포인트와 지원 기능(PKCE S256, CIMD, DCR)을 읽는다. 로그인 없이 열리고(/api 밖이라 SecurityConfig 의
 * 나머지 경로 permitAll) 브라우저 기반 클라이언트도 읽도록 공개 CORS(* 원점·자격 증명 없음)를 받는다.
 */
@RestController
@RequiredArgsConstructor
public class OAuthMetadataController {

  /** 메타데이터 경로 — issuer 에 경로가 없어 RFC 8414 §3 의 경로 삽입 없이 이 하나다. */
  public static final String PATH = "/.well-known/oauth-authorization-server";

  private final OAuthIssuer issuer;

  /** 메타데이터 — 모든 주소는 issuer(공개 웹 주소)로만 만든다. */
  @GetMapping(PATH)
  public AuthorizationServerMetadata metadata() {
    return new AuthorizationServerMetadata(
        issuer.issuer(),
        issuer.authorizationEndpoint(),
        issuer.tokenEndpoint(),
        issuer.registrationEndpoint(),
        List.of("code"),
        List.of("authorization_code", "refresh_token"),
        List.of("S256"),
        true,
        List.of("none"),
        true);
  }
}

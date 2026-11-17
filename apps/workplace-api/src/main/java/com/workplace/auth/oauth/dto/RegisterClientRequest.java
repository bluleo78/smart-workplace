package com.workplace.auth.oauth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * 동적 클라이언트 등록 요청(RFC 7591, WP-1685) — 표준 필드 이름(snake_case) 그대로 받는다. 받지 않는 그 밖의 메타데이터(contacts 등)는
 * 무시한다.
 *
 * @param redirectUris 필수, 1~10개(규칙은 RedirectUris)
 * @param clientName 표시 이름, 100자 이하 — 없으면 「이름 없는 앱」
 * @param tokenEndpointAuthMethod {@code none} 만(공개 클라이언트 + PKCE). 없으면 none
 * @param grantTypes 있으면 authorization_code·refresh_token 안에서만
 * @param responseTypes 있으면 code 만
 */
public record RegisterClientRequest(
    @JsonProperty("redirect_uris") List<String> redirectUris,
    @JsonProperty("client_name") String clientName,
    @JsonProperty("token_endpoint_auth_method") String tokenEndpointAuthMethod,
    @JsonProperty("grant_types") List<String> grantTypes,
    @JsonProperty("response_types") List<String> responseTypes) {}

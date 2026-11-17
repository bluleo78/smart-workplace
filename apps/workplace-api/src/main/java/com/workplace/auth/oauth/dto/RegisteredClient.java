package com.workplace.auth.oauth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * 동적 클라이언트 등록 응답(RFC 7591 §3.2.1, WP-1685) — 발급한 client_id 와 서버가 받아들인 메타데이터. 공개 클라이언트라
 * client_secret 은 없다.
 *
 * @param clientIdIssuedAt 발급 시각(epoch 초)
 */
public record RegisteredClient(
    @JsonProperty("client_id") String clientId,
    @JsonProperty("client_id_issued_at") long clientIdIssuedAt,
    @JsonProperty("client_name") String clientName,
    @JsonProperty("redirect_uris") List<String> redirectUris,
    @JsonProperty("token_endpoint_auth_method") String tokenEndpointAuthMethod,
    @JsonProperty("grant_types") List<String> grantTypes,
    @JsonProperty("response_types") List<String> responseTypes) {}

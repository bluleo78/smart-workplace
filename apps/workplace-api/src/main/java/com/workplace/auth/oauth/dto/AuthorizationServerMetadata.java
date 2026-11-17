package com.workplace.auth.oauth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/**
 * 인가 서버 메타데이터(RFC 8414, WP-1685) — {@code GET /.well-known/oauth-authorization-server} 본문. 모든 URL 은
 * issuer(공개 웹 주소)로만 만든다. scopes_supported 는 scope 를 쓰지 않아 넣지 않는다.
 */
public record AuthorizationServerMetadata(
    @JsonProperty("issuer") String issuer,
    @JsonProperty("authorization_endpoint") String authorizationEndpoint,
    @JsonProperty("token_endpoint") String tokenEndpoint,
    @JsonProperty("registration_endpoint") String registrationEndpoint,
    @JsonProperty("response_types_supported") List<String> responseTypesSupported,
    @JsonProperty("grant_types_supported") List<String> grantTypesSupported,
    @JsonProperty("code_challenge_methods_supported") List<String> codeChallengeMethodsSupported,
    @JsonProperty("authorization_response_iss_parameter_supported")
        boolean authorizationResponseIssParameterSupported,
    @JsonProperty("token_endpoint_auth_methods_supported")
        List<String> tokenEndpointAuthMethodsSupported,
    @JsonProperty("client_id_metadata_document_supported")
        boolean clientIdMetadataDocumentSupported) {}

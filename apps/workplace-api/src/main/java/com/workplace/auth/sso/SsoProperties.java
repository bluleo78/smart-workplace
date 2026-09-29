package com.workplace.auth.sso;

import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * WP-48 M365 SSO 로그인 설정 — 운영자가 등록한 전역 멀티테넌트 Entra 앱 1개.
 *
 * <p>clientId 가 비어 있으면 SSO 기능 전체가 꺼진다(로그인 버튼 숨김). 값이 있는데 secret/redirectUri 가 비었거나 redirectUri 가
 * https 가 아니면(localhost 제외) 부팅을 실패시켜 설정 오류를 배포 시점에 드러낸다. 메일/캘린더용 {@code workplace.mail.m365} 앱과는 동의
 * 범위를 분리하기 위해 별도로 둔다.
 */
@ConfigurationProperties(prefix = "workplace.auth.sso.m365")
public record SsoProperties(
    String clientId, String clientSecret, String redirectUri, String authorityBaseUrl) {

  private static final String DEFAULT_AUTHORITY = "https://login.microsoftonline.com";

  public SsoProperties {
    if (clientId != null && !clientId.isBlank()) {
      if (clientSecret == null || clientSecret.isBlank()) {
        throw new IllegalStateException("SSO_M365_CLIENT_SECRET 이 필요합니다(SSO_M365_CLIENT_ID 설정됨)");
      }
      if (redirectUri == null || redirectUri.isBlank()) {
        throw new IllegalStateException("SSO_M365_REDIRECT_URI 가 필요합니다(SSO_M365_CLIENT_ID 설정됨)");
      }
      URI uri = URI.create(redirectUri);
      boolean localhost = "localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost());
      if (!"https".equals(uri.getScheme()) && !localhost) {
        throw new IllegalStateException("SSO_M365_REDIRECT_URI 는 https 여야 합니다(localhost 제외)");
      }
    }
  }

  /** SSO 사용 가능 여부 — 운영자가 앱을 등록(env 설정)했는가. */
  public boolean isAvailable() {
    return clientId != null && !clientId.isBlank();
  }

  /** Microsoft authority 기본 URL(끝 '/' 제거). 테스트에서는 가짜 IdP 주소로 바뀐다. */
  public String authority() {
    String base =
        (authorityBaseUrl == null || authorityBaseUrl.isBlank())
            ? DEFAULT_AUTHORITY
            : authorityBaseUrl;
    return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
  }
}

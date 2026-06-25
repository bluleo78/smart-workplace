package com.workplace.mail.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Microsoft 365 Graph API / Azure AD OAuth2 설정.
 *
 * <p>prefix = "workplace.mail.m365". WorkplaceApplication 에 {@code @ConfigurationPropertiesScan} 이
 * 선언돼 있으므로 별도 @EnableConfigurationProperties 불필요.
 *
 * <p>clientSecret 은 반드시 환경변수({@code M365_CLIENT_SECRET})로만 주입 — 평문 커밋 금지.
 */
@ConfigurationProperties("workplace.mail.m365")
public record M365GraphProperties(
    /** Azure AD 앱 등록 클라이언트 ID. */
    String clientId,

    /** Azure AD 테넌트 ID(디렉터리 ID). */
    String tenantId,

    /** Azure AD 앱 클라이언트 시크릿 — 환경변수 M365_CLIENT_SECRET 으로만 주입. */
    String clientSecret,

    /** OAuth2 인증코드 흐름의 리다이렉트 URI. */
    String redirectUri,

    /** 웹 프론트엔드 베이스 URL(OAuth 완료 후 리다이렉트 등). */
    String webBaseUrl) {

  /**
   * 읽기 슬라이스 최소 권한 scope — 단일 출처 상수.
   *
   * <ul>
   *   <li>{@code openid} — id_token 수신 필수. 누락 시 AAD가 id_token 을 반환하지 않아 connect() 에서
   *       IllegalArgumentException 발생.
   *   <li>{@code offline_access} — refresh_token 발급 필수.
   *   <li>{@code Mail.Read} — 읽기 슬라이스(#499) 최소 권한. Mail.Send·Calendars.Read 는 각각 #500/#501 슬라이스에서
   *       추가 — 이 슬라이스에 포함하지 않는다.
   * </ul>
   *
   * <p>인가 URL(M365OAuthController), 토큰 교환(GraphApiClient.exchangeCode), 토큰 갱신
   * (GraphApiClient.refresh) 세 곳 모두 이 상수를 참조하므로 scope 드리프트가 발생하지 않는다.
   */
  public static final String SCOPE = "Mail.Read offline_access openid";
}

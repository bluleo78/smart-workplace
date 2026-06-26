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

    /** OAuth2 인증코드 흐름의 리다이렉트 URI(= 프론트 콜백 라우트). */
    String redirectUri) {

  /**
   * 읽기 슬라이스 최소 권한 scope — 단일 출처 상수.
   *
   * <ul>
   *   <li>{@code openid} — id_token 수신 필수. 누락 시 AAD가 id_token 을 반환하지 않아 connect() 에서
   *       IllegalArgumentException 발생.
   *   <li>{@code profile email} — id_token 에 {@code preferred_username}/{@code email} 클레임 포함시켜 계정
   *       이메일 추출(extractEmailFromIdToken)에 사용. 표준 OIDC scope 라 관리자 동의 불필요.
   *   <li>{@code offline_access} — refresh_token 발급 필수.
   *   <li>{@code Mail.ReadWrite} — 메일 접근. 읽기 슬라이스(#499)는 읽기만 쓰지만, 테넌트(iacloud.kr)가 사용자 동의를 차단하고 관리자
   *       동의는 {@code Mail.ReadWrite} 에 대해 이미 부여돼 있다. {@code Mail.Read}는 별개 scope라 미동의 → "관리자 승인
   *       필요"가 다시 뜨므로, 이미 동의된 {@code Mail.ReadWrite}를 쓴다(#500 발송에서도 동일 권한 필요). 추가 관리자 작업 없이 통과시키기
   *       위한 선택.
   * </ul>
   *
   * <p>인가 URL(M365OAuthController), 토큰 교환(GraphApiClient.exchangeCode), 토큰 갱신
   * (GraphApiClient.refresh) 세 곳 모두 이 상수를 참조하므로 scope 드리프트가 발생하지 않는다.
   */
  public static final String SCOPE = "Mail.ReadWrite offline_access openid profile email";
}

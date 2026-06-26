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
   * 메일 읽기·쓰기 권한 scope — 단일 출처 상수.
   *
   * <ul>
   *   <li>{@code openid profile email} — id_token/계정 이메일 추출.
   *   <li>{@code offline_access} — refresh_token 발급.
   *   <li>{@code Mail.ReadWrite} — 메일 조회·읽음표시(PATCH isRead). 관리자 동의 완료.
   *   <li>{@code Mail.Send} — 메일 발송(POST /me/sendMail). Mail.ReadWrite로는 발송 불가라 별도 필요. 에픽 #498에서
   *       관리자 동의 완료 → 추가 동의 불필요. (#500에서 추가)
   * </ul>
   *
   * <p>⚠️ 기존에 연결된 계정의 refresh_token은 Mail.Send 없이 발급됐을 수 있다 → 발송 시 401/403이면 계정 재연결로 새 scope을
   * 받는다(테스트 계정 iacloud.kr은 재연결 trivial). 라이브 게이트(Task 4)에서 확인.
   */
  public static final String SCOPE = "Mail.ReadWrite Mail.Send offline_access openid profile email";
}

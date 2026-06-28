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
   * 읽기 슬라이스 최소 권한 단일 출처. Mail.ReadWrite/Send(메일) + Calendars.Read(일정 읽기 #501).
   *
   * <ul>
   *   <li>{@code openid profile email} — id_token/계정 이메일 추출.
   *   <li>{@code offline_access} — refresh_token 발급.
   *   <li>{@code Mail.ReadWrite} — 메일 조회·읽음표시(PATCH isRead). 관리자 동의 완료.
   *   <li>{@code Mail.Send} — 메일 발송(POST /me/sendMail). Mail.ReadWrite로는 발송 불가라 별도 필요. 에픽 #498에서
   *       관리자 동의 완료 → 추가 동의 불필요. (#500에서 추가)
   *   <li>{@code Calendars.Read} — 일정 조회(GET /me/calendars, /calendarView). (#501에서 추가)
   * </ul>
   *
   * <p>⚠️ 변경 시 기존 연결 계정 재동의(관리자 동의) 필요 — 배포 게이트.
   */
  public static final String SCOPE =
      "Mail.ReadWrite Mail.Send Calendars.Read offline_access openid profile email";
}

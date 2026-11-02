package com.workplace.mail.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.service.AuditLogService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.config.M365GraphProperties;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.outbound.MailDomainEvents.MailAccountConnectedEvent;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.OAuthStateStore.StateData;
import com.workplace.tenant.repository.TenantRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Microsoft 365 OAuth2 auth-code 흐름으로 메일 계정을 연결하는 서비스.
 *
 * <p>{@link #connect}는 인가 코드를 access_token / refresh_token 으로 교환하고, id_token 에서 이메일을 추출하여 DB 에 계정을
 * upsert 한다.
 *
 * <p>콜백 완료는 로그인한 사용자 요청이라(WP-1289) JWT 필터가 세운 TenantContext 로 @Transactional 이 RLS GUC 를 주입한다.
 * 컨트롤러가 state 주인과 현재 사용자·테넌트가 같은지 확인한 뒤에만 {@link #connect} 를 부른다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class M365OAuthService {

  private final GraphApiClient graphApiClient;
  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;
  private final ObjectMapper objectMapper;

  /** 계정 연결 직후 즉시 동기화(#514)를 트리거하기 위한 도메인 이벤트 발행기. */
  private final ApplicationEventPublisher events;

  /** WP-64: 계정 변경 resource.changed 발행기. */
  private final MailChangeNotifier notifier;

  /** WP-879: 메일용 M365 앱 설정 — 비어 있으면 Outlook 연결 자체가 불가. */
  private final M365GraphProperties props;

  /** WP-879: 워크스페이스 SSO 켜짐 여부 조회(tenant 는 RLS 비대상 전역 테이블). */
  private final TenantRepository tenantRepository;

  /** WP-1289: 남의 state 로 연결을 시도한 기록을 감사 로그에 남긴다. */
  private final AuditLogService auditLogService;

  /** WP-1289: 감사 로그의 사용자 이름 조회. */
  private final UserRepository userRepository;

  /**
   * 메일 계정 추가 시 Outlook(Microsoft 365)을 기본 공급자로 고를지(WP-879).
   *
   * <p>워크스페이스가 Microsoft 로그인(SSO)을 켰다면 구성원 대부분이 Microsoft 365 메일을 쓴다고 보고 기본값으로 권한다. 메일용 M365 앱이
   * 설정되지 않은 환경에서는 연결이 실패하는 선택지가 기본이 되지 않도록 false.
   */
  @Transactional(readOnly = true)
  public boolean isPreferredFor(Long tenantId) {
    return props.isConfigured() && tenantId != null && tenantRepository.isSsoEnabled(tenantId);
  }

  /**
   * 다른 사람에게 발급된 state 로 연결 완료를 부른 시도를 감사 로그(FAILURE)로 남긴다(WP-1289).
   *
   * <p>남이 받은 연결 링크를 누르게 해 내 메일함을 그 사람 계정에 잇게 하려는 시도일 수 있어 관리자가 볼 수 있게 남긴다. 감사 저장이 실패해도 거부 응답은 그대로
   * 나가야 하므로 오류는 삼키고 경고만 남긴다.
   *
   * @param callerId 지금 로그인해 완료를 부른 사용자
   * @param state 소비한 state(발급받은 사용자·테넌트)
   */
  @Transactional
  public void auditForeignState(long callerId, StateData state) {
    try {
      auditLogService.log(
          callerId,
          userRepository
              .findById(callerId)
              .map(UserResponse::username)
              .orElse(String.valueOf(callerId)),
          "MAIL_OAUTH_STATE_MISMATCH",
          "email_account",
          null,
          "다른 사용자에게 발급된 M365 메일 연결 state 로 연결 시도 — 거부",
          null,
          null,
          "FAILURE",
          null,
          Map.of(
              "provider", "M365_GRAPH",
              "stateUserId", state.userId(),
              "stateTenantId", state.tenantId()));
    } catch (RuntimeException e) {
      log.warn("M365 state 불일치 감사 기록 실패 type={}", e.getClass().getName());
    }
  }

  /**
   * OAuth2 인가 코드를 교환하고 M365 계정을 DB 에 upsert 한다.
   *
   * <p>id_token 의 payload 세그먼트를 base64url 디코딩해 {@code preferred_username} 또는 {@code email} 클레임으로
   * 이메일을 추출한다. id_token 서명 검증은 생략한다 — AAD 토큰 엔드포인트에서 TLS(HTTPS)로 직접 수신한 값이므로 신뢰한다(RFC 6749).
   *
   * @param code AAD 에서 전달된 OAuth2 인가 코드
   * @param state 사전 발급한 StateData (userId/tenantId 결속)
   * @return 생성 또는 갱신된 email_account ID
   */
  @Transactional // RLS GUC 주입: JWT 필터가 세운 TenantContext(= state.tenantId(), 컨트롤러가 확인)
  public long connect(String code, StateData state) {
    // 인가 코드 → access_token / refresh_token / id_token 교환
    GraphApiClient.TokenResponse tokens = graphApiClient.exchangeCode(code);

    // 실제 메일박스 주소 확보 — 로그인 ID(UPN)와 메일 주소가 다를 수 있으므로 Graph /me 의 mail(주 SMTP)을 우선.
    String emailAddress = resolveMailboxAddress(tokens.accessToken(), tokens.idToken());

    // 토큰 암호화 — 평문이 로그/DB 에 노출되지 않도록
    String encRefresh = encryption.encrypt(tokens.refreshToken());
    String encAccess = encryption.encrypt(tokens.accessToken());
    OffsetDateTime expiresAt = OffsetDateTime.now().plusSeconds(tokens.expiresInSec());

    // 전역 ai_enabled 설정 상속 — 사용자가 기존 계정에서 이미 켜 뒀으면 신규 M365 계정도 켜진 상태로 생성.
    boolean aiEnabled = accountRepo.isAnyAiEnabled(state.userId());

    // 기존 활성 IMAP 행이 있으면 Graph 로 전환, 없으면 신규 INSERT
    long accountId =
        accountRepo.upsertGraphAccount(
            state.userId(), emailAddress, encRefresh, encAccess, expiresAt, aiEnabled);

    // 첫 동기화를 3분 주기 스케줄러까지 기다리지 않도록 즉시 동기화를 트리거. 토큰이 막 발급돼 가장 신선한 시점이다(AFTER_COMMIT 소비).
    events.publishEvent(new MailAccountConnectedEvent(state.userId(), accountId));
    // 신규 생성/IMAP→Graph 전환 모두 upsert 라 구분하지 않고 updated 로 알린다(프론트는 계정 목록을 재조회).
    notifier.accountChanged(
        ResourceChangedEvent.OP_UPDATED, state.userId(), accountId, state.userId());

    log.info("M365 Graph 계정 연결 완료: userId={} accountId={}", state.userId(), accountId);
    return accountId;
  }

  /**
   * 연결할 메일박스의 실제 주소를 확보한다.
   *
   * <p>로그인 ID(UPN)와 메일 주소가 다를 수 있으므로, Graph {@code /me} 의 {@code mail}(주 SMTP 주소)을 우선 사용하고, 비어 있으면
   * {@code userPrincipalName}(로그인 UPN)으로 폴백한다. {@code /me} 호출이 실패하면 id_token 클레임으로 최종 폴백한다. 동기화는
   * {@code /me/messages}(로그인 사용자 본인 메일박스)를 사용하므로, 저장 주소는 표시·식별 용도다.
   *
   * @param accessToken Graph 호출용 access_token
   * @param idToken 폴백용 id_token
   * @return 메일박스 주소
   */
  private String resolveMailboxAddress(String accessToken, String idToken) {
    try {
      JsonNode me =
          graphApiClient.get(accessToken, "/me?$select=mail,userPrincipalName", JsonNode.class);
      if (me != null) {
        JsonNode mail = me.get("mail");
        if (mail != null && !mail.isNull() && !mail.asText().isBlank()) {
          return mail.asText();
        }
        JsonNode upn = me.get("userPrincipalName");
        if (upn != null && !upn.isNull() && !upn.asText().isBlank()) {
          return upn.asText();
        }
      }
    } catch (Exception e) {
      // 토큰/주소 노출 방지를 위해 예외 요약만 기록 후 id_token 폴백
      log.warn("Graph /me 메일박스 주소 조회 실패 — id_token 폴백: {}", e.toString());
    }
    return extractEmailFromIdToken(idToken);
  }

  /**
   * AAD id_token (JWT) 의 payload 세그먼트에서 이메일 주소를 추출한다.
   *
   * <p>id_token 은 header.payload.signature 형태의 JWT 문자열이다. payload 를 base64url 디코딩하면 클레임 JSON 이 나온다.
   * {@code preferred_username} 을 우선 사용하고(M365 UPN), 없으면 {@code email} 클레임을 사용한다.
   *
   * @param idToken AAD 토큰 엔드포인트에서 수신한 id_token 문자열
   * @return 추출된 이메일 주소
   * @throws IllegalArgumentException id_token 이 null 이거나 이메일 클레임이 없는 경우
   */
  private String extractEmailFromIdToken(String idToken) {
    if (idToken == null || idToken.isBlank()) {
      throw new IllegalArgumentException("id_token 이 없습니다. openid scope 가 포함됐는지 확인하세요.");
    }
    // JWT: header.payload.signature — 점(.)으로 분리
    String[] parts = idToken.split("\\.");
    if (parts.length < 2) {
      throw new IllegalArgumentException("id_token 형식이 올바르지 않습니다.");
    }
    try {
      // base64url 패딩 없이 인코딩된 payload — getUrlDecoder 는 패딩 자동 보완
      byte[] payloadBytes = Base64.getUrlDecoder().decode(padBase64Url(parts[1]));
      JsonNode claims = objectMapper.readTree(payloadBytes);

      // preferred_username: M365 사용자 주체 이름(UPN, 보통 이메일 형식)
      JsonNode prefUsername = claims.get("preferred_username");
      if (prefUsername != null && !prefUsername.asText().isBlank()) {
        return prefUsername.asText();
      }
      // email: OIDC 표준 클레임(옵션)
      JsonNode email = claims.get("email");
      if (email != null && !email.asText().isBlank()) {
        return email.asText();
      }
      throw new IllegalArgumentException("id_token 에 이메일 클레임(preferred_username/email)이 없습니다.");
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw new IllegalArgumentException("id_token payload 파싱 실패", e);
    }
  }

  /**
   * base64url 문자열에 필요한 패딩(=)을 추가한다.
   *
   * <p>JWT payload 는 패딩 없이 전달되므로, Java {@link Base64#getUrlDecoder()} 가 요구하는 패딩을 수동으로 보완한다.
   */
  private static String padBase64Url(String s) {
    int pad = s.length() % 4;
    if (pad == 2) return s + "==";
    if (pad == 3) return s + "=";
    return s;
  }
}

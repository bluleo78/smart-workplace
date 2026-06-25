package com.workplace.mail.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.OAuthStateStore.StateData;
import java.time.OffsetDateTime;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Microsoft 365 OAuth2 auth-code 흐름으로 메일 계정을 연결하는 서비스.
 *
 * <p>{@link #connect}는 인가 코드를 access_token / refresh_token 으로 교환하고, id_token 에서 이메일을 추출하여 DB 에 계정을
 * upsert 한다.
 *
 * <p>⚠️ @Transactional 단독으로는 불충분 — 콜백은 JWT 없는 공개 경로라 TenantContext 가 비어 있다. 호출 전 반드시
 * TenantContext.set(state.tenantId()) 를 try-finally-clear 로 감싸야 RLS GUC 가 주입된다(#444/#492 패턴).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class M365OAuthService {

  private final GraphApiClient graphApiClient;
  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;
  private final ObjectMapper objectMapper;

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
  @Transactional // RLS GUC 주입: 호출 전 TenantContext.set(state.tenantId()) 필수
  public long connect(String code, StateData state) {
    // 인가 코드 → access_token / refresh_token / id_token 교환
    GraphApiClient.TokenResponse tokens = graphApiClient.exchangeCode(code);

    // id_token 에서 이메일 추출 (서명 검증 불필요 — TLS HTTPS 직접 수신)
    String emailAddress = extractEmailFromIdToken(tokens.idToken());

    // 토큰 암호화 — 평문이 로그/DB 에 노출되지 않도록
    String encRefresh = encryption.encrypt(tokens.refreshToken());
    String encAccess = encryption.encrypt(tokens.accessToken());
    OffsetDateTime expiresAt = OffsetDateTime.now().plusSeconds(tokens.expiresInSec());

    // 기존 활성 IMAP 행이 있으면 Graph 로 전환, 없으면 신규 INSERT
    long accountId =
        accountRepo.upsertGraphAccount(
            state.userId(), emailAddress, encRefresh, encAccess, expiresAt);

    log.info("M365 Graph 계정 연결 완료: userId={} accountId={}", state.userId(), accountId);
    return accountId;
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

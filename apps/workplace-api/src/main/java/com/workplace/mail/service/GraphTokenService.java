package com.workplace.mail.service;

import com.workplace.global.exception.CryptoException;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailCredentialUnreadableException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAccountRepository.OAuthTokens;
import java.time.OffsetDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Microsoft 365 Graph 계정의 OAuth2 access_token 관리 서비스.
 *
 * <p>access_token 만료 임박 시 AAD refresh 엔드포인트를 호출하고, 회전된 refresh_token 을 암호화해 DB 에 재저장한다. AAD 는 매
 * 갱신마다 refresh_token 을 회전시키므로 저장을 빠뜨리면 다음 갱신이 실패한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class GraphTokenService {

  private final EmailAccountRepository accountRepo;
  private final GraphApiClient graphApiClient;
  private final EncryptionService encryption;

  /**
   * M365 Graph 계정의 유효한 access_token 을 반환한다.
   *
   * <p>만료 2분 전이면 refresh_token 으로 갱신하고, 회전된 새 refresh_token·access_token 을 암호화해 저장한다.
   *
   * <p>⚠️ @Transactional 필수 — RLS GUC(app.tenant_id)가 트랜잭션 진입 시 주입돼야 토큰 저장 쓰기가 fail-closed 되지 않는다
   * (#444/#492 패턴). 비-@Transactional 경로에서 호출하면 updateOAuthTokens 가 GUC 미주입 상태로 RLS 에 막혀 실패한다.
   *
   * @param userId 계정 소유자
   * @param accountId 메일 계정 ID
   * @return 유효한 access_token 평문
   * @throws EmailAccountNotFoundException 계정이 없거나 접근 불가한 경우
   * @throws MailCredentialUnreadableException refresh_token 이 없거나 복호화할 수 없어 계정을 다시 연결해야 하는 경우(502)
   */
  @Transactional // RLS GUC 주입 필수 — 비-tx 경로는 fail-closed
  public String getAccessToken(long userId, long accountId) {
    OAuthTokens t =
        accountRepo
            .findOAuthTokens(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));

    OffsetDateTime exp = t.expiresAt();
    // 만료 2분 전이면 어차피 버릴 값이라 복호화하지 않는다(헛 복호화·키 교체 뒤 헛 경고를 막는다).
    // access_token 은 캐시일 뿐이라 깨져 있으면 null 로 보고 refresh 로 새로 받는다(오류로 만들지 않는다)
    boolean fresh = exp != null && !exp.isBefore(OffsetDateTime.now().plusMinutes(2));
    String access = fresh ? decryptAccessOrNull(accountId, t.accessToken()) : null;

    if (access == null) {
      String refresh = decryptRefresh(accountId, t.refreshToken());
      GraphApiClient.TokenResponse r = graphApiClient.refresh(refresh);
      access = r.accessToken();

      // AAD 는 매 갱신마다 refresh_token 회전 → 새 값(없으면 기존 유지) 저장
      String newRefresh = r.refreshToken() != null ? r.refreshToken() : refresh;
      accountRepo.updateOAuthTokens(
          accountId,
          encryption.encrypt(newRefresh),
          encryption.encrypt(access),
          OffsetDateTime.now().plusSeconds(r.expiresInSec()));

      log.debug("M365 토큰 갱신 완료: accountId={}", accountId);
    }

    return access;
  }

  /**
   * 캐시된 access_token 을 복호화한다. 복호화할 수 없으면(키 교체·손상) 경고만 남기고 null 을 돌려 호출자가 refresh 하게 한다.
   *
   * <p>로그에는 계정 id 와 예외 클래스 이름만 남긴다(암호문·토큰 금지).
   */
  private String decryptAccessOrNull(long accountId, String enc) {
    if (enc == null) {
      return null;
    }
    try {
      return encryption.decrypt(enc);
    } catch (CryptoException | IllegalArgumentException e) {
      log.warn(
          "M365 access_token 복호화 실패 — refresh 로 대체: accountId={}, cause={}",
          accountId,
          e.getClass().getSimpleName());
      return null;
    }
  }

  /**
   * refresh_token 을 복호화한다. 행에 없거나 복호화할 수 없으면 되살릴 수 없으므로 「계정 다시 연결」 안내(502)로 끊는다.
   *
   * <p>로그에는 계정 id 와 예외 클래스 이름만 남긴다(암호문·토큰 금지).
   */
  private String decryptRefresh(long accountId, String enc) {
    if (enc == null) {
      log.warn("M365 refresh_token 없음: accountId={}", accountId);
      throw MailCredentialUnreadableException.oauthToken(null);
    }
    try {
      return encryption.decrypt(enc);
    } catch (CryptoException | IllegalArgumentException e) {
      log.warn(
          "M365 refresh_token 복호화 실패: accountId={}, cause={}",
          accountId,
          e.getClass().getSimpleName());
      throw MailCredentialUnreadableException.oauthToken(e);
    }
  }
}

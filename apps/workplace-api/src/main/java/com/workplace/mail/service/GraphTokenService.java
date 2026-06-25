package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.exception.EmailAccountNotFoundException;
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
   */
  @Transactional // RLS GUC 주입 필수 — 비-tx 경로는 fail-closed
  public String getAccessToken(long userId, long accountId) {
    OAuthTokens t =
        accountRepo
            .findOAuthTokens(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));

    OffsetDateTime exp = t.expiresAt();
    String access = t.accessToken() == null ? null : encryption.decrypt(t.accessToken());

    // 만료 2분 전이면 갱신
    if (access == null || exp == null || exp.isBefore(OffsetDateTime.now().plusMinutes(2))) {
      String refresh = encryption.decrypt(t.refreshToken());
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
}

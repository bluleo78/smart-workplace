package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.OAuthTokenRedeemResponse;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Phase 5c-2 후속 (#33): AGENT 의 Claude CLI OAuth 토큰 등록/회수/redeem. - 등록 시 기존 active 자동 revoke (UPSERT
 * 시맨틱). - 평문 토큰은 등록 시점과 redeemSelf 응답에만 다룬다 — DB 에는 EncryptionService 출력만. - HUMAN 대상은 400
 * (KeyTargetMustBeAgentException).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AiAgentCredentialService {

  private final AiAgentCredentialRepository repo;
  private final UserRepository userRepository;
  private final EncryptionService encryptionService;
  private final AuditLogService auditLogService;

  /** AGENT 에 새 토큰 등록 — 기존 active 가 있으면 자동 revoke. */
  public OAuthTokenMetaResponse register(
      Long callerId, Long agentUserId, String plaintextToken, String label) {
    assertAgent(agentUserId);

    repo.revokeActive(agentUserId); // 기존 active 가 있으면 회수 (없으면 noop)

    String encrypted = encryptionService.encrypt(plaintextToken);
    Long id = repo.insert(agentUserId, encrypted, label, callerId);

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_OAUTH_TOKEN_REGISTERED",
        "ai_agent_credential",
        String.valueOf(id),
        "AGENT OAuth 토큰 등록",
        null,
        null,
        "SUCCESS",
        null,
        Map.of("agent_user_id", String.valueOf(agentUserId), "label", String.valueOf(label)));

    AiAgentCredentialRow row =
        repo.findActive(agentUserId)
            .orElseThrow(() -> new IllegalStateException("등록 직후 active 없음 — 동시성 문제"));
    return new OAuthTokenMetaResponse(row.id(), row.label(), row.createdAt(), row.lastUsedAt());
  }

  /** AGENT 의 active 토큰 회수. 없으면 noop (idempotent). */
  public void revoke(Long callerId, Long agentUserId) {
    assertAgent(agentUserId);
    int affected = repo.revokeActive(agentUserId);
    if (affected > 0) {
      auditLogService.log(
          callerId,
          resolveUsername(callerId),
          "AGENT_OAUTH_TOKEN_REVOKED",
          "ai_agent_credential",
          String.valueOf(agentUserId),
          "AGENT OAuth 토큰 회수",
          null,
          null,
          "SUCCESS",
          null,
          Map.of("agent_user_id", String.valueOf(agentUserId)));
    }
  }

  /** 관리자 GET — 메타만, 평문 없음. 없으면 404. */
  @Transactional(readOnly = true)
  public OAuthTokenMetaResponse getActiveMeta(Long agentUserId) {
    assertAgent(agentUserId);
    AiAgentCredentialRow row =
        repo.findActive(agentUserId).orElseThrow(OAuthTokenNotFoundException::new);
    return new OAuthTokenMetaResponse(row.id(), row.label(), row.createdAt(), row.lastUsedAt());
  }

  /** AGENT 본인 — 평문 토큰 + label 반환. last_used_at 갱신. 없으면 404. */
  public OAuthTokenRedeemResponse redeemSelf(Long agentUserId) {
    assertAgent(agentUserId);
    AiAgentCredentialRow row =
        repo.findActive(agentUserId).orElseThrow(OAuthTokenNotFoundException::new);
    String plaintext = encryptionService.decrypt(row.encryptedToken());
    repo.touchLastUsed(row.id());
    return new OAuthTokenRedeemResponse(plaintext, row.label());
  }

  private UserResponse assertAgent(Long userId) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new UserNotFoundException("User not found: " + userId));
    if (!UserKind.isAgent(user.kind())) throw new KeyTargetMustBeAgentException();
    return user;
  }

  private String resolveUsername(Long userId) {
    return userRepository.findById(userId).map(UserResponse::username).orElse(null);
  }
}

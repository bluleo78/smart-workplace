package com.workplace.auth.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.ProviderCredentialRedeemResponse;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.global.security.EncryptionService;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Phase 5c-2 후속 (#33), 멀티 프로바이더(#opencode) 확장: AGENT 의 프로바이더 자격증명(Claude CLI OAuth 토큰 / opencode 호환
 * provider config) 등록/회수/redeem. - 등록 시 기존 active 자동 revoke (UPSERT 시맨틱). - 평문 자격증명은 등록 시점과
 * redeemSelf 응답에만 다룬다 — DB 에는 EncryptionService 출력만. - HUMAN 대상은 400
 * (KeyTargetMustBeAgentException). - provider 허용값·payload 형태 검증은 이 서비스 한 곳(chokepoint)에서만 수행한다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AiAgentCredentialService {

  /** 현재 지원하는 provider 값 — 등록 시 이 집합 밖이면 400. */
  private static final Set<String> PROVIDERS = Set.of("anthropic", "opencode");

  private final AiAgentCredentialRepository repo;
  private final AssistantConfigRepository configRepo;
  private final UserRepository userRepository;
  private final EncryptionService encryptionService;
  private final AuditLogService auditLogService;
  private final ObjectMapper objectMapper;

  /**
   * AGENT 에 새 자격증명 등록 — 기존 active 가 있으면 자동 revoke.
   *
   * <p>provider='anthropic': plaintextSecret=OAuth 토큰. provider='opencode':
   * plaintextSecret=provider config JSON 문자열({"providerId","options":{"baseURL","apiKey",...}}) 이며
   * model 이 필수 — 같은 트랜잭션에서 assistant_config.model 을 함께 upsert한다(maxTurns/timeoutMs 는 기존 값 보존).
   */
  public OAuthTokenMetaResponse register(
      Long callerId,
      Long agentUserId,
      String provider,
      String plaintextSecret,
      String label,
      String model) {
    assertAgent(agentUserId);
    if (!PROVIDERS.contains(provider)) {
      throw new InvalidProviderCredentialException("지원하지 않는 provider 입니다: " + provider);
    }
    if ("opencode".equals(provider)) {
      validateOpencodePayload(plaintextSecret);
      if (model == null || model.isBlank()) {
        throw new InvalidProviderCredentialException("opencode 등록에는 model 이 필수입니다");
      }
    } else if (plaintextSecret == null || plaintextSecret.isBlank()) {
      throw new InvalidProviderCredentialException("anthropic 등록에는 token 이 필수입니다");
    }

    repo.revokeActive(agentUserId); // 기존 active 가 있으면 회수 (없으면 noop)

    String encrypted = encryptionService.encrypt(plaintextSecret);
    Long id = repo.insert(agentUserId, provider, encrypted, label, callerId);

    if (model != null && !model.isBlank()) {
      // opencode 는 provider 변경 시 기존 model 이 무의미해질 수 있어 자격증명과 함께 upsert.
      // (anthropic 경로는 model 인자가 null 이라 이 블록에 들어오지 않는다 — 기존 설정 화면(updateSettings)이 별도 관리.)
      ConfigRow cur = configRepo.find(agentUserId).orElse(new ConfigRow(null, null, null, null));
      configRepo.upsert(agentUserId, model, cur.thinkingDepth(), cur.maxTurns(), cur.timeoutMs());
    }

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_OAUTH_TOKEN_REGISTERED",
        "ai_agent_credential",
        String.valueOf(id),
        "AGENT 프로바이더 자격증명 등록",
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "agent_user_id", String.valueOf(agentUserId),
            "provider", provider,
            "label", String.valueOf(label)));

    AiAgentCredentialRow row =
        repo.findActive(agentUserId)
            .orElseThrow(() -> new IllegalStateException("등록 직후 active 없음 — 동시성 문제"));
    return toMeta(row);
  }

  /** AGENT 의 active 자격증명 회수. 없으면 noop (idempotent). */
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
          "AGENT 프로바이더 자격증명 회수",
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
    return toMeta(row);
  }

  /** AGENT 활성 자격증명 메타 — 없으면 empty (throw 없이 조회하려는 개인 비서 상태 화면 등에서 사용). 평문/암호문 미포함. */
  @Transactional(readOnly = true)
  public Optional<OAuthTokenMetaResponse> findActiveMetaIfPresent(Long agentUserId) {
    return repo.findActive(agentUserId).map(this::toMeta);
  }

  /**
   * AGENT 본인 — 평문 자격증명 반환. last_used_at 갱신(실제 LLM 호출 redeem 경로 전용 — ai-agent 의 GET
   * /users/me/provider-credential 에서만 사용). 없으면 404. provider='anthropic'이면 token, 'opencode'이면
   * payload(복호화된 provider config JSON)에 채워진다. model 은 assistant_config.model(없으면 null).
   */
  public ProviderCredentialRedeemResponse redeemSelf(Long agentUserId) {
    assertAgent(agentUserId);
    AiAgentCredentialRow row =
        repo.findActive(agentUserId).orElseThrow(OAuthTokenNotFoundException::new);
    ProviderCredentialRedeemResponse result = toRedeemResponse(agentUserId, row);
    repo.touchLastUsed(row.id());
    return result;
  }

  /**
   * AGENT 활성 자격증명 평문 조회 — last_used_at 갱신 없음. 모델 목록 조회(GET .../models)처럼 실제 LLM 호출이 아닌 메타/탐색성 경로에서
   * 사용한다. redeemSelf 와 응답 형태는 동일하되 "사용"으로 집계되지 않는다.
   */
  @Transactional(readOnly = true)
  public ProviderCredentialRedeemResponse decryptActivePayload(Long agentUserId) {
    assertAgent(agentUserId);
    AiAgentCredentialRow row =
        repo.findActive(agentUserId).orElseThrow(OAuthTokenNotFoundException::new);
    return toRedeemResponse(agentUserId, row);
  }

  private ProviderCredentialRedeemResponse toRedeemResponse(
      Long agentUserId, AiAgentCredentialRow row) {
    String plaintext = encryptionService.decrypt(row.encryptedToken());
    String model = configRepo.find(agentUserId).map(ConfigRow::model).orElse(null);
    return "opencode".equals(row.provider())
        ? new ProviderCredentialRedeemResponse("opencode", null, plaintext, model, row.label())
        : new ProviderCredentialRedeemResponse("anthropic", plaintext, null, model, row.label());
  }

  /**
   * provider config JSON 검증 — providerId·options.baseURL·options.apiKey 필수. baseURL 은 등록 후 GET
   * .../models 프로브에서 적용되는 것과 동일한 ProbeUrlValidator(https-only 또는 사설망 http) 를 등록 시점에도 통과해야 한다 — 그렇지
   * 않으면 등록은 성공하나 모델 목록 조회가 매번 400 으로 실패하는 비일관 상태가 된다. 실패 시 400.
   */
  private void validateOpencodePayload(String plaintextSecret) {
    JsonNode node;
    try {
      node = objectMapper.readTree(plaintextSecret);
    } catch (Exception e) {
      throw new InvalidProviderCredentialException("opencode provider config 는 올바른 JSON 이어야 합니다");
    }
    if (!node.hasNonNull("providerId")) {
      throw new InvalidProviderCredentialException("opencode provider config 에 providerId 가 필요합니다");
    }
    JsonNode options = node.get("options");
    if (options == null || !options.hasNonNull("baseURL") || !options.hasNonNull("apiKey")) {
      throw new InvalidProviderCredentialException(
          "opencode provider config 에 options.baseURL/options.apiKey 가 필요합니다");
    }
    ProbeUrlValidator.validate(options.get("baseURL").asText());
  }

  /** row → 메타 응답. opencode 는 복호화 후 payload 에서 options.baseURL 을 추출(실패 시 null), anthropic 은 null. */
  private OAuthTokenMetaResponse toMeta(AiAgentCredentialRow row) {
    String baseUrl = "opencode".equals(row.provider()) ? extractBaseUrl(row) : null;
    return new OAuthTokenMetaResponse(
        row.id(), row.provider(), baseUrl, row.label(), row.createdAt(), row.lastUsedAt());
  }

  private String extractBaseUrl(AiAgentCredentialRow row) {
    try {
      String plaintext = encryptionService.decrypt(row.encryptedToken());
      JsonNode options = objectMapper.readTree(plaintext).get("options");
      return options != null && options.hasNonNull("baseURL")
          ? options.get("baseURL").asText()
          : null;
    } catch (Exception e) {
      return null; // 메타 조회는 best-effort — 파싱 실패로 전체 응답을 깨뜨리지 않는다.
    }
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

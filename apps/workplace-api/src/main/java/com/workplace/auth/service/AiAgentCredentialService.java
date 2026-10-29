package com.workplace.auth.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.ProviderCredentialRedeemResponse;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.exception.KeyTargetMustBeAgentException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.exception.PersonalAssistantAdminChangeForbiddenException;
import com.workplace.auth.outbound.PersonalAssistantCredentialRevokedEvent;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.AssistantConfigRepository.ConfigRow;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserNotFoundException;
import com.workplace.user.repository.UserRepository;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
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
  private final ModelBaseUrlGuard urlGuard;
  private final ApplicationEventPublisher publisher;

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
    UserResponse agent = assertAgent(agentUserId);
    // WP-1163: 개인 비서의 연결은 주인만 등록·재발급한다 — 관리자 경로(AdminProviderCredentialController)도 이 메서드를 쓰므로
    // 등록 지점 한 곳에서 막는다. 남이 바꾸면 주인의 대화가 주인 모르게 그 사람의 연결로 나간다(403). 회수는 정리 수단으로 남긴다.
    // callerId 가 없으면(비정상 경로) 주인으로 볼 수 없으니 막는다 — long 으로 풀다 NPE 가 나지 않게(WP-1170).
    if (AgentUsernames.isPersonalAssistant(agent.username())
        && (callerId == null
            || AgentUsernames.isOthersPersonalAssistant(agent.username(), callerId))) {
      throw new PersonalAssistantAdminChangeForbiddenException("개인 비서의 AI 연결은 주인만 등록할 수 있습니다");
    }
    if (!PROVIDERS.contains(provider)) {
      throw new InvalidProviderCredentialException("지원하지 않는 provider 입니다: " + provider);
    }
    // opencode 연결의 providerId — 추천 모델("providerId/model") 유지 판단에 쓴다. anthropic 은 null.
    String providerId = null;
    if ("opencode".equals(provider)) {
      providerId = validateOpencodePayload(plaintextSecret);
      if (model == null || model.isBlank()) {
        throw new InvalidProviderCredentialException("opencode 등록에는 model 이 필수입니다");
      }
    } else if (plaintextSecret == null || plaintextSecret.isBlank()) {
      throw new InvalidProviderCredentialException("anthropic 등록에는 token 이 필수입니다");
    }

    // 회수 전에 이전 active 의 provider 를 읽어 둔다(아래 추천 모델 초기화 판단용).
    Optional<String> previousProvider =
        repo.findActive(agentUserId).map(r -> AgentProviders.normalize(r.provider()));
    repo.revokeActive(agentUserId); // 기존 active 가 있으면 회수 (없으면 noop)

    String encrypted = encryptionService.encrypt(plaintextSecret);
    Long id = repo.insert(agentUserId, provider, encrypted, label, callerId);

    // opencode→anthropic 전환처럼 provider 가 바뀌면 이전 provider 형식의 model 문자열
    // (예: "amazon-bedrock-openai/google.gemma-...")이 새 provider 에는 무의미해진다. anthropic 은
    // 등록 폼에 model 입력이 없어 model 인자가 항상 null 이므로, 그 경우 정적 기본값(AssistantDefaults.MODEL)
    // 으로 덮어써 stale 값이 새 provider 에 그대로 흘러가는 걸 막는다(실측 버그: anthropic 재등록 후
    // assistant_config.model 이 이전 opencode 모델 문자열로 남아 실행 시점 오류로 이어짐).
    String effectiveModel =
        (model != null && !model.isBlank())
            ? model
            : (AgentProviders.isAnthropic(provider) ? AssistantDefaults.MODEL : null);
    if (effectiveModel != null) {
      ConfigRow cur = configRepo.find(agentUserId).orElse(new ConfigRow(null, null, null, null));
      configRepo.upsert(
          agentUserId, effectiveModel, cur.thinkingDepth(), cur.maxTurns(), cur.timeoutMs());
    }
    // WP-139: 추천 질문 모델은 새 연결에서 쓸 수 있을 때만 남기고 아니면 자동(null)으로 되돌린다 — 남겨 두면 새 러너가 모르는 모델로
    // 실행돼 추천·후속 질문이 오류 표시 없이 전부 빠진다.
    if (!suggestionModelUsable(agentUserId, previousProvider, provider, providerId)) {
      configRepo.updateSuggestionModel(agentUserId, null);
    }

    auditLogService.log(
        callerId,
        resolveUsername(callerId),
        "AGENT_OAUTH_TOKEN_REGISTERED",
        "ai_agent_credential",
        String.valueOf(id),
        // WP-706 대상 AI 를 아이디로 적는다(키 기록과 같은 이유).
        "AGENT 프로바이더 자격증명 등록: " + agent.username(),
        null,
        null,
        "SUCCESS",
        null,
        Map.of(
            "agent_user_id", String.valueOf(agentUserId),
            "agentUsername", agent.username(),
            "provider", provider,
            "label", String.valueOf(label)));

    AiAgentCredentialRow row =
        repo.findActive(agentUserId)
            .orElseThrow(() -> new IllegalStateException("등록 직후 active 없음 — 동시성 문제"));
    return toMeta(row);
  }

  /**
   * 관리 경로(AI 관리 화면)에서 이 AI 의 연결을 등록·재발급할 수 있는지(WP-1170) — 개인 비서는 관리자 자신의 것이라도 막는다(403). 주인은 내 설정
   * 경로(/users/me/provider-credential)로 등록한다. 화면이 모든 개인 비서에서 등록 버튼을 숨기는 규칙과 서버를 맞춘다.
   */
  public void assertAdminMayConfigure(Long agentUserId) {
    UserResponse agent = assertAgent(agentUserId);
    if (AgentUsernames.isPersonalAssistant(agent.username())) {
      throw new PersonalAssistantAdminChangeForbiddenException("개인 비서의 AI 연결은 주인만 등록할 수 있습니다");
    }
  }

  /**
   * AGENT 의 active 자격증명 회수. 없으면 noop (idempotent). 주인이 아닌 사람이 개인 비서의 연결을 회수하면(관리자의 정리) 감사 로그에 「개인
   * 비서 정리」 사유를 남기고, 커밋 뒤 주인에게 「다시 연결해 주세요」 알림을 보낸다(WP-1170) — 주인은 비서가 왜 멈췄는지 모른 채 남았다.
   */
  public void revoke(Long callerId, Long agentUserId) {
    UserResponse agent = assertAgent(agentUserId);
    int affected = repo.revokeActive(agentUserId);
    Long ownerId = AgentUsernames.ownerIdOf(agent.username());
    boolean othersPersonal = ownerId != null && !ownerId.equals(callerId);
    if (affected > 0 && othersPersonal) {
      auditLogService.log(
          callerId,
          resolveUsername(callerId),
          "AGENT_OAUTH_TOKEN_REVOKED",
          "ai_agent_credential",
          String.valueOf(agentUserId),
          "개인 비서 정리 — 주인이 아닌 사람이 개인 비서 AI 연결 회수: " + agent.username(),
          null,
          null,
          "SUCCESS",
          null,
          Map.of(
              "agent_user_id", String.valueOf(agentUserId),
              "agentUsername", agent.username(),
              "owner_user_id", String.valueOf(ownerId),
              "reason", "개인 비서 정리"));
      Long tenantId = TenantContext.get();
      if (tenantId != null && callerId != null) {
        publisher.publishEvent(
            new PersonalAssistantCredentialRevokedEvent(tenantId, ownerId, callerId));
      }
    } else if (affected > 0) {
      auditLogService.log(
          callerId,
          resolveUsername(callerId),
          "AGENT_OAUTH_TOKEN_REVOKED",
          "ai_agent_credential",
          String.valueOf(agentUserId),
          "AGENT 프로바이더 자격증명 회수: " + agent.username(),
          null,
          null,
          "SUCCESS",
          null,
          Map.of("agent_user_id", String.valueOf(agentUserId), "agentUsername", agent.username()));
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
   * 모델 이미지 입력 수동 지정 갱신(WP-250) — 등록 후 모델만 바꾸거나 지금 모델의 지정을 고칠 때(비서 설정 변경). 활성 opencode 자격증명의
   * provider config 에서 vision 만 {@code {model: true|false}} 로 바꾸거나(이전 모델 키는 지운다 — 지금 모델만 의미가 있다)
   * 지운다(null = 자동 감지). 같은 행을 그 자리에서 다시 암호화해 쓴다 — 재등록(register)처럼 회수·새 행·감사 로그·추천 모델 초기화를 일으키지 않고,
   * providerId·options(apiKey 포함)는 값 그대로 둔다.
   *
   * @param model 지정을 걸 모델("providerId/modelId", 저장 키와 같은 형식)
   * @param vision boolean 또는 null(자동). 그 밖은 400
   */
  public void updateModelVision(Long agentUserId, String model, JsonNode vision) {
    boolean auto = vision == null || vision.isNull();
    if (!auto && !vision.isBoolean()) {
      throw new InvalidProviderCredentialException("vision 은 true/false 또는 null(자동 감지)이어야 합니다");
    }
    AiAgentCredentialRow row = repo.findActive(agentUserId).orElse(null);
    if (row == null || !"opencode".equals(row.provider())) {
      if (auto) return; // 지정할 것이 없다(Claude 연결은 늘 이미지를 본다)
      throw new InvalidProviderCredentialException("이미지 입력 지정은 OpenAI 호환 연결에만 할 수 있습니다");
    }
    if (!auto && (model == null || model.isBlank())) {
      throw new InvalidProviderCredentialException("이미지 입력을 지정할 모델이 없습니다");
    }
    ObjectNode payload;
    try {
      payload = (ObjectNode) readPayload(row);
    } catch (JsonProcessingException | ClassCastException e) {
      throw new IllegalStateException("저장된 provider config 를 읽을 수 없습니다", e);
    }
    if (auto) {
      if (!payload.has("vision")) return;
      payload.remove("vision");
    } else {
      ObjectNode perModel = objectMapper.createObjectNode();
      perModel.put(model, vision.booleanValue());
      payload.set("vision", perModel);
    }
    try {
      repo.updateEncryptedToken(
          row.id(), encryptionService.encrypt(objectMapper.writeValueAsString(payload)));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("provider config 를 저장할 수 없습니다", e);
    }
  }

  /**
   * 지금 모델의 이미지 입력 수동 지정(WP-250) — 비서 설정 화면이 초깃값으로 보여 준다. 모델별 맵이면 그 모델 키, 전 모델 공통 boolean 이면 그 값,
   * 지정이 없거나 opencode 연결이 아니면 null(자동 감지). ai-agent manualVision 과 같은 읽기 규칙(키는
   * "providerId/modelId").
   */
  @Transactional(readOnly = true)
  public Boolean findModelVision(Long agentUserId, String model) {
    return repo.findActive(agentUserId)
        .filter(r -> "opencode".equals(r.provider()))
        .map(r -> readVision(r, model))
        .orElse(null);
  }

  private Boolean readVision(AiAgentCredentialRow row, String model) {
    try {
      JsonNode v = readPayload(row).get("vision");
      if (v == null || v.isNull()) return null;
      if (v.isBoolean()) return v.booleanValue();
      JsonNode m = model == null ? null : v.get(model);
      return m != null && m.isBoolean() ? m.booleanValue() : null;
    } catch (Exception e) {
      return null; // 상태 조회는 best-effort — 파싱 실패로 화면 전체를 깨뜨리지 않는다(extractBaseUrl 과 같은 규칙).
    }
  }

  /**
   * 저장된 추천 모델을 새 연결에서도 쓸 수 있는가(WP-139). 추천 모델은 provider 형식에 묶인다(Anthropic id ↔ opencode
   * "providerId/model").
   *
   * <ul>
   *   <li>provider 계열이 바뀌었거나 이전 연결이 없으면(회수 뒤 재등록 등 — 저장값이 어느 연결용인지 모름) 쓸 수 없다.
   *   <li>anthropic → anthropic(토큰 갱신)은 모델 id 공간이 같아 그대로 쓴다.
   *   <li>opencode → opencode 는 저장값의 "providerId/" 접두가 새 연결의 providerId 와 같을 때만 쓴다(API 키 교체 등). 접두가
   *       없거나 다르면 새 연결의 provider 가 모르는 모델이다.
   * </ul>
   *
   * <p>한계: 같은 providerId 로 baseURL 만 바꾼 경우 새 서버에 그 모델이 없을 수도 있지만 등록 시점엔 알 수 없다(비서 모델도 같은 조건) — 이
   * 경우는 사용자 선택을 지킨다.
   */
  private boolean suggestionModelUsable(
      Long agentUserId, Optional<String> previousProvider, String provider, String providerId) {
    if (!previousProvider.equals(Optional.of(AgentProviders.normalize(provider)))) return false;
    if (!"opencode".equals(provider)) return true;
    String saved = configRepo.find(agentUserId).map(ConfigRow::suggestionModel).orElse(null);
    return saved == null || saved.startsWith(providerId + "/");
  }

  /**
   * provider config JSON 검증 — providerId·options.baseURL·options.apiKey 필수. baseURL 은 등록 후 GET
   * .../models 프로브에서 적용되는 것과 동일한 ModelBaseUrlGuard(https·공인 주소, 운영자 허용 목록 예외 — WP-596) 를 등록 시점에도
   * 통과해야 한다 — 그렇지 않으면 등록은 성공하나 모델 목록 조회가 매번 400 으로 실패하는 비일관 상태가 된다. 실패 시 400.
   *
   * @return 검증된 providerId(추천 모델 유지 판단용)
   */
  private String validateOpencodePayload(String plaintextSecret) {
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
    urlGuard.validate(options.get("baseURL").asText());
    validateVision(node.get("vision"));
    return node.get("providerId").asText();
  }

  /**
   * 모델 이미지 입력 수동 설정(WP-250) 검증 — 없음/null(자동 감지), boolean(전 모델 공통), 모든 값이 boolean 인 객체(모델 id →
   * boolean)만 허용한다. ai-agent(manualVision)는 boolean 이 아닌 값을 조용히 무시하므로, 오타("yes" 등)가 "설정했는데 안 먹는"
   * 상태로 저장되지 않게 등록 시점에 막는다.
   */
  private void validateVision(JsonNode vision) {
    if (vision == null || vision.isNull() || vision.isBoolean()) {
      return;
    }
    if (vision.isObject() && vision.properties().stream().allMatch(e -> e.getValue().isBoolean())) {
      return;
    }
    throw new InvalidProviderCredentialException("vision 은 true/false 또는 모델별 true/false 여야 합니다");
  }

  /** row → 메타 응답. opencode 는 복호화 후 payload 에서 options.baseURL 을 추출(실패 시 null), anthropic 은 null. */
  private OAuthTokenMetaResponse toMeta(AiAgentCredentialRow row) {
    String baseUrl = "opencode".equals(row.provider()) ? extractBaseUrl(row) : null;
    return new OAuthTokenMetaResponse(
        row.id(), row.provider(), baseUrl, row.label(), row.createdAt(), row.lastUsedAt());
  }

  private String extractBaseUrl(AiAgentCredentialRow row) {
    try {
      JsonNode options = readPayload(row).get("options");
      return options != null && options.hasNonNull("baseURL")
          ? options.get("baseURL").asText()
          : null;
    } catch (Exception e) {
      return null; // 메타 조회는 best-effort — 파싱 실패로 전체 응답을 깨뜨리지 않는다.
    }
  }

  /**
   * 저장된 자격증명을 복호화해 JSON 으로 읽는다(opencode provider config). 파싱 실패 처리는 호출자마다 다르다(best-effort 조회·저장
   * 거절).
   */
  private JsonNode readPayload(AiAgentCredentialRow row) throws JsonProcessingException {
    return objectMapper.readTree(encryptionService.decrypt(row.encryptedToken()));
  }

  private UserResponse assertAgent(Long userId) {
    UserResponse user =
        userRepository.findById(userId).orElseThrow(() -> UserNotFoundException.ofId(userId));
    if (!UserKind.isAgent(user.kind())) throw new KeyTargetMustBeAgentException();
    return user;
  }

  private String resolveUsername(Long userId) {
    return userRepository.findById(userId).map(UserResponse::username).orElse(null);
  }
}

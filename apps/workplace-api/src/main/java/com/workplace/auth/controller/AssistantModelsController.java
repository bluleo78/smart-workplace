package com.workplace.auth.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.AgentModelsResponse;
import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.OAuthTokenMetaResponse;
import com.workplace.auth.dto.ProbeModelsRequest;
import com.workplace.auth.dto.ProbeModelsResponse;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.ProviderCredentialRedeemResponse;
import com.workplace.auth.exception.AssistantModelsProbeException;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.outbound.AiAgentModelsClient;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.AssistantModels;
import com.workplace.auth.service.ProbeUrlValidator;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Task10 — 프로바이더 모델 목록/프로브 API. 등록 전(POST .../probe, 임의 baseURL+apiKey) 과 등록 후(GET .../models, 저장된
 * 자격증명 기준) 양쪽을 제공한다. anthropic 은 정적 목록(AssistantModels), opencode 는 ai-agent 에 위임해 실시간 프로브한다.
 */
@RestController
@RequiredArgsConstructor
public class AssistantModelsController {

  private final AiAgentModelsClient modelsClient;
  private final AiAgentCredentialService credentialService;
  private final PersonalAssistantRepository personalRepo;
  private final ObjectMapper objectMapper;

  /** 관리자 — 임의 baseURL+apiKey 로 등록 전 모델 프로브. */
  @PostMapping("/api/v1/admin/agents/models/probe")
  @RequirePermission("user:write")
  public ProbeModelsResponse adminProbe(@Valid @RequestBody ProbeModelsRequest req) {
    return probe(req.providerConfig());
  }

  /** 본인 — 임의 baseURL+apiKey 로 등록 전 모델 프로브(개인 비서). */
  @PostMapping("/api/v1/users/me/assistant/models/probe")
  public ProbeModelsResponse myProbe(@Valid @RequestBody ProbeModelsRequest req) {
    return probe(req.providerConfig());
  }

  /** 관리자 — AGENT 의 저장된 자격증명 기준 모델 목록. */
  @GetMapping("/api/v1/admin/agents/{userId}/models")
  @RequirePermission("user:write")
  public AgentModelsResponse adminModels(@PathVariable Long userId) {
    return resolveAgentModels(userId);
  }

  /** 본인 — 개인 비서의 저장된 자격증명 기준 모델 목록. 개인 비서 미설정이면 409(IllegalStateException 공통 매핑). */
  @GetMapping("/api/v1/users/me/assistant/models")
  public AgentModelsResponse myModels(@AuthenticationPrincipal Long callerId) {
    long agentId =
        personalRepo
            .findAgentId(callerId)
            .orElseThrow(() -> new IllegalStateException("개인 비서가 설정되지 않았어요."));
    return resolveAgentModels(agentId);
  }

  // 등록 전 프로브도 저장 형식(providerId/modelId)과 동일하게 접두해 반환한다 — 그래야 프론트가
  // 응답을 가공 없이 그대로 assistant_config.model 에 저장해도 실행 시점 splitOpencodeModel 이 통과한다.
  // (실측 버그: 접두 누락 시 저장된 model 이 'google.gemma-...' 형태로 남아 opencode 실행이 즉시 실패)
  private ProbeModelsResponse probe(ProviderConfig config) {
    String baseUrl = requireOption(config, "baseURL");
    requireOption(config, "apiKey");
    ProbeUrlValidator.validate(baseUrl);
    String prefix = config.providerId() + "/";
    List<ModelOption> prefixed =
        modelsClient.probeModels(config).stream()
            .map(m -> new ModelOption(prefix + m.id(), prefix + m.label()))
            .toList();
    return new ProbeModelsResponse(prefixed);
  }

  /** provider(anthropic/opencode) 별 모델 목록 해석. opencode 는 복호화 payload 로 실시간 프로브 후 providerId/ 접두. */
  private AgentModelsResponse resolveAgentModels(long agentId) {
    OAuthTokenMetaResponse meta = credentialService.getActiveMeta(agentId);
    if (!"opencode".equals(meta.provider())) {
      return new AgentModelsResponse(meta.provider(), AssistantModels.ANTHROPIC);
    }

    // opencode: 복호화 payload 를 얻어 프로브. 모델 목록 조회는 실제 LLM 호출이 아니므로 last_used_at 을 갱신하는
    // redeemSelf 가 아니라 읽기 전용 decryptActivePayload 를 쓴다(단순 드롭다운 오픈이 "사용" 으로 집계되지 않도록).
    // agentId 가 실제로 이 자격증명의 소유 AGENT 라는 사실은 위의 getActiveMeta(agentId) 조회 자체(및 그 앞의
    // 관리자 권한/본인 원칙)로 이미 보장된다.
    ProviderCredentialRedeemResponse redeemed = credentialService.decryptActivePayload(agentId);
    ProviderConfig config = parsePayload(redeemed.payload());
    String baseUrl = requireOption(config, "baseURL");
    ProbeUrlValidator.validate(baseUrl);

    String prefix = config.providerId() + "/";
    List<ModelOption> prefixed =
        modelsClient.probeModels(config).stream()
            .map(m -> new ModelOption(prefix + m.id(), prefix + m.label()))
            .toList();
    return new AgentModelsResponse("opencode", prefixed);
  }

  private ProviderConfig parsePayload(String payload) {
    try {
      return objectMapper.readValue(payload, ProviderConfig.class);
    } catch (Exception e) {
      throw new AssistantModelsProbeException("저장된 provider config 를 읽을 수 없습니다.", e);
    }
  }

  /** options 맵에서 문자열 값 추출 — 없거나 빈 문자열이면 400. */
  private String requireOption(ProviderConfig config, String key) {
    Object value = config.options() != null ? config.options().get(key) : null;
    if (!(value instanceof String s) || s.isBlank()) {
      throw new InvalidProviderCredentialException("providerConfig.options." + key + " 가 필요합니다");
    }
    return s;
  }
}

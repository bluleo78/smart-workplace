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
import com.workplace.global.exception.CryptoException;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import java.util.List;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Task10 — 프로바이더 모델 목록/프로브 API. 등록 전(POST .../probe, 임의 baseURL+apiKey) 과 등록 후(GET .../models, 저장된
 * 자격증명 기준) 양쪽을 제공한다. anthropic·opencode 모두 ai-agent 에 위임해 실시간 조회하며, anthropic 은 실패 시 정적
 * 목록(AssistantModels)으로 폴백한다(#873).
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class AssistantModelsController {

  private final AiAgentModelsClient modelsClient;
  private final AiAgentCredentialService credentialService;
  private final PersonalAssistantRepository personalRepo;
  private final ObjectMapper objectMapper;

  /**
   * 관리자 — 임의 baseURL+apiKey 로 등록 전 모델 프로브. 이 핸들러 자체는 리포지토리를 호출하지 않지만, 같은 컨트롤러가 {@link
   * PersonalAssistantRepository} 를 주입받아 #640 아키텍처 가드 대상이라 클래스 단위로 {@code @Transactional} 을 통일한다.
   */
  @PostMapping("/api/v1/admin/agents/models/probe")
  @RequirePermission("user:write")
  @Transactional(readOnly = true)
  public ProbeModelsResponse adminProbe(@Valid @RequestBody ProbeModelsRequest req) {
    return probe(req.providerConfig());
  }

  /** 본인 — 임의 baseURL+apiKey 로 등록 전 모델 프로브(개인 비서). */
  @PostMapping("/api/v1/users/me/assistant/models/probe")
  @Transactional(readOnly = true)
  public ProbeModelsResponse myProbe(@Valid @RequestBody ProbeModelsRequest req) {
    return probe(req.providerConfig());
  }

  /** 관리자 — AGENT 의 저장된 자격증명 기준 모델 목록. */
  @GetMapping("/api/v1/admin/agents/{userId}/models")
  @RequirePermission("user:write")
  @Transactional(readOnly = true)
  public AgentModelsResponse adminModels(@PathVariable Long userId) {
    return resolveAgentModels(userId);
  }

  /**
   * 본인 — 개인 비서의 저장된 자격증명 기준 모델 목록. 개인 비서 미설정이면 409(IllegalStateException 공통 매핑).
   *
   * <p>{@code user} 테이블 자체는 RLS 대상이 아니라 지금 당장 fail-closed 로 이어지진 않지만, 컨트롤러가 리포지토리를 직접 호출하는 경로는 #640
   * 아키텍처 가드(RlsTransactionalArchTest)가 일괄로 {@code @Transactional} 을 요구한다.
   */
  @GetMapping("/api/v1/users/me/assistant/models")
  @Transactional(readOnly = true)
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

  /**
   * provider(anthropic/opencode) 별 모델 목록 해석. anthropic 은 저장된 토큰으로 Anthropic Models API 실시간 조회(#873,
   * 실패 시 정적 목록 폴백), opencode 는 복호화 payload 로 실시간 프로브 후 providerId/ 접두.
   */
  private AgentModelsResponse resolveAgentModels(long agentId) {
    OAuthTokenMetaResponse meta = credentialService.getActiveMeta(agentId);
    if (!"opencode".equals(meta.provider())) {
      return new AgentModelsResponse(meta.provider(), anthropicModels(agentId));
    }

    // 모델 목록 조회는 실제 LLM 호출이 아니므로 last_used_at 을 갱신하는 redeemSelf 가 아니라 읽기 전용
    // decryptActivePayload 를 쓴다(단순 드롭다운 오픈이 "사용" 으로 집계되지 않도록 — anthropic 경로도 동일). agentId 가 실제로 이
    // 자격증명의 소유 AGENT 라는 사실은 위의 getActiveMeta(agentId) 조회 자체(및 그 앞의 관리자 권한/본인 원칙)로 이미 보장된다.
    ProviderCredentialRedeemResponse redeemed = credentialService.decryptActivePayload(agentId);
    ProviderConfig config = parsePayload(redeemed.payload());
    String baseUrl = requireOption(config, "baseURL");
    ProbeUrlValidator.validate(baseUrl);

    String prefix = config.providerId() + "/";
    List<ModelOption> prefixed =
        modelsClient.probeModels(config).stream()
            .map(m -> new ModelOption(prefix + m.id(), prefix + m.label()))
            .toList();
    return new AgentModelsResponse("opencode", withSavedModel(prefixed, redeemed.model()));
  }

  /**
   * anthropic 실시간 모델 목록(+저장된 모델). 드롭다운이 비어 설정 자체가 막히지 않도록 토큰 복호화 실패(키 교체·손상 행)와 조회 실패(토큰
   * 만료·네트워크·ai-agent 장애)는 502/500 으로 올리지 않고 정적 목록으로 폴백한다. 폴백 시에도 저장된 모델은 유지한다.
   */
  private List<ModelOption> anthropicModels(long agentId) {
    ProviderCredentialRedeemResponse redeemed;
    try {
      redeemed = credentialService.decryptActivePayload(agentId);
    } catch (CryptoException e) {
      log.warn("Anthropic 토큰 복호화 실패 — 정적 모델 목록으로 폴백");
      return AssistantModels.ANTHROPIC;
    }
    List<ModelOption> models;
    try {
      models = modelsClient.listAnthropicModels(redeemed.token());
    } catch (AssistantModelsProbeException e) {
      log.warn("Anthropic 모델 실시간 조회 실패 — 정적 목록으로 폴백");
      models = AssistantModels.ANTHROPIC;
    }
    return withSavedModel(models, redeemed.model());
  }

  /**
   * 저장된 모델이 목록에 없으면 맨 앞에 덧붙인다. 별칭(claude-haiku-4-5)·폴백 목록 밖 모델을 고른 경우에도 드롭다운이 현재 값을 빈칸으로 표시하지 않게 하기
   * 위함.
   */
  private static List<ModelOption> withSavedModel(List<ModelOption> models, String saved) {
    if (saved == null || saved.isBlank() || models.stream().anyMatch(m -> m.id().equals(saved))) {
      return models;
    }
    return Stream.concat(Stream.of(new ModelOption(saved, saved)), models.stream()).toList();
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

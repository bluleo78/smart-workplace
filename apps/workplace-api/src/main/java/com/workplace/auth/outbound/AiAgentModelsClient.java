package com.workplace.auth.outbound;

import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.AssistantModelsProbeException;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Task10 — ai-agent POST /models/list 동기 위임. AiAgentMailClient/AiAgentIssueClient 미러(Internal 토큰,
 * 무재시도). options.baseURL/apiKey 를 ProviderConfig 에서 그대로 전달하며, apiKey 는 로그·예외 메시지에 절대 남기지 않는다.
 */
@Slf4j
public class AiAgentModelsClient {

  private final RestClient restClient;
  private final String internalToken;

  public AiAgentModelsClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** provider config(baseURL+apiKey) 로 모델 목록을 프로브. 실패 시 AssistantModelsProbeException(502). */
  public List<ModelOption> probeModels(ProviderConfig config) {
    return postForModels("/models/list", new ModelsListRequest(config.options()));
  }

  /**
   * #873 — 저장된 anthropic 토큰으로 Anthropic Models API 를 실시간 조회(ai-agent POST /models/anthropic/list
   * 위임). 응답은 최신 출시순. 실패 시 AssistantModelsProbeException — 호출부가 정적 목록으로 폴백한다.
   */
  public List<ModelOption> listAnthropicModels(String token) {
    return postForModels("/models/anthropic/list", new AnthropicModelsListRequest(token));
  }

  /**
   * 두 모델 조회 경로 공통 — Internal 인증 POST 후 {models} 를 ModelOption 으로 변환. 요청 본문(자격증명)은 로그·예외에 남기지 않는다.
   */
  private List<ModelOption> postForModels(String uri, Object body) {
    try {
      ModelsListResponse res =
          restClient
              .post()
              .uri(uri)
              .header("Authorization", "Internal " + internalToken)
              .contentType(MediaType.APPLICATION_JSON)
              .body(body)
              .retrieve()
              .body(ModelsListResponse.class);
      if (res == null || res.models() == null) {
        throw new AssistantModelsProbeException("모델 목록 조회에 실패했습니다.");
      }
      return res.models().stream().map(ModelItem::toOption).toList();
    } catch (HttpStatusCodeException e) {
      log.warn("ai-agent 모델 조회 실패: uri={} status={}", uri, e.getStatusCode());
      throw new AssistantModelsProbeException("모델 목록 조회에 실패했습니다.", e);
    } catch (RestClientException e) {
      log.warn("ai-agent 모델 조회 실패: uri={} {}", uri, e.getClass().getSimpleName());
      throw new AssistantModelsProbeException("모델 목록 조회에 실패했습니다.", e);
    }
  }

  /** ai-agent 요청 계약 — { options: { baseURL, apiKey } }. */
  private record ModelsListRequest(Map<String, Object> options) {}

  /** ai-agent 요청 계약(#873) — { token }. */
  private record AnthropicModelsListRequest(String token) {}

  /** ai-agent 응답 계약 — { models: [{ id, label? }] }. label 은 anthropic 경로만 채우므로 없으면 id 로 대체. */
  private record ModelsListResponse(List<ModelItem> models) {}

  private record ModelItem(String id, String label) {
    ModelOption toOption() {
      return new ModelOption(id, label != null && !label.isBlank() ? label : id);
    }
  }
}

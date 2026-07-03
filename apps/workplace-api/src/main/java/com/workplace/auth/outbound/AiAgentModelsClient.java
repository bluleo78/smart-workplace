package com.workplace.auth.outbound;

import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.AssistantModelsProbeException;
import java.util.List;
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
    try {
      ModelsListResponse res =
          restClient
              .post()
              .uri("/models/list")
              .header("Authorization", "Internal " + internalToken)
              .contentType(MediaType.APPLICATION_JSON)
              .body(new ModelsListRequest(config.options()))
              .retrieve()
              .body(ModelsListResponse.class);
      if (res == null || res.models() == null) {
        throw new AssistantModelsProbeException("모델 목록 조회에 실패했습니다.");
      }
      return res.models().stream().map(m -> new ModelOption(m.id(), m.id())).toList();
    } catch (HttpStatusCodeException e) {
      log.error("ai-agent 모델 프로브 실패: status={}", e.getStatusCode());
      throw new AssistantModelsProbeException("모델 목록 조회에 실패했습니다.", e);
    } catch (RestClientException e) {
      log.error("ai-agent 모델 프로브 실패: {}", e.getClass().getSimpleName());
      throw new AssistantModelsProbeException("모델 목록 조회에 실패했습니다.", e);
    }
  }

  /** ai-agent 요청 계약 — { options: { baseURL, apiKey } }. */
  private record ModelsListRequest(java.util.Map<String, Object> options) {}

  /** ai-agent 응답 계약 — { models: [{ id }] }. */
  private record ModelsListResponse(List<ModelItem> models) {}

  private record ModelItem(String id) {}
}

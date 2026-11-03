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

  /**
   * provider config(baseURL+apiKey) 로 모델 목록을 프로브 — 등록 전 검증용(생각의 깊이 단계는 묻지 않아 빠르다). 실패 시
   * AssistantModelsProbeException(502).
   */
  public List<ModelOption> probeModels(ProviderConfig config) {
    return probeModels(config, false);
  }

  /**
   * 모델 목록 조회. withEfforts(WP-1322) 면 ai-agent 가 모델별 생각의 깊이 단계(opencode variant)도 알아내 싣는다 — opencode
   * 를 잠깐 띄우므로 첫 조회가 수 초 늘 수 있어, 비서 설정 드롭다운(등록 후 모델 목록)만 켠다. npm 은 그 조회에 쓰는 provider 패키지(없으면 OpenAI
   * 호환 기본).
   */
  public List<ModelOption> probeModels(ProviderConfig config, boolean withEfforts) {
    return postForModels(
        "/models/list", new ModelsListRequest(config.options(), config.npm(), withEfforts));
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

  /**
   * ai-agent 요청 계약 — { options: { baseURL, apiKey }, npm?, withEfforts }. npm 이 null 이면 null 로 실리고
   * ai-agent 는 선택(nullish) 필드로 받는다. withEfforts(WP-1322) 가 true 일 때만 ai-agent 가 생각의 깊이 단계를 묻는다.
   */
  private record ModelsListRequest(Map<String, Object> options, String npm, boolean withEfforts) {}

  /** ai-agent 요청 계약(#873) — { token }. */
  private record AnthropicModelsListRequest(String token) {}

  /**
   * ai-agent 응답 계약 — { models: [{ id, label?, efforts? }] }. label 은 anthropic 경로만 채우므로 없으면 id 로
   * 대체. efforts(WP-1322) 는 모델이 받는 생각의 깊이 단계 — 모르면 없음(null) 그대로 넘긴다.
   */
  private record ModelsListResponse(List<ModelItem> models) {}

  private record ModelItem(String id, String label, List<String> efforts) {
    ModelOption toOption() {
      return new ModelOption(id, label != null && !label.isBlank() ? label : id, efforts);
    }
  }
}

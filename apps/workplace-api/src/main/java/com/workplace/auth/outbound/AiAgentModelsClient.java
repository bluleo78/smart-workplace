package com.workplace.auth.outbound;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.exception.AssistantModelsProbeException;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
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

  /** ai-agent 오류 본문({error}) 판독용 — 응답 본문만 읽으므로 빈이 아닌 자체 인스턴스. */
  private static final ObjectMapper JSON = new ObjectMapper();

  /**
   * ai-agent 가 키 인증 실패(업스트림 401)를 알리는 오류 코드(WP-1496 계약). 403·다른 400 은 목록 권한만 없는 토큰일 수 있어 ai-agent 가
   * 502 로 답한다 — 여기서는 {@link CredentialCheck#UNAVAILABLE} 이 되어 저장을 막지 않는다.
   */
  static final String CREDENTIAL_REJECTED = "credential_rejected";

  /**
   * ai-agent 가 「워크스페이스 ID 가 있어야 하는 키」(업스트림 400 not scoped to a workspace)를 알리는 오류 코드(WP-1496 개정).
   */
  static final String WORKSPACE_REQUIRED = "workspace_required";

  /**
   * ai-agent 가 「키에 맞지 않는 워크스페이스 ID」(업스트림 400 「anthropic-workspace-id header must be a valid
   * workspace ID.」, 2026-11-11 실측)를 알리는 오류 코드(WP-1496). 확인 못 함으로 넘기면 틀린 ID 가 그대로 저장되므로 따로 받는다.
   */
  static final String WORKSPACE_INVALID = "workspace_invalid";

  private final RestClient restClient;

  /** 등록 확인 전용 — 등록 트랜잭션 안에서 부르므로 응답 대기를 짧게 둔 클라이언트(WP-1496). */
  private final RestClient checkClient;

  private final String internalToken;

  /**
   * @param builder 모델 목록 조회용(응답 대기가 긴 프로브)
   * @param checkBuilder 등록 확인용 — 등록 트랜잭션(DB 연결)을 오래 잡지 않게 응답 대기를 짧게 둔 빌더(WP-1496)
   */
  public AiAgentModelsClient(
      RestClient.Builder builder, RestClient.Builder checkBuilder, String internalToken) {
    this.restClient = builder.build();
    this.checkClient = checkBuilder.build();
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
   * 위임). 응답은 최신 출시순. 실패 시 AssistantModelsProbeException — 호출부가 정적 목록으로 폴백한다. workspaceId 는 연결에 저장된
   * Anthropic 워크스페이스 ID(WP-1496, 선택 — 없으면 null).
   */
  public List<ModelOption> listAnthropicModels(String token, String workspaceId) {
    return postForModels(
        "/models/anthropic/list", new AnthropicModelsListRequest(token, workspaceId, null));
  }

  /**
   * 등록 확인 결과(WP-1496) — 받아들임 / 워크스페이스 ID 가 필요한 키 / 받지 않는 워크스페이스 ID / 키·워크스페이스 거절 / 확인 못 함(ai-agent
   * 장애·연결 실패 등).
   */
  public enum CredentialCheck {
    ACCEPTED,
    WORKSPACE_REQUIRED,
    WORKSPACE_INVALID,
    REJECTED,
    UNAVAILABLE
  }

  /**
   * Anthropic 키를 등록하기 전에 모델 조회 한 번으로 확인한다(WP-1496 — 모든 Claude 토큰 등록 확인). {@code probe: true} 로 보내
   * ai-agent 가 한 쪽(1개)만 받게 해 가볍게 묻는다. ai-agent 400 의 {@code error} 가 {@code workspace_required} 면
   * {@link CredentialCheck#WORKSPACE_REQUIRED}, {@code workspace_invalid} 면 {@link
   * CredentialCheck#WORKSPACE_INVALID}, {@code credential_rejected} 면 {@link
   * CredentialCheck#REJECTED} 이고, 그 밖의 실패(다른 400·5xx·연결 실패·응답 지연·읽을 수 없는 본문)는 {@link
   * CredentialCheck#UNAVAILABLE} 이다 — 일시 장애로 등록을 막지 않게 판단은 호출자에게 맡긴다. 예외를 던지지 않으며 토큰은 로그에 남기지 않는다.
   */
  public CredentialCheck checkAnthropicCredential(String token, String workspaceId) {
    try {
      post(
              checkClient,
              "/models/anthropic/list",
              new AnthropicModelsListRequest(token, workspaceId, true))
          .toBodilessEntity();
      return CredentialCheck.ACCEPTED;
    } catch (HttpStatusCodeException e) {
      if (e.getStatusCode().isSameCodeAs(HttpStatus.BAD_REQUEST)) {
        String code = errorCode(e.getResponseBodyAsString());
        if (WORKSPACE_REQUIRED.equals(code)) return CredentialCheck.WORKSPACE_REQUIRED;
        if (WORKSPACE_INVALID.equals(code)) return CredentialCheck.WORKSPACE_INVALID;
        if (CREDENTIAL_REJECTED.equals(code)) return CredentialCheck.REJECTED;
      }
      log.warn("ai-agent Anthropic 키 확인 실패: status={}", e.getStatusCode());
      return CredentialCheck.UNAVAILABLE;
    } catch (RestClientException e) {
      log.warn("ai-agent Anthropic 키 확인 실패: {}", e.getClass().getSimpleName());
      return CredentialCheck.UNAVAILABLE;
    }
  }

  /** 오류 본문의 {@code error} 값 — JSON 이 아니거나 없으면 null. */
  private static String errorCode(String body) {
    try {
      var node = JSON.readTree(body);
      return node != null && node.path("error").isTextual() ? node.get("error").asText() : null;
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * 두 모델 조회 경로 공통 — Internal 인증 POST 후 {models} 를 ModelOption 으로 변환. 요청 본문(자격증명)은 로그·예외에 남기지 않는다.
   */
  private List<ModelOption> postForModels(String uri, Object body) {
    try {
      ModelsListResponse res = post(restClient, uri, body).body(ModelsListResponse.class);
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
   * 모델 조회·등록 확인 공통 요청 — Internal 인증 JSON POST 를 만들어 응답 읽기 직전(retrieve)까지 돌려준다. 응답 대기가 다른 두
   * 클라이언트(목록용·확인용)를 받아 같은 요청 모양을 쓴다.
   */
  private RestClient.ResponseSpec post(RestClient client, String uri, Object body) {
    return client
        .post()
        .uri(uri)
        .header("Authorization", "Internal " + internalToken)
        .contentType(MediaType.APPLICATION_JSON)
        .body(body)
        .retrieve();
  }

  /**
   * ai-agent 요청 계약 — { options: { baseURL, apiKey }, npm?, withEfforts }. npm 이 null 이면 null 로 실리고
   * ai-agent 는 선택(nullish) 필드로 받는다. withEfforts(WP-1322) 가 true 일 때만 ai-agent 가 생각의 깊이 단계를 묻는다.
   */
  private record ModelsListRequest(Map<String, Object> options, String npm, boolean withEfforts) {}

  /**
   * ai-agent 요청 계약(#873) — { token, workspaceId?, probe? }. workspaceId(WP-1496 — Anthropic 워크스페이스
   * ID, 선택)가 없으면 본문에서 뺀다(ai-agent 는 선택 필드로 받는다). probe(WP-1496)는 등록 확인만 true 로 싣고 — ai-agent 가 한 쪽만
   * limit 1 로 받는다 — 목록 조회는 null 이라 본문에서 빠진다.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  private record AnthropicModelsListRequest(String token, String workspaceId, Boolean probe) {}

  /**
   * ai-agent 응답 계약 — { models: [{ id, label?, efforts? }] }. label 은 anthropic 경로만 채우므로 없으면 id 로
   * 대체. efforts(WP-1322) 는 모델이 받는 생각의 깊이 단계 — 모르면 없음(null) 그대로 넘긴다.
   */
  private record ModelsListResponse(List<ModelItem> models) {}

  private record ModelItem(String id, String label, List<String> efforts) {
    ModelOption toOption() {
      return ModelOption.withLabelFallback(id, label, efforts);
    }
  }
}

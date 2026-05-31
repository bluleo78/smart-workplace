package com.workplace.home.outbound;

import com.workplace.home.exception.HomeComposeUnavailableException;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 의 POST /home/compose 를 동기 호출한다 (7b).
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>무재시도: CLI cold-start(10~30s) 동기 호출 — 재시도는 지연만 가중. 1회만 시도.
 *   <li>503 home_composer_not_configured(운영 설정 누락) 는 HomeComposeUnavailableException(503, 명확 메시지)
 *       로, 그 외 실패(IO/4xx/5xx)는 AiAgentComposeException(502) 로 변환 (#50).
 * </ul>
 */
@Slf4j
public class AiAgentComposeClient {

  private final RestClient restClient;
  private final String internalToken;

  public AiAgentComposeClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** compose 요청 → 결과. 실패 시 AiAgentComposeException. */
  public ComposeResult compose(ComposeRequest request) {
    try {
      return restClient
          .post()
          .uri("/home/compose")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(request)
          .retrieve()
          .body(ComposeResult.class);
    } catch (HttpStatusCodeException e) {
      // ai-agent 가 상태코드+본문으로 사유를 준 경우. 503 home_composer_not_configured 는
      // 컴포저 AGENT 미설정(운영) — 제네릭 502 로 뭉개지 않고 명확·실행가능 메시지로 변환(#50).
      String body = e.getResponseBodyAsString();
      if (e.getStatusCode().value() == 503 && body.contains("home_composer_not_configured")) {
        log.error("ai-agent home composer 미설정: {}", body);
        throw new HomeComposeUnavailableException("AI 홈 컴포저가 아직 설정되지 않았어요. 관리자에게 문의해주세요.");
      }
      log.error("ai-agent compose 실패: status={} body={}", e.getStatusCode(), body);
      throw new AiAgentComposeException("AI 구성 요청에 실패했어요. 잠시 후 다시 시도해주세요.", e);
    } catch (RestClientException e) {
      log.error("ai-agent compose 실패: {}", e.getMessage());
      throw new AiAgentComposeException("AI 구성 요청에 실패했어요. 잠시 후 다시 시도해주세요.", e);
    }
  }
}

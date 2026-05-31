package com.workplace.home.outbound;

import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import com.workplace.home.outbound.ComposeMessages.ComposeResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 의 POST /home/compose 를 동기 호출한다 (7b).
 *
 * <ul>
 *   <li>인증: Authorization: Internal {token}
 *   <li>무재시도: CLI cold-start(10~30s) 동기 호출 — 재시도는 지연만 가중. 1회만 시도.
 *   <li>실패(IO/4xx/5xx) 시 AiAgentComposeException(502) 로 변환.
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
    } catch (RestClientException e) {
      log.error("ai-agent compose 실패: {}", e.getMessage());
      throw new AiAgentComposeException("ai-agent compose 호출 실패", e);
    }
  }
}

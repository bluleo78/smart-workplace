package com.workplace.messaging.outbound;

import com.workplace.messaging.exception.MessagingAiException;
import com.workplace.messaging.outbound.dto.CatchupSummarizeRequest;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent /messaging/catchup 호출 — 안 읽은 메시지를 구조화 요약으로 변환.
 * Internal 토큰 인증, 무재시도. AiAgentMessagingClient 미러.
 */
@Slf4j
public class AiAgentCatchupClient {
  /** ai-agent baseUrl 이 이미 설정된 RestClient. */
  private final RestClient restClient;

  /** Internal 인증 토큰 — ai-agent 에 전달. */
  private final String internalToken;

  /**
   * @param builder baseUrl·factory 가 설정된 빌더(MessagingAiConfig 에서 주입)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentCatchupClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /**
   * 미읽은 메시지 목록을 ai-agent 에 전송해 구조화 요약(결정/논의)을 생성한다.
   *
   * @param req 요청 DTO(메시지·모델·실행 설정)
   * @return 요약 결과(sourceMessageIds 동반)
   */
  public CatchupSummarizeResult summarize(CatchupSummarizeRequest req) {
    try {
      return restClient
          .post()
          .uri("/messaging/catchup")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(CatchupSummarizeResult.class);
    } catch (HttpStatusCodeException e) {
      log.error(
          "ai-agent catchup 실패: status={} body={}",
          e.getStatusCode(),
          e.getResponseBodyAsString());
      throw new MessagingAiException("AI 캐치업 요약 요청에 실패했어요.", e);
    } catch (RestClientException e) {
      log.error("ai-agent catchup 실패: {}", e.getMessage());
      throw new MessagingAiException("AI 캐치업 요약 요청에 실패했어요.", e);
    }
  }
}

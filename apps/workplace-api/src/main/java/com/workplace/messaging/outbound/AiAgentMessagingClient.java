package com.workplace.messaging.outbound;

import com.workplace.messaging.exception.MessagingAiException;
import com.workplace.messaging.outbound.dto.MessagingClassifyRequest;
import com.workplace.messaging.outbound.dto.MessagingClassifyResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent 의 POST /messaging/classify 동기 호출. AiAgentMailClient 미러(Internal 토큰, 무재시도).
 *
 * <p>503 → {@link MessagingAiException}(서비스 불가), 그 외 HTTP/IO 오류 → {@link
 * MessagingAiException}(502).
 */
@Slf4j
public class AiAgentMessagingClient {

  /** ai-agent baseUrl 이 이미 설정된 RestClient. */
  private final RestClient restClient;

  /** Internal 인증 토큰 — ai-agent 에 전달. */
  private final String internalToken;

  /**
   * @param builder baseUrl·factory 가 설정된 빌더(MessagingAiConfig 에서 주입)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentMessagingClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /**
   * 메시지 목록을 ai-agent 에 전송해 어텐션 필요 멤버를 분류한다.
   *
   * @param req 요청 DTO(메시지·멤버·모델 등)
   * @return 어텐션 대상 멤버 목록
   */
  public MessagingClassifyResult classify(MessagingClassifyRequest req) {
    try {
      return restClient
          .post()
          .uri("/messaging/classify")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(MessagingClassifyResult.class);
    } catch (HttpStatusCodeException e) {
      String body = e.getResponseBodyAsString();
      log.error("ai-agent messaging classify 실패: status={} body={}", e.getStatusCode(), body);
      throw new MessagingAiException("AI 메시징 분류 요청에 실패했어요.", e);
    } catch (RestClientException e) {
      log.error("ai-agent messaging classify 실패: {}", e.getMessage());
      throw new MessagingAiException("AI 메시징 분류 요청에 실패했어요.", e);
    }
  }
}

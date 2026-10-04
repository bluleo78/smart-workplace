package com.workplace.home.outbound;

import com.workplace.home.exception.HomeContextSummaryException;
import com.workplace.home.outbound.ChatMessages.ContextSummaryRequest;
import com.workplace.home.outbound.ChatMessages.ContextSummaryResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent /home/context-summary 호출(WP-232) — 토큰 예산을 넘친 앞부분 대화를 기존 요약에 합쳐 갱신된 요약을 받는다. Internal 토큰
 * 인증, 무재시도(실패 시 호출부가 원문 유지/오래된 원문 버리기로 폴백). AiAgentCatchupClient 미러.
 */
@Slf4j
public class AiAgentContextSummaryClient {
  private final RestClient restClient;
  private final String internalToken;

  /**
   * @param builder baseUrl·factory 가 설정된 빌더(HomeChatConfig 에서 주입)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentContextSummaryClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** 누적 요약 생성. ai-agent 오류·타임아웃·빈 응답은 HomeContextSummaryException. */
  public ContextSummaryResult summarize(ContextSummaryRequest req) {
    try {
      ContextSummaryResult r =
          restClient
              .post()
              .uri("/home/context-summary")
              .header("Authorization", "Internal " + internalToken)
              .contentType(MediaType.APPLICATION_JSON)
              .body(req)
              .retrieve()
              .body(ContextSummaryResult.class);
      if (r == null || r.summary() == null || r.summary().isBlank()) {
        throw new HomeContextSummaryException("빈 요약 응답", null);
      }
      return r;
    } catch (RestClientException e) {
      log.warn("ai-agent context-summary 실패: {}", e.getMessage());
      throw new HomeContextSummaryException("대화 요약 요청에 실패했어요.", e);
    }
  }
}

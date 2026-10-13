package com.workplace.home.outbound;

import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.home.outbound.ChatMessages.SuggestionResult;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent /home/suggestions 호출(WP-139) — 빈 대화 추천(요청 스레드 동기)과 후속 질문(전용 실행기). 추천은 없어도 되는 부가 기능이라 어떤
 * 실패(502·타임아웃·연결 거부·빈 본문)도 빈 목록으로 돌려준다 — 호출부가 분기하지 않게. Internal 토큰, 무재시도.
 */
@Slf4j
public class AiAgentSuggestionClient {
  private final RestClient restClient;
  private final String internalToken;

  /**
   * @param builder baseUrl·factory 가 설정된 빌더(HomeChatConfig 에서 주입)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentSuggestionClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /** 추천 질문 생성. 실패는 빈 목록. */
  public List<String> suggest(SuggestionRequest req) {
    try {
      SuggestionResult r =
          restClient
              .post()
              .uri("/home/suggestions")
              .header("Authorization", "Internal " + internalToken)
              .contentType(MediaType.APPLICATION_JSON)
              .body(req)
              .retrieve()
              .body(SuggestionResult.class);
      return r == null || r.items() == null ? List.of() : r.items();
    } catch (RestClientException e) {
      log.warn("ai-agent suggestions 실패(mode={}): {}", req.mode(), e.getMessage());
      return List.of();
    }
  }
}

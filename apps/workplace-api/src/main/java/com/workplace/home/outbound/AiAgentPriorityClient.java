package com.workplace.home.outbound;

import com.workplace.home.exception.PriorityAiException;
import com.workplace.home.outbound.dto.PriorityClassifyRequest;
import com.workplace.home.outbound.dto.PriorityClassifyResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** ai-agent POST /home/priority-classify 동기 호출. AiAgentIssueClient 미러(Internal 토큰, 무재시도). */
@Slf4j
public class AiAgentPriorityClient {

  private final RestClient restClient;
  private final String internalToken;

  public AiAgentPriorityClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /**
   * 후보 목록을 보내 항목별 중요도·긴급도 점수를 받는다. 실패 시 PriorityAiException.
   *
   * @param req 후보 목록 + 비서 스펙
   * @return 후보별 점수·근거
   */
  public PriorityClassifyResult classify(PriorityClassifyRequest req) {
    try {
      return restClient
          .post()
          .uri("/home/priority-classify")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(PriorityClassifyResult.class);
    } catch (HttpStatusCodeException e) {
      // 503 은 ai-agent 일시 불가(재기동 등) — 호출부가 연속 횟수로 판단하므로 WARN, 그 외 상태는 요청 자체의 문제라 ERROR(WP-166)
      if (e.getStatusCode().value() == 503) {
        log.warn("ai-agent priority classify 불가(503): {}", e.getResponseBodyAsString());
      } else {
        log.error(
            "ai-agent priority classify 실패: status={} body={}",
            e.getStatusCode(),
            e.getResponseBodyAsString());
      }
      throw new PriorityAiException("AI 우선순위 분류 요청에 실패했어요.", e);
    } catch (RestClientException e) {
      // 연결·읽기 실패는 ai-agent 재기동 중에도 난다 — 호출부(스케줄러)가 연속 횟수로 판단하므로 여기선 WARN 으로 남긴다(WP-166)
      log.warn("ai-agent priority classify 실패: {}", e.getMessage());
      throw new PriorityAiException("AI 우선순위 분류 요청에 실패했어요.", e);
    }
  }
}

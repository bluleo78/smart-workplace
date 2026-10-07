package com.workplace.wiki.outbound;

import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.wiki.exception.WikiSummaryFailedException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * api → ai-agent 노트 요약 동기 호출(WP-301, AiAgentDriveClient 미러). wiki 모듈 안에 두어 fileai 모듈에 의존하지 않는다.
 * 무재시도 단발 호출 — 실패는 {@link WikiSummaryFailedException} 으로 변환해 502 로 노출한다.
 */
@Slf4j
public class WikiAiAgentSummaryClient {

  private final RestClient restClient;
  private final String internalToken;

  public WikiAiAgentSummaryClient(RestClient restClient, String internalToken) {
    this.restClient = restClient;
    this.internalToken = internalToken;
  }

  /** 노트 제목·본문을 보내 요약문을 받는다. */
  public Res summarize(Req req) {
    try {
      return restClient
          .post()
          .uri("/wiki/summarize")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(Res.class);
    } catch (RestClientException e) {
      // agent 재기동 중(연결 실패·503)은 흔한 일시 장애라 WARN, 그 외 응답 오류만 ERROR(WP-177 관례).
      if (AgentOutageGuard.isAgentDown(e)) {
        log.warn("ai-agent 노트 요약 불가(일시 장애): {}", e.getMessage());
      } else {
        log.error("ai-agent 노트 요약 실패: {}", e.getMessage());
      }
      throw new WikiSummaryFailedException("노트 요약 AI 요청에 실패했습니다.", e);
    }
  }

  /** 요약 요청 페이로드 — ai-agent zod 스키마와 1:1. */
  public record Req(
      String title,
      String body,
      long assistantAgentId,
      String model,
      int maxTurns,
      long timeoutMs) {}

  /** 요약 응답 페이로드. */
  public record Res(String summary) {}
}

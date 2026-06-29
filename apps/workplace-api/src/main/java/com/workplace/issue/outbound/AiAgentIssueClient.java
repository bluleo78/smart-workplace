package com.workplace.issue.outbound;

import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** ai-agent POST /issue/progress-summary 동기 호출. AiAgentMessagingClient 미러(Internal 토큰, 무재시도). */
@Slf4j
public class AiAgentIssueClient {

  /** ai-agent baseUrl 이 이미 설정된 RestClient. */
  private final RestClient restClient;

  /** Internal 인증 토큰 — ai-agent 에 전달. */
  private final String internalToken;

  /**
   * @param builder baseUrl·factory 가 설정된 빌더(IssueAiConfig 에서 주입)
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentIssueClient(RestClient.Builder builder, String internalToken) {
    this.restClient = builder.build();
    this.internalToken = internalToken;
  }

  /**
   * 이슈 컨텍스트를 보내 현황 요약을 받는다. 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(이슈 제목·상태·댓글·히스토리 등)
   * @return AI 가 생성한 요약 + 다음 행동
   */
  public IssueSummaryResult summarizeProgress(IssueSummaryRequest req) {
    try {
      return restClient
          .post()
          .uri("/issue/progress-summary")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(IssueSummaryResult.class);
    } catch (HttpStatusCodeException e) {
      log.error(
          "ai-agent issue summary 실패: status={} body={}",
          e.getStatusCode(),
          e.getResponseBodyAsString());
      throw new IssueAiException("AI 이슈 요약 요청에 실패했어요.", e);
    } catch (RestClientException e) {
      log.error("ai-agent issue summary 실패: {}", e.getMessage());
      throw new IssueAiException("AI 이슈 요약 요청에 실패했어요.", e);
    }
  }

  /**
   * 이슈 제목·본문·라벨 목록을 보내 분류 제안을 받는다. 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(제목·본문·프로젝트 라벨 목록·어시스턴트 ID)
   * @return AI 제안 유형·우선순위·라벨·이유
   */
  public IssueClassifyResult classify(IssueClassifyRequest req) {
    try {
      return restClient
          .post()
          .uri("/issue/classify")
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(IssueClassifyResult.class);
    } catch (HttpStatusCodeException e) {
      log.error(
          "ai-agent issue classify 실패: status={} body={}",
          e.getStatusCode(),
          e.getResponseBodyAsString());
      throw new IssueAiException("AI 이슈 분류 요청에 실패했어요.", e);
    } catch (RestClientException e) {
      log.error("ai-agent issue classify 실패: {}", e.getMessage());
      throw new IssueAiException("AI 이슈 분류 요청에 실패했어요.", e);
    }
  }
}

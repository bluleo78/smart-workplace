package com.workplace.issue.outbound;

import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.outbound.dto.ProjectStatusAiRequest;
import com.workplace.issue.outbound.dto.ProjectStatusAiResult;
import com.workplace.issue.outbound.dto.WorkProfileAiRequest;
import com.workplace.issue.outbound.dto.WorkProfileAiResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * ai-agent POST /issue/… (현황 요약·분류·업무 프로파일·프로젝트 상태 요약) 동기 호출. AiAgentMessagingClient 미러(Internal
 * 토큰, 무재시도).
 */
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
    return post(
        "/issue/progress-summary",
        req,
        IssueSummaryResult.class,
        "AI 이슈 요약 요청에 실패했어요.",
        "issue summary");
  }

  /**
   * 이슈 제목·본문·라벨 목록을 보내 분류 제안을 받는다. 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(제목·본문·프로젝트 라벨 목록·어시스턴트 ID)
   * @return AI 제안 유형·우선순위·라벨·이유
   */
  public IssueClassifyResult classify(IssueClassifyRequest req) {
    return post(
        "/issue/classify", req, IssueClassifyResult.class, "AI 이슈 분류 요청에 실패했어요.", "issue classify");
  }

  /**
   * 한 사람이 끝낸 이슈 목록을 보내 업무 프로파일(요약·역량·이슈별 분류)을 받는다(WP-1485). 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(기간 이름·끝낸 이슈·비서 사양)
   * @return AI 요약·역량 태그·이슈별 일 종류/영역
   */
  public WorkProfileAiResult analyzeWorkProfile(WorkProfileAiRequest req) {
    return post(
        "/issue/work-profile",
        req,
        WorkProfileAiResult.class,
        "AI 업무 프로파일 요청에 실패했어요.",
        "work profile");
  }

  /**
   * 프로젝트 개요 계산값과 배지를 보내 상태 요약 글을 받는다(WP-1479). 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(프로젝트 이름·배지·계산값·비서 사양)
   * @return AI 가 쓴 2~3문장 요약
   */
  public ProjectStatusAiResult summarizeProjectStatus(ProjectStatusAiRequest req) {
    return post(
        "/issue/project-status",
        req,
        ProjectStatusAiResult.class,
        "AI 프로젝트 상태 요약 요청에 실패했어요.",
        "project status");
  }

  /**
   * 공개 메서드들이 공유하는 호출 본체 — Internal 토큰을 단 JSON POST 후 응답 본문을 type 으로 받는다. HTTP 오류·연결 실패는 로그를 남기고
   * IssueAiException(failMessage) 으로 바꾼다. 메서드마다 같던 try/catch 를 한 곳으로 모은 것.
   *
   * @param logLabel 로그 접두 「ai-agent {logLabel} 실패」에 들어갈 이름
   */
  private <T> T post(String uri, Object req, Class<T> type, String failMessage, String logLabel) {
    try {
      return restClient
          .post()
          .uri(uri)
          .header("Authorization", "Internal " + internalToken)
          .contentType(MediaType.APPLICATION_JSON)
          .body(req)
          .retrieve()
          .body(type);
    } catch (HttpStatusCodeException e) {
      log.error(
          "ai-agent {} 실패: status={} body={}",
          logLabel,
          e.getStatusCode(),
          e.getResponseBodyAsString());
      throw new IssueAiException(failMessage, e);
    } catch (RestClientException e) {
      log.error("ai-agent {} 실패: {}", logLabel, e.getMessage());
      throw new IssueAiException(failMessage, e);
    }
  }
}

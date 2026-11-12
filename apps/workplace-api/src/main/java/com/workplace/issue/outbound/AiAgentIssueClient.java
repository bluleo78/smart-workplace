package com.workplace.issue.outbound;

import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.outbound.dto.ProjectReportAiRequest;
import com.workplace.issue.outbound.dto.ProjectReportAiResult;
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

  /**
   * 프로젝트 리포트 AI 실행 예산(ms, WP-1483) — 20,000자 템플릿과 이슈 60건을 읽고 긴 한국어 글을 쓰므로 비서 기본 예산(60초)으로는 모자라 따로
   * 둔다. 리포트 전용 RestClient 의 읽기 시간 제한({@link IssueAiConfig#REPORT_READ_TIMEOUT})이 이보다 길어야 API 가
   * ai-agent 보다 먼저 포기하지 않는다.
   */
  public static final long PROJECT_REPORT_TIMEOUT_MS = 180_000L;

  /** ai-agent baseUrl 이 이미 설정된 RestClient. */
  private final RestClient restClient;

  /** 프로젝트 리포트 전용 RestClient — 읽기 시간 제한이 리포트 예산보다 길다(다른 호출의 90초와 따로). */
  private final RestClient reportRestClient;

  /** Internal 인증 토큰 — ai-agent 에 전달. */
  private final String internalToken;

  /**
   * @param builder 일반 이슈 AI 호출용 빌더(IssueAiConfig 에서 주입)
   * @param reportBuilder 프로젝트 리포트용 빌더 — 읽기 시간 제한이 {@link #PROJECT_REPORT_TIMEOUT_MS} 보다 길다
   * @param internalToken AiAgentProperties.internalToken
   */
  public AiAgentIssueClient(
      RestClient.Builder builder, RestClient.Builder reportBuilder, String internalToken) {
    this.restClient = builder.build();
    this.reportRestClient = reportBuilder.build();
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
        restClient,
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
        restClient,
        "/issue/classify",
        req,
        IssueClassifyResult.class,
        "AI 이슈 분류 요청에 실패했어요.",
        "issue classify");
  }

  /**
   * 한 사람이 끝낸 이슈 목록을 보내 업무 프로파일(요약·역량·이슈별 분류)을 받는다(WP-1485). 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(기간 이름·끝낸 이슈·비서 사양)
   * @return AI 요약·역량 태그·이슈별 일 종류/영역
   */
  public WorkProfileAiResult analyzeWorkProfile(WorkProfileAiRequest req) {
    return post(
        restClient,
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
        restClient,
        "/issue/project-status",
        req,
        ProjectStatusAiResult.class,
        "AI 프로젝트 상태 요약 요청에 실패했어요.",
        "project status");
  }

  /**
   * 템플릿·계산값·이슈 목록을 보내 프로젝트 리포트 마크다운을 받는다(WP-1483). 실패 시 IssueAiException.
   *
   * @param req 요청 DTO(템플릿 샘플·표 행·이슈 목록·비서 사양)
   * @return AI 가 쓴 리포트 본문 마크다운(후처리 전)
   */
  public ProjectReportAiResult writeProjectReport(ProjectReportAiRequest req) {
    return post(
        reportRestClient,
        "/issue/project-report",
        req,
        ProjectReportAiResult.class,
        "AI 리포트 작성 요청에 실패했어요.",
        "project report");
  }

  /**
   * 공개 메서드들이 공유하는 호출 본체 — 정한 RestClient(리포트는 시간 제한이 긴 전용)로 Internal 토큰을 단 JSON POST 후 응답 본문을 type
   * 으로 받는다. HTTP 오류·연결 실패는 로그를 남기고 IssueAiException(failMessage) 으로 바꾼다. 메서드마다 같던 try/catch 를 한 곳으로
   * 모은 것.
   *
   * @param logLabel 로그 접두 「ai-agent {logLabel} 실패」에 들어갈 이름
   */
  private <T> T post(
      RestClient client,
      String uri,
      Object req,
      Class<T> type,
      String failMessage,
      String logLabel) {
    try {
      return client
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

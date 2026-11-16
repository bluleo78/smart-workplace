package com.workplace.issue.outbound;

import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.issue.outbound.dto.IssueSummaryRequest;
import com.workplace.issue.outbound.dto.IssueSummaryResult;
import com.workplace.issue.outbound.dto.PersonalReportAiRequest;
import com.workplace.issue.outbound.dto.PersonalReportAiResult;
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
   * ai-agent 연동 전역 on/off({@code workplace.ai-agent.enabled}, WP-1639·1640). 꺼져 있으면 모든 요청이 ai-agent
   * 를 부르지 않고 실패한다(보고는 {@link #DISABLED_MESSAGE}, 그 밖은 {@link #DISABLED_MESSAGE_GENERIC}) — 격리 라이브
   * 스택처럼 연동을 끈 API 가 baseUrl(local 6070)의 남의 ai-agent 로 요청을 보내지 않게.
   */
  private final boolean enabled;

  /** 보고 밖 요청(요약·분류·업무 프로필·상태 요약)이 연동 꺼짐으로 막혔을 때의 문구(WP-1640). */
  public static final String DISABLED_MESSAGE_GENERIC = "AI 연동이 꺼져 있어 AI 요청을 보낼 수 없어요.";

  /** 연동이 꺼져 있을 때 보고 작성이 남기는 오류 문구(WP-1639) — 회차 오류로 화면에 보인다. */
  public static final String DISABLED_MESSAGE = "AI 연동이 꺼져 있어 보고를 만들 수 없어요.";

  /**
   * @param builder 일반 이슈 AI 호출용 빌더(IssueAiConfig 에서 주입)
   * @param reportBuilder 프로젝트 리포트용 빌더 — 읽기 시간 제한이 {@link #PROJECT_REPORT_TIMEOUT_MS} 보다 길다
   * @param internalToken AiAgentProperties.internalToken
   * @param enabled AiAgentProperties.enabled — false 면 보고 작성이 ai-agent 를 부르지 않는다(WP-1639)
   */
  public AiAgentIssueClient(
      RestClient.Builder builder,
      RestClient.Builder reportBuilder,
      String internalToken,
      boolean enabled) {
    this.restClient = builder.build();
    this.reportRestClient = reportBuilder.build();
    this.internalToken = internalToken;
    this.enabled = enabled;
  }

  /** 연동이 켜진 클라이언트 — 호출 모양만 보는 테스트용(운영 빈은 {@link IssueAiConfig} 가 설정값을 넘긴다). */
  public AiAgentIssueClient(
      RestClient.Builder builder, RestClient.Builder reportBuilder, String internalToken) {
    this(builder, reportBuilder, internalToken, true);
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
    requireEnabled("project report", DISABLED_MESSAGE);
    return post(
        reportRestClient,
        "/issue/project-report",
        req,
        ProjectReportAiResult.class,
        "AI 리포트 작성 요청에 실패했어요.",
        "project report");
  }

  /**
   * 개인 일일·주간·월간 보고 본문(WP-1486) — 템플릿·계산값·이슈 목록을 보내 마크다운을 받는다. 프로젝트 리포트와 같은 리포트 전용 RestClient(긴 읽기
   * 시간 제한)로 보내고, 실행 예산도 {@link #PROJECT_REPORT_TIMEOUT_MS} 를 같이 쓴다.
   */
  public PersonalReportAiResult writePersonalReport(PersonalReportAiRequest req) {
    requireEnabled("personal report", DISABLED_MESSAGE);
    return post(
        reportRestClient,
        "/issue/personal-report",
        req,
        PersonalReportAiResult.class,
        "AI 보고 작성 요청에 실패했어요.",
        "personal report");
  }

  /**
   * 연동 확인(WP-1639·1640) — 꺼져 있으면 HTTP 요청 없이 {@link IssueAiException}(message) 으로 끝낸다. 호출부(실행기·서비스)가
   * 먼저 연동을 보고 건너뛰거나 409 로 거절하므로, 이것은 새 호출부가 확인을 빠뜨려도 남의 ai-agent 로 요청이 새지 않게 하는 마지막 방어선이다. 보고 두
   * 메서드는 보고 문구({@link #DISABLED_MESSAGE})로 먼저 부르고, 나머지는 {@link #post} 가 일반 문구로 부른다.
   *
   * @param logLabel 로그에 남길 호출 이름
   * @param message 예외 문구
   */
  private void requireEnabled(String logLabel, String message) {
    if (!enabled) {
      log.warn("ai-agent 연동이 꺼져 있어 {} 를 보내지 않음", logLabel);
      throw new IssueAiException(message);
    }
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
    // 마지막 방어선(WP-1640) — 연동이 꺼져 있으면 어느 메서드든 요청을 보내지 않는다.
    requireEnabled(logLabel, DISABLED_MESSAGE_GENERIC);
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

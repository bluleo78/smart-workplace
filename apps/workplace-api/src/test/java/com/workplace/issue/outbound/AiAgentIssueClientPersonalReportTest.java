package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.workplace.issue.exception.IssueAiException;
import com.workplace.issue.outbound.dto.PersonalReportAiRequest;
import com.workplace.issue.report.ReportIssue;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** AiAgentIssueClient.writePersonalReport — POST /issue/personal-report 요청 모양·응답·실패 변환(WP-1486). */
class AiAgentIssueClientPersonalReportTest {

  private MockRestServiceServer server;
  private AiAgentIssueClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentIssueClient(builder, builder, "tok-123");
  }

  /** 일일 요청 — 숫자 줄을 싣고 표 행은 비운다. 이슈는 「답을 기다림」 이유·마감일. */
  private PersonalReportAiRequest request() {
    ReportIssue issue =
        new ReportIssue(
            "WP-1",
            "https://app.test/projects/WP/issues/1",
            "질문 답하기",
            "진행 중",
            "IN_PROGRESS",
            List.of("양동희"),
            null,
            LocalDate.of(2026, 11, 10),
            "확인 부탁드려요",
            "WAITING",
            "WP",
            null,
            false);
    return new PersonalReportAiRequest(
        "양동희",
        "DAILY",
        "일일",
        "11월 11일 (수) 일일 보고",
        "11월 11일 (수)",
        "## 한 줄",
        List.of(),
        "끝냄 4 · 기한 내 3 · AI와 함께 1 | 새로 만듦 1 | 상태 바꿈 6 | 기한 지남 2",
        List.of(issue),
        Map.of("WP", 2),
        7L,
        "m",
        4,
        AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS);
  }

  @Test
  void writePersonalReport_정상_요청모양과_마크다운_반환() {
    server
        .expect(requestTo("http://ai-agent.test/issue/personal-report"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.userName").value("양동희"))
        .andExpect(jsonPath("$.kind").value("DAILY"))
        .andExpect(
            jsonPath("$.numbersLine")
                .value("끝냄 4 · 기한 내 3 · AI와 함께 1 | 새로 만듦 1 | 상태 바꿈 6 | 기한 지남 2"))
        .andExpect(jsonPath("$.tableRows").isEmpty())
        .andExpect(jsonPath("$.issues[0].reason").value("WAITING"))
        .andExpect(jsonPath("$.issues[0].dueDate").value("2026-11-10"))
        .andExpect(jsonPath("$.issues[0].project").value("WP"))
        .andExpect(jsonPath("$.omittedByEpic['WP']").value(2))
        .andExpect(jsonPath("$.timeoutMs").value(180000))
        .andRespond(withSuccess("{\"markdown\":\"## 한 줄\\n\"}", MediaType.APPLICATION_JSON));

    assertThat(client.writePersonalReport(request()).markdown()).isEqualTo("## 한 줄\n");
    server.verify();
  }

  /** 개인 보고도 긴 읽기 시간 제한을 단 리포트 전용 RestClient 로 보낸다. */
  @Test
  void writePersonalReport_리포트전용_클라이언트로_보낸다() {
    RestClient.Builder common = RestClient.builder().baseUrl("http://ai-agent.test");
    RestClient.Builder report = RestClient.builder().baseUrl("http://ai-agent.test");
    MockRestServiceServer commonServer = MockRestServiceServer.bindTo(common).build();
    MockRestServiceServer reportServer = MockRestServiceServer.bindTo(report).build();
    AiAgentIssueClient split = new AiAgentIssueClient(common, report, "tok-123");
    reportServer
        .expect(requestTo("http://ai-agent.test/issue/personal-report"))
        .andRespond(withSuccess("{\"markdown\":\"## 본문\"}", MediaType.APPLICATION_JSON));

    assertThat(split.writePersonalReport(request()).markdown()).isEqualTo("## 본문");
    reportServer.verify();
    commonServer.verify();
  }

  @Test
  void writePersonalReport_서버오류_IssueAiException() {
    server
        .expect(requestTo("http://ai-agent.test/issue/personal-report"))
        .andRespond(withServerError());
    assertThatThrownBy(() -> client.writePersonalReport(request()))
        .isInstanceOf(IssueAiException.class)
        .hasMessageContaining("AI 보고 작성 요청에 실패했어요.");
  }
}

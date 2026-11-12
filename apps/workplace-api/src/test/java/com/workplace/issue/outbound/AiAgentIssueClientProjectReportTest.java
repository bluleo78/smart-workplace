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
import com.workplace.issue.outbound.dto.ProjectReportAiRequest;
import com.workplace.issue.report.ReportIssue;
import com.workplace.issue.report.ReportTableRow;
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

/** AiAgentIssueClient.writeProjectReport — POST /issue/project-report 요청 모양·응답·실패 변환(WP-1483). */
class AiAgentIssueClientProjectReportTest {

  private MockRestServiceServer server;
  private AiAgentIssueClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://ai-agent.test");
    server = MockRestServiceServer.bindTo(builder).build();
    client = new AiAgentIssueClient(builder, builder, "tok-123");
  }

  private ProjectReportAiRequest request() {
    ReportIssue issue =
        new ReportIssue(
            "WP-1",
            "https://app.test/projects/WP/issues/1",
            "제목",
            "완료",
            "DONE",
            List.of("동희"),
            "에픽",
            LocalDate.of(2026, 11, 10),
            null,
            "DONE",
            "WP",
            null,
            false);
    return new ProjectReportAiRequest(
        "WP",
        "11월 2주차 주간 리포트",
        "11월 9일 ~ 15일",
        "주간",
        "# 샘플",
        "WARN",
        null,
        List.of(new ReportTableRow("완료", "3", "+1")),
        List.of(issue),
        Map.of("에픽 없음", 2),
        7L,
        "m",
        4,
        60000L);
  }

  @Test
  void writeProjectReport_정상_요청모양과_마크다운_반환() {
    server
        .expect(requestTo("http://ai-agent.test/issue/project-report"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header(HttpHeaders.AUTHORIZATION, "Internal tok-123"))
        .andExpect(jsonPath("$.projectName").value("WP"))
        .andExpect(jsonPath("$.badge").value("WARN"))
        .andExpect(jsonPath("$.tableRows[0].label").value("완료"))
        .andExpect(jsonPath("$.issues[0].url").value("https://app.test/projects/WP/issues/1"))
        .andExpect(jsonPath("$.issues[0].dueDate").value("2026-11-10"))
        .andExpect(jsonPath("$.omittedByEpic['에픽 없음']").value(2))
        .andExpect(jsonPath("$.assistantAgentId").value(7))
        .andRespond(withSuccess("{\"markdown\":\"## 본문\\n\"}", MediaType.APPLICATION_JSON));

    assertThat(client.writeProjectReport(request()).markdown()).isEqualTo("## 본문\n");
    server.verify();
  }

  /** 리포트는 긴 읽기 시간 제한을 단 전용 RestClient 로 보낸다 — 다른 이슈 AI 호출(90초)과 따로(최종 리뷰 #3). */
  @Test
  void writeProjectReport_리포트전용_클라이언트로_보낸다() {
    RestClient.Builder common = RestClient.builder().baseUrl("http://ai-agent.test");
    RestClient.Builder report = RestClient.builder().baseUrl("http://ai-agent.test");
    MockRestServiceServer commonServer = MockRestServiceServer.bindTo(common).build();
    MockRestServiceServer reportServer = MockRestServiceServer.bindTo(report).build();
    AiAgentIssueClient split = new AiAgentIssueClient(common, report, "tok-123");
    reportServer
        .expect(requestTo("http://ai-agent.test/issue/project-report"))
        .andRespond(withSuccess("{\"markdown\":\"## 본문\"}", MediaType.APPLICATION_JSON));

    assertThat(split.writeProjectReport(request()).markdown()).isEqualTo("## 본문");
    reportServer.verify();
    commonServer.verify();
  }

  /** 리포트 읽기 시간 제한은 ai-agent 리포트 실행 예산(180초)보다 길고, 다른 이슈 AI 호출(90초)보다 길다. */
  @Test
  void reportReadTimeout_exceedsReportBudget() {
    assertThat(IssueAiConfig.REPORT_READ_TIMEOUT.toMillis())
        .isGreaterThan(AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS)
        .isGreaterThan(IssueAiConfig.READ_TIMEOUT.toMillis());
    assertThat(AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS).isEqualTo(180_000L);
  }

  @Test
  void writeProjectReport_서버오류_IssueAiException() {
    server
        .expect(requestTo("http://ai-agent.test/issue/project-report"))
        .andRespond(withServerError());
    assertThatThrownBy(() -> client.writeProjectReport(request()))
        .isInstanceOf(IssueAiException.class)
        .hasMessageContaining("AI 리포트 작성 요청에 실패했어요.");
  }
}

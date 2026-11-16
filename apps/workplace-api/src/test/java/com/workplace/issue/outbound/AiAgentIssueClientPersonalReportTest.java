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
import com.workplace.issue.report.PersonalReportWork;
import com.workplace.issue.report.ReportAssignee;
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
            false,
            List.of(new ReportAssignee("양동희", "HUMAN"), new ReportAssignee("AI 개발자1", "AGENT")));
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
        new PersonalReportAiRequest.CompletedSplit(4, 1, 3),
        null,
        false,
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
        // WP-1632 — 담당 kind·끝낸 일 AI와 함께/직접 건수(선택 필드, 기존 assignees 모양은 그대로).
        .andExpect(jsonPath("$.issues[0].assignees[0]").value("양동희"))
        .andExpect(jsonPath("$.issues[0].assigneesDetail[1].name").value("AI 개발자1"))
        .andExpect(jsonPath("$.issues[0].assigneesDetail[1].kind").value("AGENT"))
        .andExpect(jsonPath("$.completedSplit.completed").value(4))
        .andExpect(jsonPath("$.completedSplit.withAi").value(1))
        .andExpect(jsonPath("$.completedSplit.direct").value(3))
        .andExpect(jsonPath("$.timeoutMs").value(180000))
        .andRespond(withSuccess("{\"markdown\":\"## 한 줄\\n\"}", MediaType.APPLICATION_JSON));

    assertThat(client.writePersonalReport(request()).markdown()).isEqualTo("## 한 줄\n");
    server.verify();
  }

  /**
   * 주간 요청 — 끝낸 일 프로젝트 → 에픽 집계가 camelCase doneByProject 로 실리고, 「에픽 없음」 은 key·url 이 null(WP-1632).
   */
  @Test
  void writePersonalReport_주간_doneByProject_요청모양() {
    PersonalReportAiRequest daily = request();
    PersonalReportWork.ProjectWork wp =
        new PersonalReportWork.ProjectWork(
            "WP",
            "Gen:iA Works",
            3,
            1,
            List.of(
                new PersonalReportWork.EpicWork(
                    "WP-10",
                    "https://app.test/projects/WP/issues/10",
                    "통합 검색",
                    false,
                    true,
                    2,
                    0,
                    List.of("색인", "결과 화면")),
                new PersonalReportWork.EpicWork(
                    null, null, PersonalReportWork.NO_EPIC, false, false, 1, 1, List.of("버그"))));
    PersonalReportAiRequest weekly =
        new PersonalReportAiRequest(
            daily.userName(),
            "WEEKLY",
            "주간",
            "11월 2주 주간 보고",
            "11월 9일 ~ 15일",
            daily.templateMarkdown(),
            List.of(),
            null,
            List.of(),
            Map.of(),
            new PersonalReportAiRequest.CompletedSplit(3, 1, 2),
            List.of(wp),
            true,
            7L,
            "m",
            4,
            AiAgentIssueClient.PROJECT_REPORT_TIMEOUT_MS);
    server
        .expect(requestTo("http://ai-agent.test/issue/personal-report"))
        .andExpect(jsonPath("$.doneByProject[0].projectKey").value("WP"))
        .andExpect(jsonPath("$.doneByProject[0].projectName").value("Gen:iA Works"))
        .andExpect(jsonPath("$.doneByProject[0].done").value(3))
        .andExpect(jsonPath("$.doneByProject[0].foundByAiTester").value(1))
        .andExpect(jsonPath("$.doneByProject[0].epics[0].key").value("WP-10"))
        .andExpect(jsonPath("$.doneByProject[0].epics[0].epicDone").value(true))
        .andExpect(jsonPath("$.doneByProject[0].epics[0].doneTitles[1]").value("결과 화면"))
        .andExpect(jsonPath("$.doneByProject[0].epics[1].title").value("에픽 없음"))
        .andExpect(jsonPath("$.doneByProject[0].epics[1].key").doesNotExist())
        .andExpect(jsonPath("$.workTableInTemplate").value(true))
        .andRespond(withSuccess("{\"markdown\":\"## 요약\"}", MediaType.APPLICATION_JSON));

    assertThat(client.writePersonalReport(weekly).markdown()).isEqualTo("## 요약");
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

  /**
   * 연동이 꺼진 API(workplace.ai-agent.enabled=false — 격리 라이브 스택 등)에서는 개인 보고 작성이 ai-agent 로 HTTP 요청을 보내지
   * 않고 「AI 연동이 꺼져 있어…」로 실패한다(WP-1639). 기대 요청을 하나도 걸지 않은 서버의 verify 가 요청 0건을 확인한다.
   */
  @Test
  void writePersonalReport_연동꺼짐_요청없이_실패() {
    RestClient.Builder off = RestClient.builder().baseUrl("http://ai-agent.test");
    MockRestServiceServer offServer = MockRestServiceServer.bindTo(off).build();
    AiAgentIssueClient disabled = new AiAgentIssueClient(off, off, "tok-123", false);

    assertThatThrownBy(() -> disabled.writePersonalReport(request()))
        .isInstanceOf(IssueAiException.class)
        .hasMessage(AiAgentIssueClient.DISABLED_MESSAGE);
    offServer.verify();
  }
}

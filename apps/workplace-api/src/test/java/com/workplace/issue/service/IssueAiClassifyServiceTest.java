package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.IssueAiClassifyResponse;
import com.workplace.issue.exception.IssueAiAssistantUnavailableException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.label.dto.LabelRow;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** IssueAiClassifyService 통합 테스트 — ai-agent 클라이언트 목. */
@SpringBootTest
@ActiveProfiles("test")
class IssueAiClassifyServiceTest {

  @Autowired private IssueAiClassifyService classifyService;

  @MockitoBean private AiAgentIssueClient aiClient;

  @MockitoBean private ProjectRepository projectRepository;

  @MockitoBean private LabelRepository labelRepository;

  @MockitoBean private AssistantResolver assistantResolver;

  @Test
  void classify_팀프로젝트_정상분류() {
    // given
    ProjectRow project =
        new ProjectRow(10L, "TEST", "테스트 프로젝트", null, 1L, "TEAM", false, null, null);
    when(projectRepository.findByKey("TEST")).thenReturn(Optional.of(project));
    when(labelRepository.findByProject(10L))
        .thenReturn(
            List.of(
                new LabelRow(1L, 10L, "backend", "#ff0000", null, null),
                new LabelRow(2L, 10L, "bug", "#ff5500", null, null)));
    AssistantSpec spec = new AssistantSpec(2L, "claude-sonnet-4-6", "NONE", 6, 30_000);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(spec));
    IssueClassifyResult aiResult =
        new IssueClassifyResult("BUG", "HIGH", List.of("backend"), "500 오류");
    when(aiClient.classify(any())).thenReturn(aiResult);

    // when
    IssueAiClassifyResponse result = classifyService.classify(1L, "TEST", "로그인 오류", "500 에러 발생");

    // then
    assertThat(result.type()).isEqualTo("BUG");
    assertThat(result.priority()).isEqualTo("HIGH");
    assertThat(result.labels()).containsExactly("backend");
    assertThat(result.reason()).isEqualTo("500 오류");
  }

  @Test
  void classify_어시스턴트없음_422() {
    // given
    ProjectRow project =
        new ProjectRow(10L, "TEST", "테스트 프로젝트", null, 1L, "TEAM", false, null, null);
    when(projectRepository.findByKey("TEST")).thenReturn(Optional.of(project));
    when(labelRepository.findByProject(10L)).thenReturn(List.of());
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.empty());

    // when/then
    assertThatThrownBy(() -> classifyService.classify(1L, "TEST", "제목", "본문"))
        .isInstanceOf(IssueAiAssistantUnavailableException.class);
  }

  @Test
  void classify_개인프로젝트_type_null() {
    // given — 개인 프로젝트: ownerId=1, type="PERSONAL"
    ProjectRow project =
        new ProjectRow(11L, "PERSONAL", "개인", null, 1L, "PERSONAL", false, null, null);
    when(projectRepository.findByKey("PERSONAL")).thenReturn(Optional.of(project));
    when(labelRepository.findByProject(11L)).thenReturn(List.of());
    AssistantSpec spec = new AssistantSpec(2L, "claude-sonnet-4-6", "NONE", 6, 30_000);
    when(assistantResolver.resolveOrEmpty(1L)).thenReturn(Optional.of(spec));
    // 개인 프로젝트는 type null 반환 가능
    IssueClassifyResult aiResult = new IssueClassifyResult(null, "MID", List.of(), "개인 태스크");
    when(aiClient.classify(any())).thenReturn(aiResult);

    // when
    IssueAiClassifyResponse result = classifyService.classify(1L, "PERSONAL", "할 일", "");

    // then
    assertThat(result.type()).isNull();
    assertThat(result.priority()).isEqualTo("MID");
  }
}

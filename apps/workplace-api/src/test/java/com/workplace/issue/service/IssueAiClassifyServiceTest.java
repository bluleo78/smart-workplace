package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
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
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** IssueAiClassifyService 통합 테스트 — ai-agent 클라이언트 목. */
class IssueAiClassifyServiceTest extends IntegrationTestBase {

  @Autowired private IssueAiClassifyService classifyService;

  @MockitoBean private AiAgentIssueClient aiClient;

  @MockitoBean private ProjectAccessGuard accessGuard;

  @MockitoBean private LabelRepository labelRepository;

  @MockitoBean private AssistantResolver assistantResolver;

  @Test
  void classify_팀프로젝트_정상분류() {
    // given
    ProjectRow project =
        new ProjectRow(10L, "TEST", "테스트 프로젝트", null, 1L, "TEAM", false, null, null);
    when(accessGuard.assertIssueCreatable("TEST", 1L)).thenReturn(project);
    when(labelRepository.findByProject(10L))
        .thenReturn(
            List.of(
                new LabelRow(1L, 10L, "backend", "#ff0000", null, null, null),
                new LabelRow(2L, 10L, "bug", "#ff5500", null, null, null)));
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
    when(accessGuard.assertIssueCreatable("TEST", 1L)).thenReturn(project);
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
    when(accessGuard.assertIssueCreatable("PERSONAL", 1L)).thenReturn(project);
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

  /**
   * WP-478 — 프로젝트를 볼 수 없는 사람은 403. 라벨 목록·어시스턴트(개인 프로젝트면 소유자 개인 비서)에 닿기 전에 막아야 한다 — 전에는 멤버 검사 없이
   * 어시스턴트 조회(422)까지 갔다.
   */
  @Test
  void classify_프로젝트_접근권한없음_403_라벨_어시스턴트_조회안함() {
    when(accessGuard.assertIssueCreatable("SEC", 99L))
        .thenThrow(new ProjectAccessDeniedException("프로젝트 멤버가 아닙니다"));

    assertThatThrownBy(() -> classifyService.classify(99L, "SEC", "x", ""))
        .isInstanceOf(ProjectAccessDeniedException.class);
    verifyNoInteractions(labelRepository, assistantResolver);
    verify(aiClient, never()).classify(any());
  }
}

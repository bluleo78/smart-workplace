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
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
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
import org.mockito.ArgumentCaptor;
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
        new ProjectRow(10L, "TEST", "테스트 프로젝트", null, 1L, "TEAM", false, null, null, null, null);
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
        new ProjectRow(10L, "TEST", "테스트 프로젝트", null, 1L, "TEAM", false, null, null, null, null);
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
        new ProjectRow(11L, "PERSONAL", "개인", null, 1L, "PERSONAL", false, null, null, null, null);
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

  /** WP-886 — ai-agent 가 보낸 5단계 우선순위(HIGHEST·LOWEST 포함)는 보정 없이 그대로 응답에 담긴다. */
  @Test
  void classify_우선순위_5단계는_그대로() {
    ProjectRow project =
        new ProjectRow(12L, "PRI", "우선순위 프로젝트", null, 1L, "TEAM", false, null, null, null, null);
    when(accessGuard.assertIssueCreatable("PRI", 1L)).thenReturn(project);
    when(labelRepository.findByProject(12L)).thenReturn(List.of());
    AssistantSpec spec = new AssistantSpec(2L, "claude-sonnet-4-6", "NONE", 6, 30_000);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(spec));

    when(aiClient.classify(any()))
        .thenReturn(new IssueClassifyResult("BUG", "HIGHEST", List.of(), "운영 장애"));
    assertThat(classifyService.classify(1L, "PRI", "결제 장애", "").priority()).isEqualTo("HIGHEST");

    when(aiClient.classify(any()))
        .thenReturn(new IssueClassifyResult("TASK", "LOWEST", List.of(), "아이디어"));
    assertThat(classifyService.classify(1L, "PRI", "아이디어", "").priority()).isEqualTo("LOWEST");
  }

  /**
   * WP-885 — 본문 상한이 5만자로 올라도 분류 입력에는 앞 2만자만 보낸다(65,536 토큰 모델 502 방지). 잘린 곳은 생략 글자 수 표식으로 알리고, 상한 이하
   * 본문은 그대로 보낸다.
   */
  @Test
  void classify_본문은_2만자까지만_보내고_표식을_붙인다() {
    ProjectRow project =
        new ProjectRow(13L, "LONG", "긴 본문 프로젝트", null, 1L, "TEAM", false, null, null, null, null);
    when(accessGuard.assertIssueCreatable("LONG", 1L)).thenReturn(project);
    when(labelRepository.findByProject(13L)).thenReturn(List.of());
    AssistantSpec spec = new AssistantSpec(2L, "claude-sonnet-4-6", "NONE", 6, 30_000);
    when(assistantResolver.resolveWorkspaceOrEmpty()).thenReturn(Optional.of(spec));
    when(aiClient.classify(any()))
        .thenReturn(new IssueClassifyResult("TASK", "MID", List.of(), "긴 본문"));

    classifyService.classify(1L, "LONG", "긴 이슈", "가".repeat(50_000));
    classifyService.classify(1L, "LONG", "짧은 이슈", "나".repeat(20_000));

    ArgumentCaptor<IssueClassifyRequest> captor =
        ArgumentCaptor.forClass(IssueClassifyRequest.class);
    verify(aiClient, org.mockito.Mockito.times(2)).classify(captor.capture());
    assertThat(captor.getAllValues().get(0).body())
        .isEqualTo("가".repeat(20_000) + "…(이하 30000자 생략)");
    assertThat(captor.getAllValues().get(1).body()).isEqualTo("나".repeat(20_000));
  }
}

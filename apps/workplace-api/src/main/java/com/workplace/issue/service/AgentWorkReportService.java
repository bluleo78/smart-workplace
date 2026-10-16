package com.workplace.issue.service;

import com.workplace.global.security.AgentToolContext;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkReportResponse;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ReportAgentWorkRequest;
import com.workplace.issue.exception.AgentToolRequiredException;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.exception.AgentWorkNotAssigneeException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.AgentWorkAutoStarted;
import com.workplace.issue.outbound.IssueChatPoster;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserKind;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 작업 명시 보고(WP-377 §4.1). 담당자 본인의 작업을 시작·갱신·종료하고, 선택적으로 이슈 챗에 글을 올린다. AgentWorkService 는
 * IssueChatPoster 에 의존하지 않고 이 서비스만 의존해 빈 순환을 피한다.
 */
@Service
@RequiredArgsConstructor
public class AgentWorkReportService {

  /** message 에서 note 를 만들 때 자르는 길이 — note 컬럼 한도와 같다. */
  private static final int NOTE_MAX = 120;

  private final AgentWorkService agentWorkService;
  private final IssueService issueService;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueChatPoster chatPoster;

  /** 명시 보고. 부수 쓰기(상태 변경·챗 글)가 자동 터치로 보고 상태를 되돌리지 않도록 전체를 억제 구간으로 감싼다. */
  @Transactional
  public AgentWorkReportResponse report(
      long callerId, String projectKey, int number, ReportAgentWorkRequest req) {
    String tool = AgentToolContext.current();
    if (tool == null) throw new AgentToolRequiredException();
    return AgentToolContext.suppressTouch(() -> doReport(callerId, projectKey, number, req, tool));
  }

  private AgentWorkReportResponse doReport(
      long callerId, String projectKey, int number, ReportAgentWorkRequest req, String tool) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    if (!assigneeRepository.findUserIdsByIssue(issue.id()).contains(callerId)) {
      throw new AgentWorkNotAssigneeException();
    }
    if (IssueStatuses.CLOSED.contains(issue.status())) throw new AgentWorkIssueClosedException();

    boolean hasMessage = req.message() != null && !req.message().isBlank();

    // 종료 상태(COMPLETED·FAILED·CANCELED·REJECTED)는 진행 상태 갱신이 아니라 작업 행을 닫는 신호다.
    // startOrUpdate 에 넘기지 않고, TODO 이슈도 IN_PROGRESS 로 올리지 않으며 이슈 상태는 건드리지 않는다.
    if (AgentWorkState.isTerminal(req.state())) {
      // message 는 상태와 무관한 챗 글(스펙 §4.1) — 종료 보고여도 먼저 올린다(질문 표시 없음).
      if (hasMessage) {
        chatPoster.post(callerId, projectKey, number, req.message(), false);
      }
      // 착수 전(SUBMITTED)에서 곧바로 종료 보고하면 행의 tool 이 비어 있으므로 요청의 도구를 종료와 함께 채우고, 보고에 담긴 마지막
      // note·progress·단계 수도 같은 문장에서 반영한다(note 는 일반 보고와 같은 규칙으로 정한다).
      agentWorkService.end(
          issue.id(),
          callerId,
          req.state(),
          new AgentWorkPatch(
              tool,
              null,
              noteFor(req, hasMessage),
              "".equals(req.note()),
              req.progress(),
              req.stepsDone(),
              req.stepsTotal()));
      return new AgentWorkReportResponse(null, true);
    }

    // 작업을 시작했으면 TODO 이슈는 진행 중으로 — 상태 변경이 자동 터치로 보고를 덮지 않게 이미 억제 구간 안이다.
    if ("TODO".equals(issue.status())) {
      issueService.updateStatus(callerId, projectKey, number, "IN_PROGRESS");
    }

    boolean clearNote = "".equals(req.note());

    var view =
        agentWorkService.startOrUpdate(
            issue.id(),
            callerId,
            tool,
            new AgentWorkPatch(
                tool,
                req.state(),
                noteFor(req, hasMessage),
                clearNote,
                req.progress(),
                req.stepsDone(),
                req.stepsTotal()));

    // 갱신된 상태가 답변 필요(INPUT_REQUIRED)이고 작업자가 AI 구성원일 때만 질문으로 저장한다(사람 글·인증 필요 글은 일반 글).
    // 질문 여부를 생성과 함께 저장하려고 작업 갱신 뒤에 글을 올린다 — 같은 트랜잭션이라 이벤트는 커밋 뒤 함께 나간다.
    if (hasMessage) {
      boolean question =
          AgentWorkState.INPUT_REQUIRED.equals(view.state())
              && UserKind.isAgent(view.worker().kind());
      chatPoster.post(callerId, projectKey, number, req.message(), question);
    }
    return new AgentWorkReportResponse(view, false);
  }

  /**
   * MCP 쓰기로 할 일 이슈의 AI 작업이 자동 시작됐으면(WP-393) 명시 보고와 같은 규칙으로 진행 중으로 올린다(이력·상태 변경 알림 포함). 쓰기와 같은 트랜잭션의
   * 동기 리스너다. 명시 보고와 달리 멤버가 아니면 건너뛴다 — 상태는 멤버만 바꿀 수 있어 403 이 나면 AI 가 한 원래 쓰기까지 함께 롤백되기 때문. 상태 변경 알림이
   * 다시 자동 터치를 일으켜 작업 이벤트를 한 번 더 남기지 않게 터치 억제 구간에서 바꾼다. 그 사이 프로젝트가 사라졌으면 건너뛴다.
   */
  @EventListener
  public void onAgentWorkAutoStarted(AgentWorkAutoStarted e) {
    projectRepository
        .findById(e.projectId())
        .filter(project -> accessGuard.isMemberOrAdmin(project, e.actorId()))
        .ifPresent(
            project ->
                AgentToolContext.suppressTouch(
                    () ->
                        issueService.updateStatus(
                            e.actorId(), project.key(), e.issueNumber(), "IN_PROGRESS")));
  }

  /** 보고의 note: 빈 문자열은 지우기(null + clearNote), 미지정이면 message 첫 줄(최대 120자)로 대체, 둘 다 없으면 null(유지). */
  private static String noteFor(ReportAgentWorkRequest req, boolean hasMessage) {
    if (req.note() == null) return hasMessage ? firstLine(req.message()) : null;
    return req.note().isEmpty() ? null : req.note();
  }

  /** message 첫 줄(앞뒤 공백 제거)을 note 한도로 자른다. */
  private static String firstLine(String message) {
    String line = message.strip().lines().findFirst().orElse("").strip();
    if (line.length() <= NOTE_MAX) return line;
    // 서로게이트 쌍(이모지 등)을 반으로 쪼개지 않도록 경계가 high surrogate 면 한 글자 물린다.
    int end = Character.isHighSurrogate(line.charAt(NOTE_MAX - 1)) ? NOTE_MAX - 1 : NOTE_MAX;
    return line.substring(0, end);
  }
}

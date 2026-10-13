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
import com.workplace.issue.outbound.IssueChatPoster;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.service.ProjectAccessGuard;
import lombok.RequiredArgsConstructor;
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

    // ENDED 는 저장 상태가 아니라 종료 신호 — startOrUpdate 에 넘기면 state 컬럼에 "ENDED" 가 써진다. 이슈 상태는 건드리지 않는다.
    if (AgentWorkState.ENDED.equals(req.state())) {
      // message 는 상태와 무관한 챗 글(스펙 §4.1) — 종료 보고여도 올린다(질문 표시 없음). note·progress 는 종료라 무시.
      if (req.message() != null && !req.message().isBlank()) {
        chatPoster.post(callerId, projectKey, number, req.message());
      }
      agentWorkService.end(issue.id(), callerId);
      return new AgentWorkReportResponse(null, true);
    }

    // 작업을 시작했으면 TODO 이슈는 진행 중으로 — 상태 변경이 자동 터치로 보고를 덮지 않게 이미 억제 구간 안이다.
    if ("TODO".equals(issue.status())) {
      issueService.updateStatus(callerId, projectKey, number, "IN_PROGRESS");
    }

    boolean hasMessage = req.message() != null && !req.message().isBlank();
    Long messageId =
        hasMessage ? chatPoster.post(callerId, projectKey, number, req.message()) : null;

    // note: 빈 문자열은 지우기, 미지정이면 message 첫 줄(최대 120자)로 대체.
    String note = req.note();
    boolean clearNote = note != null && note.isEmpty();
    if (clearNote) note = null;
    if (req.note() == null && hasMessage) note = firstLine(req.message());

    var view =
        agentWorkService.startOrUpdate(
            issue.id(),
            callerId,
            tool,
            new AgentWorkPatch(
                tool,
                req.state(),
                note,
                clearNote,
                req.progress(),
                req.stepsDone(),
                req.stepsTotal()));

    // AI 구성원이 답변 필요로 멈추며 남긴 글만 질문으로 표시한다(사람 글은 일반 글).
    if (messageId != null
        && AgentWorkState.WAITING.equals(view.state())
        && "AGENT".equals(view.worker().kind())) {
      chatPoster.markQuestion(messageId);
    }
    return new AgentWorkReportResponse(view, false);
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

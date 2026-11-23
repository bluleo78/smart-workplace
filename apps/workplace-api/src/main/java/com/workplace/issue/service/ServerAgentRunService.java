package com.workplace.issue.service;

import com.workplace.global.util.Texts;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.ServerAgentRunReport;
import com.workplace.issue.repository.AgentServerRunRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.service.WorkflowAgentWorkBridge;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버가 돌리는(INTERNAL) AI 의 이슈 실행을 작업 기록(agent_work)으로 남긴다(WP-1219).
 *
 * <p>외부 AI 는 MCP 의 report_agent_work 로 스스로 보고하지만, 서버 AI 는 그 도구를 싣지 않고(모델이 아닌 서버가 기록한다) Internal 대행
 * 호출이고 이슈 쓰기는 작업을 시작하지 않는다(WP-1365). 그래서 기록이 하나도 없어 AI 위임 작업에서 빠졌다. ai-agent 가 담당 지정·코멘트로 깨어난 실행의
 * 시작과 끝을 알리면 여기서 「작업 중」 → 「검토 대기」(정상 끝) 또는 「차단됨」(실패)으로 남긴다.
 *
 * <p>기록을 바꾸지 않는 경우: 이슈가 끝났거나(완료·취소 — 완료 처리가 이미 기록을 닫았다) AI 가 담당에서 빠졌으면(스스로 빠짐 포함) 되살리지 않는다. 그 AI 가
 * 이 이슈의 반복을 돌리면 반복이 기록(다음 회차 대기 등)을 맡으므로 건드리지 않는다.
 *
 * <p>워크플로우 이슈(WP-1986): 노드 담당 AI 의 실패 끝은 노드를 멈추고(조치로 잇는다), 정상 끝은 검토 대기를 쓰지 않는다 — 판정은 {@link
 * WorkflowAgentWorkBridge#onServerRunSuccess}. 이동 없이 끝났으면 실행 id 로 그 AI 의 마지막 도는 실행의 끝인지 가려({@link
 * AgentServerRunRepository}) 그때만 작업 중 행을 대기 중(WAITING + {@link
 * AgentWorkState#NOTE_FINISHED_WITHOUT_MOVE})으로 내린다 — 「일했고 쉬는 중」이라 이슈 완료 때 COMPLETED 로 닫히고 알림도 없다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class ServerAgentRunService {

  /** 서버가 대신 남기는 작업 기록의 도구 이름 — 반복 작업과 같다. */
  static final String TOOL = IssueRecurrenceService.TOOL;

  static final String NOTE_WORKING = "맡은 일을 처리하는 중";
  static final String NOTE_DONE = "처리를 마쳤습니다 — 이슈 코멘트로 결과를 확인해 주세요";
  static final String NOTE_FAILED_DEFAULT = "실행이 정상적으로 끝나지 않았습니다";

  /**
   * 실행이 FINISHED 없이 죽어 남은 도는 실행 행을 더는 세지 않는 시간.
   *
   * <p>ai-agent 의 실행 제한 시간(WORKPLACE_AI_TIMEOUT_MS, 기본 300초)과 묶여 있다 — 늘 그보다 크게 유지한다. 제한 시간 안에서 도는
   * 실행을 죽은 것으로 보면 다른 실행의 끝이 작업을 잘못 쉬는 중으로 내린다. ai-agent 의 제한 시간을 이보다 길게 바꾸면 이 값도 함께 올린다(설정으로 빼지
   * 않았다).
   */
  static final Duration RUN_STALE_AFTER = Duration.ofMinutes(30);

  /** note 한도 — 보고 API 와 같은 값을 쓴다. */
  static final int NOTE_MAX = AgentWorkReportService.NOTE_MAX;

  private final AgentWorkService agentWorkService;
  private final IssueRepository issueRepository;
  private final IssueRecurrenceRepository recurrenceRepository;
  private final UserRepository userRepository;
  private final WorkflowAgentWorkBridge workflowBridge;
  private final AgentServerRunRepository serverRunRepository;

  /**
   * 실행 보고를 반영한다. 반영하지 않는 경우(이슈 없음·끝남·담당 아님·반복이 맡음·동시 종료)는 조용히 넘긴다 — ai-agent 는 결과와 상관없이 다음 일로 간다.
   *
   * @param agentId 대행 호출의 AI(X-On-Behalf-Of) — AI 가 아니면 403
   */
  public void report(long agentId, long issueId, ServerAgentRunReport report) {
    boolean callerIsAgent =
        userRepository.findById(agentId).map(u -> UserKind.isAgent(u.kind())).orElse(false);
    if (!callerIsAgent) throw new AccessDeniedException("AI 만 실행을 보고할 수 있습니다");
    AgentWorkPatch patch = patchFor(report);
    UUID runId = report.runUuid();

    // 이슈 행을 먼저 잠가 같은 이슈의 STARTED·FINISHED 를 줄 세운다 — 동시에 끝난 두 실행이 서로의 행을 보고 둘 다 작업 중에 남거나,
    // 「남은 실행 없음」 판정 뒤 새 실행의 STARTED 가 먼저 커밋되지 않게(이동·조치와 같은 이슈 우선 순서). 삭제된 이슈는 오지 않는다.
    IssueRow issue = issueRepository.findActiveByIdForNoKeyUpdate(issueId).orElse(null);
    if (issue == null) return;
    // 끝난 실행은 이른 return(담당에서 빠짐·반복이 맡음) 전에 도는 실행 표에서 지운다 — 남으면 뒤의 다른 실행 끝을 막는다.
    if (runId != null && ServerAgentRunReport.FINISHED.equals(report.phase())) {
      serverRunRepository.deleteFinished(issueId, agentId, runId);
    }
    if (!agentWorkService.isLiveFor(issue, agentId)) return;
    // 그 AI 의 반복이 이 이슈에 있으면 반복이 기록을 맡는다 — 코멘트 실행이 「다음 회차 대기」를 덮지 않게. 지운 반복(묘비)은 맡지 않는다.
    if (recurrenceRepository
        .find(issueId)
        .filter(r -> !r.deleted() && r.agentUserId() == agentId)
        .isPresent()) {
      return;
    }
    if (runId != null && ServerAgentRunReport.STARTED.equals(report.phase())) {
      serverRunRepository.insertStarted(issueId, agentId, runId, RUN_STALE_AFTER);
    }
    if (ServerAgentRunReport.FINISHED.equals(report.phase())) {
      if (report.ok()) {
        switch (workflowBridge.onServerRunSuccess(issueId, agentId)) {
          case OWNED -> {
            return;
          }
          case FINISHED_WITHOUT_MOVE -> {
            // 그 AI 의 다른 실행(다음 노드의 새 실행·이슈 댓글로 깨어난 실행)이 아직 돌면 작업 중 그대로 둔다. 이 실행이 표에 없어도
            // (STARTED 를 잃음) 남은 실행이 없으면 내린다. runId 없는 보고(배포 중의 옛 ai-agent)는 어느 실행인지 몰라 그대로 둔다.
            if (runId == null
                || serverRunRepository.hasLiveRun(issueId, agentId, RUN_STALE_AFTER)) {
              return;
            }
            patch = patch(AgentWorkState.WAITING, AgentWorkState.NOTE_FINISHED_WITHOUT_MOVE);
          }
          case NOT_OWNED -> {}
        }
      } else {
        // 실패 끝은 차단 보고와 같은 경로 — 노드 담당이면 노드를 멈춰 조치(/recover)로 잇는다.
        workflowBridge.onAgentReport(issueId, agentId, AgentWorkState.BLOCKED, patch.note());
      }
    }
    // 읽은 뒤 다른 트랜잭션이 이슈를 닫았으면 AgentWorkIssueClosedException(409) 이 그대로 나간다 — 같은 트랜잭션이 이미 롤백 전용이라
    // 여기서 삼켜도 커밋이 실패한다. ai-agent 는 보고 실패를 로그로만 남기고 넘어간다.
    var transition = agentWorkService.startOrUpdateTracked(issueId, agentId, TOOL, patch);
    // 검토 대기·차단됨으로 들어선 순간에만 명시 보고와 같은 AI 작업 알림(검토 요청·답변 필요)을 낸다 — 같은 상태 보고는 다시 알리지 않는다.
    String state = transition.view().state();
    if (!Objects.equals(transition.previousState(), state)) {
      agentWorkService.publishEnteredNotice(issue, agentId, state);
    }
  }

  /** 보고 → 작업 기록 패치. 알 수 없는 phase 는 400. */
  private static AgentWorkPatch patchFor(ServerAgentRunReport report) {
    String phase = report == null ? null : report.phase();
    if (ServerAgentRunReport.STARTED.equals(phase)) {
      return patch(AgentWorkState.WORKING, NOTE_WORKING);
    }
    if (ServerAgentRunReport.FINISHED.equals(phase)) {
      if (report.ok()) return patch(AgentWorkState.REVIEW, NOTE_DONE);
      String note =
          report.note() == null || report.note().isBlank()
              ? NOTE_FAILED_DEFAULT
              : report.note().strip();
      return patch(AgentWorkState.BLOCKED, Texts.headUtf16(note, NOTE_MAX));
    }
    throw new IllegalArgumentException("phase 는 STARTED 또는 FINISHED 여야 합니다");
  }

  private static AgentWorkPatch patch(String state, String note) {
    return new AgentWorkPatch(TOOL, state, note, false, null, null, null);
  }
}

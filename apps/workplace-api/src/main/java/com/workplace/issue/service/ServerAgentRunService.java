package com.workplace.issue.service;

import com.workplace.global.util.Texts;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.ServerAgentRunReport;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버가 돌리는(INTERNAL) AI 의 이슈 실행을 작업 기록(agent_work)으로 남긴다(WP-1219).
 *
 * <p>외부 AI 는 MCP 의 report_agent_work 로 스스로 보고하지만, 서버 AI 는 그 도구를 싣지 않고(모델이 아닌 서버가 기록한다) Internal 대행
 * 호출이라 쓰기 자동 시작도 일어나지 않는다. 그래서 기록이 하나도 없어 AI 위임 작업에서 빠졌다. ai-agent 가 담당 지정·코멘트로 깨어난 실행의 시작과 끝을 알리면
 * 여기서 「작업 중」 → 「검토 대기」(정상 끝) 또는 「막힘」(실패)으로 남긴다.
 *
 * <p>기록을 바꾸지 않는 경우: 이슈가 끝났거나(완료·취소 — 완료 처리가 이미 기록을 닫았다) AI 가 담당에서 빠졌으면(스스로 빠짐 포함) 되살리지 않는다. 그 AI 가
 * 이 이슈의 반복을 돌리면 반복이 기록(다음 회차 대기 등)을 맡으므로 건드리지 않는다.
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

  /** note 한도 — 보고 API 와 같은 값을 쓴다. */
  static final int NOTE_MAX = AgentWorkReportService.NOTE_MAX;

  private final AgentWorkService agentWorkService;
  private final IssueRepository issueRepository;
  private final IssueRecurrenceRepository recurrenceRepository;
  private final UserRepository userRepository;

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

    // findById 는 삭제된 이슈를 돌려주지 않는다.
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    if (issue == null || !agentWorkService.isLiveFor(issue, agentId)) return;
    // 그 AI 의 반복이 이 이슈에 있으면 반복이 기록을 맡는다 — 코멘트 실행이 「다음 회차 대기」를 덮지 않게. 지운 반복(묘비)은 맡지 않는다.
    if (recurrenceRepository
        .find(issueId)
        .filter(r -> !r.deleted() && r.agentUserId() == agentId)
        .isPresent()) {
      return;
    }
    // 읽은 뒤 다른 트랜잭션이 이슈를 닫았으면 AgentWorkIssueClosedException(409) 이 그대로 나간다 — 같은 트랜잭션이 이미 롤백 전용이라
    // 여기서 삼켜도 커밋이 실패한다. ai-agent 는 보고 실패를 로그로만 남기고 넘어간다.
    var transition = agentWorkService.startOrUpdateTracked(issueId, agentId, TOOL, patch);
    // 검토 대기·막힘으로 들어선 순간에만 명시 보고와 같은 AI 작업 알림(검토 요청·답변 필요)을 낸다 — 같은 상태 보고는 다시 알리지 않는다.
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

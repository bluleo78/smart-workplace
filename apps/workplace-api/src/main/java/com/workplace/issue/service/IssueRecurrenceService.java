package com.workplace.issue.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.util.Texts;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRecurrenceRequest;
import com.workplace.issue.dto.IssueRecurrenceResponse;
import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.issue.dto.IssueRecurrenceRunReport;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.InvalidIssueRecurrenceException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.IssueRecurrenceConflictException;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.outbound.IssueChatPoster;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.project.service.ProjectService;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 개인 작업의 반복 AI 작업(WP-989). 개인 작업 이슈에 반복 규칙을 붙이면 정한 시각(KST)마다 담당 AI 비서에게 회차 실행 이벤트를 보내고, AI 의 결과 보고를
 * 그 AI 이름의 이슈 챗 글로 남긴다.
 *
 * <p>AI 작업 기록(agent_work)은 회차 사이 「다음 회차 대기」(SCHEDULED + next_run_at), 실행 중 「작업 중」(WORKING)이다. 3회 연속
 * 실패하면 반복을 끄고 「막힘」(BLOCKED)으로 둔다. 이슈가 끝났거나 담당에서 그 AI 가 빠졌으면 스케줄러가 반복을 지우고 작업을 취소한다.
 *
 * <p>회차 실행 중의 쓰기(메일 보내기·이슈 만들기 등)는 하지 않는다 — 사람이 없는 실행이라 확인 카드를 띄울 수 없어, ai-agent 의 회차 지시문이 읽기·정리만
 * 하고 필요한 쓰기는 결과 글에 「제안」으로 적게 한다.
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class IssueRecurrenceService {

  /** 반복이 남기는 AI 작업 기록의 도구 이름 — 서버가 대신 기록하는 작업이다. */
  static final String TOOL = "workplace";

  static final String NOTE_SCHEDULED = "반복 · 다음 회차 대기";
  static final String NOTE_RUNNING = "반복 회차 실행 중";
  static final String NOTE_STOPPED = "3회 연속 실패로 반복을 멈췄습니다";

  /** 이 횟수만큼 연속 실패하면 반복을 끈다. */
  static final int MAX_CONSECUTIVE_FAILURES = 3;

  static final String NOT_PERSONAL = "반복은 개인 작업에서만 쓸 수 있습니다";
  static final String NO_ASSISTANT = "쓸 수 있는 AI 비서가 없습니다 — 개인 비서를 연결하거나 관리자에게 공통 비서 지정을 요청하세요";
  static final String ISSUE_CLOSED = "완료·취소된 작업에는 반복을 둘 수 없습니다";

  /** 실패 회차 글의 머리. */
  static final String FAILED_PREFIX = "이번 회차를 실행하지 못했습니다: ";

  /** 반복을 멈췄을 때 이슈 챗에 남기는 안내. */
  static final String STOPPED_NOTICE = "반복 작업이 3회 연속 실패해 반복을 멈췄습니다. 이슈의 반복 설정에서 다시 저장하면 다시 켜집니다.";

  /** 결과를 받지 못한 회차(다음 회차가 됐는데도 대기 중이거나 오래 대기한 회차)를 실패로 셀 때 남기는 글. */
  static final String LOST_RUN = "이전 회차 결과를 받지 못했습니다";

  /** 다음 회차를 더는 계산할 수 없어 반복을 껐을 때 남기는 안내. */
  static final String NO_NEXT_NOTICE = "다음 회차 시각을 정할 수 없어 반복을 멈췄습니다. 이슈의 반복 설정을 다시 저장해 주세요.";

  static final String NOTE_NO_NEXT = "다음 회차를 정할 수 없어 반복을 멈췄습니다";

  /**
   * 보낸 회차의 결과를 이만큼 기다린다 — 넘으면 결과를 못 받은 회차로 보고 실패로 센 뒤 「다음 회차 대기」로 되돌린다(월 반복이 한 달 내내 작업 중으로 남지 않게).
   */
  static final Duration PENDING_TIMEOUT = Duration.ofMinutes(30);

  /** 결과 글이 비었을 때 대신 남기는 글. */
  static final String EMPTY_RESULT = "(이번 회차 결과가 비어 있습니다)";

  /** 이슈 챗 글 한도 — 보고 글(ReportAgentWorkRequest.message)과 같다. 넘으면 자른다. */
  static final int CHAT_BODY_MAX = 4000;

  private static final String TRUNCATED_MARK = "\n\n…(길어서 줄였습니다)";

  private final IssueRecurrenceRepository repository;
  private final IssueRecurrenceRules rules;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  // 비서를 멤버·담당으로 넣는 경로 — 사람이 할 때와 같은 서비스로(검증·이력·워처·실시간 갱신).
  private final ProjectService projectService;
  private final ProjectMemberRepository memberRepository;
  private final IssueAssigneeService assigneeService;
  private final AssistantResolver assistantResolver;
  private final AgentWorkService agentWorkService;
  private final IssueChatPoster chatPoster;
  private final UserRepository userRepository;
  private final ApplicationEventPublisher publisher;
  // 스케줄러 회차를 행마다 세이브포인트로 감싸는 데 쓴다(한 행의 실패가 테넌트 전체를 되돌리지 않게).
  private final PlatformTransactionManager txManager;

  // ───────────────────────────── REST(사람) ─────────────────────────────

  /** 이슈의 반복. 없으면 빈 값(컨트롤러가 204). 이슈를 읽을 수 있으면 볼 수 있다. */
  @Transactional(readOnly = true)
  public Optional<IssueRecurrenceResponse> get(long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue = issue(project, projectKey, number);
    // 묘비(실행 중에 지운 반복)는 없는 반복이다.
    return repository.find(issue.id()).filter(r -> !r.deleted()).map(this::toResponse);
  }

  /**
   * 반복을 저장한다(없으면 만들고 있으면 바꾼다 — 꺼진 반복도 다시 켜진다). 개인 작업이고, 소유자의 AI 비서(개인 비서, 없으면 공용 비서)가 있어야 한다(없으면
   * 409). 비서가 아직 멤버·담당이 아니면 넣는다. 저장하면 그 AI 의 작업 기록을 「다음 회차 대기」로 시작하거나 바꾼다.
   */
  public IssueRecurrenceResponse save(
      long callerId, String projectKey, int number, IssueRecurrenceRequest req) {
    // 이슈 수정과 같은 가드 — 멤버만(개인 프로젝트는 소유자만 멤버다).
    var project = accessGuard.assertMember(projectKey, callerId);
    if (!"PERSONAL".equals(project.type())) throw conflict(NOT_PERSONAL);
    var issue = issue(project, projectKey, number);
    String rrule = rules.normalizeRrule(req == null ? null : req.rrule());
    LocalTime time = rules.parseTime(req == null ? null : req.time());
    if (IssueStatuses.CLOSED.contains(issue.status())) throw conflict(ISSUE_CLOSED);
    long agentId =
        assistantResolver
            .resolveOrEmpty(project.ownerId())
            .map(AssistantSpec::agentUserId)
            .orElseThrow(() -> conflict(NO_ASSISTANT));

    // 켜진 반복은 늘 다음 회차가 있어야 한다 — 계산할 수 없는 규칙은 저장하지 않는다.
    Instant next = rules.nextRunAfter(rrule, time, Instant.now());
    if (next == null) throw new InvalidIssueRecurrenceException("다음 회차를 정할 수 없는 반복 규칙입니다");

    enrollAssistant(callerId, project, projectKey, issue, agentId);

    IssueRecurrenceRow old = repository.findForUpdate(issue.id()).orElse(null);
    boolean agentChanged = old != null && old.agentUserId() != agentId;
    // 비서가 바뀌었으면(개인 비서를 새로 정함 등) 예전 AI 의 반복 작업 기록은 끝낸다 — 두 AI 가 같은 반복을 기다리는 것처럼 보이지 않게.
    if (agentChanged) cancelWork(issue.id(), old.agentUserId());
    repository.upsert(issue.id(), rrule, time, agentId, callerId, next);
    // 예전 AI 가 돌리던 회차의 결과는 받지 않는다(늦게 와도 조용히 무시된다).
    if (agentChanged && old.pendingRunId() != null) repository.clearPending(issue.id());

    // 같은 AI 의 회차가 아직 도는 중이면 「작업 중」을 그대로 둔다 — 결과 보고가 「다음 회차 대기」로 바꾼다.
    boolean running = old != null && !agentChanged && old.pendingRunId() != null;
    agentWorkService.startOrUpdateTracked(
        issue.id(), agentId, TOOL, running ? runningPatch() : scheduledPatch(next));
    return toResponse(repository.find(issue.id()).orElseThrow());
  }

  /**
   * 반복을 지운다(없어도 성공 — 멱등). 그 AI 의 진행 중 작업 기록은 취소로 끝낸다.
   *
   * <p>회차가 도는 중(결과 대기)이면 행을 바로 지우지 않고 묘비(deleted, 꺼짐)로 남긴다 — 이미 시킨 회차의 결과는 사용자가 기다리는 것이라, 도착하면 이슈
   * 챗에 남기고 그때 행을 지운다(결과가 끝내 안 오면 스케줄러의 대기 시간 초과 정리가 지운다). 묘비는 조회·목록·스케줄러에서 빠지고, 다시 저장하면 되살아난다.
   */
  public void delete(long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue = issue(project, projectKey, number);
    repository
        .findForUpdate(issue.id())
        .ifPresent(
            row -> {
              if (row.pendingRunId() == null) {
                cancel(row);
                return;
              }
              repository.tombstone(issue.id());
              cancelWork(issue.id(), row.agentUserId());
            });
  }

  // ───────────────────────────── 스케줄러 ─────────────────────────────

  /**
   * 현재 테넌트(호출자가 연 테넌트 트랜잭션)에서 스케줄러 한 번의 일을 한다.
   *
   * <ol>
   *   <li>대기 시간 초과 정리 — 보낸 지 {@link #PENDING_TIMEOUT} 이 지나도록 결과가 오지 않은 회차를 실패로 세고(「이전 회차 결과를 받지
   *       못했습니다」) 작업을 「다음 회차 대기」로 되돌린다. 묘비는 지운다.
   *   <li>회차 실행 — 회차 시각이 된 반복마다 이슈 상태·담당을 확인한 뒤 회차 이벤트를 발행하고(커밋 뒤 ai-agent 로 나간다), 다음 회차를 「지금 이후의 첫
   *       회차」로 옮기고, AI 작업을 「작업 중」으로 바꾼다. 이슈가 끝났거나(삭제 포함) 담당에서 AI 가 빠졌으면 회차를 건너뛰고 반복을 지운다.
   * </ol>
   *
   * 보낸 회차 수를 돌려준다.
   */
  public int runDue(Instant now) {
    // 행마다 세이브포인트(NESTED) — 한 행이 실패해도 그 행의 쓰기만 되돌리고 나머지 행과 테넌트 트랜잭션은 그대로 커밋한다. 회차 이벤트 발행은
    // runOne 의 마지막 문장이라, 실패한 행은 이벤트를 내지 않는다.
    TransactionTemplate perRow = new TransactionTemplate(txManager);
    perRow.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    for (IssueRecurrenceRow row : repository.lockStalePending(now.minus(PENDING_TIMEOUT))) {
      try {
        perRow.executeWithoutResult(status -> sweepOne(row));
      } catch (RuntimeException e) {
        log.warn("[recurrence] 결과 대기 초과 정리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    // 정리가 끝난 뒤에 읽는다 — 방금 실패로 센 회차를 결과 대기로 다시 보지 않게.
    int sent = 0;
    for (IssueRecurrenceRow row : repository.lockDue(now)) {
      try {
        if (Boolean.TRUE.equals(perRow.execute(status -> runOne(row, now)))) sent++;
      } catch (RuntimeException e) {
        log.warn("[recurrence] 반복 회차 처리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    return sent;
  }

  /** 결과를 오래 못 받은 회차 하나 — 묘비면 지우고, 아니면 실패로 센다. */
  private void sweepOne(IssueRecurrenceRow row) {
    log.info("[recurrence] 회차 결과 대기 시간 초과 issueId={} runId={}", row.issueId(), row.pendingRunId());
    if (row.deleted()) {
      repository.delete(row.issueId());
      return;
    }
    applyResult(row, false, LOST_RUN);
  }

  /** 반복 하나의 이번 회차 — 보냈으면 true, 건너뛰었으면(지움·멈춤) false. */
  private boolean runOne(IssueRecurrenceRow row, Instant now) {
    IssueRow issue = issueRepository.findById(row.issueId()).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue == null || project == null || !live(issue, row.agentUserId())) {
      log.info("[recurrence] 반복 해제 — 이슈 종료·삭제 또는 담당 해제. issueId={}", row.issueId());
      cancel(row);
      return false;
    }

    // 다음 회차가 됐는데 지난 회차 결과를 아직 기다리는 중이다 — 보낸 지 PENDING_TIMEOUT 이 안 된 살아 있는 회차라(지난 것은 위
    // 정리가 이미 실패로 셌다) 실패로 세지 않고 이번 회차를 미룬다. 회차 시각은 그대로 두어, 결과가 오거나 대기가 끝난 뒤의 확인에서 보낸다.
    // 예: 09:00 회차를 보낸 뒤 09:03 에 시각을 09:05 로 당겨 저장한 경우(리뷰 PR #971).
    if (row.pendingRunId() != null) {
      log.info("[recurrence] 지난 회차 결과 대기 중 — 이번 회차를 미룬다. issueId={}", row.issueId());
      return false;
    }

    // 켜진 반복은 늘 다음 회차가 있어야 한다 — 계산할 수 없으면(규칙이 더는 회차를 내지 않음) 반복을 끄고 알린다. null 을 저장하지 않는다.
    Instant next = rules.nextRunAfter(row.rrule(), row.runTime(), now);
    if (next == null) {
      log.warn(
          "[recurrence] 다음 회차 계산 불가 — 반복을 끈다. issueId={} rrule={}", row.issueId(), row.rrule());
      repository.disable(row.issueId());
      post(row.agentUserId(), project, issue, NO_NEXT_NOTICE);
      block(issue, row.agentUserId(), NOTE_NO_NEXT);
      return false;
    }

    Instant runAt = row.nextRunAt();
    String runId = row.issueId() + "-" + runAt.getEpochSecond();
    repository.markDispatched(row.issueId(), runId, now, next);
    agentWorkService.startOrUpdateTracked(issue.id(), row.agentUserId(), TOOL, runningPatch());
    List<UserSummary> assignees = assigneeRepository.findByIssue(issue.id());

    UserSummary actor =
        userRepository.findById(row.createdBy()).map(UserResponse::toSummary).orElse(null);
    publisher.publishEvent(
        new IssueRecurringRunEvent(
            issue.id(),
            project.key(),
            project.key() + "-" + issue.number(),
            issue.title(),
            actor,
            assignees,
            row.agentUserId(),
            row.createdBy(),
            runId,
            runAt,
            row.runCount() + 1,
            row.rrule(),
            IssueRecurrenceRules.formatTime(row.runTime()),
            issue.body() == null || issue.body().isBlank() ? null : issue.body(),
            now));
    return true;
  }

  // ───────────────────────────── 결과 보고(ai-agent) ─────────────────────────────

  /**
   * ai-agent 의 회차 결과 보고. 보고자는 AI 여야 한다(사람·없는 사용자는 403). 결과 대기 중인 회차(runId)와 같을 때만 반영하고, 다르면(같은
   * runId 두 번째·지난 회차·시간 초과로 실패 처리된 회차·실행 AI 가 바뀐 뒤 예전 AI 의 보고·지운 반복) 조용히 무시한다. runId 는 맞는데 보고자가 그
   * 반복의 AI 가 아니면 403.
   *
   * <ul>
   *   <li>성공: 결과를 그 AI 이름으로 이슈 챗에 남기고 연속 실패 수를 0 으로, 작업은 「다음 회차 대기」로.
   *   <li>실패: 연속 실패 수 +1, 「이번 회차를 실행하지 못했습니다: 사유」 글. 3회째면 반복을 끄고 작업을 「막힘」으로 두고 안내 글을 남긴다. 아니면 「다음
   *       회차 대기」로 되돌린다.
   *   <li>묘비(실행 중에 지운 반복): 결과 글만 남기고 행을 지운다.
   * </ul>
   *
   * 이슈가 그 사이 끝났으면 글만 남기고(작업 기록은 이슈 종료가 이미 닫았다) 작업 상태는 바꾸지 않는다. 이슈가 지워졌으면 글도 남기지 않는다.
   */
  public void reportRun(long callerId, long issueId, IssueRecurrenceRunReport report) {
    if (report == null || report.runId() == null || report.runId().isBlank()) {
      throw new InvalidIssueRecurrenceException("runId 가 필요합니다");
    }
    // 내부 토큰을 가진 호출이어도 대신하는 사용자가 AI 가 아니면 받지 않는다.
    boolean callerIsAgent =
        userRepository.findById(callerId).map(u -> UserKind.isAgent(u.kind())).orElse(false);
    if (!callerIsAgent) throw new AccessDeniedException("AI 만 반복 회차 결과를 보고할 수 있습니다");

    IssueRecurrenceRow row = repository.findForUpdate(issueId).orElse(null);
    if (row == null || !report.runId().equals(row.pendingRunId())) {
      log.debug("[recurrence] 대기 중이 아닌 회차 보고 무시 issueId={} runId={}", issueId, report.runId());
      return;
    }
    if (row.agentUserId() != callerId) {
      throw new AccessDeniedException("이 반복을 실행하는 AI 만 결과를 보고할 수 있습니다");
    }
    String body =
        report.ok()
            ? orDefault(report.message(), EMPTY_RESULT)
            : FAILED_PREFIX + orDefault(report.message(), "알 수 없는 오류");
    applyResult(row, report.ok(), body);
  }

  /**
   * 회차 하나의 결과(보고된 성공·실패, 또는 결과를 못 받은 실패)를 반영한다 — 결과 대기를 비우고 연속 실패 수를 바꾸고, 그 AI 이름으로 이슈 챗에 글을 남기고,
   * 작업 기록을 「다음 회차 대기」나(3회 연속 실패) 「막힘」으로 둔다. 묘비면 글만 남기고 행을 지운다. 바뀐 연속 실패 수를 돌려준다(묘비는 0) — {@link
   * #MAX_CONSECUTIVE_FAILURES} 이상이면 이번 결과로 반복이 멈춘 것이다.
   */
  private int applyResult(IssueRecurrenceRow row, boolean ok, String body) {
    long issueId = row.issueId();
    long agentId = row.agentUserId();
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);

    if (row.deleted()) {
      // 지운 반복의 마지막 회차 결과 — 사용자가 시킨 회차라 글은 남기고, 작업 기록(지울 때 취소됨)은 건드리지 않는다.
      repository.delete(issueId);
      if (issue != null && project != null) post(agentId, project, issue, body);
      return 0;
    }

    int failures = ok ? 0 : row.consecutiveFailures() + 1;
    boolean stop = !ok && failures >= MAX_CONSECUTIVE_FAILURES;
    boolean enabled = row.enabled() && !stop;
    repository.recordResult(issueId, failures, enabled);
    if (issue == null || project == null) return failures;

    post(agentId, project, issue, body);
    if (stop && row.enabled()) {
      post(agentId, project, issue, STOPPED_NOTICE);
      block(issue, agentId, NOTE_STOPPED);
    } else if (enabled && live(issue, agentId)) {
      agentWorkService.startOrUpdateTracked(
          issueId, agentId, TOOL, scheduledPatch(row.nextRunAt()));
    }
    return failures;
  }

  /** 반복이 멈춘 작업을 「막힘」으로 두고 소유자에게 알린다. 이슈가 끝났거나 AI 가 담당에서 빠졌으면 작업 기록을 되살리지 않는다(종료·담당 해제가 이미 닫았다). */
  private void block(IssueRow issue, long agentId, String note) {
    if (!live(issue, agentId)) return;
    agentWorkService.startOrUpdateTracked(
        issue.id(),
        agentId,
        TOOL,
        new AgentWorkPatch(TOOL, AgentWorkState.BLOCKED, note, false, null, null, null));
    // 막힘으로 들어선 순간 — 명시 보고와 같은 AI 작업 알림 경로(AgentWorkNoticeEvent)로 소유자에게 「답변 필요」 알림을 낸다. 수신자는
    // notify 가 이슈 챗 질문과 같은 규칙으로 고른다(개인 작업이라 소유자). 후보는 보고 경로와 같은 [담당 지정자, 보고자] 순서.
    List<Long> candidates = new ArrayList<>(2);
    assigneeRepository.findAssignedBy(issue.id(), agentId).ifPresent(candidates::add);
    if (issue.reporterId() != null) candidates.add(issue.reporterId());
    publisher.publishEvent(
        new AgentWorkNoticeEvent(
            issue.id(), agentId, AgentWorkState.BLOCKED, candidates, List.of()));
  }

  /**
   * 비서를 이 개인 작업의 담당으로 넣는다 — 개인 프로젝트는 멤버만 담당이 될 수 있는데(AssigneePolicy) 개인 작업 화면에는 AI 를 멤버로 넣는 길이 없어,
   * 반복 저장이 대신 멤버(MEMBER)로 넣고 담당에 더한다. 멤버 추가·담당 교체는 사람이 할 때와 같은 서비스 경로를 타서 검증·이력·워처·실시간 갱신이 같다. 다만
   * 담당 지정이 AI 를 깨워 이슈 작업을 시작하게(issue.assigned 실행) 하지는 않는다 — 이 AI 는 반복 회차 이벤트로만 일한다.
   */
  private void enrollAssistant(
      long callerId, ProjectRow project, String projectKey, IssueRow issue, long agentId) {
    if (!memberRepository.isDirectMember(project.id(), agentId)) {
      projectService.addMember(callerId, projectKey, new AddMemberRequest(agentId, "MEMBER"));
    }
    List<Long> assigneeIds = assigneeRepository.findUserIdsByIssue(issue.id());
    if (!assigneeIds.contains(agentId)) {
      List<Long> withAgent = new ArrayList<>(assigneeIds);
      withAgent.add(agentId);
      assigneeService.replace(callerId, projectKey, issue.number(), withAgent, false);
    }
  }

  /** 반복을 지우고 그 AI 의 작업 기록을 취소로 끝낸다. */
  private void cancel(IssueRecurrenceRow row) {
    repository.delete(row.issueId());
    cancelWork(row.issueId(), row.agentUserId());
  }

  /** 그 AI 의 반복 작업 기록을 취소로 끝낸다. */
  private void cancelWork(long issueId, long agentId) {
    agentWorkService.end(issueId, agentId, AgentWorkState.CANCELED, AgentWorkPatch.empty());
  }

  /** 이슈가 아직 열려 있고 AI 가 담당에 있는지 — 작업 기록을 바꿔도 되는지. */
  private boolean live(IssueRow issue, long agentId) {
    return !IssueStatuses.CLOSED.contains(issue.status())
        && assigneeRepository.findUserIdsByIssue(issue.id()).contains(agentId);
  }

  // ───────────────────────────── 내부 도우미 ─────────────────────────────

  /** 그 AI 이름으로 이슈 챗에 글을 남긴다 — 챗 글 한도를 넘으면 자른다. */
  private void post(long agentId, ProjectRow project, IssueRow issue, String body) {
    String text =
        body.length() <= CHAT_BODY_MAX
            ? body
            : Texts.headUtf16(body, CHAT_BODY_MAX - TRUNCATED_MARK.length()) + TRUNCATED_MARK;
    chatPoster.post(agentId, project.key(), issue.number(), text, false, List.of());
  }

  /** 「작업 중」 작업 패치 — 회차를 보낸 뒤 결과를 기다리는 동안. */
  private static AgentWorkPatch runningPatch() {
    return new AgentWorkPatch(TOOL, AgentWorkState.WORKING, NOTE_RUNNING, false, null, null, null);
  }

  /** 「다음 회차 대기」 작업 패치 — SCHEDULED + 다음 회차 시각. */
  private static AgentWorkPatch scheduledPatch(Instant next) {
    return new AgentWorkPatch(
        TOOL, AgentWorkState.SCHEDULED, NOTE_SCHEDULED, false, null, null, null, next);
  }

  private IssueRow issue(ProjectRow project, String projectKey, int number) {
    return issueRepository
        .findByProjectAndNumber(project.id(), number)
        .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
  }

  private IssueRecurrenceResponse toResponse(IssueRecurrenceRow r) {
    String agentName =
        userRepository
            .findById(r.agentUserId())
            .map(u -> u.name() != null && !u.name().isBlank() ? u.name() : u.username())
            .orElse(null);
    return new IssueRecurrenceResponse(
        r.rrule(),
        IssueRecurrenceRules.formatTime(r.runTime()),
        r.enabled(),
        r.nextRunAt(),
        r.consecutiveFailures(),
        r.lastRunAt(),
        r.agentUserId(),
        agentName);
  }

  private static String orDefault(String s, String fallback) {
    return s == null || s.isBlank() ? fallback : s.strip();
  }

  private static IssueRecurrenceConflictException conflict(String message) {
    return new IssueRecurrenceConflictException(message);
  }
}

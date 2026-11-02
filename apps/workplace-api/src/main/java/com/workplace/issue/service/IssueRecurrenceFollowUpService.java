package com.workplace.issue.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.IssueRecurrenceConflictException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.outbound.RecurringQuestionAnswers;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.OptionalLong;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 반복 회차가 남긴 질문의 답을 받아 같은 AI 의 이어 처리를 보낸다(WP-1312, {@link RecurringQuestionAnswers} 구현).
 *
 * <p>회차·이어 처리가 질문으로 끝나면 {@link IssueRecurrenceService} 가 반복 행에 「답을 기다리는 질문」을 남긴다. 소유자가 그 이슈 챗에 글을
 * 남기면(멘션 없어도) chat 모듈이 글을 저장한 트랜잭션에서 이 빈을 부르고, 답이면 질문을 소비하고 정기 회차와 같은 {@link
 * IssueRecurringRunEvent} 를 이어 처리 정보와 함께 발행한다 — ai-agent 는 같은 issue.recurring_run 경로(같은 AI·정기 회차와
 * 같은 도구 신원·recurring 프로필)로 돌리고, 결과는 같은 내부 보고로 이어 처리 id 에 돌려준다({@link
 * IssueRecurrenceService#reportRun}).
 *
 * <p>{@link IssueRecurrenceService} 와 나눈 까닭: 그 서비스는 결과 글을 남기려 chat 의 IssueChatPoster 구현에 의존하고, 그
 * 구현은 ChatMessageService 에 의존한다. ChatMessageService 가 이 포트를 부르므로 같은 빈에 두면 빈 순환이 생긴다 — 이 빈은 chat 쪽
 * 빈에 의존하지 않는다.
 *
 * <p>WP-1313: 「지금 실행」(테스트 실행)이 남긴 테스트 질문은 누른 사람이 답하고, 이어 처리도 테스트(issue.recurring_test_run)로 보낸다 — 그
 * 질문이 멈춘 되돌릴 수 없는 쓰기만 허락된 쓰기로 실어, ai-agent 가 그 쓰기만 실행하고 다른 되돌릴 수 없는 쓰기는 또 멈추게 한다. 테스트 이어 처리는 AI 작업
 * 기록을 바꾸지 않는다(테스트 실행처럼).
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class IssueRecurrenceFollowUpService implements RecurringQuestionAnswers {

  /**
   * 질문을 답으로 받는 기한 — 지나면 소유자가 이슈 챗에 글을 남겨도 이어 처리하지 않는다(답할 때 판정하며 그때 비운다). 주 1회 반복이 다음 회차 전까지 답을 받을 수
   * 있는 길이다.
   */
  static final Duration QUESTION_TTL = Duration.ofDays(7);

  /**
   * 남은 질문이 아직 답 기한({@link #QUESTION_TTL}) 안인지 — 답 판정과 「지금 실행」 거절 판정(IssueRecurrenceService)이 같은 기준을
   * 쓴다.
   */
  static boolean questionWithinTtl(IssueRecurrenceRow row, Instant now) {
    return row.pendingQuestionAskedAt() != null
        && !row.pendingQuestionAskedAt().isBefore(now.minus(QUESTION_TTL));
  }

  /**
   * 답이 이어 처리를 시작해야 하는데 같은 반복에 결과를 기다리는 실행(정기 회차·테스트 실행·다른 이어 처리)이 있을 때 답 글을 거절하는 문구(409, WP-1313).
   * 이어 처리를 겹쳐 돌리지 않는다 — 질문은 그대로 남아, 결과가 채팅에 남은 뒤 다시 답하면 이어 처리한다.
   */
  static final String RUN_IN_FLIGHT = "이미 실행 중입니다 — 결과가 채팅에 남은 뒤 다시 답하세요";

  private final IssueRecurrenceRepository repository;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final AgentWorkService agentWorkService;
  private final UserRepository userRepository;
  // 도구 신원 — 정기 회차와 같은 규칙(WP-1314).
  private final IssueRecurrenceRunIdentity runIdentity;
  private final ApplicationEventPublisher publisher;
  // 답 판정·이어 처리 발행을 세이브포인트로 감싸는 데 쓴다(실패해도 사람의 글 저장은 되돌리지 않게).
  private final PlatformTransactionManager txManager;
  // 테스트 질문이 멈춘 쓰기 목록(JSON, WP-1313)을 읽는다.
  private final ObjectMapper objectMapper;

  /**
   * 사람이 이슈 챗에 남긴 글이 반복 회차가 남긴 질문의 답이면 같은 AI 의 이어 처리를 보낸다. 답으로 보는 조건: 그 질문에 답할 사람(정기 회차 질문은 반복을 저장한
   * 사람 created_by, 테스트 질문은 「지금 실행」을 누른 사람 — WP-1313. 이어 처리가 정기 회차와 같은 도구 신원(개인 비서면 주인 대행,
   * WP-1314)으로 돌아, 아무 구성원의 글이 그 권한의 쓰기를 일으키면 안 된다. 누른 사람은 실행 권한을 확인받은 사람이다)의 글이고, 답을 기다리는 질문 뒤의
   * 글이고, 질문이 {@link #QUESTION_TTL} 안이고, 이슈가 열려 있고 AI 가 담당이다.
   *
   * <p>chat 의 글 저장 트랜잭션 안에서 세이브포인트(NESTED)로 돈다 — 여기서 실패해도 그 부분만 되돌리고 사람의 글은 저장한다. 다만 답인데 같은 반복에 결과를
   * 기다리는 실행이 있으면 {@link IssueRecurrenceConflictException}(409)을 던져 글 저장까지 되돌린다(WP-1313) — 질문은 그대로
   * 남아 실행이 끝난 뒤 다시 답할 수 있다. 행을 잠그고 질문을 비우므로 빠르게 두 번 답해도 이어 처리는 하나다(두 번째 글은 질문이 비어 답이 아니다).
   */
  @Override
  public OptionalLong answer(long issueId, long messageId, long actorId, String body) {
    if (body == null || body.isBlank()) return OptionalLong.empty();
    // 대부분의 챗 글은 반복도 질문도 없는 이슈에 달린다 — 잠그기 전에 답일 수 있는지만 좁게 물어 보통 글의 비용을 존재 확인 하나로 둔다.
    if (!repository.mayAnswerQuestion(issueId, messageId, actorId)) return OptionalLong.empty();
    TransactionTemplate nested = new TransactionTemplate(txManager);
    nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    try {
      Long agentId =
          nested.execute(
              status -> startFollowUp(issueId, messageId, actorId, body.strip(), Instant.now()));
      return agentId == null ? OptionalLong.empty() : OptionalLong.of(agentId);
    } catch (IssueRecurrenceConflictException e) {
      // 실행이 도는 중이라 답을 받을 수 없다 — 글 저장까지 되돌려 409 로 알린다(질문은 남아 다시 답할 수 있다, WP-1313).
      throw e;
    } catch (RuntimeException e) {
      log.warn("[recurrence] 질문 답의 이어 처리 실패 — 글은 그대로 저장한다. issueId={}", issueId, e);
      return OptionalLong.empty();
    }
  }

  /** 잠근 행으로 답 조건을 다시 확인하고, 맞으면 질문을 소비하고 이어 처리 이벤트를 발행한다. 깨운 AI id, 답이 아니면 null. */
  private Long startFollowUp(
      long issueId, long messageId, long actorId, String answer, Instant now) {
    IssueRecurrenceRow row = repository.findForUpdate(issueId).orElse(null);
    if (row == null || row.deleted() || row.pendingQuestionMessageId() == null) return null;
    if (row.questionAnswerer() != actorId || messageId <= row.pendingQuestionMessageId()) {
      return null;
    }
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    if (!questionWithinTtl(row, now)) {
      // 기한이 지난 질문 — 답으로 보지 않고 이참에 비운다(정기 반복의 만료 질문을 따로 쓸어 내는 일은 두지 않는다). 끝난 「한 번만」 예약(WP-1315)의
      // 질문이면 답을 기다리던 작업 기록도 끝낸다 — 스케줄러의 기한 정리(IssueRecurrenceService#runDue)와 같은 결과.
      repository.clearPendingQuestion(issueId);
      if (issue != null && !row.testQuestion() && IssueRecurrenceService.finishedOnce(row)) {
        agentWorkService.endIfLive(
            issue,
            row.agentUserId(),
            AgentWorkState.COMPLETED,
            IssueRecurrenceService.endPatch(IssueRecurrenceService.NOTE_ONCE_UNANSWERED));
      }
      return null;
    }
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    long agentId = row.agentUserId();
    // 이슈가 열려 있고 AI 가 담당일 때만 — 작업 기록과 같은 판정(AgentWorkService#isLiveFor)을 쓴다.
    if (issue == null || project == null || !agentWorkService.isLiveFor(issue, agentId))
      return null;
    // WP-1313: 같은 반복에 결과를 기다리는 실행(정기 회차·테스트 실행·다른 이어 처리)이 있으면 이어 처리를 겹쳐 보내지 않는다 — 질문을 소비하지
    // 않고 답 글을 409 로 거절해, 결과가 남은 뒤 다시 답하게 한다(앞선 이어 처리 id 를 덮어써 그 결과를 버리는 일도 없다).
    if (row.anyRunInFlight()) throw new IssueRecurrenceConflictException(RUN_IN_FLIGHT);

    // 도구 신원은 정기 회차와 같은 규칙으로 정한다(WP-1314). 대행할 주인이 프로젝트를 더는 볼 수 없으면 정기 회차가 거절하는 실행이라 이어 처리도
    // 하지 않는다 — 질문만 비우고, 일정을 거두는 일은 다음 정기 회차(IssueRecurrenceService#runOne)에 맡긴다.
    OptionalLong runAs = runIdentity.resolve(agentId, project);
    if (runAs.isEmpty()) {
      log.info("[recurrence] 이어 처리 안 함 — 대행 주인이 프로젝트를 볼 수 없음. issueId={}", issueId);
      repository.clearPendingQuestion(issueId);
      return null;
    }

    // 이어 처리 id 는 답 글 id 로 만든다 — 정기 회차 id 와 모양이 달라 결과 보고가 어느 쪽인지 가른다. 도는 실행이 있으면 위에서 거절했다.
    String runId = issueId + "-f" + messageId;
    // WP-1313: 테스트 질문의 답이면 테스트 이어 처리 — 답한 사람을 남겨 결과에 테스트 표시를 붙이고, 또 물으면 같은 사람이 답하게 한다.
    boolean test = row.testQuestion();
    var permitted =
        test ? IssueRecurrenceService.readPaused(objectMapper, row.pendingQuestionActions()) : null;
    // 잠근 행으로 위에서 확인했지만, 도는 이어 처리 id 는 쿼리도 덮어쓰지 않는다 — 기록하지 못했으면 같은 거절로.
    if (!repository.markFollowUpDispatched(issueId, runId, now, test ? actorId : null)) {
      throw new IssueRecurrenceConflictException(RUN_IN_FLIGHT);
    }
    // 작업은 「작업 중」으로 — 켜진 반복일 때만(멈춘 반복의 「막힘」 등은 그대로 둔다). 결과 보고가 「다음 회차 대기」로 되돌린다. 끝난 「한 번만」
    // 예약(WP-1315)은 꺼져 있어도 답을 기다리던 작업이라 「작업 중」으로 두고, 결과 보고가 작업을 끝낸다. 테스트 이어 처리는 정기 회차의 작업 기록과
    // 따로라 바꾸지 않는다.
    if ((row.enabled() || IssueRecurrenceService.finishedOnce(row)) && !test) {
      agentWorkService.startOrUpdateTracked(
          issueId, agentId, IssueRecurrenceService.TOOL, IssueRecurrenceService.followUpPatch());
    }
    // 정기 회차와 같은 이벤트·같은 실행 경로 — 같은 AI(LLM 자격), 정기 회차와 같은 도구 신원, recurring 프로필. 답한 사람은 이벤트 actor(반복을
    // 저장한 사람)다 — 그 사람만 답할 수 있다. 회차 번호는 싣지 않는다(이어 처리 지시문이 쓰지 않는다).
    publisher.publishEvent(
        IssueRecurrenceService.runEvent(
            userRepository,
            row,
            issue,
            project,
            runAs.getAsLong(),
            assigneeRepository.findByIssue(issue.id()),
            runId,
            now,
            null,
            now,
            new IssueRecurringRunEvent.FollowUp(row.pendingQuestionText(), answer, permitted),
            // 답한 사람이 actor — 정기 질문은 저장한 사람(=답한 사람), 테스트 질문은 누른 사람(=답한 사람).
            actorId,
            test));
    log.info("[recurrence] 질문의 답으로 이어 처리를 보낸다 issueId={} runId={}", issueId, runId);
    return agentId;
  }
}

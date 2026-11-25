package com.workplace.issue.workflow.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.util.MentionParser;
import com.workplace.global.util.PersonNames;
import com.workplace.issue.outbound.WorkflowAnswer;
import com.workplace.issue.outbound.WorkflowQuestionAnswers;
import com.workplace.issue.workflow.domain.NodeTypes;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.dto.IssueWorkflowView;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.user.dto.UserKind;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 챗 사람 글을 워크플로우 질문 대기의 답으로 받아 실행을 {@code answered} 로 옮긴다(WP-2093, {@link
 * WorkflowQuestionAnswers} 구현).
 *
 * <p>질문 이동(outcome ask)은 질문을 이슈 챗의 「답변 필요 질문」으로 남기고 실행은 질문 대기 노드(returnTo human_task)에서 기다린다. 사람이 그
 * 이슈 챗에 글을 쓰면 chat 모듈이 글을 저장한 트랜잭션에서 이 빈을 부르고, 답이면 {@link WorkflowRunService#answerFromChat} 이 질문한
 * AI 노드로 되돌린다 — 진입이 그 AI 를 깨운다.
 *
 * <p>실행 서비스를 늦게 꺼내는 까닭: 실행 서비스는 질문 글을 올리려 chat 의 IssueChatPoster 구현에 의존하고, 그 구현은 ChatMessageService
 * 에, ChatMessageService 는 이 포트에 의존한다 — 생성자 주입이면 빈 순환이다.
 */
@Slf4j
@Service
public class WorkflowChatAnswerService implements WorkflowQuestionAnswers {

  /** 이동 진입점 — 빈 순환(위 클래스 주석)을 피하려 부를 때 꺼낸다. */
  private final ObjectProvider<WorkflowRunService> runService;

  // 잠그기 전 좁은 확인 — 대부분의 챗 글은 질문 대기가 아닌 이슈에 달린다.
  private final WorkflowRunRepository runRepository;

  // 판정·이동을 세이브포인트(NESTED)로 감싸는 데 쓴다(실패해도 사람의 글 저장은 되돌리지 않게) — 한 번만 만들어 매 호출에 쓴다.
  private final TransactionTemplate nested;

  public WorkflowChatAnswerService(
      ObjectProvider<WorkflowRunService> runService,
      WorkflowRunRepository runRepository,
      PlatformTransactionManager txManager) {
    this.runService = runService;
    this.runRepository = runRepository;
    this.nested = new TransactionTemplate(txManager);
    this.nested.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * 사람 글이 질문 대기의 답이면 answered 이동을 하고 그 결과(소비 여부·깨운 AI)를 돌려준다. 보이는 글자가 없는 글(첨부만)과 멘션 토큰을 빼면 보이는 글자가
   * 없는 글(「@담당자」·「@a, @b」만 — 사람을 부르기만 한 글. 토큰 사이 쉼표도 함께 뺀다)은 답이 아니다.
   *
   * <p>chat 의 글 저장 트랜잭션 안에서 세이브포인트(NESTED)로 돈다 — 잠그지 않은 사전 확인부터 판정·이동까지 모두 그 안이라, 조회 예외·판정 위반·이동
   * 실패는 그 부분만 되돌리고 log.warn 한 뒤 「답 아님」이다. 사람의 글은 그대로 저장된다(설계 §2 실패 격리).
   */
  @Override
  public WorkflowAnswer answer(long issueId, long messageId, long actorId, String body) {
    // 멘션 토큰(<@id>)을 그 사이 구분자(공백류·쉼표)와 함께 지운 뒤 보이는 글자가 있어야 답으로 본다 — 부르기만 한 글(「@a, @b」 포함)이
    // 질문 대기를 answered 로 넘기지 않게.
    if (!PersonNames.hasVisibleChar(MentionParser.removeTokens(body))) {
      return WorkflowAnswer.NOT_ANSWER;
    }
    try {
      WorkflowAnswer result =
          nested.execute(status -> moveIfAsking(issueId, messageId, actorId, body));
      return result == null ? WorkflowAnswer.NOT_ANSWER : result;
    } catch (RuntimeException e) {
      log.warn(
          "[workflow] 챗 답의 answered 이동 실패 — 글은 그대로 저장한다. issueId={} messageId={}",
          issueId,
          messageId,
          e);
      return WorkflowAnswer.NOT_ANSWER;
    }
  }

  /** 세이브포인트 안에서 도는 본체 — 좁은 사전 확인 뒤 실행 서비스로 이동한다. */
  private WorkflowAnswer moveIfAsking(long issueId, long messageId, long actorId, String body) {
    // 잠그지 않은 좁은 확인 — 기다리는 활성 실행이 없으면 이슈 행 잠금 없이 끝낸다. 잠근 뒤 실행 서비스가 다시 확인한다.
    if (runRepository
        .findActiveByIssue(issueId)
        .filter(r -> RunState.WAITING.equals(r.status()))
        .isEmpty()) {
      return WorkflowAnswer.NOT_ANSWER;
    }
    Optional<IssueWorkflowView> moved =
        runService.getObject().answerFromChat(issueId, messageId, actorId, body);
    return moved.isEmpty()
        ? WorkflowAnswer.NOT_ANSWER
        : WorkflowAnswer.consumed(wokenAgents(moved.get()));
  }

  /**
   * 이동으로 깨운 AI — 돌아간 노드가 agent_task 면 그 노드의 AI 담당 전부(노드 담당 순서). 진입 깨우기(WorkflowNodeWakeEvent)가 깨우는
   * 노드 AI 와 같은 사람들이라, chat 이 이들을 같은 글의 멘션·암묵 응답·재개 알림에서 빼 또 깨우지 않게 한다. AI 노드가 아니면 빈 목록이다.
   */
  private static List<Long> wokenAgents(IssueWorkflowView moved) {
    IssueWorkflowView.NodeView node = moved.currentNode();
    if (node == null || !NodeTypes.AGENT_TASK.equals(node.type())) {
      return List.of();
    }
    return node.assignees().stream()
        .filter(u -> UserKind.isAgent(u.kind()))
        .map(UserSummary::id)
        .toList();
  }
}

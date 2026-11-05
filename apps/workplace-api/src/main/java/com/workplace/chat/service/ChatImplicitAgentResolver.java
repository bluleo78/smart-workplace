package com.workplace.chat.service;

import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.issue.outbound.ImplicitChatAgents;
import com.workplace.issue.outbound.ImplicitChatAgents.ImplicitChatAgent;
import com.workplace.issue.outbound.ImplicitChatAgents.Mode;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈챗에서 멘션 없이도 답할 담당 AI 를 chat 쪽 데이터(스레드 멤버)까지 보고 정한다(WP-1377).
 *
 * <p>issue 모듈의 {@link ImplicitChatAgents} 가 일정·담당자·개인/팀을 판정하고, 여기서는 팀 이슈라도 스레드 멤버가 글쓴이와 담당 AI 뿐이면
 * {@link Mode#ALWAYS} 로 올린다 — 둘만의 대화면 사람끼리 대화에 AI 가 끼어들 일이 없다. 글 저장(ChatMessageService)과 스레드
 * 응답(ChatThreadService)이 같은 판정을 쓰게 한 곳에 둔다. 글 저장 쪽의 「직전 글이 그 AI 의 글인가」({@link Mode#AFTER_AI_REPLY})
 * 판정도 여기서 끝내 「이 글에 AI 가 답하나」 판정이 한 곳에 모이게 한다.
 */
@Slf4j
@Component
class ChatImplicitAgentResolver {

  private final ImplicitChatAgents implicitAgents;
  private final ChatThreadMemberRepository memberRepo;
  private final ChatMessageRepository messageRepo;
  // WP-1377: 판정을 세이브포인트(NESTED)로 감싸는 데 쓴다 — 실패해도 글 저장·스레드 조회를 되돌리지 않게. 설정이 늘 같아 한 번만 만든다.
  private final TransactionTemplate nestedTx;

  ChatImplicitAgentResolver(
      ImplicitChatAgents implicitAgents,
      ChatThreadMemberRepository memberRepo,
      ChatMessageRepository messageRepo,
      PlatformTransactionManager txManager) {
    this.implicitAgents = implicitAgents;
    this.memberRepo = memberRepo;
    this.messageRepo = messageRepo;
    this.nestedTx = new TransactionTemplate(txManager);
    this.nestedTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
  }

  /**
   * 이 스레드에서 actorId 의 멘션 없는 글에 답할 담당 AI 와 방식. 스레드 멤버가 아직 아닌 사람(보낼 때 자동 참여, WP-213)도 멤버로 쳐서 판정한다 —
   * 화면 판정과 보낸 뒤 판정이 같게.
   */
  Optional<ImplicitChatAgent> resolve(long issueId, long threadId, long actorId) {
    Optional<ImplicitChatAgent> found = implicitAgents.resolve(issueId, actorId);
    if (found.isEmpty() || found.get().mode() == Mode.ALWAYS) return found;
    ImplicitChatAgent agent = found.get();
    return Optional.of(
        onlyPair(threadId, actorId, agent.agentId()) ? agent.withMode(Mode.ALWAYS) : agent);
  }

  /**
   * 방금 저장한 멘션 없는 글(messageId)에 답할 담당 AI id(WP-1377). 늘 답하는 경우(개인 작업·둘만의 스레드)거나, 팀 이슈에서 이 글 바로 앞
   * 글(삭제된 글 제외)이 그 AI 의 글이면 답한다. 답할 AI 가 없으면 null — 스레드 멤버 추가는 호출자(글 저장)가 한다.
   */
  Long resolveForPost(long issueId, long threadId, long messageId, long actorId) {
    ImplicitChatAgent found = resolve(issueId, threadId, actorId).orElse(null);
    if (found == null) return null;
    if (found.mode() == Mode.AFTER_AI_REPLY) {
      Long previousAuthor = messageRepo.findPreviousAuthorId(threadId, messageId).orElse(null);
      if (previousAuthor == null || previousAuthor != found.agentId()) return null;
    }
    return found.agentId();
  }

  /**
   * 스레드 멤버가 글쓴이와 담당 AI 뿐인지. 멤버가 하나도 없으면 둘만의 대화가 아니다(WP-1377) — 빈 목록의 allMatch 는 참이라 그대로 두면 아무도 없는
   * 스레드가 ALWAYS 로 올라간다.
   */
  private boolean onlyPair(long threadId, long actorId, long agentId) {
    List<Long> members = memberRepo.findMemberIds(threadId);
    return !members.isEmpty() && members.stream().allMatch(id -> id == actorId || id == agentId);
  }

  /**
   * 멘션 없이 답할 AI 판정을 세이브포인트(NESTED)로 감싸 돌린다(WP-1377). 판정이 실패해도 사람의 글 저장·스레드 조회는 그대로 두고 「답할 AI
   * 없음」(null)으로 본다 — RecurringQuestionAnswers#answer 와 같은 격리. 세이브포인트로 되돌려야 SQL 오류가 바깥 Postgres
   * 트랜잭션을 망가뜨리지(aborted) 않고, 참여한 @Transactional 빈이 건 rollback-only 표시도 풀린다.
   */
  <T> T isolated(long issueId, Supplier<T> work) {
    try {
      return nestedTx.execute(status -> work.get());
    } catch (RuntimeException e) {
      log.warn("[chat] 멘션 없이 답할 담당 AI 판정 실패 — 답할 AI 없음으로 본다. issueId={}", issueId, e);
      return null;
    }
  }
}

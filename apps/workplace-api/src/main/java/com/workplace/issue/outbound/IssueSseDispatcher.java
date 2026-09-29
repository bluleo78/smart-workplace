package com.workplace.issue.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 이슈 도메인 이벤트를 브라우저 SSE(/api/v1/events)로 이슈 참여자(watcher)에게 fan-out 한다 (#579).
 *
 * <p>{@link IssueEventDispatcher}(AGENT 담당자가 있을 때만 ai-agent 서버로 발사)와 완전히 분리된 별도 리스너 — 관심사 분리. 이
 * 디스패처는 AGENT 유무와 무관하게 항상 동작하며, 대상은 {@code issue_watcher}(담당자·구경자·코멘트 작성자는 이슈 서비스에서 이미 자동 watcher 로
 * enroll 됨 — {@code WatcherAutoEnroller})다. self-echo 도 허용(발신자 포함) — 멀티기기 동기화 + 프론트가 자기 캐시는 이미
 * 낙관적으로 갱신했으므로 재조회(invalidate)만 유발해도 무해하다.
 *
 * <p>{@code @Transactional(REQUIRES_NEW)} 필수 — AFTER_COMMIT 리스너는 원래 트랜잭션이 이미 커밋된 후 동기 실행되어 활성
 * 트랜잭션(및 트랜잭션-로컬 GUC)이 없다. REQUIRES_NEW 로 새 트랜잭션을 열면 TenantAwareTransactionManager.doBegin 이 요청
 * 스레드에 남아있는 TenantContext 를 읽어 GUC 를 재주입하므로 findUserIdsByIssue 가 RLS fail-closed 로 빈 목록을 반환하지 않는다
 * (MessageSseDispatcher/ChatSseDispatcher 와 동일 패턴).
 */
@Component
@RequiredArgsConstructor
public class IssueSseDispatcher {

  private final SseRegistry registry;
  private final IssueWatcherRepository watcherRepository;

  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCommented(IssueCommentedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueNumber", e.issueNumber());
    p.put("issueId", e.issueId());
    p.put("issueKey", e.issueKey());
    p.put("commentId", e.commentId());
    p.put("actorId", e.actor() == null ? null : e.actor().id());
    registry.fanOut(watcherRepository.findUserIdsByIssue(e.issueId()), "issue.commented", p);
  }

  /** 코멘트 수정 (#717) — watcher 전원에게 issue.comment_updated 로 fan-out. */
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCommentUpdated(IssueCommentUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueNumber", e.issueNumber());
    p.put("issueId", e.issueId());
    p.put("issueKey", e.issueKey());
    p.put("commentId", e.commentId());
    p.put("actorId", e.actor() == null ? null : e.actor().id());
    registry.fanOut(watcherRepository.findUserIdsByIssue(e.issueId()), "issue.comment_updated", p);
  }

  /** 코멘트 삭제 (#717) — watcher 전원에게 issue.comment_deleted 로 fan-out. */
  // AFTER_COMMIT 후 트랜잭션-로컬 GUC 소멸 → REQUIRES_NEW 로 새 트랜잭션 열어 GUC 재주입.
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void onCommentDeleted(IssueCommentDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueNumber", e.issueNumber());
    p.put("issueId", e.issueId());
    p.put("issueKey", e.issueKey());
    p.put("commentId", e.commentId());
    p.put("actorId", e.actor() == null ? null : e.actor().id());
    registry.fanOut(watcherRepository.findUserIdsByIssue(e.issueId()), "issue.comment_deleted", p);
  }
}

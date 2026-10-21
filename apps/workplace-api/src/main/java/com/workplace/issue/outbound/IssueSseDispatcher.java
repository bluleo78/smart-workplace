package com.workplace.issue.outbound;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.util.AfterCommit;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
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
 * <p>수신자는 커밋 직전(BEFORE_COMMIT)에 요청 트랜잭션 안에서 조회하고(커넥션·GUC 를 그대로 써 RLS 가 맞게 걸린다), 전송만 {@link
 * AfterCommit} 로 커밋 뒤로 미뤄 커밋된 변경만 알린다(롤백되면 보내지 않는다). 예전처럼 커밋 뒤 REQUIRES_NEW 로 다시 조회하면 요청 커넥션을 쥔 채 두
 * 번째 커넥션을 빌려, 동시 쓰기가 풀 크기를 넘으면 모두가 서로를 기다리며 멈췄다(WP-751).
 */
@Component
@RequiredArgsConstructor
public class IssueSseDispatcher {

  private final SseRegistry registry;
  private final IssueWatcherRepository watcherRepository;

  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onCommented(IssueCommentedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueNumber", e.issueNumber());
    p.put("issueId", e.issueId());
    p.put("issueKey", e.issueKey());
    p.put("commentId", e.commentId());
    p.put("actorId", e.actor() == null ? null : e.actor().id());
    Collection<Long> to = watcherRepository.findUserIdsByIssue(e.issueId());
    AfterCommit.run(() -> registry.fanOut(to, "issue.commented", p));
  }

  /** 코멘트 수정 (#717) — watcher 전원에게 issue.comment_updated 로 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onCommentUpdated(IssueCommentUpdatedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueNumber", e.issueNumber());
    p.put("issueId", e.issueId());
    p.put("issueKey", e.issueKey());
    p.put("commentId", e.commentId());
    p.put("actorId", e.actor() == null ? null : e.actor().id());
    Collection<Long> to = watcherRepository.findUserIdsByIssue(e.issueId());
    AfterCommit.run(() -> registry.fanOut(to, "issue.comment_updated", p));
  }

  /** 코멘트 삭제 (#717) — watcher 전원에게 issue.comment_deleted 로 fan-out. */
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onCommentDeleted(IssueCommentDeletedEvent e) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("projectKey", e.projectKey());
    p.put("issueNumber", e.issueNumber());
    p.put("issueId", e.issueId());
    p.put("issueKey", e.issueKey());
    p.put("commentId", e.commentId());
    p.put("actorId", e.actor() == null ? null : e.actor().id());
    Collection<Long> to = watcherRepository.findUserIdsByIssue(e.issueId());
    AfterCommit.run(() -> registry.fanOut(to, "issue.comment_deleted", p));
  }
}

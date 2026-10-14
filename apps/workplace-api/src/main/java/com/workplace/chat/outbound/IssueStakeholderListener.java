package com.workplace.chat.outbound;

import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.chat.service.ChatThreadContextResolver;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * issue/watcher 모듈의 도메인 이벤트를 받아 chat thread 멤버를 자동 추가 (add-only).
 *
 * <p>chat 모듈은 issue/watcher 모듈 서비스/리포지토리를 직접 import 하지 않는다는 원칙이지만, 도메인 이벤트 record 자체는 "public 계약"
 * 으로 간주해 import 허용.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IssueStakeholderListener {

  private final ChatThreadRepository threadRepo;
  private final ChatThreadMemberRepository memberRepo;
  private final ChatThreadContextResolver contextResolver;
  private final ChatThreadChangeNotifier notifier;

  /**
   * assignee 변경 이벤트 — thread 가 이미 있으면 added 멤버 자동 추가하고, 추가·제거 모두 chat-thread 변경을 알린다.
   *
   * <p>알림은 열려 있는 챗 화면의 작성창 안내(externalAgent)를 다른 사람이 담당자를 바꿔도 갱신하기 위함이다. 이벤트는 담당자 변경 쓰기 트랜잭션 안에서 동기
   * 발행되므로 notifier 의 AFTER_COMMIT 전제를 만족한다. thread 가 없으면 아무것도 하지 않는다.
   */
  @EventListener
  @Transactional
  public void onIssueAssigned(IssueAssignedEvent e) {
    Optional<Long> found = threadRepo.findIdByIssueId(e.issueId());
    if (found.isEmpty()) return;
    long threadId = found.get();
    memberRepo.insertIgnoreConflict(threadId, idsOf(e.added()));
    if (e.added().isEmpty() && e.removed().isEmpty()) return;
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null) return;
    Long actorId = e.actor() == null ? null : e.actor().id();
    notifier.membersChanged(
        ctx.projectId(), ctx.projectKey(), ctx.issueNumber(), threadId, actorId, Set.of());
  }

  /** watcher 추가 이벤트 — thread 가 이미 있으면 자동 추가. */
  @EventListener
  @Transactional
  public void onWatcherAdded(WatcherAddedEvent e) {
    threadRepo
        .findIdByIssueId(e.issueId())
        .ifPresent(threadId -> memberRepo.insertIgnoreConflict(threadId, List.of(e.userId())));
  }

  private List<Long> idsOf(List<UserSummary> users) {
    return users.stream().map(UserSummary::id).toList();
  }
}

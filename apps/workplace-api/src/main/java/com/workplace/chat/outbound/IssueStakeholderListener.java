package com.workplace.chat.outbound;

import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.util.List;
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

  /** assignee 추가 이벤트 — thread 가 이미 있으면 added 멤버 자동 추가. */
  @EventListener
  @Transactional
  public void onIssueAssigned(IssueAssignedEvent e) {
    threadRepo
        .findIdByIssueId(e.issueId())
        .ifPresent(threadId -> memberRepo.insertIgnoreConflict(threadId, idsOf(e.added())));
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

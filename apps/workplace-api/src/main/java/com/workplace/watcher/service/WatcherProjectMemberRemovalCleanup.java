package com.workplace.watcher.service;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.project.outbound.ProjectChangeNotifier;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.watcher.repository.IssueWatcherRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 프로젝트에서 빠져 더는 그 프로젝트를 볼 수 없게 된 사람을 그 프로젝트 이슈의 워처에서 뺀다(WP-476). 워처 row 가 남으면 제거 뒤 생긴 댓글·상태 변경 알림과
 * 활동 피드·실시간 이벤트가 계속 가고, 바뀐 이슈 제목까지 보인다. 멤버 제거가 쓰기 트랜잭션 안에서 내는 ResourceChangedEvent
 * (project-member/deleted)를 같은 트랜잭션에서 받는다(@EventListener — 롤백되면 함께 롤백). 멤버 row 가 이미 지워진 뒤라, 그래도 볼 수
 * 있는 사람(OPEN 프로젝트·ADMIN)은 조회 규칙({@link ProjectAccessGuard#canRead})으로 가려 워처를 남긴다.
 */
@Component
@RequiredArgsConstructor
public class WatcherProjectMemberRemovalCleanup {

  private final IssueWatcherRepository watcherRepository;
  private final ProjectAccessGuard accessGuard;

  /** project-member/deleted 만 거른다. scopeId 가 프로젝트 id, ids 가 제거된 사용자 id 다. */
  @EventListener
  public void onResourceChanged(ResourceChangedEvent e) {
    if (!ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER.equals(e.resource())
        || !ResourceChangedEvent.OP_DELETED.equals(e.op())) {
      return;
    }
    for (long userId : e.ids()) {
      if (!accessGuard.canRead(e.scopeId(), userId)) {
        watcherRepository.removeFromProject(e.scopeId(), userId);
      }
    }
  }
}

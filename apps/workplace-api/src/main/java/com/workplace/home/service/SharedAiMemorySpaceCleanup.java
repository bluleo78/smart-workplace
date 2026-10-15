package com.workplace.home.service;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.outbound.ProjectChangeNotifier;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 공간이 사라지면 그 공간의 공용 메모리·기록·지운 기록을 함께 지운다(WP-386 스펙 4·11절). 프로젝트 soft delete 가 쓰기 트랜잭션 안에서 내는
 * ResourceChangedEvent(project/deleted)를 같은 트랜잭션에서 받는다(@EventListener — 발행 즉시, 롤백되면 함께 롤백). 노트
 * 스페이스에는 아직 삭제 경로가 없다 — 생기면 같은 deleteSpace 를 부른다.
 */
@Component
@RequiredArgsConstructor
public class SharedAiMemorySpaceCleanup {

  private final SharedAiMemoryRepository repo;

  /** project/deleted 만 거른다 — 그 밖의 리소스 이벤트는 무시. scopeId 가 프로젝트 id 다. */
  @EventListener
  public void onResourceChanged(ResourceChangedEvent e) {
    if (ProjectChangeNotifier.RESOURCE_PROJECT.equals(e.resource())
        && ResourceChangedEvent.OP_DELETED.equals(e.op())) {
      SpaceKey k = SpaceKey.of("PROJECT", e.scopeId());
      // 공간 잠금을 먼저 잡는다 — 같은 공간의 지움 되돌리기·배경 저장이 삭제 뒤에 행을 되살려 남기지 않게 줄 세운다.
      repo.lockSpace(k);
      repo.deleteSpace(k);
    }
  }
}

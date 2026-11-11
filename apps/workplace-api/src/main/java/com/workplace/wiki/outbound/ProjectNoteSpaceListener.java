package com.workplace.wiki.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.wiki.service.ProjectNoteSpaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 프로젝트 변경을 받아 프로젝트 노트 공간에 반영한다(WP-1480). 프로젝트는 변경마다 {@link ResourceChangedEvent} 를 쓰기 트랜잭션 안에서 내므로
 * 이를 동기 {@code @EventListener} 로 받아 <b>같은 트랜잭션</b>에서 처리한다 — 공간 동기화가 실패하면 프로젝트 변경도 함께 롤백되어 둘이 어긋난 채
 * 커밋되지 않는다(드라이브 채널 공간 ChannelDriveListener 와 같은 방식). 테넌트는 발행한 쪽이 세운 컨텍스트를 그대로 쓴다(요청 스레드, 또는 프로젝트 쪽
 * 리스너의 {@code TenantContext.runAs}).
 *
 * <p>wiki 는 project 패키지를 import 하지 않으므로 리소스 이름을 문자열로 둔다 — {@code
 * ProjectChangeNotifier.RESOURCE_PROJECT·RESOURCE_PROJECT_MEMBER·RESOURCE_PROJECT_MEMBER_GROUP} 과
 * 같아야 한다(바뀌면 이 리스너가 조용히 멈춘다 — ProjectNoteSpaceTest 가 잡는다). 이벤트의 scopeId 가 프로젝트 id 다.
 */
@Component
@RequiredArgsConstructor
public class ProjectNoteSpaceListener {
  static final String RESOURCE_PROJECT = "project";
  static final String RESOURCE_PROJECT_MEMBER = "project-member";
  static final String RESOURCE_PROJECT_MEMBER_GROUP = "project-member-group";

  /** project/updated 의 부가 값 — 이름이 바뀌었는지(ProjectService.update 가 싣는 키와 같아야 한다). */
  static final String ATTR_NAME_CHANGED = "nameChanged";

  private final ProjectNoteSpaceService service;

  /**
   * 프로젝트·프로젝트 멤버·멤버 부서 변경만 본다 — 이 이벤트는 이슈·라벨·노트 공간 자신의 변경에도 나므로 리소스 이름으로 먼저 거른다(공간 맞추기가 내는
   * wiki-space 변경이 여기로 되돌아와도 바로 끝난다).
   */
  @EventListener
  public void onResourceChanged(ResourceChangedEvent e) {
    switch (e.resource()) {
      case RESOURCE_PROJECT -> onProject(e);
      case RESOURCE_PROJECT_MEMBER, RESOURCE_PROJECT_MEMBER_GROUP ->
          service.reconcile(e.scopeId(), e.actorId());
      default -> {
        // 다른 리소스는 관심 없다.
      }
    }
  }

  /** 프로젝트 생성 → 공간 만들기, 이름 변경 → 이름 따라가기, 삭제(soft) → 연결 끊기. */
  private void onProject(ResourceChangedEvent e) {
    switch (e.op()) {
      case ResourceChangedEvent.OP_CREATED -> service.ensureSpace(e.scopeId(), e.actorId());
      case ResourceChangedEvent.OP_UPDATED -> {
        // 이름이 실제로 바뀐 수정만 공간 이름에 반영한다 — 설명·저장소만 고친 수정이 사용자가 고른(연결한) 공간 이름을 덮지 않게.
        // nameChanged 는 ProjectService.update 가 싣는다(없으면 이름 변경 아님으로 본다).
        if (Boolean.TRUE.equals(e.attrs().get(ATTR_NAME_CHANGED))) {
          service.onProjectRenamed(e.scopeId(), e.actorId());
        }
      }
      case ResourceChangedEvent.OP_DELETED -> service.onProjectDeleted(e.scopeId(), e.actorId());
      default -> {
        // 알 수 없는 op 는 무시한다.
      }
    }
  }
}

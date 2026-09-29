package com.workplace.project.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import com.workplace.project.dto.ProjectRow;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 프로젝트와 프로젝트 설정(멤버·라벨·마일스톤·사이클·필드·유형·저장된 뷰) 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-60). 서비스가
 * 쓰기 트랜잭션 안에서 한 줄로 호출한다. 수신자는 기본 PROJECT(멤버 전원)이고, 제거된 멤버처럼 커밋 후 명단에서 빠지는 사용자는 extra 로 받는다.
 */
@Component
@RequiredArgsConstructor
public class ProjectChangeNotifier {

  private final ApplicationEventPublisher publisher;

  /**
   * 프로젝트 멤버 전원에게 알린다. resource 는
   * "project"·"label"·"milestone"·"cycle"·"field-def"·"issue-type"·"project-member". 반드시 쓰기 트랜잭션
   * 안에서 호출 — 밖에서 부르면 AFTER_COMMIT 리스너가 발화하지 않는다.
   */
  public void changed(String resource, String op, ProjectRow project, long id, Long actorId) {
    changed(resource, op, project, id, actorId, Set.of());
  }

  /** extra — 커밋 후 멤버 명단에 없을 사용자(방금 제거된 멤버). */
  public void changed(
      String resource,
      String op,
      ProjectRow project,
      long id,
      Long actorId,
      Collection<Long> extra) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            resource,
            op,
            ProjectAudienceResolver.SCOPE,
            project.id(),
            List.of(id),
            Map.of("projectKey", project.key()),
            actorId,
            Set.copyOf(extra)));
  }

  /** 개인(PRIVATE) 저장된 뷰 — 소유자에게만. 공유 뷰는 {@link #changed} 로 프로젝트에 보낸다. */
  public void privateView(String op, ProjectRow project, long viewId, long ownerId) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            "saved-view",
            op,
            UserAudienceResolver.SCOPE,
            ownerId,
            List.of(viewId),
            Map.of("projectKey", project.key()),
            ownerId,
            Set.of()));
  }
}

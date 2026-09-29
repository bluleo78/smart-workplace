package com.workplace.project.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.realtime.UserAudienceResolver;
import com.workplace.project.dto.ProjectRow;
import java.util.Collection;
import java.util.List;
import java.util.Map;
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

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_PROJECT = "project";

  public static final String RESOURCE_PROJECT_MEMBER = "project-member";
  public static final String RESOURCE_LABEL = "label";
  public static final String RESOURCE_MILESTONE = "milestone";
  public static final String RESOURCE_CYCLE = "cycle";
  public static final String RESOURCE_FIELD_DEF = "field-def";
  public static final String RESOURCE_ISSUE_TYPE = "issue-type";
  public static final String RESOURCE_SAVED_VIEW = "saved-view";

  private final ApplicationEventPublisher publisher;

  /**
   * 프로젝트 멤버 전원에게 알린다. resource 는 이 클래스의 RESOURCE_*
   * 상수(project·label·milestone·cycle·field-def·issue-type· project-member). 반드시 쓰기 트랜잭션 안에서 호출 —
   * 밖에서 부르면 AFTER_COMMIT 리스너가 발화하지 않는다.
   */
  public void changed(String resource, String op, ProjectRow project, long id, Long actorId) {
    changed(resource, op, project, id, actorId, List.of());
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
        ResourceChangedEvent.of(
            resource,
            op,
            ProjectAudienceResolver.SCOPE,
            project.id(),
            List.of(id),
            Map.of("projectKey", project.key()),
            actorId,
            extra));
  }

  /**
   * 저장된 뷰 변경. shared — 변경 전/후 어느 한쪽이라도 SHARED 였는지(호출자가 wasShared||isShared 로 계산). 공유였으면 프로젝트 멤버
   * 전원에게, 둘 다 PRIVATE 이면 소유자에게만 보낸다 — 개인 뷰의 존재가 다른 멤버에게 새지 않게 하려는 것이다.
   */
  public void savedView(
      String op, ProjectRow project, long viewId, Long callerId, long ownerId, boolean shared) {
    if (shared) {
      changed(RESOURCE_SAVED_VIEW, op, project, viewId, callerId);
    } else {
      privateView(op, project, viewId, ownerId);
    }
  }

  /** 개인(PRIVATE) 저장된 뷰 — 소유자에게만(행위자도 소유자). */
  private void privateView(String op, ProjectRow project, long viewId, long ownerId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_SAVED_VIEW,
            op,
            UserAudienceResolver.SCOPE,
            ownerId,
            List.of(viewId),
            Map.of("projectKey", project.key()),
            ownerId));
  }
}

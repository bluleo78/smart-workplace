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

  /**
   * 멤버로 둔 조직도 부서 행(WP-1057) — 부서 추가·제거와 조직도 변경(부서 삭제·이동·구성원 감소·증가 WP-1166)으로 부서 행·인원이 바뀌면 멤버 창의 부서
   * 목록과 멤버(후보) 목록을 다시 받게 한다. ids 는 부서 id 다 — 사용자 id 를 싣는 project-member(제거 정리 리스너가 사용자 id 로 읽는다)와
   * 섞지 않는다.
   */
  public static final String RESOURCE_PROJECT_MEMBER_GROUP = "project-member-group";

  public static final String RESOURCE_LABEL = "label";
  public static final String RESOURCE_MILESTONE = "milestone";
  public static final String RESOURCE_CYCLE = "cycle";
  public static final String RESOURCE_FIELD_DEF = "field-def";
  public static final String RESOURCE_ISSUE_TYPE = "issue-type";
  public static final String RESOURCE_SAVED_VIEW = "saved-view";

  /** 프로젝트별 이슈 상태(WP-807) — 추가·이름 변경 시 보드 컬럼·상태 고르기를 다시 받게 한다. */
  public static final String RESOURCE_PROJECT_STATUS = "project-status";

  /** 프로젝트 구성요소(WP-933) — 추가·편집·보관·삭제 시 설정·피커·필터의 구성요소 목록을 다시 받게 한다. */
  public static final String RESOURCE_COMPONENT = "component";

  /** 프로젝트 버전(WP-888) — 추가·편집·보관·출시·삭제 시 버전 목록·상세와 이슈 칩을 다시 받게 한다. */
  public static final String RESOURCE_VERSION = "version";

  private final ApplicationEventPublisher publisher;

  /**
   * 프로젝트 멤버 전원에게 알린다. resource 는 이 클래스의 RESOURCE_*
   * 상수(project·label·milestone·cycle·field-def·issue-type·project-member·project-member-group·saved-view·
   * project-status·component·version). 반드시 쓰기 트랜잭션 안에서 호출 — 밖에서 부르면 AFTER_COMMIT 리스너가 발화하지 않는다.
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
    changed(resource, op, project, List.of(id), actorId, extra);
  }

  /**
   * 여러 대상을 한 이벤트로 알린다 — 부서 행 제거·조직도 변경으로 여러 사람이 한꺼번에 빠질 때 사람마다 이벤트(SSE·리스너)를 내지 않게(WP-1057). extra
   * 는 위와 같다.
   */
  public void changed(
      String resource,
      String op,
      ProjectRow project,
      Collection<Long> ids,
      Long actorId,
      Collection<Long> extra) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            resource,
            op,
            ProjectAudienceResolver.SCOPE,
            project.id(),
            List.copyOf(ids),
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

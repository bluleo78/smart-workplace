package com.workplace.issue.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.project.dto.ProjectRow;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 이슈 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-59). 이슈 관련 서비스(본문·담당자·라벨·사이클·필드·의존성·첨부·드라이브
 * 링크·워치·삭제)가 쓰기 트랜잭션 안에서 한 줄로 호출한다 — 이벤트 모양을 한 곳에 고정해 서비스마다 조립이 흩어지지 않게 한다. 프론트는
 * projectKey/issueNumber 로 목록·상세 쿼리 키를 만든다.
 */
@Component
@RequiredArgsConstructor
public class IssueChangeNotifier {

  public static final String RESOURCE = "issue";

  private final ApplicationEventPublisher publisher;

  /** 이슈 생성 알림. 반드시 쓰기 트랜잭션 안에서 호출 — 밖에서 부르면 AFTER_COMMIT 리스너가 발화하지 않는다. */
  public void created(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_CREATED, actorId);
  }

  /** 이슈 수정(본문·담당자·라벨 등 부속 변경 포함) 알림. */
  public void updated(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_UPDATED, actorId);
  }

  /** 이슈 삭제 알림. */
  public void deleted(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_DELETED, actorId);
  }

  // 행위자 수신 규칙은 ResourceSseDispatcher 가 공통으로 처리하므로 extraRecipients 는 비운다.
  private void changed(ProjectRow project, int issueNumber, long issueId, String op, Long actorId) {
    publisher.publishEvent(
        new ResourceChangedEvent(
            RESOURCE,
            op,
            "PROJECT",
            project.id(),
            List.of(issueId),
            Map.of("projectKey", project.key(), "issueNumber", issueNumber),
            actorId,
            Set.of()));
  }
}

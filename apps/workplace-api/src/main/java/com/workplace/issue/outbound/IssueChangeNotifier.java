package com.workplace.issue.outbound;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.outbound.ProjectAudienceResolver;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * 이슈 변경 → {@link ResourceChangedEvent} 발행 헬퍼 (WP-59). 이슈 관련 서비스(본문·담당자·라벨·사이클·필드·의존성·첨부·드라이브
 * 링크·워치·삭제)가 쓰기 트랜잭션 안에서 한 줄로 호출한다 — 이벤트 모양을 한 곳에 고정해 서비스마다 조립이 흩어지지 않게 한다. 프론트는
 * projectKey/issueNumber 로 목록·상세 쿼리 키를 만든다.
 *
 * <p>MCP(수행 도구 헤더) 쓰기 분류(WP-425): 작업 쓰기(제목·본문·상태 수정, 코멘트, 첨부, 드라이브 링크)는 {@link #updated} — AI 작업을
 * 시작·터치한다. 정리성 쓰기(유형·부모·의존성·라벨·담당자·사이클·커스텀 필드, 우선순위·날짜·마일스톤만의 수정)는 {@link #updatedWithoutTouch} —
 * 알림만 낸다.
 */
@Component
@RequiredArgsConstructor
public class IssueChangeNotifier {

  /** 리소스 이름 — 프론트 무효화 맵(resourceInvalidation RULES) 키와 계약 테스트로 일치를 고정한다. */
  public static final String RESOURCE_ISSUE = "issue";

  private final ApplicationEventPublisher publisher;

  /**
   * 이슈 생성 알림. 반드시 쓰기 트랜잭션 안에서 호출 — 밖에서 부르면 AFTER_COMMIT 리스너가 발화하지 않는다. {@link #updated}와 마찬가지로
   * MCP(수행 도구 헤더) 경유 쓰기면 AI 작업 터치 이벤트도 함께 낸다(WP-377) — 단 승격 전용이라, 외부 AI 가 자기를 담당자로 두고 이슈를 만들 때 담당자
   * 추가가 만든 시작 전(SUBMITTED) 작업을 같은 트랜잭션에서 작업 중으로 이어 쓰고 도구를 채울 뿐 새 작업 행은 만들지 않는다. 호출자는 담당자 매핑을 넣은 뒤에
   * 불러야 하며, 담당자가 아니면 리스너가 무시한다.
   */
  public void created(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_CREATED, actorId);
    // 위에서 이슈 이벤트를 이미 냈으므로 터치 리스너는 알림을 다시 내지 않는다(issueNotified=true).
    // promoteOnly — 생성만으로 새 작업을 열지 않는다. 담당자 추가가 만든 시작 전 작업이 있을 때만 착수로 잇는다(사람·담당자 아닌 쓰기에 유령 작업 방지).
    AgentToolWriteEvent.publishIfAgentTool(publisher, issueId, actorId, true, true, false);
  }

  /**
   * 이슈 작업 쓰기(제목·본문·상태·코멘트·첨부·드라이브 링크) 알림. MCP(수행 도구 헤더) 경유 쓰기면 AI 작업 자동 시작·터치 이벤트도 함께 낸다(WP-377) —
   * 작업 쓰기 서비스가 모두 이 메서드를 거치므로 쓰기 지점마다 따로 넣지 않는다. 이슈를 정리만 하는 쓰기는 {@link #updatedWithoutTouch} 를
   * 쓴다(WP-425).
   */
  public void updated(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    updated(project, issueNumber, issueId, actorId, false);
  }

  /**
   * {@link #updated(ProjectRow, int, long, Long)} 와 같고, statusWritten 이면 이 쓰기가 이슈 상태를 직접 지정했다는 뜻이다
   * — AI 작업이 이때 시작돼도 요청한 상태를 진행 중으로 덮지 않는다(WP-393).
   */
  public void updated(
      ProjectRow project, int issueNumber, long issueId, Long actorId, boolean statusWritten) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_UPDATED, actorId);
    // 위에서 이슈 이벤트를 이미 냈으므로 터치 리스너는 알림을 다시 내지 않는다(issueNotified=true).
    AgentToolWriteEvent.publishIfAgentTool(publisher, issueId, actorId, true, false, statusWritten);
  }

  /**
   * 화면 갱신용 수정 알림만 내고 AI 작업 터치({@link AgentToolWriteEvent})는 내지 않는다(WP-377). 그 이슈의 AI 작업이 시작·재개되면 안
   * 되는 두 갈래의 쓰기에 쓴다.
   *
   * <ul>
   *   <li><b>정리성 쓰기</b>(WP-425) — 유형·부모·의존성·라벨·담당자·사이클·커스텀 필드, 우선순위·날짜·마일스톤만의 수정. 이슈를 정리했을 뿐 그 일을 한
   *       것이 아니므로, MCP 경유라도 작업 행을 만들거나 시작 전(SUBMITTED) 작업을 잇거나 일하던 작업을 되돌리지 않는다.
   *   <li><b>이슈 자체를 쓰지 않은 변경</b> — 워치 등록·해제, 의존성 추가·제거에서 호출자가 직접 쓰지 않은 상대 이슈. AI 작업 기록(agent_work)
   *       변경 알림도 여기에 든다 — 터치 리스너가 이 알림을 내므로 터치 이벤트를 발행하면 터치 → 알림 → 터치로 무한 재귀한다.
   * </ul>
   */
  public void updatedWithoutTouch(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_UPDATED, actorId);
  }

  /** 이슈 삭제 알림. */
  public void deleted(ProjectRow project, int issueNumber, long issueId, Long actorId) {
    changed(project, issueNumber, issueId, ResourceChangedEvent.OP_DELETED, actorId);
  }

  // 행위자 수신 규칙은 ResourceSseDispatcher 가 공통으로 처리하므로 extraRecipients 는 비운다.
  private void changed(ProjectRow project, int issueNumber, long issueId, String op, Long actorId) {
    publisher.publishEvent(
        ResourceChangedEvent.of(
            RESOURCE_ISSUE,
            op,
            ProjectAudienceResolver.SCOPE,
            project.id(),
            List.of(issueId),
            Map.of("projectKey", project.key(), "issueNumber", issueNumber),
            actorId));
  }
}

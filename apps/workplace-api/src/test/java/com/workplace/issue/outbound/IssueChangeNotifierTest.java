package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.project.dto.ProjectRow;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

/** IssueChangeNotifier 단위 테스트 — 이슈 변경이 PROJECT scope 의 resource.changed 이벤트로 조립되는지 (WP-59). */
class IssueChangeNotifierTest {

  @Test
  void buildsProjectScopedIssueEvent() {
    var publisher = mock(ApplicationEventPublisher.class);
    var notifier = new IssueChangeNotifier(publisher);
    var project =
        new ProjectRow(7L, "EX", "예제", null, 1L, "TEAM", false, Instant.now(), Instant.now());

    notifier.deleted(project, 21, 39L, 1L);

    var captor = ArgumentCaptor.forClass(ResourceChangedEvent.class);
    verify(publisher).publishEvent(captor.capture());
    var e = captor.getValue();
    assertThat(e.resource()).isEqualTo("issue");
    assertThat(e.op()).isEqualTo("deleted");
    assertThat(e.scopeType()).isEqualTo("PROJECT");
    assertThat(e.scopeId()).isEqualTo(7L);
    assertThat(e.ids()).isEqualTo(List.of(39L));
    assertThat(e.attrs()).containsEntry("projectKey", "EX").containsEntry("issueNumber", 21);
  }

  /** 행위자 수신 규칙은 ResourceSseDispatcher 공통 처리 — 알림 헬퍼는 op 만 다르게 매핑하고 extraRecipients 는 비운다. */
  @Test
  void createdAndUpdatedMapOpsAndLeaveExtraRecipientsEmpty() {
    var publisher = mock(ApplicationEventPublisher.class);
    var notifier = new IssueChangeNotifier(publisher);
    var project =
        new ProjectRow(7L, "EX", "예제", null, 1L, "OPEN", false, Instant.now(), Instant.now());

    notifier.created(project, 21, 39L, 5L);
    notifier.updated(project, 21, 39L, null);

    var captor = ArgumentCaptor.forClass(ResourceChangedEvent.class);
    verify(publisher, times(2)).publishEvent(captor.capture());
    var events = captor.getAllValues();
    assertThat(events.get(0).op()).isEqualTo("created");
    assertThat(events.get(0).actorId()).isEqualTo(5L);
    assertThat(events.get(0).extraRecipients()).isEmpty();
    assertThat(events.get(1).op()).isEqualTo("updated");
    assertThat(events.get(1).actorId()).isNull();
    assertThat(events.get(1).extraRecipients()).isEmpty();
  }
}

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

    notifier.changed(project, 21, 39L, ResourceChangedEvent.OP_DELETED, 1L);

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

  @Test
  void actorIsAlwaysExtraRecipient_nullActorYieldsEmpty() {
    var publisher = mock(ApplicationEventPublisher.class);
    var notifier = new IssueChangeNotifier(publisher);
    var project =
        new ProjectRow(7L, "EX", "예제", null, 1L, "OPEN", false, Instant.now(), Instant.now());

    notifier.changed(project, 21, 39L, ResourceChangedEvent.OP_UPDATED, 5L);
    notifier.changed(project, 21, 39L, ResourceChangedEvent.OP_UPDATED, null);

    var captor = ArgumentCaptor.forClass(ResourceChangedEvent.class);
    verify(publisher, times(2)).publishEvent(captor.capture());
    assertThat(captor.getAllValues().get(0).extraRecipients()).containsExactly(5L);
    assertThat(captor.getAllValues().get(1).extraRecipients()).isEmpty();
  }
}

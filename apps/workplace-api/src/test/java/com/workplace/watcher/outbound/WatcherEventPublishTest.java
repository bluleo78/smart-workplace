package com.workplace.watcher.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.repository.UserRepository;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import com.workplace.watcher.service.WatcherService;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

/**
 * WatcherService.watch() 가 WatcherAddedEvent 를 발행하는지 검증. 신규 insert 시에만 발행되고, 이미 watcher 인 멱등 케이스에서는
 * 발행되지 않음을 확인. Mockito 만 사용 — Spring 컨텍스트 없음.
 */
class WatcherEventPublishTest {

  private IssueWatcherRepository watcherRepository;
  private IssueRepository issueRepository;
  private IssueLabelRepository issueLabelRepository;
  private ProjectRepository projectRepository;
  private UserRepository userRepository;
  private ProjectAccessGuard accessGuard;
  private ApplicationEventPublisher publisher;
  private WatcherService service;

  private static final String PROJECT_KEY = "WP";
  private static final long PROJECT_ID = 42L;
  private static final long ISSUE_ID = 100L;
  private static final int ISSUE_NUMBER = 3;
  private static final long CALLER_ID = 7L;

  @BeforeEach
  void setUp() {
    watcherRepository = mock(IssueWatcherRepository.class);
    issueRepository = mock(IssueRepository.class);
    issueLabelRepository = mock(IssueLabelRepository.class);
    projectRepository = mock(ProjectRepository.class);
    userRepository = mock(UserRepository.class);
    accessGuard = mock(ProjectAccessGuard.class);
    publisher = mock(ApplicationEventPublisher.class);

    service =
        new WatcherService(
            watcherRepository,
            issueRepository,
            issueLabelRepository,
            projectRepository,
            userRepository,
            accessGuard,
            publisher);

    ProjectRow project =
        new ProjectRow(
            PROJECT_ID, PROJECT_KEY, "P", "d", 1L, "TEAM", false, Instant.now(), Instant.now());
    IssueRow issue =
        new IssueRow(
            ISSUE_ID,
            PROJECT_ID,
            ISSUE_NUMBER,
            "t",
            "b",
            "TODO",
            "MID",
            null,
            CALLER_ID,
            Instant.now(),
            Instant.now(),
            null,
            1L,
            null);
    when(accessGuard.assertMember(PROJECT_KEY, CALLER_ID)).thenReturn(project);
    when(issueRepository.findByProjectAndNumber(PROJECT_ID, ISSUE_NUMBER))
        .thenReturn(Optional.of(issue));
  }

  @Test
  void watch_publishesWatcherAddedEvent_whenNewInsert() {
    when(watcherRepository.add(ISSUE_ID, CALLER_ID)).thenReturn(true);

    service.watch(CALLER_ID, PROJECT_KEY, ISSUE_NUMBER);

    ArgumentCaptor<WatcherAddedEvent> captor = ArgumentCaptor.forClass(WatcherAddedEvent.class);
    verify(publisher).publishEvent(captor.capture());
    WatcherAddedEvent event = captor.getValue();
    assertThat(event.issueId()).isEqualTo(ISSUE_ID);
    assertThat(event.userId()).isEqualTo(CALLER_ID);
    assertThat(event.actorUserId()).isEqualTo(CALLER_ID);
    assertThat(event.occurredAt()).isNotNull();
  }

  @Test
  void watch_doesNotPublishEvent_whenAlreadyWatching() {
    when(watcherRepository.add(ISSUE_ID, CALLER_ID)).thenReturn(false);

    service.watch(CALLER_ID, PROJECT_KEY, ISSUE_NUMBER);

    verify(publisher, never()).publishEvent(any());
  }
}

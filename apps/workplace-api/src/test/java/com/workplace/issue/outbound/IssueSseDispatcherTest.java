package com.workplace.issue.outbound;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.global.dto.UserSummary;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.watcher.repository.IssueWatcherRepository;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/** IssueSseDispatcher 단위 테스트 — 이슈 코멘트 SSE 브로드캐스트가 watcher 전원에게 fan-out 되는지 검증 (#579). */
class IssueSseDispatcherTest {

  private SseRegistry registry;
  private IssueWatcherRepository watcherRepository;
  private IssueSseDispatcher dispatcher;

  private static final UserSummary AUTHOR = new UserSummary(1L, "alice", "Alice", "HUMAN");

  @BeforeEach
  void setUp() {
    registry = Mockito.mock(SseRegistry.class);
    watcherRepository = Mockito.mock(IssueWatcherRepository.class);
    dispatcher = new IssueSseDispatcher(registry, watcherRepository);
    when(watcherRepository.findUserIdsByIssue(39L)).thenReturn(List.of(1L, 2L, 3L));
  }

  @Test
  void onCommented_fansOutToAllWatchers() {
    dispatcher.onCommented(
        new IssueCommentedEvent(
            39L,
            "EX",
            "EX-21",
            21,
            "결제 모듈 환불 처리 간헐적 실패",
            AUTHOR,
            List.of(),
            100L,
            "재현 조건 확인했습니다",
            Instant.now()));

    verify(registry).fanOut(eq(List.of(1L, 2L, 3L)), eq("issue.commented"), any());
  }

  @Test
  void onCommented_payloadCarriesIssueNumberForQueryKey() {
    dispatcher.onCommented(
        new IssueCommentedEvent(
            39L,
            "EX",
            "EX-21",
            21,
            "결제 모듈 환불 처리 간헐적 실패",
            AUTHOR,
            List.of(),
            100L,
            "재현 조건 확인했습니다",
            Instant.now()));

    Mockito.verify(registry)
        .fanOut(
            any(),
            eq("issue.commented"),
            Mockito.argThat(
                payload -> {
                  @SuppressWarnings("unchecked")
                  var p = (java.util.Map<String, Object>) payload;
                  return "EX".equals(p.get("projectKey"))
                      && Integer.valueOf(21).equals(p.get("issueNumber"))
                      && Long.valueOf(100L).equals(p.get("commentId"));
                }));
  }

  @Test
  void onCommentUpdated_fansOutToAllWatchers() {
    dispatcher.onCommentUpdated(
        new IssueCommentUpdatedEvent(
            39L,
            "EX",
            "EX-21",
            21,
            "결제 모듈 환불 처리 간헐적 실패",
            AUTHOR,
            List.of(),
            100L,
            "수정된 내용입니다",
            Instant.now()));

    verify(registry).fanOut(eq(List.of(1L, 2L, 3L)), eq("issue.comment_updated"), any());
  }

  @Test
  void onCommentDeleted_fansOutToAllWatchers() {
    dispatcher.onCommentDeleted(
        new IssueCommentDeletedEvent(
            39L, "EX", "EX-21", 21, "결제 모듈 환불 처리 간헐적 실패", AUTHOR, List.of(), 100L, Instant.now()));

    verify(registry).fanOut(eq(List.of(1L, 2L, 3L)), eq("issue.comment_deleted"), any());
  }
}

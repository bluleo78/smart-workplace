package com.workplace.home.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.airun.context.AiRunContext;
import com.workplace.airun.context.AiRunKinds;
import com.workplace.auth.service.AssistantLimitGuard;
import com.workplace.auth.service.AssistantResolution;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.home.outbound.AiAgentContextSummaryClient;
import com.workplace.home.repository.HomeMessageRepository.ContextRow;
import com.workplace.home.repository.HomeSessionRepository.SummaryState;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.AsyncTaskExecutor;

/**
 * WP-2108 최종 검토 6: 홈 채팅 맥락의 자동(비동기) 요약은 비서가 한도 대기 중이면 조용히 건너뛴다 — 호출하지 않고, 실패 쿨다운도 시작하지 않아 풀린 뒤 다음
 * 턴에 바로 이어진다.
 */
class HomeContextSummaryLimitWaitTest {

  @Test
  void 한도_대기_중이면_조용히_건너뛰고_쿨다운도_걸지_않는다() {
    HomeSessionService sessions = mock(HomeSessionService.class);
    AiAgentContextSummaryClient summaryClient = mock(AiAgentContextSummaryClient.class);
    AssistantResolver resolver = mock(AssistantResolver.class);
    AssistantLimitGuard guard = mock(AssistantLimitGuard.class);
    AsyncTaskExecutor executor = mock(AsyncTaskExecutor.class);
    doAnswer(
            inv -> {
              ((Runnable) inv.getArgument(0)).run();
              return null;
            })
        .when(executor)
        .execute(any(Runnable.class));
    // 예산 1000 → 트리거 750 토큰, 메시지 상한 250. 긴 원문 여러 건이면 넘는다.
    var props = new HomeChatProperties(1000, 3);
    when(sessions.getContextSource(7L, SESSION))
        .thenReturn(
            new HomeSessionService.ContextSource(
                new SummaryState(null, null),
                java.util.stream.IntStream.rangeClosed(1, 10)
                    .mapToObj(i -> new ContextRow(i, "USER", "가".repeat(2000)))
                    .toList(),
                Map.of()));
    when(resolver.resolution(7L))
        .thenReturn(AssistantResolution.waiting(5L, Instant.now().plus(1, ChronoUnit.HOURS)));
    when(guard.specOrSkip(any(), anyString(), any(AiRunContext.class)))
        .thenReturn(Optional.empty());
    var svc =
        new HomeContextSummaryService(sessions, summaryClient, resolver, guard, props, executor);

    svc.scheduleIfNeeded(7L, SESSION);
    svc.scheduleIfNeeded(7L, SESSION);

    verify(guard, times(2))
        .specOrSkip(any(), org.mockito.ArgumentMatchers.eq(AiRunKinds.HOME_CONTEXT_SUMMARY), any());
    verify(summaryClient, never()).summarize(any());
    // 쿨다운이 걸렸다면 두 번째 예약은 해석까지 가지 않는다 — 두 번 다 해석했다면 쿨다운 없음.
    verify(resolver, times(2)).resolution(7L);
  }

  private static final UUID SESSION = UUID.randomUUID();
}

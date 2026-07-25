package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.DefaultStreamingGenerationRegistry;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.task.support.TaskExecutorAdapter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * WikiAiService 단위 테스트(#593 편입). 의존성을 목으로, executor 는 동기(TaskExecutorAdapter(Runnable::run))로 주입해
 * 펌프가 인라인 실행되게 한다 — 슬립/래치 없이 결정적으로 검증. SseRegistry 는 목, StreamingGenerationRegistry 는 실제
 * 구현(Default...)을 써서 correlationId 발급까지 실제 경로로 검증한다.
 */
class WikiAiServiceTest {

  private WikiPageRepository pages;
  private WikiPermissions perms;
  private AssistantResolver assistantResolver;
  private WikiAiAgentStreamClient agent;
  private SseRegistry sseRegistry;
  private StreamingGenerationRegistry registry;
  private WikiPageService pageService;
  private WikiAiService service;

  private static final long CALLER = 7L;
  private static final long PAGE_ID = 100L;
  private static final long SPACE_ID = 42L;

  @BeforeEach
  void setup() {
    pages = mock(WikiPageRepository.class);
    perms = mock(WikiPermissions.class);
    assistantResolver = mock(AssistantResolver.class);
    agent = mock(WikiAiAgentStreamClient.class);
    sseRegistry = mock(SseRegistry.class);
    registry = new DefaultStreamingGenerationRegistry();
    pageService = mock(WikiPageService.class);
    service =
        new WikiAiService(
            pages,
            perms,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            registry,
            sseRegistry,
            pageService);
  }

  private WikiPageDetail page() {
    return new WikiPageDetail(
        PAGE_ID, SPACE_ID, null, "설계 문서", "## 본문\n내용", 3, CALLER, OffsetDateTime.now(), null, null);
  }

  private AssistantSpec spec() {
    return new AssistantSpec(900L, "claude-opus", "NORMAL", 5, 60_000);
  }

  /** EDITOR 권한이 강제된다 — 역할 미달(VIEWER)이면 startCompose 가 throw, 에이전트/fanOut 호출 없음. */
  @Test
  void startCompose_nonEditor_throwsAndDoesNotCallAgent() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    doThrow(new WikiForbiddenException(SPACE_ID, CALLER))
        .when(perms)
        .requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"));

    assertThatThrownBy(() -> service.startCompose(CALLER, PAGE_ID, summarize()))
        .isInstanceOf(WikiForbiddenException.class);

    verify(agent, never()).stream(any(), any(), any());
    verify(assistantResolver, never()).resolve(anyLong());
    verify(sseRegistry, never()).fanOut(any(), any(), any());
  }

  /** EDITOR 통과 시 페이지 제목·본문·액션이 에이전트 요청 본문(AgentBody)에 실린다. */
  @Test
  void startCompose_passesPageContextIntoAgentBody() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    ArgumentCaptor<Object> bodyCaptor = ArgumentCaptor.forClass(Object.class);
    service.startCompose(CALLER, PAGE_ID, summarize());

    verify(agent).stream(bodyCaptor.capture(), any(), any());
    WikiAiService.AgentBody body = (WikiAiService.AgentBody) bodyCaptor.getValue();
    assertThat(body.pageTitle()).isEqualTo("설계 문서");
    assertThat(body.pageBody()).isEqualTo("## 본문\n내용");
    assertThat(body.action()).isEqualTo(WikiAiAction.SUMMARIZE);
    assertThat(body.assistantAgentId()).isEqualTo(900L);
    assertThat(body.model()).isEqualTo("claude-opus");
  }

  /** 에이전트 델타·완료가 SseRegistry.fanOut 으로 wiki.ai.delta/wiki.ai.done 으로 전달된다(동기 펌프). */
  @Test
  void startCompose_deltasFanOutAsWikiAiEvents_andDone() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    doAnswer(
        inv -> {
          @SuppressWarnings("unchecked")
          Consumer<String> onDelta = inv.getArgument(1);
          Runnable onDone = inv.getArgument(2);
          onDelta.accept("요약: ");
          onDelta.accept("핵심");
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    String correlationId = service.startCompose(CALLER, PAGE_ID, summarize());
    assertThat(correlationId).isNotBlank();

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
    ArgumentCaptor<String> eventCaptor = ArgumentCaptor.forClass(String.class);
    verify(sseRegistry, times(3))
        .fanOut(eq(Set.of(CALLER)), eventCaptor.capture(), payloadCaptor.capture());

    assertThat(eventCaptor.getAllValues())
        .containsExactly("wiki.ai.delta", "wiki.ai.delta", "wiki.ai.done");
    assertThat(payloadCaptor.getAllValues().get(0))
        .containsEntry("correlationId", correlationId)
        .containsEntry("text", "요약: ");
    assertThat(payloadCaptor.getAllValues().get(1)).containsEntry("text", "핵심");
    assertThat(payloadCaptor.getAllValues().get(2)).containsEntry("correlationId", correlationId);
  }

  /**
   * #736: 델타가 1개 이상 전달된 뒤 정상 완료되면 attribution 이 기록된다. fanOut 순서상 recordAiUsage 가 wiki.ai.done 이벤트보다
   * 먼저 커밋돼야(§4.1) 뒤이은 자동저장이 최신 값을 읽으므로, 실행 자체가 성공하면 순서는 자연히 보장된다(같은 스레드 동기 호출) — 여기서는 호출 여부/인자만
   * 검증한다.
   */
  @Test
  void startCompose_deltaDeliveredThenDone_recordsAiUsage() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    doAnswer(
        inv -> {
          @SuppressWarnings("unchecked")
          Consumer<String> onDelta = inv.getArgument(1);
          Runnable onDone = inv.getArgument(2);
          onDelta.accept("핵심 요약");
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    service.startCompose(CALLER, PAGE_ID, summarize());

    verify(pageService).recordAiUsage(PAGE_ID, WikiAiAction.SUMMARIZE);
  }

  /** agent.stream 이 예외를 던지면 wiki.ai.error(message 포함)로 fanOut 된다. */
  @Test
  void startCompose_agentThrows_fanOutWikiAiError() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    doThrow(new RuntimeException("ai-agent 응답 실패")).when(agent).stream(any(), any(), any());

    String correlationId = service.startCompose(CALLER, PAGE_ID, summarize());

    verify(sseRegistry)
        .fanOut(
            eq(Set.of(CALLER)),
            eq("wiki.ai.error"),
            eq(Map.of("correlationId", correlationId, "message", "ai-agent 응답 실패")));
  }

  /** #736: 델타 없이 즉시 실패하면 attribution 을 기록하지 않는다(전달된 텍스트가 없으므로 신호 없음). */
  @Test
  void startCompose_agentThrowsWithoutDelta_doesNotRecordAiUsage() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    doThrow(new RuntimeException("ai-agent 응답 실패")).when(agent).stream(any(), any(), any());

    service.startCompose(CALLER, PAGE_ID, summarize());

    verify(pageService, never()).recordAiUsage(anyLong(), any());
  }

  /**
   * #736: 델타가 전달된 뒤 도중에 실패해도(에러/취소 불문) attribution 을 기록한다 — 부분 텍스트가 이미 에디터에 삽입·자동저장 예정이므로 "정상 완료"가
   * 아니어도 신호는 남아야 한다(§3.1).
   */
  @Test
  void startCompose_deltaDeliveredThenAgentThrows_recordsAiUsage() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    doAnswer(
        inv -> {
          @SuppressWarnings("unchecked")
          Consumer<String> onDelta = inv.getArgument(1);
          onDelta.accept("일부 생성분");
          throw new RuntimeException("네트워크 끊김");
        })
        .when(agent)
        .stream(any(), any(), any());

    service.startCompose(CALLER, PAGE_ID, summarize());

    verify(pageService).recordAiUsage(PAGE_ID, WikiAiAction.SUMMARIZE);
  }

  /** #736: attribution 기록이 실패해도(예외 격리) wiki.ai.done fanOut 은 그대로 발생한다. */
  @Test
  void startCompose_recordAiUsageThrows_stillFansOutDone() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    doThrow(new RuntimeException("DB 오류")).when(pageService).recordAiUsage(anyLong(), any());

    doAnswer(
        inv -> {
          @SuppressWarnings("unchecked")
          Consumer<String> onDelta = inv.getArgument(1);
          Runnable onDone = inv.getArgument(2);
          onDelta.accept("핵심 요약");
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    String correlationId = service.startCompose(CALLER, PAGE_ID, summarize());

    verify(sseRegistry)
        .fanOut(eq(Set.of(CALLER)), eq("wiki.ai.done"), eq(Map.of("correlationId", correlationId)));
  }

  /**
   * 취소(cancelCompose)로 펌프 스레드가 인터럽트될 때 — 실제 JDK HttpClient 블로킹 read 가 isInterrupted() 로 조용히 리턴하지 않고
   * InterruptedException 이 감싸인 예외를 던지는 것과 동일하게 agent.stream 을 스텁해 재현한다. 실제
   * 스레드풀(ThreadPoolTaskExecutor)+실제 DefaultStreamingGenerationRegistry 로 진짜 인터럽트를 발생시켜, catch 블록의
   * 원인 체인 검사가 wiki.ai.error(cancelled:true) 를 내보내는지 검증한다(동기 TaskExecutorAdapter 로는 재현 불가한 경로).
   */
  @Test
  void startCompose_cancelledWhileBlockedInAgentStream_fanOutErrorWithCancelledTrue()
      throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    ThreadPoolTaskExecutor realExecutor = new ThreadPoolTaskExecutor();
    realExecutor.setCorePoolSize(2);
    realExecutor.setMaxPoolSize(2);
    realExecutor.initialize();
    StreamingGenerationRegistry realRegistry = new DefaultStreamingGenerationRegistry();
    WikiAiService svc =
        new WikiAiService(
            pages,
            perms,
            assistantResolver,
            agent,
            realExecutor,
            realRegistry,
            sseRegistry,
            pageService);

    CountDownLatch started = new CountDownLatch(1);
    doAnswer(
        inv -> {
          started.countDown();
          try {
            // 에이전트 thinking 대기 중을 흉내 — 인터럽트되기 전까지 블로킹.
            Thread.sleep(5000);
          } catch (InterruptedException ie) {
            // 실제 WikiAiAgentStreamClient.stream() 의 ofLines() 블로킹 read 가 interrupt 시
            // 조용히 리턴하지 않고 이런 형태로 감싸인 예외를 던지는 것을 재현한다.
            throw new UncheckedIOException(new IOException(ie));
          }
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    String correlationId = svc.startCompose(CALLER, PAGE_ID, summarize());
    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

    svc.cancelCompose(correlationId, CALLER);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
    verify(sseRegistry, org.mockito.Mockito.timeout(1000))
        .fanOut(eq(Set.of(CALLER)), eq("wiki.ai.error"), payloadCaptor.capture());
    assertThat(payloadCaptor.getValue())
        .containsEntry("correlationId", correlationId)
        .containsEntry("cancelled", true);

    realExecutor.shutdown();
  }

  /** cancelCompose 는 StreamingGenerationRegistry.cancel 로 위임한다. */
  @Test
  void cancelCompose_delegatesToRegistry() {
    StreamingGenerationRegistry mockRegistry = mock(StreamingGenerationRegistry.class);
    WikiAiService svc =
        new WikiAiService(
            pages,
            perms,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            mockRegistry,
            sseRegistry,
            pageService);

    svc.cancelCompose("corr-1", CALLER);

    verify(mockRegistry).cancel("corr-1", CALLER);
  }

  private WikiAiRequest summarize() {
    return new WikiAiRequest(WikiAiAction.SUMMARIZE, null, null);
  }
}

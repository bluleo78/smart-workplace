package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.drive.dto.DriveContentHit;
import com.workplace.drive.dto.DriveContentSearchResponse;
import com.workplace.drive.outbound.DriveOverviewStreamClient;
import com.workplace.drive.repository.DriveExcerptRepository;
import com.workplace.global.realtime.DefaultStreamingGenerationRegistry;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.task.support.TaskExecutorAdapter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * DriveOverviewService 단위 테스트(#593 편입). 의존성을 목으로, executor 는
 * 동기(TaskExecutorAdapter(Runnable::run))로 주입해 펌프가 인라인 실행되게 한다 — 슬립/래치 없이 결정적으로 검증. SseRegistry 는 목,
 * StreamingGenerationRegistry 는 실제 구현 (Default...)을 써서 correlationId 발급까지 실제 경로로
 * 검증한다(WikiAiServiceTest 패턴 미러).
 */
class DriveOverviewServiceTest {

  private DriveContentSearchService search;
  private DriveExcerptRepository excerpts;
  private AssistantResolver assistantResolver;
  private DriveOverviewStreamClient agent;
  private PlatformTransactionManager txManager;
  private SseRegistry sseRegistry;
  private StreamingGenerationRegistry registry;
  private DriveOverviewService service;

  private static final long CALLER = 7L;

  @BeforeEach
  void setup() {
    search = mock(DriveContentSearchService.class);
    excerpts = mock(DriveExcerptRepository.class);
    assistantResolver = mock(AssistantResolver.class);
    agent = mock(DriveOverviewStreamClient.class);
    sseRegistry = mock(SseRegistry.class);
    registry = new DefaultStreamingGenerationRegistry();

    // 읽기전용 TransactionTemplate 이 execute() 를 호출할 때 콜백을 즉시 실행하는 스텁 txManager.
    txManager = mock(PlatformTransactionManager.class);
    TransactionStatus txStatus = new SimpleTransactionStatus();
    when(txManager.getTransaction(any(TransactionDefinition.class))).thenReturn(txStatus);

    service =
        new DriveOverviewService(
            search,
            excerpts,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            txManager,
            registry,
            sseRegistry);
  }

  private AssistantSpec spec() {
    return new AssistantSpec(900L, "claude-opus", "NORMAL", 5, 60_000);
  }

  private DriveContentHit hit(long fileId, String name) {
    return new DriveContentHit(fileId, fileId, 10L, "기획 공간", name, "text/plain", "발췌", 0.9);
  }

  /** 검색·발췌·비서 해석 결과가 정확히 AgentBody 에 실려 agent.stream 에 전달된다. */
  @Test
  void startOverview_passesSearchAndExcerptsIntoAgentBody() throws Exception {
    when(search.search(eq(CALLER), eq("매출"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(hit(20L, "보고서.txt")), true));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    when(excerpts.findExtractedText(eq(20L), anyInt())).thenReturn("매출 성장 분석 내용");

    doAnswer(
        inv -> {
          Runnable onDone = inv.getArgument(2);
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    ArgumentCaptor<Object> bodyCaptor = ArgumentCaptor.forClass(Object.class);
    service.startOverview(CALLER, "매출", null);

    verify(agent).stream(bodyCaptor.capture(), any(), any());
    DriveOverviewService.AgentBody body = (DriveOverviewService.AgentBody) bodyCaptor.getValue();
    assertThat(body.query()).isEqualTo("매출");
    assertThat(body.excerpts()).hasSize(1);
    assertThat(body.excerpts().get(0).name()).isEqualTo("보고서.txt");
    assertThat(body.excerpts().get(0).text()).isEqualTo("매출 성장 분석 내용");
    assertThat(body.assistantAgentId()).isEqualTo(900L);
    assertThat(body.model()).isEqualTo("claude-opus");
  }

  /** 발췌 텍스트가 없는(blank) 파일은 발췌 목록에서 걸러진다. */
  @Test
  void startOverview_blankExcerpt_isFiltered() throws Exception {
    when(search.search(eq(CALLER), eq("쿼리"), eq(5), isNull()))
        .thenReturn(
            new DriveContentSearchResponse(List.of(hit(1L, "파일A.txt"), hit(2L, "파일B.txt")), false));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    // 파일A = 빈 발췌, 파일B = 유효 발췌
    when(excerpts.findExtractedText(eq(1L), anyInt())).thenReturn("");
    when(excerpts.findExtractedText(eq(2L), anyInt())).thenReturn("유효한 본문");

    doAnswer(
        inv -> {
          Runnable onDone = inv.getArgument(2);
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    service.startOverview(CALLER, "쿼리", null);

    var bodyCaptor = ArgumentCaptor.forClass(Object.class);
    verify(agent).stream(bodyCaptor.capture(), any(), any());
    DriveOverviewService.AgentBody body = (DriveOverviewService.AgentBody) bodyCaptor.getValue();
    // 빈 발췌 파일A 는 제외, 파일B 만 남아야 한다.
    assertThat(body.excerpts()).hasSize(1);
    assertThat(body.excerpts().get(0).name()).isEqualTo("파일B.txt");
  }

  /** 검색 결과가 없으면 발췌 없는 빈 목록으로 에이전트를 호출한다(Overview = "관련 파일 없음" 처리). */
  @Test
  void startOverview_noHits_callsAgentWithEmptyExcerpts() throws Exception {
    when(search.search(eq(CALLER), eq("없는쿼리"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(), false));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    doAnswer(
        inv -> {
          Runnable onDone = inv.getArgument(2);
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    String correlationId = service.startOverview(CALLER, "없는쿼리", null);

    assertThat(correlationId).isNotBlank();
    var bodyCaptor = ArgumentCaptor.forClass(Object.class);
    verify(agent).stream(bodyCaptor.capture(), any(), any());
    DriveOverviewService.AgentBody body = (DriveOverviewService.AgentBody) bodyCaptor.getValue();
    assertThat(body.excerpts()).isEmpty();
    assertThat(body.query()).isEqualTo("없는쿼리");
    assertThat(body.assistantAgentId()).isEqualTo(900L);
  }

  /** spaceId 가 지정되면 그대로 콘텐츠 검색으로 전달되어야 한다(Overview 근거도 공간 스코프로 제한). */
  @Test
  void startOverview_withSpaceId_passesThroughToSearch() throws Exception {
    when(search.search(eq(CALLER), eq("예산"), eq(5), eq(42L)))
        .thenReturn(new DriveContentSearchResponse(List.of(), false));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    doAnswer(
        inv -> {
          Runnable onDone = inv.getArgument(2);
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    service.startOverview(CALLER, "예산", 42L);

    verify(search).search(eq(CALLER), eq("예산"), eq(5), eq(42L));
  }

  /** 에이전트 델타·완료가 SseRegistry.fanOut 으로 drive.overview.delta/drive.overview.done 으로 전달된다(동기 펌프). */
  @Test
  void startOverview_deltasFanOutAsDriveOverviewEvents_andDone() throws Exception {
    when(search.search(eq(CALLER), eq("매출"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(hit(20L, "보고서.txt")), true));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    when(excerpts.findExtractedText(eq(20L), anyInt())).thenReturn("매출 성장 분석 내용");

    doAnswer(
        inv -> {
          @SuppressWarnings("unchecked")
          Consumer<String> onDelta = inv.getArgument(1);
          Runnable onDone = inv.getArgument(2);
          onDelta.accept("매출 ");
          onDelta.accept("분석");
          onDone.run();
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    String correlationId = service.startOverview(CALLER, "매출", null);
    assertThat(correlationId).isNotBlank();

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
    ArgumentCaptor<String> eventCaptor = ArgumentCaptor.forClass(String.class);
    verify(sseRegistry, times(3))
        .fanOut(eq(Set.of(CALLER)), eventCaptor.capture(), payloadCaptor.capture());

    assertThat(eventCaptor.getAllValues())
        .containsExactly("drive.overview.delta", "drive.overview.delta", "drive.overview.done");
    assertThat(payloadCaptor.getAllValues().get(0))
        .containsEntry("correlationId", correlationId)
        .containsEntry("text", "매출 ");
    assertThat(payloadCaptor.getAllValues().get(1)).containsEntry("text", "분석");
    assertThat(payloadCaptor.getAllValues().get(2)).containsEntry("correlationId", correlationId);
  }

  /** agent.stream 이 예외를 던지면 drive.overview.error(message 포함)로 fanOut 된다(cancelled 필드 없음). */
  @Test
  void startOverview_agentThrows_fanOutDriveOverviewError() throws Exception {
    when(search.search(eq(CALLER), eq("오류"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(), false));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    doThrow(new RuntimeException("ai-agent stream error")).when(agent).stream(any(), any(), any());

    String correlationId = service.startOverview(CALLER, "오류", null);

    verify(sseRegistry)
        .fanOut(
            eq(Set.of(CALLER)),
            eq("drive.overview.error"),
            eq(Map.of("correlationId", correlationId, "message", "ai-agent stream error")));
  }

  /**
   * 취소(cancelOverview)로 펌프 스레드가 인터럽트될 때 — 실제 JDK HttpClient 블로킹 read 가 InterruptedException 이 감싸인
   * 예외를 던지는 것과 동일하게 agent.stream 을 스텁해 재현한다. 실제 스레드풀(ThreadPoolTaskExecutor)+실제
   * DefaultStreamingGenerationRegistry 로 진짜 인터럽트를 발생시켜, catch 블록의 원인 체인 검사가
   * drive.overview.error(cancelled:true) 를 내보내는지 검증한다(동기 TaskExecutorAdapter 로는 재현 불가한 경로).
   */
  @Test
  void startOverview_cancelledWhileBlockedInAgentStream_fanOutErrorWithCancelledTrue()
      throws Exception {
    when(search.search(eq(CALLER), eq("취소"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(), false));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    ThreadPoolTaskExecutor realExecutor = new ThreadPoolTaskExecutor();
    realExecutor.setCorePoolSize(2);
    realExecutor.setMaxPoolSize(2);
    realExecutor.initialize();
    StreamingGenerationRegistry realRegistry = new DefaultStreamingGenerationRegistry();
    DriveOverviewService svc =
        new DriveOverviewService(
            search,
            excerpts,
            assistantResolver,
            agent,
            realExecutor,
            txManager,
            realRegistry,
            sseRegistry);

    CountDownLatch started = new CountDownLatch(1);
    doAnswer(
        inv -> {
          started.countDown();
          try {
            // 에이전트 thinking 대기 중을 흉내 — 인터럽트되기 전까지 블로킹.
            Thread.sleep(5000);
          } catch (InterruptedException ie) {
            // 실제 DriveOverviewStreamClient.stream() 의 ofLines() 블로킹 read 가 interrupt 시
            // 조용히 리턴하지 않고 이런 형태로 감싸인 예외를 던지는 것을 재현한다.
            throw new UncheckedIOException(new IOException(ie));
          }
          return null;
        })
        .when(agent)
        .stream(any(), any(), any());

    String correlationId = svc.startOverview(CALLER, "취소", null);
    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

    svc.cancelOverview(correlationId, CALLER);

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Map<String, Object>> payloadCaptor = ArgumentCaptor.forClass(Map.class);
    verify(sseRegistry, org.mockito.Mockito.timeout(1000))
        .fanOut(eq(Set.of(CALLER)), eq("drive.overview.error"), payloadCaptor.capture());
    assertThat(payloadCaptor.getValue())
        .containsEntry("correlationId", correlationId)
        .containsEntry("cancelled", true);

    realExecutor.shutdown();
  }

  /** cancelOverview 는 StreamingGenerationRegistry.cancel 로 위임한다. */
  @Test
  void cancelOverview_delegatesToRegistry() {
    StreamingGenerationRegistry mockRegistry = mock(StreamingGenerationRegistry.class);
    DriveOverviewService svc =
        new DriveOverviewService(
            search,
            excerpts,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            txManager,
            mockRegistry,
            sseRegistry);

    svc.cancelOverview("corr-1", CALLER);

    verify(mockRegistry).cancel("corr-1", CALLER);
  }
}

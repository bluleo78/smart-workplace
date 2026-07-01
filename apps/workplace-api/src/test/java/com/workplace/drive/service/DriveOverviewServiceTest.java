package com.workplace.drive.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.drive.dto.DriveContentHit;
import com.workplace.drive.dto.DriveContentSearchResponse;
import com.workplace.drive.outbound.DriveOverviewStreamClient;
import com.workplace.drive.repository.DriveExcerptRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.support.TaskExecutorAdapter;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * DriveOverviewService 단위 테스트. 의존성을 목으로, executor 는 동기(TaskExecutorAdapter(Runnable::run))로 주입해 펌프가
 * 인라인 실행되게 한다 — 슬립/래치 없이 결정적으로 검증.
 */
class DriveOverviewServiceTest {

  private DriveContentSearchService search;
  private DriveExcerptRepository excerpts;
  private AssistantResolver assistantResolver;
  private DriveOverviewStreamClient agent;
  private PlatformTransactionManager txManager;
  private DriveOverviewService service;

  private static final long CALLER = 7L;

  @BeforeEach
  void setup() {
    search = mock(DriveContentSearchService.class);
    excerpts = mock(DriveExcerptRepository.class);
    assistantResolver = mock(AssistantResolver.class);
    agent = mock(DriveOverviewStreamClient.class);

    // 읽기전용 TransactionTemplate 이 execute() 를 호출할 때 콜백을 즉시 실행하는 스텁 txManager.
    txManager = mock(PlatformTransactionManager.class);
    TransactionStatus txStatus = new SimpleTransactionStatus();
    when(txManager.getTransaction(any(TransactionDefinition.class))).thenReturn(txStatus);

    // 동기 executor — submit 한 Runnable 을 호출 스레드에서 즉시 실행.
    service =
        new DriveOverviewService(
            search,
            excerpts,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            txManager);
  }

  private AssistantSpec spec() {
    return new AssistantSpec(900L, "claude-opus", "NORMAL", 5, 60_000);
  }

  private DriveContentHit hit(long fileId, String name) {
    return new DriveContentHit(fileId, fileId, 10L, "기획 공간", name, "text/plain", "발췌", 0.9);
  }

  /** 에이전트 델타가 emitter 까지 도달하고 정상 완료된다(동기 펌프). */
  @Test
  void streamOverview_deltasReachEmitter_andCompletes() throws Exception {
    when(search.search(eq(CALLER), eq("매출"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(hit(20L, "보고서.txt")), true));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    when(excerpts.findExtractedText(eq(20L), anyInt())).thenReturn("매출 성장 분석 내용");

    // 목 stream() 이 onDelta 2회 + onDone 1회 발행하도록.
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

    // newEmitter() 를 스파이 SseEmitter 로 오버라이드 — send/complete 호출을 캡처.
    SseEmitter spyEmitter = org.mockito.Mockito.spy(new SseEmitter());
    List<Object> sentData = new ArrayList<>();
    doAnswer(
            inv -> {
              Object arg = inv.getArgument(0);
              if (arg instanceof SseEmitter.SseEventBuilder b) {
                for (var d : b.build()) {
                  sentData.add(d.getData());
                }
              } else {
                sentData.add(arg);
              }
              return null;
            })
        .when(spyEmitter)
        .send(any(SseEmitter.SseEventBuilder.class));

    DriveOverviewService spied =
        new DriveOverviewService(
            search,
            excerpts,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            txManager) {
          @Override
          protected SseEmitter newEmitter() {
            return spyEmitter;
          }
        };

    spied.streamOverview(CALLER, "매출", null);

    // delta 2개 + done 1개가 emitter.send 로 흘렀고, 정상 complete 됐는지.
    String joined = sentData.stream().map(String::valueOf).reduce("", (a, b) -> a + b);
    assertThat(joined).contains("매출 ").contains("분석");
    verify(spyEmitter).complete();
  }

  /** 발췌 텍스트가 없는(blank) 파일은 발췌 목록에서 걸러진다. */
  @Test
  void streamOverview_blankExcerpt_isFiltered() throws Exception {
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

    service.streamOverview(CALLER, "쿼리", null);

    // 에이전트에 전달된 AgentBody 에서 발췌 목록을 검증.
    var bodyCaptor = org.mockito.ArgumentCaptor.forClass(Object.class);
    verify(agent).stream(bodyCaptor.capture(), any(), any());
    DriveOverviewService.AgentBody body = (DriveOverviewService.AgentBody) bodyCaptor.getValue();
    // 빈 발췌 파일A 는 제외, 파일B 만 남아야 한다.
    assertThat(body.excerpts()).hasSize(1);
    assertThat(body.excerpts().get(0).name()).isEqualTo("파일B.txt");
  }

  /** 검색 결과가 없으면 발췌 없는 빈 목록으로 에이전트를 호출한다(Overview = "관련 파일 없음" 처리). */
  @Test
  void streamOverview_noHits_callsAgentWithEmptyExcerpts() throws Exception {
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

    SseEmitter emitter = service.streamOverview(CALLER, "없는쿼리", null);

    assertThat(emitter).isNotNull();
    var bodyCaptor = org.mockito.ArgumentCaptor.forClass(Object.class);
    verify(agent).stream(bodyCaptor.capture(), any(), any());
    DriveOverviewService.AgentBody body = (DriveOverviewService.AgentBody) bodyCaptor.getValue();
    assertThat(body.excerpts()).isEmpty();
    assertThat(body.query()).isEqualTo("없는쿼리");
    assertThat(body.assistantAgentId()).isEqualTo(900L);
  }

  /** 에이전트 스트림이 예외를 던지면 emitter.completeWithError 가 호출된다. */
  @Test
  void streamOverview_agentError_completesWithError() throws Exception {
    when(search.search(eq(CALLER), eq("오류"), eq(5), isNull()))
        .thenReturn(new DriveContentSearchResponse(List.of(), false));
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());
    doAnswer(
        inv -> {
          throw new RuntimeException("ai-agent stream error");
        })
        .when(agent)
        .stream(any(), any(), any());

    SseEmitter spyEmitter = org.mockito.Mockito.spy(new SseEmitter());

    DriveOverviewService spied =
        new DriveOverviewService(
            search,
            excerpts,
            assistantResolver,
            agent,
            new TaskExecutorAdapter(Runnable::run),
            txManager) {
          @Override
          protected SseEmitter newEmitter() {
            return spyEmitter;
          }
        };

    spied.streamOverview(CALLER, "오류", null);

    verify(spyEmitter).completeWithError(any(RuntimeException.class));
  }

  /** spaceId 가 지정되면 그대로 콘텐츠 검색으로 전달되어야 한다(Overview 근거도 공간 스코프로 제한). */
  @Test
  void streamOverview_withSpaceId_passesThroughToSearch() throws Exception {
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

    service.streamOverview(CALLER, "예산", 42L);

    verify(search).search(eq(CALLER), eq("예산"), eq(5), eq(42L));
  }
}

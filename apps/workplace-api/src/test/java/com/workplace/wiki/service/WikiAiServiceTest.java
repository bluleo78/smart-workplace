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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.task.support.TaskExecutorAdapter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * WikiAiService 단위 테스트. 의존성을 목으로, executor 는 동기(TaskExecutorAdapter(Runnable::run))로 주입해 펌프가 인라인
 * 실행되게 한다 — 슬립/래치 없이 결정적으로 검증.
 */
class WikiAiServiceTest {

  private WikiPageRepository pages;
  private WikiPermissions perms;
  private AssistantResolver assistantResolver;
  private WikiAiAgentStreamClient agent;
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
    // 동기 executor — submit 한 Runnable 을 호출 스레드에서 즉시 실행.
    service =
        new WikiAiService(
            pages, perms, assistantResolver, agent, new TaskExecutorAdapter(Runnable::run));
  }

  private WikiPageDetail page() {
    return new WikiPageDetail(
        PAGE_ID, SPACE_ID, null, "설계 문서", "## 본문\n내용", 3, CALLER, OffsetDateTime.now());
  }

  private AssistantSpec spec() {
    return new AssistantSpec(900L, "claude-opus", "NORMAL", 5, 60_000);
  }

  /** EDITOR 권한이 강제된다 — 역할 미달(VIEWER)이면 streamCompose 가 throw, 에이전트 호출 없음. */
  @Test
  void streamCompose_nonEditor_throwsAndDoesNotCallAgent() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    doThrow(new WikiForbiddenException(SPACE_ID, CALLER))
        .when(perms)
        .requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"));

    assertThatThrownBy(() -> service.streamCompose(CALLER, PAGE_ID, summarize()))
        .isInstanceOf(WikiForbiddenException.class);

    verify(agent, never()).stream(any(), any(), any());
    verify(assistantResolver, never()).resolve(anyLong());
  }

  /** EDITOR 통과 시 페이지 제목·본문·액션이 에이전트 요청 본문(AgentBody)에 실린다. */
  @Test
  void streamCompose_passesPageContextIntoAgentBody() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    ArgumentCaptor<Object> bodyCaptor = ArgumentCaptor.forClass(Object.class);
    // 동기 실행이므로 streamCompose 반환 시점에 이미 stream() 이 호출돼 있다.
    service.streamCompose(CALLER, PAGE_ID, summarize());

    verify(agent).stream(bodyCaptor.capture(), any(), any());
    WikiAiService.AgentBody body = (WikiAiService.AgentBody) bodyCaptor.getValue();
    assertThat(body.pageTitle()).isEqualTo("설계 문서");
    assertThat(body.pageBody()).isEqualTo("## 본문\n내용");
    assertThat(body.action()).isEqualTo(WikiAiAction.SUMMARIZE);
    assertThat(body.assistantAgentId()).isEqualTo(900L);
    assertThat(body.model()).isEqualTo("claude-opus");
  }

  /** 에이전트 델타가 emitter 까지 도달하고 정상 완료된다(동기 펌프). */
  @Test
  void streamCompose_deltasReachEmitter_andCompletes() throws Exception {
    when(pages.findDetail(PAGE_ID)).thenReturn(Optional.of(page()));
    when(perms.requireRole(eq(SPACE_ID), eq(CALLER), eq("EDITOR"))).thenReturn("EDITOR");
    when(assistantResolver.resolve(CALLER)).thenReturn(spec());

    // 목 stream() 이 onDelta 2회 + onDone 1회 발행하도록.
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

    // newEmitter() 를 스파이 SseEmitter 로 오버라이드 — send/complete 호출을 캡처.
    SseEmitter spyEmitter = org.mockito.Mockito.spy(new SseEmitter());
    List<Object> sentData = new ArrayList<>();
    doAnswer(
            inv -> {
              // SseEventBuilder 의 data 본문에서 텍스트 페이로드를 추출.
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

    WikiAiService spied =
        new WikiAiService(
            pages, perms, assistantResolver, agent, new TaskExecutorAdapter(Runnable::run)) {
          @Override
          protected SseEmitter newEmitter() {
            return spyEmitter;
          }
        };

    spied.streamCompose(CALLER, PAGE_ID, summarize());

    // delta 2개 + done 1개가 emitter.send 로 흘렀고, 정상 complete 됐는지.
    String joined = sentData.stream().map(String::valueOf).reduce("", (a, b) -> a + b);
    assertThat(joined).contains("요약: ").contains("핵심");
    verify(spyEmitter).complete();
  }

  private WikiAiRequest summarize() {
    return new WikiAiRequest(WikiAiAction.SUMMARIZE, null, null);
  }
}

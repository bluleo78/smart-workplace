package com.workplace.wiki.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.io.InterruptedIOException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 인에디터 /ai 스트리밍(#593 편입). EDITOR 권한 확인 → 페이지 본문 컨텍스트 로드 → AssistantResolver 로 비서 해석 →
 * StreamingGenerationRegistry 로 전용 executor 스레드에 펌프를 제출하고, 결과를 SseRegistry.fanOut 으로 통합 /events
 * 채널(wiki.ai.delta/done/error)에 전달한다.
 *
 * <p>권한·비서 해석은 시작 요청 <b>동기</b> 처리 — 실패하면 GlobalExceptionHandler 가 일반 4xx 로 매핑한다(깨진 스트림 X).
 */
@Service
public class WikiAiService {

  private static final Logger log = LoggerFactory.getLogger(WikiAiService.class);

  /** 생성 타임아웃 — 펌프 렌더링 + CLI cold-start(최대 ~60s) 여유. */
  private static final Duration TIMEOUT = Duration.ofSeconds(120);

  private final WikiPageRepository pages;
  private final WikiPermissions perms;
  private final AssistantResolver assistantResolver;
  private final WikiAiAgentStreamClient agent;
  private final AsyncTaskExecutor executor;
  private final StreamingGenerationRegistry registry;
  private final SseRegistry sseRegistry;
  private final WikiPageService pageService;

  public WikiAiService(
      WikiPageRepository pages,
      WikiPermissions perms,
      AssistantResolver assistantResolver,
      WikiAiAgentStreamClient agent,
      @Qualifier("wikiAiStreamExecutor") AsyncTaskExecutor executor,
      StreamingGenerationRegistry registry,
      SseRegistry sseRegistry,
      WikiPageService pageService) {
    this.pages = pages;
    this.perms = perms;
    this.assistantResolver = assistantResolver;
    this.agent = agent;
    this.executor = executor;
    this.registry = registry;
    this.sseRegistry = sseRegistry;
    this.pageService = pageService;
  }

  /**
   * EDITOR 권한·컨텍스트·비서를 동기 해석한 뒤, 펌프를 레지스트리에 등록하고 correlationId 를 즉시 반환한다.
   *
   * <p>{@code @Transactional} 필수(#654) — RLS 정책의 {@code app.tenant_id} GUC 는 트랜잭션 시작 시점(AOP doBegin
   * 훅)에 주입되므로, 어노테이션이 없으면 {@link #pages}.findDetail() 이 GUC 미설정 커넥션으로 실행돼 RLS 가 모든 행을 비가시 처리 → 항상
   * 404 가 된다. 쓰기는 없으므로 readOnly.
   */
  @Transactional(readOnly = true)
  public String startCompose(long callerId, long pageId, WikiAiRequest req) {
    // 1) 페이지 로드(존재 은닉 위해 NotFound).
    WikiPageDetail page =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    // 2) EDITOR 권한 강제(VIEWER 거부). 멤버 아니면 NotFound, 역할 미달이면 Forbidden — 모두 시작 전 동기 throw.
    perms.requireRole(page.spaceId(), callerId, "EDITOR");
    // 3) 비서 해석(미설정이면 HomeAssistantNotConfiguredException → 일반 4xx).
    AssistantSpec spec = assistantResolver.resolve(callerId);

    AgentBody body =
        new AgentBody(
            req.action(),
            page.title(),
            page.body() == null ? "" : page.body(),
            req.selection(),
            req.prompt(),
            spec.agentUserId(),
            spec.model(),
            spec.thinkingDepth(),
            spec.maxTurns(),
            spec.timeoutMs());

    // 4) 펌프를 레지스트리에 등록 — correlationId 는 클로저로 각 이벤트 payload 에 실린다.
    return registry.start(
        callerId,
        executor,
        TIMEOUT,
        correlationId ->
            () -> {
              // #736: 델타가 한 번이라도 전달됐으면(부분 텍스트가 이미 에디터에 삽입·자동저장 예정) 정상
              // 완료/취소/에러 어느 경로로 끝나든 attribution 을 기록한다 — "정상 종료만 기록"하면 취소·
              // 타임아웃으로 끝난 스트림도 실제로는 AI 텍스트가 남는데 신호가 빠지는 false negative 가 생긴다.
              AtomicBoolean delivered = new AtomicBoolean(false);
              try {
                agent.stream(
                    body,
                    text -> {
                      delivered.set(true);
                      sseRegistry.fanOut(
                          Set.of(callerId),
                          "wiki.ai.delta",
                          Map.of("correlationId", correlationId, "text", text));
                    },
                    () -> {
                      if (delivered.get()) {
                        recordAiUsageSafely(pageId, req.action());
                      }
                      sseRegistry.fanOut(
                          Set.of(callerId), "wiki.ai.done", Map.of("correlationId", correlationId));
                    });
              } catch (Exception e) {
                if (delivered.get()) {
                  recordAiUsageSafely(pageId, req.action());
                }
                // 취소(Future.cancel(true))가 펌프 스레드를 인터럽트할 때, 블로킹 중이던 JDK HttpClient 의
                // ofLines() read 는 isInterrupted() 로 조용히 리턴하지 않고 InterruptedException 이 감싸인
                // 예외(UncheckedIOException/InterruptedIOException 등)를 던진다 — catch 진입 시점엔 이미
                // 인터럽트 플래그도 소비돼 있어 Thread.currentThread().isInterrupted() 로는 취소 여부를 판별할
                // 수 없다. 원인 체인을 순회해 InterruptedException/InterruptedIOException 을 찾아 구분한다.
                boolean cancelled = isInterruption(e);
                Map<String, Object> payload =
                    cancelled
                        ? Map.of("correlationId", correlationId, "cancelled", true)
                        : Map.of("correlationId", correlationId, "message", e.getMessage());
                sseRegistry.fanOut(Set.of(callerId), "wiki.ai.error", payload);
              }
            });
  }

  /**
   * attribution 은 부가 신호일 뿐이라 실패해도 스트림 완료/에러 이벤트를 막지 않는다(§3 실패 격리) — 예외를 삼키고 경고 로그만 남긴다. {@code
   * pageService.recordAiUsage} 는 외부 빈(WikiPageService) 호출이라 {@code @Transactional} 프록시가 정상
   * 적용되고(자기호출 아님), 실행 스레드는 wikiAiStreamExecutor 의 TenantContextTaskDecorator 가 이미 tenant 를 복원해둔 상태라
   * RLS GUC 도 정상 주입된다.
   */
  private void recordAiUsageSafely(long pageId, WikiAiAction action) {
    try {
      pageService.recordAiUsage(pageId, action);
    } catch (Exception e) {
      log.warn("wiki AI attribution 기록 실패(pageId={}, action={})", pageId, action, e);
    }
  }

  /** 진행 중인 생성을 취소한다. 소유자 불일치/미존재면 레지스트리가 403/404 예외를 던진다. */
  public void cancelCompose(String correlationId, long callerId) {
    registry.cancel(correlationId, callerId);
  }

  /**
   * 예외 체인(cause chain)을 순회해 InterruptedException/InterruptedIOException 이 있는지 검사한다. 취소
   * (Future.cancel(true)) 로 인한 인터럽트가 JDK HttpClient 블로킹 read 를 통과할 때 여러 겹으로 감싸질 수 있어(예:
   * UncheckedIOException(IOException(InterruptedException))), 최상위 타입만 보면 취소를 놓친다.
   */
  private static boolean isInterruption(Throwable e) {
    for (Throwable cur = e; cur != null; cur = cur.getCause()) {
      if (cur instanceof InterruptedException || cur instanceof InterruptedIOException) {
        return true;
      }
    }
    return false;
  }

  /**
   * ai-agent /wiki/compose 요청 본문. 와이어 계약(zod) 과 1:1.
   *
   * <ul>
   *   <li>action 은 {@link WikiAiAction} 의 소문자 @JsonValue 로 직렬화된다.
   *   <li>selection/prompt 가 null 이면 필드를 생략한다 — zod {@code .optional()} 은 null 이 아닌 undefined 만 허용.
   * </ul>
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  record AgentBody(
      WikiAiAction action,
      String pageTitle,
      String pageBody,
      String selection,
      String prompt,
      long assistantAgentId,
      String model,
      String thinkingDepth,
      int maxTurns,
      int timeoutMs) {}
}

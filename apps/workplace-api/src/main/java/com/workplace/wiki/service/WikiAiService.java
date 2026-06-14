package com.workplace.wiki.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiAiRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.Future;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 인에디터 /ai 스트리밍 (S3 B4). EDITOR 권한 확인 → 페이지 본문 컨텍스트 로드 → AssistantResolver 로 비서 해석 → 전용 executor
 * 스레드에서 ai-agent SSE 를 {@link SseEmitter} 로 패스스루한다.
 *
 * <p>권한·비서 해석은 스트림 시작 <b>전</b> 동기 실행 — 실패하면 GlobalExceptionHandler 가 일반 4xx 로 매핑한다(깨진 스트림 X).
 */
@Service
public class WikiAiService {

  /** SSE 타임아웃 — 펌프 펜더링 + CLI cold-start(최대 ~60s) 여유. */
  private static final long TIMEOUT_MS = 120_000L;

  private final WikiPageRepository pages;
  private final WikiPermissions perms;
  private final AssistantResolver assistantResolver;
  private final WikiAiAgentStreamClient agent;
  private final AsyncTaskExecutor executor;

  public WikiAiService(
      WikiPageRepository pages,
      WikiPermissions perms,
      AssistantResolver assistantResolver,
      WikiAiAgentStreamClient agent,
      @Qualifier("wikiAiStreamExecutor") AsyncTaskExecutor executor) {
    this.pages = pages;
    this.perms = perms;
    this.assistantResolver = assistantResolver;
    this.agent = agent;
    this.executor = executor;
  }

  /** EDITOR 권한·컨텍스트·비서를 동기 해석한 뒤, 펌프를 전용 스레드에 제출하고 emitter 를 반환한다. */
  public SseEmitter streamCompose(long callerId, long pageId, WikiAiRequest req) {
    // 1) 페이지 로드(존재 은닉 위해 NotFound).
    WikiPageDetail page =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    // 2) EDITOR 권한 강제(VIEWER 거부). 멤버 아니면 NotFound, 역할 미달이면 Forbidden — 모두 스트림 전 동기 throw.
    perms.requireRole(page.spaceId(), callerId, "EDITOR");
    // 3) 비서 해석(미설정이면 HomeAssistantNotConfiguredException → 일반 4xx).
    AssistantSpec spec = assistantResolver.resolve(callerId);

    SseEmitter emitter = newEmitter();

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

    // 4) 펌프를 전용 executor 에 제출(펌프가 호출 스레드를 점유하지 않게).
    Future<?> task =
        executor.submit(
            () -> {
              try {
                agent.stream(
                    body,
                    text -> {
                      try {
                        emitter.send(SseEmitter.event().name("delta").data(Map.of("text", text)));
                      } catch (IOException io) {
                        // 클라 연결 끊김 — 펌프 루프를 깨 위로 전파한다.
                        throw new RuntimeException(io);
                      }
                    },
                    () -> {
                      try {
                        emitter.send(SseEmitter.event().name("done").data(Map.of()));
                      } catch (IOException ignored) {
                        // done 송신 실패는 무시(이미 끊긴 연결).
                      }
                    });
                emitter.complete();
              } catch (Exception e) {
                emitter.completeWithError(e);
              }
            });

    // 5) emitter 생명주기 → 펌프 취소(자원 누수 방지).
    emitter.onTimeout(() -> task.cancel(true));
    emitter.onError(e -> task.cancel(true));
    emitter.onCompletion(() -> task.cancel(false));

    return emitter;
  }

  /** SseEmitter 생성 — 테스트에서 스파이/목으로 send 호출을 캡처할 수 있도록 분리. */
  protected SseEmitter newEmitter() {
    return new SseEmitter(TIMEOUT_MS);
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

package com.workplace.drive.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.drive.outbound.DriveOverviewStreamClient;
import com.workplace.drive.repository.DriveExcerptRepository;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.realtime.StreamingGenerationRegistry;
import java.io.InterruptedIOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Drive 콘텐츠 검색 상위 결과를 근거로 인용 AI Overview 를 통합 /events 채널로 스트리밍한다(#593 편입, WikiAiService 미러).
 *
 * <p>검색·발췌 확보·비서 해석은 시작 요청 <b>동기</b> 처리 — 실패하면 GlobalExceptionHandler 가 일반 4xx 로 매핑한다(깨진 스트림 X).
 */
@Service
public class DriveOverviewService {

  /** 생성 타임아웃 — 펌프 렌더링 + CLI cold-start(최대 ~120s) 여유. */
  private static final Duration TIMEOUT = Duration.ofSeconds(120);

  /** Overview 근거 파일 수 — 검색 상위 N건만 발췌에 사용. */
  private static final int TOP_N = 5;

  /** 파일당 발췌 최대 문자 수. */
  private static final int EXCERPT_CHARS = 2000;

  private final DriveContentSearchService search;
  private final DriveExcerptRepository excerpts;
  private final AssistantResolver assistantResolver;
  private final DriveOverviewStreamClient agent;
  private final AsyncTaskExecutor executor;
  private final StreamingGenerationRegistry registry;
  private final SseRegistry sseRegistry;

  /**
   * 발췌 조회를 트랜잭션으로 감싸 RLS GUC 를 주입하기 위한 읽기전용 TransactionTemplate.
   *
   * <p>비-tx bare read 는 GUC 미주입 → RLS fail-closed → null 발췌 → Overview "파일
   * 없음"(mail-summary-rls-444·#492 패턴).
   */
  private final TransactionTemplate txTemplate;

  public DriveOverviewService(
      DriveContentSearchService search,
      DriveExcerptRepository excerpts,
      AssistantResolver assistantResolver,
      DriveOverviewStreamClient agent,
      @Qualifier("driveOverviewStreamExecutor") AsyncTaskExecutor executor,
      PlatformTransactionManager txManager,
      StreamingGenerationRegistry registry,
      SseRegistry sseRegistry) {
    this.search = search;
    this.excerpts = excerpts;
    this.assistantResolver = assistantResolver;
    this.agent = agent;
    this.executor = executor;
    this.txTemplate = new TransactionTemplate(txManager);
    this.txTemplate.setReadOnly(true);
    this.registry = registry;
    this.sseRegistry = sseRegistry;
  }

  /**
   * 검색 상위 N 발췌 + 비서 해석을 동기 수행한 뒤, 펌프를 레지스트리에 등록하고 correlationId 를 즉시 반환한다.
   *
   * @param callerId 호출자 userId (JWT principal)
   * @param q 검색 쿼리
   * @param spaceId null 이면 테넌트 전역, 값이 있으면 해당 공간 파일로 근거를 제한(콘텐츠 검색과 스코프 일관성 유지)
   */
  public String startOverview(long callerId, String q, Long spaceId) {
    // 1) 콘텐츠 검색 — 이미 RLS·멤버십 필터됨, 추가 권한 검증 불필요.
    var res = search.search(callerId, q, TOP_N, spaceId);
    // 2) 비서 해석(미설정이면 HomeAssistantNotConfiguredException → 일반 4xx).
    AssistantSpec spec = assistantResolver.resolve(callerId);

    // 3) 발췌 조회는 읽기전용 트랜잭션 안에서 — GUC(app.tenant_id) 가 주입되어야 RLS 가 자기 행을 보여줌.
    List<Excerpt> ex =
        txTemplate.execute(
            status ->
                res.hits().stream()
                    .map(
                        h ->
                            new Excerpt(
                                h.name(), excerpts.findExtractedText(h.fileId(), EXCERPT_CHARS)))
                    .filter(e -> e.text() != null && !e.text().isBlank())
                    .toList());

    AgentBody body =
        new AgentBody(q, ex, spec.agentUserId(), spec.model(), spec.maxTurns(), spec.timeoutMs());

    // 4) 펌프를 레지스트리에 등록 — correlationId 는 클로저로 각 이벤트 payload 에 실린다.
    return registry.start(
        callerId,
        executor,
        TIMEOUT,
        correlationId ->
            () -> {
              try {
                agent.stream(
                    body,
                    text ->
                        sseRegistry.fanOut(
                            Set.of(callerId),
                            "drive.overview.delta",
                            Map.of("correlationId", correlationId, "text", text)),
                    () ->
                        sseRegistry.fanOut(
                            Set.of(callerId),
                            "drive.overview.done",
                            Map.of("correlationId", correlationId)));
              } catch (Exception e) {
                // 취소(Future.cancel(true))가 펌프 스레드를 인터럽트할 때, 블로킹 중이던 JDK HttpClient 의
                // ofLines() read 는 InterruptedException 이 감싸인 예외를 던진다(WikiAiService 동일 패턴) —
                // 원인 체인을 순회해 취소와 실제 오류를 구분한다.
                boolean cancelled = isInterruption(e);
                Map<String, Object> payload =
                    cancelled
                        ? Map.of("correlationId", correlationId, "cancelled", true)
                        : Map.of("correlationId", correlationId, "message", e.getMessage());
                sseRegistry.fanOut(Set.of(callerId), "drive.overview.error", payload);
              }
            });
  }

  /** 진행 중인 생성을 취소한다. 소유자 불일치/미존재면 레지스트리가 403/404 예외를 던진다. */
  public void cancelOverview(String correlationId, long callerId) {
    registry.cancel(correlationId, callerId);
  }

  /**
   * 예외 체인(cause chain)을 순회해 InterruptedException/InterruptedIOException 이 있는지 검사한다(WikiAiService 와
   * 동일한 헬퍼 — 클래스마다 static private 로 중복 — 기존 인터럽트-체크 블록 중복 컨벤션과 일관).
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
   * ai-agent /drive/overview 요청 본문. zod 계약과 1:1.
   *
   * <p>null 필드는 직렬화에서 생략한다 — zod {@code .optional()} 은 undefined 만 허용.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  record AgentBody(
      String query,
      List<Excerpt> excerpts,
      long assistantAgentId,
      String model,
      int maxTurns,
      int timeoutMs) {}

  /** 발췌 1건(파일명 + 텍스트). */
  record Excerpt(String name, String text) {}
}

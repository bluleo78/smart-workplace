package com.workplace.drive.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.drive.outbound.DriveOverviewStreamClient;
import com.workplace.drive.repository.DriveExcerptRepository;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Future;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Drive 콘텐츠 검색 상위 결과를 근거로 인용 AI Overview 를 SSE 스트리밍한다(WikiAiService 미러).
 *
 * <p>검색·발췌 확보·비서 해석은 스트림 시작 <b>전</b> 동기 실행 — 실패하면 GlobalExceptionHandler 가 일반 4xx 로 매핑한다(깨진 스트림 X).
 */
@Service
public class DriveOverviewService {

  /** SSE 타임아웃 — 펌프 펜더링 + CLI cold-start(최대 ~120s) 여유. */
  private static final long TIMEOUT_MS = 120_000L;

  /** Overview 근거 파일 수 — 검색 상위 N건만 발췌에 사용. */
  private static final int TOP_N = 5;

  /** 파일당 발췌 최대 문자 수. */
  private static final int EXCERPT_CHARS = 2000;

  private final DriveContentSearchService search;
  private final DriveExcerptRepository excerpts;
  private final AssistantResolver assistantResolver;
  private final DriveOverviewStreamClient agent;
  private final AsyncTaskExecutor executor;

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
      PlatformTransactionManager txManager) {
    this.search = search;
    this.excerpts = excerpts;
    this.assistantResolver = assistantResolver;
    this.agent = agent;
    this.executor = executor;
    this.txTemplate = new TransactionTemplate(txManager);
    this.txTemplate.setReadOnly(true);
  }

  /**
   * 검색 상위 N 발췌 + 비서 해석을 동기 수행 후 SSE 펌프를 전용 스레드에 제출.
   *
   * @param callerId 호출자 userId (JWT principal)
   * @param q 검색 쿼리
   */
  public SseEmitter streamOverview(long callerId, String q) {
    // 1) 콘텐츠 검색 — 이미 RLS·멤버십 필터됨, 추가 권한 검증 불필요.
    var res = search.search(callerId, q, TOP_N);
    // 2) 비서 해석(미설정이면 HomeAssistantNotConfiguredException → 일반 4xx).
    AssistantSpec spec = assistantResolver.resolve(callerId);

    // 3) 발췌 조회는 읽기전용 트랜잭션 안에서 — GUC(app.tenant_id) 가 주입되어야 RLS 가 자기 행을 보여줌.
    //    컨트롤러 스레드에 이미 TenantContext 가 있으므로 TenantAwareTransactionManager.doBegin 이 GUC 를 주입한다.
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

    SseEmitter emitter = newEmitter();
    AgentBody body =
        new AgentBody(q, ex, spec.agentUserId(), spec.model(), spec.maxTurns(), spec.timeoutMs());

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

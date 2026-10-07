package com.workplace.wiki.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummaryState;
import com.workplace.wiki.dto.WikiSummaryStatus;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.exception.WikiSummaryFailedException;
import com.workplace.wiki.outbound.WikiAiAgentSummaryClient;
import com.workplace.wiki.repository.WikiPageRepository;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 상단 AI 요약(WP-301). 본문을 바꾸지 않는 읽기 보조라 VIEWER 이상이면 조회·생성할 수 있다.
 *
 * <p>트랜잭션 경계: RLS 의 {@code app.tenant_id} GUC 는 트랜잭션 시작 시 주입되므로(#654) DB 접근은 반드시 트랜잭션 안에서 한다. 다만
 * ai-agent 호출(수십 초)을 트랜잭션 안에 두면 커넥션을 오래 쥐므로, generate 는 TransactionTemplate 으로 "상태·본문 읽기 → (트랜잭션 밖)
 * AI 호출 → 저장" 세 단계로 나눈다.
 */
@Service
public class WikiSummaryService {

  /** 이 길이 이하의 본문은 요약하지 않는다(카드 비노출) — 메일 EMPTY 와 같은 취지. */
  static final int MIN_BODY_CHARS = 400;

  /**
   * ai-agent 로 보내는 본문 상한(글자). 아주 긴 노트가 토큰·비용을 폭주시키지 않도록 앞부분만 보낸다 — fileai {@code
   * ExtractedTextService.MAX_LIMIT}(32,000) 와 같은 값을 쓴다(모듈 의존을 피하려 상수를 따로 둔다).
   */
  static final int MAX_INPUT_CHARS = 32_000;

  /** 도구 없는 단발 요약이라 1턴이면 충분하다 — fileai {@code FileExtractionPipeline.MAX_TURNS} 와 같은 취지. */
  static final int MAX_TURNS = 1;

  private final WikiPageRepository pages;
  private final WikiPermissions perms;
  private final AssistantResolver assistantResolver;
  private final WikiAiAgentSummaryClient agent;
  private final TransactionTemplate readTx;
  private final TransactionTemplate writeTx;

  /** 노트별 진행 중 생성 — 같은 JVM 의 동시 POST 가 ai-agent 를 한 번만 부르게 한다(generate 참고). */
  private final ConcurrentHashMap<Long, CompletableFuture<WikiPageSummaryState>> inFlight =
      new ConcurrentHashMap<>();

  public WikiSummaryService(
      WikiPageRepository pages,
      WikiPermissions perms,
      AssistantResolver assistantResolver,
      WikiAiAgentSummaryClient agent,
      PlatformTransactionManager txManager) {
    this.pages = pages;
    this.perms = perms;
    this.assistantResolver = assistantResolver;
    this.agent = agent;
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
    this.writeTx = new TransactionTemplate(txManager);
  }

  /** 현재 요약 상태를 계산한다. 비멤버는 NotFound(존재 은닉). */
  public WikiPageSummaryState get(long callerId, long pageId) {
    // 공용 비서 조회도 DB(RLS) 접근이라 같은 읽기 트랜잭션 안에서, 권한 확인 뒤에 한다(evaluate 가 필요할 때만 조회).
    return readTx.execute(st -> evaluate(loadStateForViewer(callerId, pageId)).state());
  }

  /**
   * 요약을 생성·저장하고 갱신된 상태를 돌려준다. 다음 경우엔 AI 를 부르지 않고 현재 상태만 반환한다 — 본문이 짧음(TOO_SHORT), 공용 비서 없음
   * (UNAVAILABLE), 이미 현재 버전 요약이 있음(READY, 중복 POST·연타 비용 방지). 낡은 요약(STALE)인데 공용 비서가 없으면 새로 만들 수 없으므로
   * 실패로 알린다 — "다시 요약"이 아무 변화 없이 끝나지 않게 웹의 실패 UI 를 띄우기 위함이다.
   *
   * <p>같은 노트에 대한 동시 생성 요청은 JVM 안에서 하나로 합친다(in-flight coalescing) — 먼저 온 요청(리더)만 상태를 읽고 ai-agent 를
   * 부르며, 나머지는 그 결과(또는 예외)를 공유한다. 권한 확인은 합류 전에 호출자마다 각자 한다. 여러 레플리카 사이의 중복 호출은 여전히 가능하지만, 저장은 {@code
   * saveSummaryIfNotOlder} 조건부 갱신이라 결과 정합성은 지켜진다.
   */
  public WikiPageSummaryState generate(long callerId, long pageId) {
    // 1) 권한 확인 — 진행 중 생성에 합류하기 전에 해야 비멤버가 남의 요약 결과를 받지 않는다(비멤버엔 존재도 숨김).
    readTx.executeWithoutResult(st -> loadStateForViewer(callerId, pageId));
    // 2) 같은 노트의 진행 중 생성이 있으면 그 결과를 함께 기다린다.
    CompletableFuture<WikiPageSummaryState> mine = new CompletableFuture<>();
    CompletableFuture<WikiPageSummaryState> running = inFlight.putIfAbsent(pageId, mine);
    if (running != null) {
      return await(running);
    }
    try {
      // 3) 리더만 상태를 읽는다 — 직전 리더가 막 저장을 끝냈다면 READY 라 다시 부르지 않는다.
      WikiPageSummaryState result = generateAsLeader(pageId);
      mine.complete(result);
      return result;
    } catch (RuntimeException e) {
      mine.completeExceptionally(e);
      throw e;
    } finally {
      inFlight.remove(pageId, mine);
    }
  }

  /**
   * 리더의 생성 — 같은 읽기 트랜잭션에서 상태를 계산하고, 생성 대상(MISSING/STALE)일 때만 본문과 공용 비서를 확정한 뒤 트랜잭션 밖에서 요약한다. 요약은 이
   * 노트를 보는 모든 사람이 공유하므로 호출자 개인 비서(임의 엔드포인트일 수 있음)가 아닌 공용 비서로만 만든다.
   */
  private WikiPageSummaryState generateAsLeader(long pageId) {
    Target target =
        readTx.execute(
            st -> {
              Evaluated e =
                  evaluate(
                      pages
                          .findSummaryState(pageId)
                          .orElseThrow(() -> new WikiPageNotFoundException(pageId)));
              WikiSummaryStatus status = e.state().status();
              if (!status.needsGeneration()) {
                return new Target(e.state(), null, Optional.empty());
              }
              WikiPageDetail page =
                  pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
              // MISSING 은 evaluate 가 이미 비서를 조회했으므로 재사용하고, STALE 일 때만 여기서 조회한다.
              Optional<AssistantSpec> assistant =
                  status == WikiSummaryStatus.MISSING
                      ? e.assistant()
                      : assistantResolver.resolveWorkspaceOrEmpty();
              return new Target(e.state(), page, assistant);
            });
    return target.page() == null
        ? target.state()
        : summarizeAndSave(pageId, target.page(), target.assistant());
  }

  /** 트랜잭션 밖에서 ai-agent 를 불러 요약을 만들고 조건부로 저장한 뒤 최신 상태를 돌려준다. */
  private WikiPageSummaryState summarizeAndSave(
      long pageId, WikiPageDetail page, Optional<AssistantSpec> assistant) {
    // MISSING 이면 evaluate 가 이미 UNAVAILABLE 로 바꿨으므로 비서가 없는 건 STALE 뿐 — 옛 요약은 있지만 새로 만들 수 없다.
    AssistantSpec spec =
        assistant.orElseThrow(
            () -> new WikiSummaryFailedException("공용 AI 비서가 없어 요약을 새로 만들 수 없습니다.", null));
    // 트랜잭션 밖 AI 호출 — 본문은 상한까지만 보낸다.
    WikiAiAgentSummaryClient.Res res =
        agent.summarize(
            new WikiAiAgentSummaryClient.Req(
                page.title(),
                capInput(page.body()),
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));
    // 응답이 없거나 공백뿐이면 실패 — 빈 카드를 저장하지 않는다.
    String summary =
        Optional.ofNullable(res)
            .map(WikiAiAgentSummaryClient.Res::summary)
            .map(String::strip)
            .filter(s -> !s.isEmpty())
            .orElseThrow(() -> new WikiSummaryFailedException("AI 가 빈 요약을 돌려줬습니다.", null));
    // 저장 — 오래된 결과가 새 요약을 덮지 않도록 조건부 갱신. 갱신됐으면 RETURNING 으로 받은 최신 행(AI 호출 중 바뀐 버전·본문 길이 포함)으로,
    // 더 새 요약이 있어 갱신하지 않았을 때만 다시 읽어 상태를 계산한다. 두 경우 모두 요약이 있어 비서 조회는 일어나지 않는다.
    return writeTx.execute(
        st ->
            pages
                .saveSummaryIfNotOlder(pageId, summary, page.version(), OffsetDateTime.now())
                .or(() -> pages.findSummaryState(pageId))
                .map(row -> evaluate(row).state())
                .orElseThrow(() -> new WikiPageNotFoundException(pageId)));
  }

  /**
   * 본문을 {@link #MAX_INPUT_CHARS} 까지 자른다. 자르는 지점이 서로게이트 쌍(이모지 등) 한가운데면 한 글자 덜 잘라 홀로 남은 high
   * surrogate 가 깨진 문자로 전송되지 않게 한다.
   */
  static String capInput(String body) {
    if (body.length() <= MAX_INPUT_CHARS) {
      return body;
    }
    int end = MAX_INPUT_CHARS;
    if (Character.isHighSurrogate(body.charAt(end - 1))) {
      end--;
    }
    return body.substring(0, end);
  }

  /** 진행 중 생성 결과를 기다린다. 리더의 예외(실패 등)는 원래 타입 그대로 다시 던져 웹이 같은 실패 UI 를 보이게 한다. */
  private static WikiPageSummaryState await(CompletableFuture<WikiPageSummaryState> running) {
    try {
      return running.join();
    } catch (CompletionException e) {
      if (e.getCause() instanceof RuntimeException re) {
        throw re;
      }
      throw new WikiSummaryFailedException("노트 요약 AI 요청에 실패했습니다.", e.getCause());
    }
  }

  /** 요약 상태 행 로드 + VIEWER 권한 확인(본문은 읽지 않는다). */
  private WikiPageRepository.SummaryState loadStateForViewer(long callerId, long pageId) {
    WikiPageRepository.SummaryState row =
        pages.findSummaryState(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(row.spaceId(), callerId, "VIEWER");
    return row;
  }

  /** 상태 계산 결과 — 계산 중 공용 비서를 조회했다면(요약 없음 + 본문 충분) 그 결과도 함께 둬 generate 가 다시 조회하지 않게 한다. */
  private record Evaluated(WikiPageSummaryState state, Optional<AssistantSpec> assistant) {}

  /** 리더가 고정한 생성 대상 — page 가 null 이면 생성 대상이 아니어서 state 를 그대로 돌려준다. */
  private record Target(
      WikiPageSummaryState state, WikiPageDetail page, Optional<AssistantSpec> assistant) {}

  /**
   * 요약 상태 행으로 상태를 계산한다(트랜잭션 안에서 호출).
   *
   * <p>본문이 짧으면(빈 노트 포함) 옛 요약이 남아 있어도 TOO_SHORT 로 보고 summary·버전·시각을 비워 보낸다 — 웹은 summary 가 없으면 카드를
   * 그리지 않으므로 빈 노트에 지난 요약이 떠 있지 않는다.
   *
   * <p>공용 비서는 요약이 없고 본문이 충분히 길 때만 조회해 MISSING(자동 생성 대상)과 UNAVAILABLE 을 가른다 — 노트를 열 때마다 호출되는 GET 에서
   * 요약이 이미 있으면 비서 조회 비용을 아낀다.
   */
  private Evaluated evaluate(WikiPageRepository.SummaryState row) {
    if (row.bodyLength() <= MIN_BODY_CHARS) {
      return new Evaluated(
          new WikiPageSummaryState(null, WikiSummaryStatus.TOO_SHORT, null, row.version(), null),
          Optional.empty());
    }
    Optional<AssistantSpec> assistant = Optional.empty();
    WikiSummaryStatus status;
    if (row.summary() != null) {
      status =
          row.summaryVersion() != null && row.summaryVersion() >= row.version()
              ? WikiSummaryStatus.READY
              : WikiSummaryStatus.STALE;
    } else {
      assistant = assistantResolver.resolveWorkspaceOrEmpty();
      status = assistant.isPresent() ? WikiSummaryStatus.MISSING : WikiSummaryStatus.UNAVAILABLE;
    }
    return new Evaluated(
        new WikiPageSummaryState(
            row.summary(), status, row.summaryVersion(), row.version(), row.summarizedAt()),
        assistant);
  }
}

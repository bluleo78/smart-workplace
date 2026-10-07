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
import java.util.function.Supplier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 상단 AI 요약(WP-301). 본문을 바꾸지 않는 읽기 보조라 VIEWER 이상이면 조회·생성할 수 있다.
 *
 * <p>트랜잭션 경계: RLS 의 {@code app.tenant_id} GUC 는 트랜잭션 시작 시 주입되므로(#654) DB 접근은 반드시 트랜잭션 안에서 한다. 다만
 * ai-agent 호출(수십 초)을 트랜잭션 안에 두면 커넥션을 오래 쥐므로, generate 는 TransactionTemplate 으로 "스냅샷 읽기 → (트랜잭션 밖)
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
    // 공용 비서 조회도 DB(RLS) 접근이라 같은 읽기 트랜잭션 안에서, 권한 확인 뒤에 한다. 비서 조회는 MISSING/UNAVAILABLE 을 가를 때만
    // 필요하므로 지연 평가한다 — 노트를 열 때마다 호출되는 GET 에서 요약이 이미 있으면 비서 조회 비용을 아낀다.
    return readTx.execute(
        st -> {
          WikiPageDetail page = loadForViewer(callerId, pageId);
          return state(page, memoize(this::workspaceAssistant));
        });
  }

  /**
   * 요약을 생성·저장하고 갱신된 상태를 돌려준다. 다음 경우엔 AI 를 부르지 않고 현재 상태만 반환한다 — 본문이 짧음(TOO_SHORT), 공용 비서 없음
   * (UNAVAILABLE), 이미 현재 버전 요약이 있음(READY, 중복 POST·연타 비용 방지). 낡은 요약(STALE)인데 공용 비서가 없으면 새로 만들 수 없으므로
   * 실패로 알린다 — "다시 요약"이 아무 변화 없이 끝나지 않게 웹의 실패 UI 를 띄우기 위함이다.
   *
   * <p>같은 노트에 대한 동시 생성 요청은 JVM 안에서 하나로 합친다(in-flight coalescing) — 먼저 온 요청만 ai-agent 를 부르고 나머지는 그
   * 결과(또는 예외)를 공유한다. 권한 확인은 호출자마다 각자 한다. 여러 레플리카 사이의 중복 호출은 여전히 가능하지만, 저장은 {@code
   * saveSummaryIfNotOlder} 조건부 갱신이라 결과 정합성은 지켜진다.
   */
  public WikiPageSummaryState generate(long callerId, long pageId) {
    // 1) 권한 확인 + 현재 상태 — 권한 확인을 비서 조회보다 먼저 해 비멤버엔 존재를 숨긴다.
    Snapshot snap = snapshot(callerId, pageId);
    if (!snap.needsGeneration()) {
      return snap.state();
    }
    // 2) 같은 노트의 진행 중 생성이 있으면 그 결과를 함께 기다린다.
    CompletableFuture<WikiPageSummaryState> mine = new CompletableFuture<>();
    CompletableFuture<WikiPageSummaryState> running = inFlight.putIfAbsent(pageId, mine);
    if (running != null) {
      return await(running);
    }
    try {
      // 리더가 된 뒤 상태를 다시 본다 — 직전 리더가 막 저장을 끝냈다면(1단계 스냅샷 이후) 다시 부를 필요가 없다.
      Snapshot fresh = snapshot(callerId, pageId);
      WikiPageSummaryState result =
          fresh.needsGeneration() ? summarizeAndSave(pageId, fresh) : fresh.state();
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
   * 스냅샷 — 권한 확인 + 요약 대상 본문/버전 고정. 요약은 이 노트를 보는 모든 사람이 공유하므로 호출자 개인 비서(임의 엔드포인트일 수 있음)가 아닌 공용 비서로만
   * 만든다. MISSING/STALE 일 때만 비서를 확정한다.
   */
  private Snapshot snapshot(long callerId, long pageId) {
    return readTx.execute(
        st -> {
          WikiPageDetail p = loadForViewer(callerId, pageId);
          Supplier<Optional<AssistantSpec>> assistant = memoize(this::workspaceAssistant);
          WikiPageSummaryState s = state(p, assistant);
          boolean target =
              s.status() == WikiSummaryStatus.MISSING || s.status() == WikiSummaryStatus.STALE;
          return new Snapshot(p, target ? assistant.get() : Optional.empty(), s);
        });
  }

  /** 트랜잭션 밖에서 ai-agent 를 불러 요약을 만들고 조건부로 저장한 뒤 최신 상태를 돌려준다. */
  private WikiPageSummaryState summarizeAndSave(long pageId, Snapshot snap) {
    WikiPageDetail page = snap.page();
    if (snap.assistant().isEmpty()) {
      // MISSING 이면 state() 가 이미 UNAVAILABLE 로 바꿨으므로 여기 오는 건 STALE 뿐 — 옛 요약은 있지만 새로 만들 수 없다.
      throw new WikiSummaryFailedException("공용 AI 비서가 없어 요약을 새로 만들 수 없습니다.", null);
    }
    AssistantSpec spec = snap.assistant().get();
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
    String summary = res == null || res.summary() == null ? "" : res.summary().strip();
    if (summary.isEmpty()) {
      throw new WikiSummaryFailedException("AI 가 빈 요약을 돌려줬습니다.", null);
    }
    // 저장 — 오래된 결과가 새 요약을 덮지 않도록 조건부 갱신. 이후 최신 행으로 상태를 다시 계산한다.
    return writeTx.execute(
        st -> {
          pages.saveSummaryIfNotOlder(pageId, summary, page.version(), OffsetDateTime.now());
          WikiPageDetail latest =
              pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
          return state(latest, () -> Optional.of(spec));
        });
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

  /** 진행 중 생성 결과를 기다린다. 리더의 예외(실패·권한 없음 등)는 원래 타입 그대로 다시 던져 웹이 같은 실패 UI 를 보이게 한다. */
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

  /** 한 번만 평가하는 Supplier — 같은 트랜잭션에서 공용 비서를 두 번 조회하지 않게 한다. */
  private static <T> Supplier<T> memoize(Supplier<T> s) {
    return new Supplier<>() {
      private T value;
      private boolean done;

      @Override
      public T get() {
        if (!done) {
          value = s.get();
          done = true;
        }
        return value;
      }
    };
  }

  /** 페이지 로드 + VIEWER 권한 확인. */
  private WikiPageDetail loadForViewer(long callerId, long pageId) {
    WikiPageDetail page =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(page.spaceId(), callerId, "VIEWER");
    return page;
  }

  /** generate 스냅샷 — 같은 읽기 트랜잭션에서 고정한 페이지·공용 비서(MISSING/STALE 일 때만 확정)·현재 상태. */
  private record Snapshot(
      WikiPageDetail page, Optional<AssistantSpec> assistant, WikiPageSummaryState state) {
    /** 요약을 새로 만들어야 하는 상태인가 — 요약 없음(MISSING) 또는 낡음(STALE). */
    boolean needsGeneration() {
      return state.status() == WikiSummaryStatus.MISSING
          || state.status() == WikiSummaryStatus.STALE;
    }
  }

  /** 공용(워크스페이스) 비서 — 없으면 empty. 트랜잭션 안에서 호출한다(RLS). 요약 생성 가능 여부와 생성 주체를 함께 정한다. */
  private Optional<AssistantSpec> workspaceAssistant() {
    return assistantResolver.resolveWorkspaceOrEmpty();
  }

  /**
   * 저장본과 현재 페이지로 상태를 계산한다(트랜잭션 안에서 호출).
   *
   * <p>본문이 짧으면(빈 노트 포함) 옛 요약이 남아 있어도 TOO_SHORT 로 보고 summary·버전·시각을 비워 보낸다 — 웹은 summary 가 없으면 카드를
   * 그리지 않으므로 빈 노트에 지난 요약이 떠 있지 않는다.
   *
   * @param assistant 공용 비서(지연 평가) — 요약이 없고 본문이 충분히 길 때만 조회해 MISSING(자동 생성 대상)과 UNAVAILABLE 을 가른다
   */
  private WikiPageSummaryState state(
      WikiPageDetail page, Supplier<Optional<AssistantSpec>> assistant) {
    WikiPageRepository.SummaryRow row =
        pages.findSummary(page.id()).orElseThrow(() -> new WikiPageNotFoundException(page.id()));
    if (!isLongEnough(page.body())) {
      return new WikiPageSummaryState(
          null, WikiSummaryStatus.TOO_SHORT, null, page.version(), null);
    }
    WikiSummaryStatus status;
    if (row.summary() != null) {
      status =
          row.summaryVersion() != null && row.summaryVersion() >= page.version()
              ? WikiSummaryStatus.READY
              : WikiSummaryStatus.STALE;
    } else {
      status =
          assistant.get().isPresent() ? WikiSummaryStatus.MISSING : WikiSummaryStatus.UNAVAILABLE;
    }
    return new WikiPageSummaryState(
        row.summary(), status, row.summaryVersion(), page.version(), row.summarizedAt());
  }

  private static boolean isLongEnough(String body) {
    return body != null && body.strip().length() > MIN_BODY_CHARS;
  }
}

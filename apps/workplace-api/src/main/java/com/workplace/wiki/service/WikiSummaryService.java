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
    // 공용 비서 조회도 DB(RLS) 접근이라 같은 읽기 트랜잭션 안에서, 권한 확인 뒤에 한다.
    return readTx.execute(
        st -> {
          WikiPageDetail page = loadForViewer(callerId, pageId);
          return state(page, workspaceAssistant().isPresent());
        });
  }

  /**
   * 요약을 생성·저장하고 갱신된 상태를 돌려준다. 다음 경우엔 AI 를 부르지 않고 현재 상태만 반환한다 — 본문이 짧음(TOO_SHORT), 공용 비서 없음
   * (UNAVAILABLE), 이미 현재 버전 요약이 있음(READY, 중복 POST·연타 비용 방지). 더 새 요약이 이미 있으면(동시 생성) 저장을 건너뛰고 저장본 기준
   * 상태를 돌려준다.
   */
  public WikiPageSummaryState generate(long callerId, long pageId) {
    // 1) 스냅샷 — 권한 확인 + 요약 대상 본문/버전 고정. 권한 확인을 비서 조회보다 먼저 해 비멤버엔 존재를 숨긴다.
    // 요약은 이 노트를 보는 모든 사람이 공유하므로 호출자 개인 비서(임의 엔드포인트일 수 있음)가 아닌 공용 비서로만 만든다.
    Snapshot snap =
        readTx.execute(
            st -> {
              WikiPageDetail p = loadForViewer(callerId, pageId);
              Optional<AssistantSpec> a = workspaceAssistant();
              return new Snapshot(p, a, state(p, a.isPresent()));
            });
    WikiPageDetail page = snap.page();
    Optional<AssistantSpec> assistant = snap.assistant();
    WikiPageSummaryState current = snap.state();
    if (current.status() != WikiSummaryStatus.MISSING
        && current.status() != WikiSummaryStatus.STALE) {
      return current; // TOO_SHORT · UNAVAILABLE · READY — 만들 것이 없다
    }
    if (assistant.isEmpty()) {
      return current; // STALE 이지만 공용 비서가 사라짐 — 옛 요약을 그대로 보여 준다
    }
    AssistantSpec spec = assistant.get();
    // 2) 트랜잭션 밖 AI 호출 — 본문은 상한까지만 보낸다.
    String body = page.body();
    String input = body.length() > MAX_INPUT_CHARS ? body.substring(0, MAX_INPUT_CHARS) : body;
    WikiAiAgentSummaryClient.Res res =
        agent.summarize(
            new WikiAiAgentSummaryClient.Req(
                page.title(),
                input,
                spec.agentUserId(),
                spec.model(),
                MAX_TURNS,
                spec.timeoutMs()));
    String summary = res == null || res.summary() == null ? "" : res.summary().strip();
    if (summary.isEmpty()) {
      throw new WikiSummaryFailedException("AI 가 빈 요약을 돌려줬습니다.", null);
    }
    // 3) 저장 — 오래된 결과가 새 요약을 덮지 않도록 조건부 갱신. 이후 최신 행으로 상태를 다시 계산한다.
    return writeTx.execute(
        st -> {
          pages.saveSummaryIfNotOlder(pageId, summary, page.version(), OffsetDateTime.now());
          WikiPageDetail latest =
              pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
          return state(latest, true);
        });
  }

  /** 페이지 로드 + VIEWER 권한 확인. */
  private WikiPageDetail loadForViewer(long callerId, long pageId) {
    WikiPageDetail page =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(page.spaceId(), callerId, "VIEWER");
    return page;
  }

  /** generate 1단계 스냅샷 — 같은 읽기 트랜잭션에서 고정한 페이지·공용 비서·현재 상태. */
  private record Snapshot(
      WikiPageDetail page, Optional<AssistantSpec> assistant, WikiPageSummaryState state) {}

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
   * @param assistantAvailable 공용 비서 존재 여부 — 요약이 없을 때 MISSING(자동 생성 대상)과 UNAVAILABLE 을 가른다
   */
  private WikiPageSummaryState state(WikiPageDetail page, boolean assistantAvailable) {
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
      status = assistantAvailable ? WikiSummaryStatus.MISSING : WikiSummaryStatus.UNAVAILABLE;
    }
    return new WikiPageSummaryState(
        row.summary(), status, row.summaryVersion(), page.version(), row.summarizedAt());
  }

  private static boolean isLongEnough(String body) {
    return body != null && body.strip().length() > MIN_BODY_CHARS;
  }
}

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
    return readTx.execute(st -> state(loadForViewer(callerId, pageId)));
  }

  /**
   * 요약을 생성·저장하고 갱신된 상태를 돌려준다. 본문이 짧으면 AI 를 부르지 않고 TOO_SHORT 를 반환한다. 더 새 요약이 이미 있으면(동시 생성) 저장을 건너뛰고
   * 저장본 기준 상태를 돌려준다.
   */
  public WikiPageSummaryState generate(long callerId, long pageId) {
    // 1) 스냅샷 — 권한 확인 + 요약 대상 본문/버전 고정.
    WikiPageDetail page = readTx.execute(st -> loadForViewer(callerId, pageId));
    if (!isLongEnough(page.body())) {
      return readTx.execute(st -> state(page));
    }
    // 2) 트랜잭션 밖 AI 호출 — 비서 미설정이면 AssistantResolver 예외가 그대로 4xx 로 나간다.
    AssistantSpec spec = assistantResolver.resolve(callerId);
    WikiAiAgentSummaryClient.Res res =
        agent.summarize(
            new WikiAiAgentSummaryClient.Req(
                page.title(),
                page.body(),
                spec.agentUserId(),
                spec.model(),
                spec.maxTurns(),
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
          return state(latest);
        });
  }

  /** 페이지 로드 + VIEWER 권한 확인. */
  private WikiPageDetail loadForViewer(long callerId, long pageId) {
    WikiPageDetail page =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(page.spaceId(), callerId, "VIEWER");
    return page;
  }

  /** 저장본과 현재 페이지로 상태를 계산한다(트랜잭션 안에서 호출). */
  private WikiPageSummaryState state(WikiPageDetail page) {
    WikiPageRepository.SummaryRow row =
        pages.findSummary(page.id()).orElseThrow(() -> new WikiPageNotFoundException(page.id()));
    WikiSummaryStatus status;
    if (row.summary() != null) {
      status =
          row.summaryVersion() != null && row.summaryVersion() >= page.version()
              ? WikiSummaryStatus.READY
              : WikiSummaryStatus.STALE;
    } else {
      status = isLongEnough(page.body()) ? WikiSummaryStatus.MISSING : WikiSummaryStatus.TOO_SHORT;
    }
    return new WikiPageSummaryState(
        row.summary(), status, row.summaryVersion(), page.version(), row.summarizedAt());
  }

  private static boolean isLongEnough(String body) {
    return body != null && body.strip().length() > MIN_BODY_CHARS;
  }
}

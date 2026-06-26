package com.workplace.mail.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.mail.util.MailBodyText;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 선제 배치 요약 — 안읽은·미요약 최근 메일의 본문을 (필요 시 IMAP) 적재한 뒤 요약을 미리 채운다. 분류 백필({@link
 * MailClassifyBackfillService})과 달리 본문이 필요하므로 미적재 시 fetchBody 로 IMAP 왕복. best-effort: 메시지별 실패는 삼키고
 * 다음으로. 빈본문은 요약 저장 skip(쓰레기 캐싱 방지, #480).
 */
@Slf4j
@Service
public class MailSummaryBackfillService {

  /** 한 회 요약 상한 — 첫 백필 부담 완화(IMAP fetch + LLM 각 LIMIT 회). */
  public static final int LIMIT = 20;

  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailAiService mailAiService;
  private final TransactionTemplate txTemplate;

  public MailSummaryBackfillService(
      EmailMessageRepository messageRepo,
      MailBodyFetcher bodyFetcher,
      MailAiService mailAiService,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.bodyFetcher = bodyFetcher;
    this.mailAiService = mailAiService;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 동기화 직후 비동기 진입점. TenantContext 는 TenantContextTaskDecorator 가 전파. */
  @Async("aiAgentEventExecutor")
  public void summarizeRecentUnread(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("요약 백필 skip — TenantContext 없음 accountId={}", accountId);
      return;
    }
    summarizeRecentUnreadNow(userId, accountId);
  }

  /** 동기 본체. 스케줄러(테넌트별 트랜잭션)와 테스트가 직접 호출한다. */
  public void summarizeRecentUnreadNow(long userId, long accountId) {
    AssistantSpec spec = mailAiService.resolveSpecOrNull(userId);
    if (spec == null) {
      return; // 비서 미설정 — 요약 생략
    }
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnsummarizedIds(accountId, LIMIT));
    if (ids == null) {
      return;
    }
    for (Long id : ids) {
      try {
        ensureBodyAndSummarize(userId, id);
      } catch (RuntimeException e) {
        log.warn("선제 요약 실패 messageId={} — 건너뜀", id, e);
      }
    }
  }

  /** 본문 미적재면 IMAP 적재 후, 빈본문이 아니면 요약 생성. 각 단계 짧은 트랜잭션으로 RLS GUC 주입. */
  private void ensureBodyAndSummarize(long userId, long messageId) {
    // 1) 본문 적재(필요 시) — MailMessageService.get() 과 동일 가드/패턴.
    BodyTarget target =
        txTemplate.execute(
            status ->
                messageRepo
                    .findBodyTargetForUser(userId, messageId)
                    .filter(t -> t.bodyFetchedAt() == null && t.imapUid() != 0)
                    .orElse(null));
    if (target != null) {
      txTemplate.executeWithoutResult(status -> bodyFetcher.fetchBody(userId, target));
    }
    // 2) 빈본문 가드 — 적재 후에도 본문이 비면 요약 LLM 호출/저장 skip.
    AiContext ctx =
        txTemplate.execute(
            status -> messageRepo.findAiContextByIdAndUser(userId, messageId).orElse(null));
    if (ctx == null) {
      return;
    }
    String body = MailBodyText.effectiveBody(ctx.bodyText(), ctx.bodyHtml());
    if (body == null || body.isBlank()) {
      return;
    }
    // 3) 요약 생성·저장(캐시 미스 → LLM). summarize 가 자체 짧은 트랜잭션으로 처리.
    mailAiService.summarize(userId, messageId);
  }
}

package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import java.util.function.Consumer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 선제 백필(WP-149) — 안읽은 최근 메일의 본문을 (필요 시) 적재한 뒤 미분석분을 분석한다.
 *
 * <ul>
 *   <li>③ 원본 분석 패스: content.ai_summarized_at 미시도 대상(#484) → {@link
 *       MailAnalysisService#analyzeContent}(공통 비서, ai_enabled 무관)
 *   <li>④ 개인 분석 패스: email_message.ai_analyzed_at 미시도 + 배포 전 미분류 대상 → {@link
 *       MailAnalysisService#analyzePersonal}(개인→공통 비서, AI 사용 계정)
 * </ul>
 *
 * 메서드 이름(summarize*)은 호출부(MailSyncService·스케줄러) 호환을 위해 유지한다. best-effort: 메시지별 실패는 삼키고 다음으로. 비서
 * 없음·빈 본문은 분석 서비스가 건너뛴다.
 */
@Slf4j
@Service
public class MailSummaryBackfillService {

  /** 한 회 상한 — 첫 백필 부담 완화(본문 적재 + LLM 각 LIMIT 회). */
  public static final int LIMIT = 20;

  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailAnalysisService analysis;
  private final TransactionTemplate txTemplate;

  public MailSummaryBackfillService(
      EmailMessageRepository messageRepo,
      MailBodyFetcher bodyFetcher,
      MailAnalysisService analysis,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.bodyFetcher = bodyFetcher;
    this.analysis = analysis;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 동기화 직후 비동기 진입점 — ③·④ 두 패스. TenantContext 는 TaskDecorator 가 전파. */
  @Async("aiAgentEventExecutor")
  public void summarizeRecentUnread(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("선제 분석 skip — TenantContext 없음 accountId={}", accountId);
      return;
    }
    summarizeObjectiveRecentNow(userId, accountId);
    summarizePersonalRecentNow(userId, accountId);
  }

  /** ③ 원본 분석 패스 — content 미시도 대상. */
  public void summarizeObjectiveRecentNow(long userId, long accountId) {
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnsummarizedIds(accountId, LIMIT));
    runPass(userId, ids, id -> analysis.analyzeContent(userId, id));
  }

  /** ④ 개인 분석 패스 — 사본 미시도 + 배포 전 미분류 대상. */
  public void summarizePersonalRecentNow(long userId, long accountId) {
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnanalyzedIds(accountId, LIMIT));
    runPass(userId, ids, id -> analysis.analyzePersonal(userId, id));
  }

  /** 공통 루프 — 대상별 본문 ensure 후 분석. 메시지별 실패는 삼킨다. */
  private void runPass(long userId, List<Long> ids, Consumer<Long> step) {
    if (ids == null) {
      return;
    }
    for (Long id : ids) {
      try {
        ensureBody(userId, id);
        step.accept(id);
      } catch (RuntimeException e) {
        log.warn("선제 분석 실패 messageId={} — 건너뜀", id, e);
      }
    }
  }

  /** 본문 미적재면 적재(IMAP uid 또는 Graph id 가 있을 때만). 각 단계 짧은 트랜잭션으로 RLS GUC 주입. */
  private void ensureBody(long userId, long messageId) {
    BodyTarget target =
        txTemplate.execute(
            status ->
                messageRepo
                    .findBodyTargetForUser(userId, messageId)
                    // WP-130: Graph 도 적재 — 적재·검증 전엔 공유 본문이 가려져 분석할 수 없다
                    .filter(
                        t ->
                            t.bodyFetchedAt() == null
                                && (t.imapUid() != 0 || t.providerMessageId() != null))
                    .orElse(null));
    if (target != null) {
      txTemplate.executeWithoutResult(status -> bodyFetcher.fetchBody(userId, target));
    }
  }
}

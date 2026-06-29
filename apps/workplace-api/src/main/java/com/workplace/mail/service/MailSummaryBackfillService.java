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
 * 선제 배치 요약 — 안읽은 최근 메일의 본문을 (필요 시 IMAP) 적재한 뒤 두 패스로 요약을 미리 채운다.
 *
 * <ul>
 *   <li>T1 객관적(공통): content.ai_summary 미생성 대상 → ensureObjectiveSummary (공통비서, ai_enabled 무관)
 *   <li>T2 개인: email_message.ai_personal_summary 미생성 대상 → ensurePersonalSummary (개인비서)
 * </ul>
 *
 * best-effort: 메시지별 실패는 삼키고 다음으로. 빈본문·비서 없음은 각 ensure 메서드 내부에서 skip.
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

  /** 동기화 직후 비동기 진입점 — 객관적·개인 두 패스 모두. TenantContext 는 TaskDecorator 가 전파. */
  @Async("aiAgentEventExecutor")
  public void summarizeRecentUnread(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("요약 백필 skip — TenantContext 없음 accountId={}", accountId);
      return;
    }
    summarizeObjectiveRecentNow(userId, accountId);
    summarizePersonalRecentNow(userId, accountId);
  }

  /** T1 객관적 — content 미요약 대상. 공통비서 없으면 ensureObjectiveSummary 가 알아서 skip. */
  public void summarizeObjectiveRecentNow(long userId, long accountId) {
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnsummarizedIds(accountId, LIMIT));
    runPass(userId, ids, id -> mailAiService.ensureObjectiveSummary(userId, id));
  }

  /** T2 개인 — envelope 미개인요약 대상. 개인비서 없으면 ensurePersonalSummary 가 알아서 skip. */
  public void summarizePersonalRecentNow(long userId, long accountId) {
    List<Long> ids =
        txTemplate.execute(
            status -> messageRepo.listRecentUnreadUnpersonalizedIds(accountId, LIMIT));
    runPass(userId, ids, id -> mailAiService.ensurePersonalSummary(userId, id));
  }

  /**
   * 공통 루프 — 대상별 본문 ensure 후 summarizer 적용. 메시지별 실패는 삼킨다.
   *
   * @param userId 호출자 userId — RLS GUC 주입 및 비서 조회에 사용
   * @param ids 처리 대상 메시지 ID 목록 (null 이면 txTemplate 이 반환한 것 — skip)
   * @param summarizer 메시지 ID 를 받아 요약 저장을 수행하는 단계 (userId 는 람다로 캡처)
   */
  private void runPass(long userId, List<Long> ids, Consumer<Long> summarizer) {
    if (ids == null) {
      return;
    }
    for (Long id : ids) {
      try {
        // 본문 미적재 시 IMAP fetch 선행, 이후 ensure*(best-effort, 빈본문·비서 없음은 내부 skip)
        ensureBody(userId, id);
        summarizer.accept(id);
      } catch (RuntimeException e) {
        log.warn("선제 요약 실패 messageId={} — 건너뜀", id, e);
      }
    }
  }

  /**
   * 본문 미적재면 IMAP fetch. bodyFetchedAt == null && imapUid != 0 인 경우만 IMAP 왕복.
   *
   * <p>MailMessageService.get() 과 동일 가드/패턴. 각 단계 짧은 트랜잭션으로 RLS GUC 주입.
   */
  private void ensureBody(long userId, long messageId) {
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
  }
}

package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.exception.MailAiException;
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
    AgentOutageGuard guard = new AgentOutageGuard(); // 두 패스가 같은 agent 를 부른다 — 한 카운터로 센다
    try {
      summarizeObjectiveRecentNow(userId, accountId, guard);
      summarizePersonalRecentNow(userId, accountId, guard);
    } catch (RuntimeException e) {
      if (!MailAiException.isAgentUnavailable(e)) {
        throw e;
      }
      // 패스가 ai-agent 불가로 멈췄다 — 비동기 예외(ERROR)로 새지 않게 한 줄만. 남은 메일은 다음 동기화·주기 배치가 다시 집는다.
      log.warn("선제 분석 중단 — ai-agent 불가 accountId={}", accountId);
    }
  }

  /** ③ 원본 분석 패스 — content 미시도 대상. */
  public void summarizeObjectiveRecentNow(long userId, long accountId) {
    summarizeObjectiveRecentNow(userId, accountId, new AgentOutageGuard());
  }

  /** ③ 원본 분석 패스 — 배치 회차의 agent 불가 카운터를 이어 쓴다(스케줄러용, WP-166). */
  void summarizeObjectiveRecentNow(long userId, long accountId, AgentOutageGuard guard) {
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnsummarizedIds(accountId, LIMIT));
    runPass(userId, ids, id -> analysis.analyzeContent(userId, id), guard);
  }

  /** ④ 개인 분석 패스 — 사본 미시도 + 배포 전 미분류 대상. */
  public void summarizePersonalRecentNow(long userId, long accountId) {
    summarizePersonalRecentNow(userId, accountId, new AgentOutageGuard());
  }

  /** ④ 개인 분석 패스 — 배치 회차의 agent 불가 카운터를 이어 쓴다(스케줄러용, WP-166). */
  void summarizePersonalRecentNow(long userId, long accountId, AgentOutageGuard guard) {
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnanalyzedIds(accountId, LIMIT));
    UserMailProfileCache profiles = analysis.newProfileCache(); // 이 패스 동안 "나" 프로필 1회 조회(WP-150)
    runPass(userId, ids, id -> analysis.analyzePersonal(userId, id, profiles), guard);
  }

  /**
   * 공통 루프 — 대상별 본문 ensure 후 분석. 메시지별 실패는 삼킨다.
   *
   * <p>단 ai-agent 불가({@link MailAiException#isAgentUnavailable})가 연속 상한({@link AgentOutageGuard})에
   * 닿으면 남은 메일에 같은 실패를 쌓지 않고 그 예외를 다시 던져 패스를 멈춘다(WP-166) — 호출부(스케줄러)가 이번 회차의 남은 계정까지 멈출 수 있게. 분석에
   * 실패한 메일은 시도 기록이 남지 않아 다음 주기에 다시 대상이 된다.
   */
  private void runPass(long userId, List<Long> ids, Consumer<Long> step, AgentOutageGuard guard) {
    if (ids == null) {
      return;
    }
    for (Long id : ids) {
      try {
        ensureBody(userId, id);
        step.accept(id);
        guard.recordResponse();
      } catch (RuntimeException e) {
        if (!MailAiException.isAgentUnavailable(e)) {
          guard.recordResponse();
          log.warn("선제 분석 실패 messageId={} — 건너뜀", id, e);
          continue;
        }
        // agent 재기동 중 등 — 스택 없이 한 줄. 읽기 타임아웃도 여기 들어오므로 첫 실패에서 멈추지는 않는다.
        log.warn("선제 분석 실패(ai-agent 불가) messageId={}: {}", id, String.valueOf(e.getCause()));
        if (guard.recordUnavailable()) {
          throw e;
        }
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

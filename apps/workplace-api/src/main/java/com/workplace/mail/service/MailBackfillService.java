package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 동기화 직후 누락 본문을 최근순으로 비동기 보충. best-effort. */
@Slf4j
@Service
public class MailBackfillService {

  /** 한 회 보충 상한(과도한 IMAP 점유 방지). 진행률 표기 보정을 위해 sync 에서도 참조한다. */
  public static final int BATCH_LIMIT = 200;

  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailSyncProgress progress;
  private final MailAnalysisService analysis;
  private final TransactionTemplate txTemplate;

  /**
   * TransactionTemplate 은 @Primary {@code TenantAwareTransactionManager} 로 구성 — 본문 보충은 RLS 적용
   * 테이블(email_message/email_attachment) 을 읽고 쓰므로, 트랜잭션 진입 시 GUC(app.tenant_id) 주입이 필요하다.
   * (@Transactional 어노테이션을 쓰지 않는 이유: backfill→backfillNow 자기-호출은 프록시를 우회해 어노테이션 트랜잭션이 적용되지 않기 때문 —
   * 명시적 TransactionTemplate 은 진입 경로와 무관하게 항상 트랜잭션을 연다.)
   */
  public MailBackfillService(
      EmailMessageRepository messageRepo,
      MailBodyFetcher bodyFetcher,
      MailSyncProgress progress,
      MailAnalysisService analysis,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.bodyFetcher = bodyFetcher;
    this.progress = progress;
    this.analysis = analysis;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 비동기 진입점(sync 가 호출). 별도 스레드/트랜잭션에서 동기 보충 수행.
   *
   * <p>요청 스레드에서 트리거되며 aiAgentEventExecutor 의 TenantContextTaskDecorator 가 TenantContext 를 워커로 전파한다.
   * null 가드: 전파 실패(비테넌트/시스템 트리거) 시 GUC 미설정으로 RLS fail-closed 가 되어 조용히 no-op 되므로, 명시적으로 경고 후 skip 하여
   * 잘못된 비테넌트 실행을 방지한다.
   */
  @Async("aiAgentEventExecutor")
  public void backfill(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("본문 백필 skip — TenantContext 없음(비테넌트 트리거 의심) accountId={}", accountId);
      progress.finish(accountId);
      return;
    }
    backfillNow(userId, accountId);
  }

  /**
   * 동기 보충 본체. 테스트는 이 메서드를 직접 호출해 같은 스레드에서 검증한다.
   *
   * <p>WP-149 "본문 적재 직후" 분석: 본문을 모두 적재해 진행바를 끝낸 뒤, 이번에 적재된 메일마다 ③+④ 를 트랜잭션 밖에서 실행한다(INBOX 만,
   * best-effort). 분석은 메시지당 LLM 을 최대 두 번 부르므로 진행바를 붙잡지 않는다.
   */
  public void backfillNow(long userId, long accountId) {
    try {
      // 대상 목록 조회(RLS 테이블) — 짧은 트랜잭션으로 GUC 주입.
      List<BodyTarget> targets =
          txTemplate.execute(status -> messageRepo.listMissingBody(accountId, BATCH_LIMIT));
      List<Long> loaded = new ArrayList<>();
      // 본문 적재는 IMAP 네트워크 I/O 를 포함하므로 메시지별 짧은 트랜잭션으로 감싼다(풀 고갈 방지 + RLS write GUC 주입).
      for (BodyTarget t : targets) {
        Boolean ok = txTemplate.execute(status -> bodyFetcher.fetchBody(userId, t));
        progress.incBody(accountId);
        if (Boolean.TRUE.equals(ok)) {
          loaded.add(t.messageId());
        }
      }
      progress.finish(accountId); // 본문 보충 완료 — 분석은 진행바와 무관하게 이어서
      for (Long id : loaded) {
        analysis.analyzeAfterLoad(userId, id);
      }
    } catch (Exception e) {
      log.warn("본문 백그라운드 보충 실패 (accountId={}): {}", accountId, e.toString());
    } finally {
      progress.finish(accountId);
    }
  }
}

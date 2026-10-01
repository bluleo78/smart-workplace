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

  /**
   * 적재 직후 분석 상한(최근 수신 순 상위 N건) — MailSummaryBackfillService.LIMIT 과 같은 값. 분석은 메시지당 LLM 을 최대 두 번 부르고
   * 공유 executor(aiAgentEventExecutor, core 2) 스레드를 순차로 붙잡으므로 200건 전부 돌리지 않는다. 나머지는 동기화 후 요약 백필 패스와
   * 열람 시 요약 GET 이 맡는다.
   */
  public static final int ANALYZE_AFTER_LOAD_LIMIT = 20;

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
   * <p>WP-149 "본문 적재 직후" 분석: 본문을 모두 적재해 진행바를 끝낸 뒤, 이번에 적재된 메일 중 최근 수신 순 상위 {@link
   * #ANALYZE_AFTER_LOAD_LIMIT}건에 ③+④ 를 트랜잭션 밖에서 실행한다(INBOX 만, best-effort). 분석은 메시지당 LLM 을 최대 두 번
   * 부르므로 진행바를 붙잡지 않는다.
   */
  public void backfillNow(long userId, long accountId) {
    List<Long> loaded = new ArrayList<>();
    try {
      // 대상 목록 조회(RLS 테이블) — 짧은 트랜잭션으로 GUC 주입.
      List<BodyTarget> targets =
          txTemplate.execute(status -> messageRepo.listMissingBody(accountId, BATCH_LIMIT));
      // 본문 적재는 IMAP 네트워크 I/O 를 포함하므로 메시지별 짧은 트랜잭션으로 감싼다(풀 고갈 방지 + RLS write GUC 주입).
      for (BodyTarget t : targets) {
        Boolean ok = txTemplate.execute(status -> bodyFetcher.fetchBody(userId, t));
        progress.incBody(accountId);
        if (Boolean.TRUE.equals(ok)) {
          loaded.add(t.messageId());
        }
      }
    } catch (Exception e) {
      log.warn("본문 백그라운드 보충 실패 (accountId={}): {}", accountId, e.toString());
    } finally {
      progress.finish(accountId); // 정확히 한 번 — 분석(수 분 소요 가능) 전에 끝낸다
    }
    // 분석은 finish 뒤에서 한다: 분석 중 다음 동기화가 tryStart 한 진행 상태를 여기서 다시 finish 로 지우면
    // 진행바가 꺼지고 동기화가 중복 시작될 수 있다. analyzeAfterLoad 는 각 단계 예외를 스스로 삼키지만 방어적으로 감싼다.
    // loaded 는 listMissingBody(received_at DESC) 순서 그대로라 앞 N건이 최근 수신 메일이다.
    for (Long id : loaded.subList(0, Math.min(loaded.size(), ANALYZE_AFTER_LOAD_LIMIT))) {
      try {
        analysis.analyzeAfterLoad(userId, id);
      } catch (RuntimeException e) {
        log.warn("적재 후 분석 실패 (messageId={}): {}", id, e.toString());
      }
    }
  }
}

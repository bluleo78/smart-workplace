package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAnalysisBreaker.Admission;
import com.workplace.mail.service.MailAnalysisService.AfterLoadOutcome;
import com.workplace.mail.service.MailPushService.NewMailPush;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 동기화 직후 누락 본문을 최근순으로 비동기 보충. best-effort.
 *
 * <p>동기화가 미뤄 둔 새 메일 OS 푸시(WP-1739)도 보충이 끝난 뒤 여기서 보낸다 — 자동 발송 판정(email_content.auto_generated)은 본문을
 * 받을 때 헤더로 정해지므로, 보충 뒤에 판정해야 「업무 메일만(WORK)」에서 대량·자동 발송이 빠진다.
 */
@Slf4j
@Service
public class MailBackfillService {

  /** 한 회 보충 상한(과도한 IMAP 점유 방지). 진행률 표기 보정을 위해 sync 에서도 참조한다. */
  public static final int BATCH_LIMIT = 200;

  /**
   * 적재 직후 분석 상한(최근 수신 순 상위 N건) — MailSummaryBackfillService.LIMIT 과 같은 값. 분석은 메시지당 LLM 을 최대 두 번 부르고
   * 분석 executor(mailAnalysisExecutor, core 2) 스레드를 순차로 붙잡으므로 200건 전부 돌리지 않는다. 나머지는 동기화 후 요약 백필 패스와
   * 열람 시 요약 GET 이 맡는다.
   */
  public static final int ANALYZE_AFTER_LOAD_LIMIT = 20;

  private final EmailMessageRepository messageRepo;
  private final MailBodyFetcher bodyFetcher;
  private final MailSyncProgress progress;
  private final MailAnalysisService analysis;
  private final TransactionTemplate txTemplate;

  /** 새 메일 OS 푸시(WP-1739) — 동기화가 넘긴 발송 정보가 있을 때만 보충이 끝난 뒤 부른다. */
  private final MailPushService pushService;

  /** 백필 전용 회로 차단기(WP-1812). */
  private final MailAnalysisBreaker breaker;

  /**
   * 적재 후 분석(LLM)을 넘기는 분석 실행기(mailAnalysisExecutor, WP-1812 리뷰 후속). 본문 보충 스레드가 분석까지 붙잡으면 다른 계정의 본문·새
   * 메일 푸시가 그 뒤에 줄 서고, 분석 동시 실행도 분석 풀의 2개를 넘는다 — 그래서 분석은 이 실행기로 넘기고 본문 스레드는 바로 끝낸다.
   */
  private final Executor analysisExecutor;

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
      PlatformTransactionManager txManager,
      MailPushService pushService,
      MailAnalysisBreaker breaker,
      @Qualifier("mailAnalysisExecutor") Executor analysisExecutor) {
    this.breaker = breaker;
    this.analysisExecutor = analysisExecutor;
    this.messageRepo = messageRepo;
    this.bodyFetcher = bodyFetcher;
    this.progress = progress;
    this.analysis = analysis;
    this.txTemplate = new TransactionTemplate(txManager);
    this.pushService = pushService;
  }

  /**
   * 비동기 진입점(sync 가 호출). 별도 스레드/트랜잭션에서 동기 보충 수행.
   *
   * <p>요청 스레드에서 트리거되며 mailBodyBackfillExecutor 의 TenantContextTaskDecorator 가 TenantContext 를 워커로
   * 전파한다. 분석 풀(mailAnalysisExecutor)과 떼어 본문 가져오기가 LLM 분석 뒤에 줄 서거나 거절되지 않게 한다(WP-1812 리뷰 후속). null
   * 가드: 전파 실패(비테넌트/시스템 트리거) 시 GUC 미설정으로 RLS fail-closed 가 되어 조용히 no-op 되므로, 명시적으로 경고 후 skip 하여 잘못된
   * 비테넌트 실행을 방지한다(이때는 새 메일 푸시도 싣지 못해 보내지 않는다 — 후보 조회·발송 테넌트 모두 테넌트 문맥이 필요하다).
   *
   * @param push 보충이 끝난 뒤 보낼 새 메일 푸시(WP-1739) — 동기화가 넘긴다. 첫 동기화처럼 보내지 않을 때는 null
   */
  @Async("mailBodyBackfillExecutor")
  public void backfill(long userId, long accountId, NewMailPush push) {
    if (TenantContext.get() == null) {
      log.warn("본문 백필 skip — TenantContext 없음(비테넌트 트리거 의심) accountId={}", accountId);
      progress.finish(accountId);
      return;
    }
    backfillNow(userId, accountId, push);
  }

  /**
   * 동기 보충 본체. 테스트는 이 메서드를 직접 호출해 같은 스레드에서 검증한다.
   *
   * <p>WP-149 "본문 적재 직후" 분석: 본문을 모두 적재해 진행바를 끝낸 뒤, 이번에 적재된 메일 중 최근 수신 순 상위 {@link
   * #ANALYZE_AFTER_LOAD_LIMIT}건에 ③+④ 를 트랜잭션 밖에서 실행한다(INBOX 만, best-effort). 분석은 메시지당 LLM 을 최대 두 번
   * 부르므로 진행바를 붙잡지 않는다.
   *
   * <p>발송 정보 없이 부르므로 새 메일 푸시는 하지 않는다 — 새 메일 푸시는 동기화 경로({@link #backfill})에서만 나간다(WP-1739).
   */
  public void backfillNow(long userId, long accountId) {
    backfillNow(userId, accountId, null);
  }

  /**
   * 동기 보충 본체 + 미뤄 둔 새 메일 푸시(WP-1739). 비동기 진입점 {@link #backfill} 이 부르고, 테스트는 같은 스레드에서 검증하려고 직접 부른다.
   *
   * <p>푸시는 진행바를 끝낸 직후·적재 후 분석 전에 보낸다 — 본문(자동 발송 헤더 판정)은 이미 적재됐고, 수 분 걸릴 수 있는 분석을 기다리면 알림이 늦는다. 보충이
   * 실패해도(예외) 보낸다: 본문을 못 받은 메일은 자동 발송 판정이 false 로 남아 「애매하면 보냄」 규칙대로 판정된다. 한 회 상한({@link
   * #BATCH_LIMIT})을 넘겨 일부 새 메일의 본문이 아직 없을 때도 같은 이유로 그대로 보낸다(다음 보충까지 기다리면 알림이 빠지거나 크게 늦는다).
   *
   * @param push 보충이 끝난 뒤 보낼 새 메일 푸시 — null 이면 보내지 않는다
   */
  public void backfillNow(long userId, long accountId, NewMailPush push) {
    List<Long> loaded = new ArrayList<>();
    try {
      // 대상 목록 조회(RLS 테이블) — 짧은 트랜잭션으로 GUC 주입.
      List<BodyTarget> targets =
          txTemplate.execute(status -> messageRepo.listMissingBody(accountId, BATCH_LIMIT));
      // 본문 적재는 IMAP 네트워크 I/O 를 포함하므로 메시지별 짧은 트랜잭션으로 감싼다(풀 고갈 방지 + RLS write GUC 주입).
      for (BodyTarget t : targets) {
        Boolean ok = txTemplate.execute(status -> bodyFetcher.fetchBody(userId, t));
        progress.incBody(accountId);
        // 적재 후 분석은 받은편지함만 한다(analyzeAfterLoad 가 그 밖은 건너뜀) — 동기화한 보낸 메일(WP-950)이 분석 상한 슬롯을 차지하지 않게
        // 받은편지함 메일만 모은다.
        if (Boolean.TRUE.equals(ok) && "INBOX".equals(t.folderName())) {
          loaded.add(t.messageId());
        }
      }
    } catch (Exception e) {
      log.warn("본문 백그라운드 보충 실패 (accountId={}): {}", accountId, e.toString());
    } finally {
      progress.finish(accountId); // 정확히 한 번 — 분석(수 분 소요 가능) 전에 끝낸다
    }
    // WP-1739: 미뤄 둔 새 메일 푸시 — 본문 적재(자동 발송 판정)가 끝난 뒤, 분석 전에 보낸다.
    sendNewMailQuietly(userId, push);
    // 분석은 finish 뒤에서 한다: 분석 중 다음 동기화가 tryStart 한 진행 상태를 여기서 다시 finish 로 지우면
    // 진행바가 꺼지고 동기화가 중복 시작될 수 있다. loaded 는 listMissingBody(received_at DESC) 순서 그대로라 앞 N건이 최근 수신
    // 메일이다.
    // WP-1812 리뷰 후속: 분석(LLM)은 분석 실행기로 넘기고 이 본문 보충 스레드는 바로 끝낸다 — 다른 계정의 본문 보충이 분석 뒤에 줄 서지 않고,
    // 메일 LLM 동시 실행이 분석 풀 크기(2)로 묶인다. 분석 실행기가 가득 차 거절되면 건너뛴다(요약 백필 패스·열람 시 요약이 맡는다).
    if (loaded.isEmpty()) {
      return;
    }
    List<Long> toAnalyze =
        new ArrayList<>(loaded.subList(0, Math.min(loaded.size(), ANALYZE_AFTER_LOAD_LIMIT)));
    try {
      analysisExecutor.execute(() -> analyzeLoaded(userId, toAnalyze));
    } catch (RejectedExecutionException e) {
      log.warn("적재 후 분석 건너뜀 — 분석 실행기 가득 참(요약 백필이 이어 맡음) accountId={}", accountId);
    }
  }

  /**
   * 적재 후 분석 본체(분석 실행기 스레드) — 최근 수신 순으로 ③+④ 를 차례로 한다. 회로가 열리면 멈추고, 메시지마다 예외를 삼킨다(best-effort, 스레드
   * 미처리 예외로 사라지지 않게).
   */
  private void analyzeLoaded(long userId, List<Long> ids) {
    UserMailProfileCache profiles = analysis.newProfileCache(); // 이 배치 동안 "나" 프로필 1회 조회(WP-150)
    for (Long id : ids) {
      Admission admission = breaker.admit(id);
      if (admission == Admission.OPEN) {
        break; // 모델 실패가 이어져 회로가 열렸다(WP-1812) — 남은 메일은 요약 백필 패스·열람 시 요약이 맡는다
      }
      if (admission == Admission.SKIP) {
        continue;
      }
      try {
        AfterLoadOutcome outcome = analysis.analyzeAfterLoad(userId, id, profiles);
        if (outcome == AfterLoadOutcome.RESPONDED) {
          breaker.recordSuccess();
        } else if (outcome == AfterLoadOutcome.AI_FAILED) {
          breaker.recordFailure(id);
        }
      } catch (RuntimeException e) {
        breaker.onError(id, e);
        log.warn("적재 후 분석 실패 (messageId={}): {}", id, e.toString());
      }
    }
  }

  /**
   * 보충이 끝난 뒤 새 메일 푸시(WP-1739, best-effort) — 동기화 전 경계 뒤로 들어온 안 읽은 메일을 판정해 보낸다. 후보 조회는 RLS 테이블이라 짧은
   * 트랜잭션으로 감싸 테넌트 GUC 를 주입한다(테넌트 문맥은 비동기 워커로 전파돼 있다). 어떤 예외도 보충·분석을 막지 않게 삼킨다.
   */
  private void sendNewMailQuietly(long userId, NewMailPush push) {
    if (push == null) {
      return; // 발송 정보 없음 — 첫 동기화·동기화 밖 보충
    }
    try {
      txTemplate.executeWithoutResult(
          status -> pushService.sendNewMail(userId, push.account(), push.maxInboxId()));
    } catch (Exception ex) {
      log.warn("[push] 본문 보충 뒤 새 메일 푸시 실패 accountId={}: {}", push.account().id(), ex.toString());
    }
  }
}

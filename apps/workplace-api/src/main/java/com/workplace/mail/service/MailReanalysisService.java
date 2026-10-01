package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 새 기준 재분석(WP-151) — 회신필요 판정 기준이 바뀐 뒤(WP-149 ④ 개인 분석 + ⑤ 최종 판정) AI 사용 계정마다 정확히 1회, 새 흐름으로 아직 분석하지
 * 않은 안 읽은 INBOX 최근 {@value #LIMIT}건을 다시 판정해 배포 전 기준의 ai_needs_reply 를 바로잡는다.
 *
 * <p>1회 보장: 처리 직전에 email_account.ai_classify_version 을 조건부 UPDATE 로 선점한다 — 여러 레플리카·연속 주기가 같은 계정을
 * 집어도 한 곳만 실행한다. 비서가 없으면 선점하지 않아(버전 소진 방지) 비서 설정 후 다시 대상이 된다. 시도가 전부 실패하면(agent 다운 등) 선점을 되돌려 다음
 * 주기에 다시 시도한다 — ai_analyzed_at 가드로 이미 성공한 메일은 재호출되지 않는다.
 *
 * <p>④ 는 공개 진입점 {@link MailAnalysisService#analyzePersonal(long, long, UserMailProfileCache)} 를 그대로
 * 쓴다(배포 전 행은 ai_analyzed_at 이 NULL 이라 가드를 통과한다). "나" 프로필 캐시({@link
 * MailAnalysisService#newProfileCache})는 계정마다 1개 — AI 켬 백필과 같은 배치 단위(WP-150). 기존 개인 요약이 있는 행은 그
 * 진입점이 needsReply 만 요청한다. LLM 은 트랜잭션 밖에서 메일마다 순서대로 부르고(동시 호출 없음), 선점·조회·되돌리기만 짧은 트랜잭션(@Primary
 * TenantAwareTransactionManager → RLS GUC)으로 감싼다. 호출자가 TenantContext 를 설정한다.
 */
@Slf4j
@Service
public class MailReanalysisService {

  /** 현재 회신필요 판정 기준 버전 — 계정의 ai_classify_version 이 이보다 낮으면 재분석 대상. */
  public static final int CURRENT_CLASSIFY_VERSION = 1;

  /** 계정당 재분석 상한 — 홈 위젯·사이드바 표면(최근 안읽음)에 충분하고 LLM 비용을 묶는다. */
  public static final int LIMIT = 50;

  /** 연속 실패가 이만큼 쌓이면 그 계정의 루프를 멈춘다 — agent 장애 때 타임아웃 호출이 50회 쌓이지 않게. */
  static final int MAX_CONSECUTIVE_FAILURES = 3;

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;
  private final MailAnalysisService analysis;
  private final AssistantResolver assistantResolver;
  private final TransactionTemplate txTemplate;

  public MailReanalysisService(
      EmailAccountRepository accountRepo,
      EmailMessageRepository messageRepo,
      MailAnalysisService analysis,
      AssistantResolver assistantResolver,
      PlatformTransactionManager txManager) {
    this.accountRepo = accountRepo;
    this.messageRepo = messageRepo;
    this.analysis = analysis;
    this.assistantResolver = assistantResolver;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * 계정 1개를 재분석한다(동기). 비서 없음·이미 최신 버전·AI 꺼짐·해지 계정이면 아무것도 하지 않는다.
   *
   * @return 이번 호출이 계정을 선점했으면 true(전부 실패해 되돌린 경우 포함) — 스케줄러의 실행당 계정 상한 계산에 쓴다
   */
  public boolean reanalyzeAccountNow(long userId, long accountId) {
    // 비서가 없으면 ④ 가 전부 건너뛰므로 선점하지 않는다 — 버전을 헛되이 소진하지 않게
    if (assistantResolver.resolveOrEmpty(userId).isEmpty()) {
      return false;
    }
    Boolean claimed =
        txTemplate.execute(
            status -> accountRepo.claimClassifyVersion(accountId, CURRENT_CLASSIFY_VERSION));
    if (!Boolean.TRUE.equals(claimed)) {
      return false; // 이미 최신 버전이거나 다른 실행이 선점, 또는 그사이 AI 꺼짐
    }
    List<Long> ids;
    try {
      ids = txTemplate.execute(status -> messageRepo.listReanalysisTargetIds(accountId, LIMIT));
    } catch (RuntimeException e) {
      release(accountId);
      log.warn("재분석 대상 조회 실패 — 선점 되돌림 accountId={}: {}", accountId, e.toString());
      return true;
    }
    if (ids == null || ids.isEmpty()) {
      log.info("재분석 완료(대상 없음) accountId={}", accountId);
      return true;
    }
    // "나" 프로필 캐시 — 이 계정 재분석 동안 1개(WP-150 배치 캐시). 메일마다 주소·이름·소속을 다시 읽지 않고, 다음 계정과는 공유하지 않는다.
    UserMailProfileCache profiles = analysis.newProfileCache();
    int done = 0;
    int failed = 0;
    int streak = 0;
    for (Long id : ids) {
      try {
        analysis.analyzePersonal(userId, id, profiles);
        done++;
        streak = 0;
      } catch (RuntimeException e) {
        failed++;
        log.warn("재분석 건너뜀 (messageId={}): {}", id, e.toString());
        // 연속 실패 = agent 다운·지연으로 본다 — 남은 메일에 타임아웃을 계속 쌓지 않고 멈춘다(장애 시 비용 = 계정당 몇 회)
        if (++streak >= MAX_CONSECUTIVE_FAILURES) {
          break;
        }
      }
    }
    if (done == 0) {
      // 하나도 성공하지 못함 = 일시 장애 — 버전을 되돌려 다음 주기에 다시 시도. 일부라도 성공했으면 되돌리지 않는다:
      // 되돌리면 ai_analyzed_at 필터 때문에 재시도가 그다음 50건을 골라 계정당 상한(50)을 넘게 된다.
      release(accountId);
      log.warn("재분석 성공 0건 — 선점 되돌림 accountId={} 실패={}", accountId, failed);
    } else {
      log.info("재분석 완료 accountId={} 대상={} 성공={} 실패={}", accountId, ids.size(), done, failed);
    }
    return true;
  }

  /**
   * 선점 되돌리기(CAS — 현재 버전일 때만 한 단계 내림). 되돌리기 실패(DB 일시 장애 등)가 호출자(스케줄러)로 새지 않도록 삼키고 경고만 남긴다 — 실패하면 버전이
   * 소진된 채 남아 해당 계정은 열람 시 자연 해제된다.
   */
  private void release(long accountId) {
    try {
      txTemplate.executeWithoutResult(
          status -> accountRepo.releaseClassifyVersion(accountId, CURRENT_CLASSIFY_VERSION));
    } catch (RuntimeException e) {
      log.warn("재분석 선점 되돌리기 실패 accountId={}: {}", accountId, e.toString());
    }
  }
}

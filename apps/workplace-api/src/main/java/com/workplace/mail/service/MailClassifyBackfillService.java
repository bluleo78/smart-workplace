package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 AI 사용 켬(off→on) 시 호출(WP-149) — 최근 안읽은·본문 적재된 미분석 INBOX 메일 50건에 ④ 개인 분석 + ⑤ 최종 판정을 실행해, 켠 직후
 * 홈·사이드바의 "회신 필요"가 의미를 갖게 한다. 읽은 메일은 대상이 아니다(판단 13). 배포 전에 분류된 메일도 대상이 아니다(재분석은 WP-151).
 * best-effort: 메시지별 실패는 삼킨다. LLM 은 트랜잭션 밖에서 부른다(#232).
 *
 * <p>이름은 호출부 호환을 위해 유지하지만 실제 역할은 "AI 켬 개인 분석 백필"이다. {@link MailSummaryBackfillService} 의 ④ 패스와 달리
 * 본문을 새로 적재하지 않고(이미 적재된 메일만) 상한도 50건이라 의도적으로 분리해 둔다.
 */
@Slf4j
@Service
public class MailClassifyBackfillService {

  /** 한 회 상한 — 홈 위젯 표면(최근)에 충분. */
  public static final int LIMIT = 50;

  private final EmailMessageRepository messageRepo;
  private final MailAnalysisService analysis;

  /** 대상 조회용 — @Primary TenantAwareTransactionManager 라 진입 시 RLS GUC 주입. */
  private final TransactionTemplate txTemplate;

  public MailClassifyBackfillService(
      EmailMessageRepository messageRepo,
      MailAnalysisService analysis,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.analysis = analysis;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** off→on 전환 비동기 진입점. TenantContext 전파 실패 시 RLS fail-closed 라 경고 후 skip. */
  @Async("aiAgentEventExecutor")
  public void classifyRecentUnread(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("개인 분석 백필 skip — TenantContext 없음 accountId={}", accountId);
      return;
    }
    classifyRecentUnreadNow(userId, accountId);
  }

  /** 동기 본체. 비서 없음·미적재·AI 꺼짐은 분석 서비스가 건너뛴다. */
  public void classifyRecentUnreadNow(long userId, long accountId) {
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnanalyzedIds(accountId, LIMIT));
    if (ids == null) {
      return;
    }
    UserMailProfileCache profiles = analysis.newProfileCache(); // 이 백필 동안 "나" 프로필 1회 조회(WP-150)
    for (Long id : ids) {
      try {
        analysis.analyzePersonal(userId, id, profiles);
      } catch (RuntimeException e) {
        log.warn("개인 분석 백필 건너뜀 (messageId={}): {}", id, e.toString());
      }
    }
  }
}

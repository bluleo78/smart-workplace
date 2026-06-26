package com.workplace.mail.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 AI 분류 활성화(off→on) 시 호출 — 최근 안읽은·미분류 메일을 분류해 회신 필요 신호를 채운다. 기존 sync 가 본문을 이미 적재한 미분류 메일까지
 * 다루므로(MailBackfillService 와 달리 본문 유무 무관), 켠 직후 홈 위젯의 "회신 필요" 카운트가 의미를 갖는다. best-effort: 실패는 삼킨다.
 */
@Slf4j
@Service
public class MailClassifyBackfillService {

  /** 한 회 분류 상한 — 홈 위젯 표면(최근)에 충분. */
  public static final int LIMIT = 50;

  private final EmailMessageRepository messageRepo;
  private final MailAiService mailAiService;

  /**
   * TransactionTemplate 은 @Primary {@code TenantAwareTransactionManager} 로 구성 — 분류 쿼리와
   * updateClassification(RLS write) 모두 트랜잭션 진입 시 GUC(app.tenant_id) 주입이 필요하다.
   */
  private final TransactionTemplate txTemplate;

  public MailClassifyBackfillService(
      EmailMessageRepository messageRepo,
      MailAiService mailAiService,
      PlatformTransactionManager txManager) {
    this.messageRepo = messageRepo;
    this.mailAiService = mailAiService;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /**
   * off→on 전환 비동기 진입점. TenantContext 는 TenantContextTaskDecorator 가 전파. null 가드: 전파 실패 시 GUC 미설정으로
   * RLS fail-closed 되므로 명시적으로 경고 후 skip.
   */
  @Async("aiAgentEventExecutor")
  public void classifyRecentUnread(long userId, long accountId) {
    if (TenantContext.get() == null) {
      log.warn("분류 백필 skip — TenantContext 없음 accountId={}", accountId);
      return;
    }
    classifyRecentUnreadNow(userId, accountId);
  }

  /** 동기 본체. 테스트는 이 메서드를 직접 호출해 같은 스레드에서 검증한다. */
  public void classifyRecentUnreadNow(long userId, long accountId) {
    AssistantSpec spec = mailAiService.resolveSpecOrNull(userId);
    if (spec == null) {
      return; // 비서 미설정 — 분류 생략
    }
    List<Long> ids =
        txTemplate.execute(status -> messageRepo.listRecentUnreadUnclassifiedIds(accountId, LIMIT));
    if (ids == null) {
      return;
    }
    // 분류 결과 저장(updateClassification)은 RLS write → 메시지별 짧은 트랜잭션으로 GUC 주입.
    for (Long id : ids) {
      txTemplate.executeWithoutResult(status -> mailAiService.classifyAndStore(userId, id, spec));
    }
  }
}

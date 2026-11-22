package com.workplace.mail;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.MailAccountJobRepository.Kind;
import com.workplace.mail.service.MailAnalysisBreaker;
import com.workplace.mail.service.MailAnalysisService;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailJobRun;
import com.workplace.mail.service.MailPushService;
import com.workplace.mail.service.MailPushService.NewMailPush;
import com.workplace.mail.service.MailSyncProgress;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Task 4 null 가드 단위 테스트 — @Async backfill() 진입 시 TenantContext 가 없으면(비테넌트/전파 실패) RLS 테이블 접근 없이 즉시
 * skip 하고 progress.finish 로 종료함을 검증한다. Spring 컨텍스트 없이 순수 Mockito 로 구동.
 */
class MailBackfillNullGuardTest {

  private EmailMessageRepository messageRepo;
  private MailBodyFetcher bodyFetcher;
  private MailSyncProgress progress;
  private MailAnalysisService analysis;
  private MailPushService push;
  private MailBackfillService service;

  @BeforeEach
  void setUp() {
    messageRepo = Mockito.mock(EmailMessageRepository.class);
    bodyFetcher = Mockito.mock(MailBodyFetcher.class);
    progress = Mockito.mock(MailSyncProgress.class);
    analysis = Mockito.mock(MailAnalysisService.class);
    push = Mockito.mock(MailPushService.class);
    PlatformTransactionManager txManager = Mockito.mock(PlatformTransactionManager.class);
    service =
        new MailBackfillService(
            messageRepo,
            bodyFetcher,
            progress,
            analysis,
            txManager,
            push,
            new MailAnalysisBreaker(),
            Runnable::run);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void backfill_withoutTenantContext_skips_andFinishes() {
    TenantContext.clear(); // 비테넌트 컨텍스트
    MailJobRun run = new MailJobRun(Kind.SYNC, 42L, UUID.randomUUID(), 1L);

    service.backfill(
        7L,
        42L,
        new NewMailPush(Mockito.mock(com.workplace.mail.dto.EmailAccountResponse.class), 3L),
        run);

    // RLS 테이블 접근(listMissingBody)과 본문 적재가 일어나지 않아야 한다.
    verify(messageRepo, never()).listMissingBody(Mockito.anyLong(), Mockito.anyInt());
    verify(bodyFetcher, never()).fetchBody(Mockito.anyLong(), Mockito.any());
    // 진행률은 정상 종료 처리(stuck 방지) — 동기화가 넘긴 실행 핸들로 끝낸다(핸들의 테넌트로 문맥을 세워 쓴다, WP-1977).
    verify(progress).finish(run);
    verify(analysis, never()).analyzeAfterLoad(Mockito.anyLong(), Mockito.anyLong(), Mockito.any());
    // 테넌트가 없으면 푸시도 싣지 못한다(RLS 후보 조회·발송 테넌트 모두 불가) — 발송하지 않는다(WP-1739).
    verify(push, never()).sendNewMail(Mockito.anyLong(), Mockito.any(), Mockito.anyLong());
  }
}

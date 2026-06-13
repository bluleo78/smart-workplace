package com.workplace.mail;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailSyncProgress;
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
  private MailBackfillService service;

  @BeforeEach
  void setUp() {
    messageRepo = Mockito.mock(EmailMessageRepository.class);
    bodyFetcher = Mockito.mock(MailBodyFetcher.class);
    progress = Mockito.mock(MailSyncProgress.class);
    PlatformTransactionManager txManager = Mockito.mock(PlatformTransactionManager.class);
    service = new MailBackfillService(messageRepo, bodyFetcher, progress, txManager);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void backfill_withoutTenantContext_skips_andFinishes() {
    TenantContext.clear(); // 비테넌트 컨텍스트

    service.backfill(7L, 42L);

    // RLS 테이블 접근(listMissingBody)과 본문 적재가 일어나지 않아야 한다.
    verify(messageRepo, never()).listMissingBody(Mockito.anyLong(), Mockito.anyInt());
    verify(bodyFetcher, never()).fetchBody(Mockito.anyLong(), Mockito.any());
    // 진행률은 정상 종료 처리(stuck 방지).
    verify(progress).finish(42L);
  }
}

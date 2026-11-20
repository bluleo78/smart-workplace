package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.outbound.MailChangeNotifier;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.folder.MailFolderService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * WP-1812 — 메일 분석 실행기가 가득 차 {@link TaskRejectedException} 을 던져도 동기화가 예외 없이 결과를 돌려주고 진행바를 끝내는지 검증하는
 * Mockito 단위 테스트. 거절이 동기화 전체를 깨거나 진행바를 영원히 켜 두면 안 된다.
 */
class MailSyncServiceRejectionTest {

  private static final long USER = 1L;
  private static final long ACCOUNT = 7L;

  private EmailAccountRepository accountRepo;
  private EmailMessageRepository messageRepo;
  private MailSyncProgress progress;
  private MailBackfillService backfillService;
  private MailSummaryBackfillService summaryBackfillService;
  private MailFetcher fetcher;

  @BeforeEach
  void setUp() {
    accountRepo = mock(EmailAccountRepository.class);
    messageRepo = mock(EmailMessageRepository.class);
    progress = spy(new MailSyncProgress());
    backfillService = mock(MailBackfillService.class);
    summaryBackfillService = mock(MailSummaryBackfillService.class);
    fetcher = mock(MailFetcher.class);
    when(fetcher.provider()).thenReturn(MailProvider.IMAP);
    when(fetcher.fetchNewMessages(anyLong(), anyLong(), any()))
        .thenReturn(new MailSyncResult(0, 0, 0));
  }

  private MailSyncService service(boolean aiEnabled) {
    EmailAccountResponse account =
        new EmailAccountResponse(
            ACCOUNT,
            "a@b.c",
            "A",
            "h",
            993,
            null,
            "u",
            "h",
            587,
            null,
            "u",
            null,
            null,
            null,
            aiEnabled,
            null,
            MailProvider.IMAP,
            "WORK");
    when(accountRepo.findByIdAndUser(USER, ACCOUNT)).thenReturn(Optional.of(account));
    return new MailSyncService(
        accountRepo,
        messageRepo,
        progress,
        backfillService,
        mock(MailChangeNotifier.class),
        summaryBackfillService,
        mock(PlatformTransactionManager.class),
        List.of(fetcher),
        mock(MailFolderService.class),
        mock(MailPushService.class));
  }

  @Test
  void backfillRejectionFinishesProgressAndReturnsResult() {
    MailSyncService service = service(false);
    when(messageRepo.countMissingBody(ACCOUNT)).thenReturn(3);
    doThrow(new TaskRejectedException("full"))
        .when(backfillService)
        .backfill(anyLong(), anyLong(), any());

    MailSyncResult result = service.sync(USER, ACCOUNT);

    assertThat(result).isNotNull();
    // 백필이 거절돼 끝낼 책임을 못 지므로 finally 가 진행바를 정확히 한 번 끝낸다.
    verify(progress).finish(ACCOUNT);
  }

  @Test
  void summaryRejectionIsSwallowed() {
    MailSyncService service = service(true);
    when(messageRepo.countMissingBody(ACCOUNT)).thenReturn(0);
    doThrow(new TaskRejectedException("full"))
        .when(summaryBackfillService)
        .summarizeRecentUnread(USER, ACCOUNT);

    MailSyncResult result = service.sync(USER, ACCOUNT);

    assertThat(result).isNotNull();
    verify(progress).finish(ACCOUNT);
    verify(backfillService, never()).backfill(anyLong(), anyLong(), any());
  }
}

package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailBodyLoader;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * MailBodyFetcher 순수 단위 테스트. WP-149: 디스패처는 본문만 적재하고 "이번에 적재했는지"를 돌려준다 — 분석은 호출자(본문 보충)가 트랜잭션 밖에서
 * 한다. 적재 실패(false)면 호출자도 분석하지 않아 빈 스니펫 기반 오분류를 막는다(I1).
 */
class MailBodyFetcherUnitTest {

  private MailBodyLoader loader;
  private MailBodyFetcher fetcher;

  @BeforeEach
  void setUp() {
    loader = mock(MailBodyLoader.class);
    when(loader.provider()).thenReturn(MailProvider.IMAP);
    EmailAccountResponse account =
        new EmailAccountResponse(
            1L,
            "test@example.com",
            "테스트",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            true,
            null,
            MailProvider.IMAP);
    EmailAccountRepository accountRepo = mock(EmailAccountRepository.class);
    when(accountRepo.findByIdAndUser(anyLong(), anyLong())).thenReturn(Optional.of(account));
    fetcher = new MailBodyFetcher(accountRepo, List.of(loader));
  }

  @Test
  void loadFails_returnsFalse() {
    when(loader.loadBody(anyLong(), any(BodyTarget.class), any(EmailAccountResponse.class)))
        .thenReturn(false);

    assertThat(fetcher.fetchBody(1L, new BodyTarget(10L, 1L, 0L, "INBOX", null, null, 0L)))
        .isFalse();
  }

  @Test
  void loadSucceeds_returnsTrue() {
    when(loader.loadBody(anyLong(), any(BodyTarget.class), any(EmailAccountResponse.class)))
        .thenReturn(true);

    assertThat(fetcher.fetchBody(1L, new BodyTarget(10L, 1L, 3L, "INBOX", null, null, 7L)))
        .isTrue();
  }

  @Test
  void alreadyFetched_returnsFalse_withoutLoading() {
    BodyTarget fetched = new BodyTarget(10L, 1L, 3L, "INBOX", Instant.now(), null, 7L);

    assertThat(fetcher.fetchBody(1L, fetched)).isFalse();
    verify(loader, never()).loadBody(anyLong(), any(), any());
  }
}

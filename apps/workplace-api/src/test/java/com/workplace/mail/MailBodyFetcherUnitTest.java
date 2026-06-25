package com.workplace.mail;

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
import com.workplace.mail.service.MailAiService;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.mail.service.MailBodyLoader;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * MailBodyFetcher 순수 단위 테스트(Spring 없음).
 *
 * <p>I1 회귀 가드: loadBody 실패(false 반환) 시 classifyAndStore 가 호출되지 않아야 한다. 적재 실패 시 빈 스니펫으로 분류하면
 * ai_needs_reply 가 영구 기록되고 본문 적재 후에도 재분류 안 되는 오분류 회귀를 차단한다.
 */
class MailBodyFetcherUnitTest {

  /** loadBody 가 false 를 반환하면(적재 실패) classifyAndStore 는 호출되지 않는다(I1 회귀 가드). */
  @Test
  void fetchBody_loadBodyFails_classifySkipped() {
    // 스텁 loader: provider=IMAP, loadBody=false(적재 실패)
    MailBodyLoader loader = mock(MailBodyLoader.class);
    when(loader.provider()).thenReturn(MailProvider.IMAP);
    when(loader.loadBody(anyLong(), any(BodyTarget.class), any(EmailAccountResponse.class)))
        .thenReturn(false);

    // 스텁 account: aiEnabled=true (적재 성공이었으면 분류됐을 조건)
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
            true, // aiEnabled=true — 적재 성공이면 분류 진행할 조건
            null,
            MailProvider.IMAP);

    // 스텁 repository: account 반환
    EmailAccountRepository accountRepo = mock(EmailAccountRepository.class);
    when(accountRepo.findByIdAndUser(anyLong(), anyLong())).thenReturn(Optional.of(account));

    // 스텁 mailAiService
    MailAiService mailAiService = mock(MailAiService.class);

    // MailBodyFetcher 직접 생성(Spring 없음)
    MailBodyFetcher fetcher = new MailBodyFetcher(accountRepo, mailAiService, List.of(loader));

    // bodyFetchedAt=null 인 BodyTarget(미적재 상태)
    BodyTarget target = new BodyTarget(10L, 1L, 0L, "INBOX", null, null);

    fetcher.fetchBody(1L, target);

    // loadBody=false 이면 classifyAndStore 는 절대 호출되지 않아야 한다.
    verify(mailAiService, never()).classifyAndStore(anyLong(), anyLong(), any());
    verify(mailAiService, never()).resolveSpecOrNull(anyLong());
  }
}

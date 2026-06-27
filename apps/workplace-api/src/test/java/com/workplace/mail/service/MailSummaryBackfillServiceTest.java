package com.workplace.mail.service;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * MailSummaryBackfillService 단위 테스트. Spring 컨텍스트 없이 Mockito 만으로 서비스 로직 검증 — (a) 본문 있음 → 요약 호출, (b)
 * 빈본문 → 요약 미호출, (c) resolveSpecOrNull=null → 아무것도 안 함.
 */
@ExtendWith(MockitoExtension.class)
class MailSummaryBackfillServiceTest {

  private static final long USER = 1L;
  private static final long ACCOUNT = 2L;

  @Mock private EmailMessageRepository messageRepo;
  @Mock private MailBodyFetcher bodyFetcher;
  @Mock private MailAiService mailAiService;
  @Mock private PlatformTransactionManager txManager;

  private MailSummaryBackfillService service;
  private AssistantSpec spec;

  @BeforeEach
  void setUp() {
    // TransactionTemplate 이 txManager.getTransaction() 을 호출할 때 더미 상태 반환
    // → execute(callback) 이 콜백을 동기 실행하도록 허용.
    // lenient: resolveSpec=null 단축 경로에서는 txManager 가 호출되지 않아도 무시.
    org.mockito.Mockito.lenient()
        .when(
            txManager.getTransaction(org.mockito.ArgumentMatchers.any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    service = new MailSummaryBackfillService(messageRepo, bodyFetcher, mailAiService, txManager);
    spec = new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60_000);
  }

  /**
   * AiContext 생성 헬퍼 — 필드 순서: aiEnabled, selfAddress, subject, fromAddress, bodyText, bodyHtml,
   * summary
   */
  private static AiContext aiContext(String bodyText, String bodyHtml) {
    return new AiContext(
        true, "self@test.local", "제목", "from@test.local", bodyText, bodyHtml, null);
  }

  @Test
  void summarizeRecentUnreadNow_본문있으면_요약호출_빈본문은_skip() {
    given(mailAiService.resolveSpecOrNull(USER)).willReturn(spec);
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(10L, 11L));
    // 10L: 본문 있음 → 요약 대상
    given(messageRepo.findAiContextByIdAndUser(USER, 10L))
        .willReturn(Optional.of(aiContext("본문 텍스트", null)));
    // 11L: 본문 없음(빈) → skip
    given(messageRepo.findAiContextByIdAndUser(USER, 11L))
        .willReturn(Optional.of(aiContext(null, null)));
    // fetchBody 불필요 경로: bodyFetchedAt != null 이거나 imapUid == 0 → Optional.empty()
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());

    service.summarizeRecentUnreadNow(USER, ACCOUNT);

    verify(mailAiService).summarize(USER, 10L);
    verify(mailAiService, never()).summarize(USER, 11L);
  }

  @Test
  void summarizeRecentUnreadNow_resolveSpecNull_아무것도안함() {
    given(mailAiService.resolveSpecOrNull(USER)).willReturn(null);

    service.summarizeRecentUnreadNow(USER, ACCOUNT);

    verify(messageRepo, never())
        .listRecentUnreadUnsummarizedIds(anyLong(), org.mockito.ArgumentMatchers.anyInt());
    verify(mailAiService, never()).summarize(anyLong(), anyLong());
  }

  @Test
  void summarizeRecentUnreadNow_bodyFetch_후_빈본문이면_skip() {
    // 본문 미적재 메시지: imapUid != 0, bodyFetchedAt = null → fetch 후에도 빈 본문
    given(mailAiService.resolveSpecOrNull(USER)).willReturn(spec);
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(20L));
    // bodyTarget 이 fetch 필요(imapUid=5, bodyFetchedAt=null)
    BodyTarget fetchNeeded = new BodyTarget(20L, 99L, 5L, "INBOX", null, null, 0L);
    given(messageRepo.findBodyTargetForUser(USER, 20L)).willReturn(Optional.of(fetchNeeded));
    // fetch 후에도 본문이 빈 경우
    given(messageRepo.findAiContextByIdAndUser(USER, 20L))
        .willReturn(Optional.of(aiContext(null, null)));

    service.summarizeRecentUnreadNow(USER, ACCOUNT);

    verify(bodyFetcher).fetchBody(USER, fetchNeeded);
    verify(mailAiService, never()).summarize(anyLong(), anyLong());
  }
}

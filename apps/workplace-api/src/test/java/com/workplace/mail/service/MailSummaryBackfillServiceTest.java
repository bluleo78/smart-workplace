package com.workplace.mail.service;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * WP-149 동기화 후 선제 백필 단위 테스트 — ③ 패스는 원본 미분석(content.ai_summarized_at) 대상에 analyzeContent, ④ 패스는 사본
 * 미분석 대상에 analyzePersonal. 본문이 없으면 먼저 적재하고, 메시지별 실패는 삼킨다.
 */
@ExtendWith(MockitoExtension.class)
class MailSummaryBackfillServiceTest {

  private static final long USER = 1L;
  private static final long ACCOUNT = 2L;

  @Mock private EmailMessageRepository messageRepo;
  @Mock private MailBodyFetcher bodyFetcher;
  @Mock private MailAnalysisService analysis;
  @Mock private PlatformTransactionManager txManager;

  private MailSummaryBackfillService service;

  @BeforeEach
  void setUp() {
    lenient()
        .when(txManager.getTransaction(ArgumentMatchers.any(TransactionDefinition.class)))
        .thenReturn(new SimpleTransactionStatus());
    service = new MailSummaryBackfillService(messageRepo, bodyFetcher, analysis, txManager);
  }

  @Test
  void contentPass_loadsMissingBody_thenAnalyzesContent() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(10L, 11L));
    given(messageRepo.findBodyTargetForUser(USER, 10L)).willReturn(Optional.empty());
    BodyTarget fetchNeeded = new BodyTarget(11L, 99L, 5L, "INBOX", null, null, 0L);
    given(messageRepo.findBodyTargetForUser(USER, 11L)).willReturn(Optional.of(fetchNeeded));

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis).analyzeContent(USER, 10L);
    verify(bodyFetcher).fetchBody(USER, fetchNeeded);
    verify(analysis).analyzeContent(USER, 11L);
    verify(analysis, never()).analyzePersonal(anyLong(), anyLong());
  }

  @Test
  void personalPass_usesUnanalyzedTargets() {
    given(messageRepo.listRecentUnreadUnanalyzedIds(ACCOUNT, 20)).willReturn(List.of(20L));
    given(messageRepo.findBodyTargetForUser(USER, 20L)).willReturn(Optional.empty());

    service.summarizePersonalRecentNow(USER, ACCOUNT);

    verify(analysis).analyzePersonal(USER, 20L);
    verify(analysis, never()).analyzeContent(anyLong(), anyLong());
  }

  @Test
  void nullTargets_doNothing() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(null);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis, never()).analyzeContent(anyLong(), anyLong());
  }

  @Test
  void perMessageFailure_continues() {
    given(messageRepo.listRecentUnreadUnsummarizedIds(ACCOUNT, 20)).willReturn(List.of(50L, 51L));
    given(messageRepo.findBodyTargetForUser(eq(USER), anyLong())).willReturn(Optional.empty());
    doThrow(new RuntimeException("LLM 오류")).when(analysis).analyzeContent(USER, 50L);

    service.summarizeObjectiveRecentNow(USER, ACCOUNT);

    verify(analysis).analyzeContent(USER, 51L);
  }
}

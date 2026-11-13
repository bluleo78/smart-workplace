package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.workplace.global.tenant.TenantContext;
import java.util.concurrent.RejectedExecutionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

/** 매뉴얼 공백 기록기 시험(WP-1512) — 표식 판정·테넌트 확인·실패 삼킴(채팅을 건드리지 않음). */
class HelpGapRecorderTest {

  private static final String GAP = "x\n\n[매뉴얼 보강](manual-gap:)";

  private final HelpMetricService service = mock(HelpMetricService.class);
  private HelpGapRecorder recorder;

  @BeforeEach
  void setUp() {
    recorder = new HelpGapRecorder(service, Runnable::run);
    TenantContext.set(1L);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void gapAnswerRecordsQuestionAndSection() {
    recorder.recordIfGap("질문", GAP, "mail.rules");
    verify(service).recordAiGap("질문", "mail.rules");
  }

  @Test
  void nonGapAnswerRecordsNothing() {
    recorder.recordIfGap("질문", "그냥 답", "mail.rules");
    verifyNoInteractions(service);
  }

  @Test
  void noTenantRecordsNothing() {
    TenantContext.clear();
    recorder.recordIfGap("질문", GAP, "mail.rules");
    verifyNoInteractions(service);
  }

  /** Review Focus 3 — 기록이 실패해도 예외가 채팅으로 번지지 않는다. */
  @Test
  void repositoryFailureIsSwallowed() {
    doThrow(new DataAccessResourceFailureException("x")).when(service).recordAiGap(any(), any());
    assertThatCode(() -> recorder.recordIfGap("질문", GAP, "mail.rules")).doesNotThrowAnyException();
  }

  @Test
  void executorRejectionIsSwallowed() {
    recorder.useExecutorForTest(
        r -> {
          throw new RejectedExecutionException();
        });
    assertThatCode(() -> recorder.recordIfGap("질문", GAP, "mail.rules")).doesNotThrowAnyException();
  }
}

package com.workplace.help.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.AfterCommit;
import com.workplace.global.util.Texts;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;

/**
 * 홈 AI 답변이 매뉴얼로 답하지 못했을 때(답 끝에 manual-gap: 표식) 질문을 AI_GAP 지표로 남긴다(WP-1512). 서버는 답 전문을 이미 쥐고 있어 직접
 * 판정한다.
 *
 * <p>기록은 전용 실행기에서 비동기로 하고, 어떤 실패(DB·테넌트 없음·실행기 꽉 참)도 호출자(채팅)에게 던지지 않는다.
 */
@Slf4j
@Component
public class HelpGapRecorder {

  private final HelpMetricService service;

  /**
   * 기록을 돌릴 실행기. 테스트가 {@link #useExecutorForTest} 로 실행 중에 바꾸고, 기록은 채팅 펌프 스레드가 읽으므로 volatile 로 두어 바꾼
   * 값이 다른 스레드에 곧바로 보이게 한다.
   */
  private volatile Executor executor;

  /**
   * 지표 서비스와 기록 전용 실행기({@link HelpMetricConfig#helpMetricExecutor}, 단일 스레드·작은 큐)를 받는다 — 기록이 채팅 응답을
   * 늦추지 않게 따로 돌리기 위해서다.
   */
  public HelpGapRecorder(
      HelpMetricService service, @Qualifier("helpMetricExecutor") Executor executor) {
    this.service = service;
    this.executor = executor;
  }

  /** 질문을 이 길이(코드포인트)로 잘라 큐에 넣는다 — 한도 있는 큐가 거대한 원문 질문을 쥐지 않게 한다(서비스가 다시 가리고 200자로 줄인다). */
  private static final int QUESTION_MAX = 2000;

  /** 답이 공백 표식으로 끝나면 질문·도움말 절 id 를 기록하게 한다. 절대 예외를 던지지 않는다. */
  public void recordIfGap(String question, String answer, @Nullable String helpId) {
    swallow(
        () -> {
          if (!ManualGapMarker.endsWithGap(answer)) {
            return;
          }
          // 실행기 스레드는 테넌트가 없으므로 부른 스레드에서 잡아 넘긴다.
          Long tenantId = TenantContext.get();
          if (tenantId == null) {
            return;
          }
          String q = question == null ? null : Texts.headCodePoints(question, QUESTION_MAX);
          AfterCommit.run(() -> executor.execute(() -> runSafely(tenantId, q, helpId)));
        });
  }

  /** 실행기 스레드 — 테넌트를 세워 기록하고, 실패는 로그만 남긴다. */
  private void runSafely(long tenantId, String question, String helpId) {
    swallow(() -> TenantContext.runAs(tenantId, () -> service.recordAiGap(question, helpId)));
  }

  /** 기록 실패가 호출자(채팅)로 새지 않게 삼키고 로그만 남긴다. */
  private static void swallow(Runnable action) {
    try {
      action.run();
    } catch (RuntimeException e) {
      log.warn("도움말 측정 기록 실패(무시): {}", e.getClass().getSimpleName());
    }
  }

  /** 테스트 전용 — 실행기를 바꾸고 이전 것을 돌려준다(테스트가 끝에 되돌린다). */
  public Executor useExecutorForTest(Executor e) {
    Executor prev = this.executor;
    this.executor = e;
    return prev;
  }
}

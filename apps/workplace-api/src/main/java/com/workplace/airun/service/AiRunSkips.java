package com.workplace.airun.service;

import com.workplace.airun.context.AiRunContext;
import com.workplace.airun.dto.AiRunRecord;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * ai-agent 를 부르지 않고 건너뛴 처리를 AI 처리 기록(SKIPPED)으로 남기는 공용 도우미 (WP-1829).
 *
 * <p>왜: 건너뛴 회차는 ai-agent 에 닿지 않아 ai-agent 가 기록할 수 없다. 「왜 이 보고가 안 만들어졌나」를 처리 이력에서 볼 수 있게 호출 쪽이 새 처리
 * ID 로 한 행을 남긴다.
 */
public final class AiRunSkips {

  private static final Logger log = LoggerFactory.getLogger(AiRunSkips.class);

  /** 처리 종류 — 프로젝트 리포트(ai-agent AiRunKinds 의 /issue/project-report 와 같은 값). */
  public static final String PROJECT_REPORT = "PROJECT_REPORT";

  /** 처리 종류 — 개인 보고(/issue/personal-report 와 같은 값). */
  public static final String PERSONAL_REPORT = "PERSONAL_REPORT";

  /** 건너뜀 사유 — 공통 비서가 없다. */
  public static final String NO_ASSISTANT = "no_assistant";

  /** 건너뜀 사유 — 지난 회차와 달라진 게 없다. */
  public static final String NO_CHANGE = "no_change";

  /** 건너뜀 사유 — 보고할 한 일이 없다. */
  public static final String EMPTY = "empty";

  private AiRunSkips() {}

  /**
   * 건너뜀을 SKIPPED 한 행으로 기록한다. 시작·종료 시각은 같은 지금이다. 기록 중 어떤 예외도 삼켜 호출한 쪽의 결과를 바꾸지 않는다.
   *
   * @param kind 처리 종류(예: PROJECT_REPORT)
   * @param ctx 대상·주체·원천 시각
   * @param reason 건너뜀 사유 코드(no_assistant·no_change·empty)
   */
  public static void record(AiRunRecorder recorder, String kind, AiRunContext ctx, String reason) {
    try {
      OffsetDateTime now = OffsetDateTime.now();
      recorder.upsert(
          AiRunRecord.terminal(
              UUID.randomUUID(),
              TenantContext.get(),
              kind,
              ctx,
              ctx.actorType(),
              ctx.actorId(),
              now,
              now,
              "SKIPPED",
              reason,
              null));
    } catch (RuntimeException e) {
      // 기록은 부가 기능 — 보고 생성기의 결과를 가리지 않는다.
      log.warn("AI 처리 건너뜀 기록 중 오류(무시): kind={} reason={}", kind, reason, e);
    }
  }
}

package com.workplace.airun.dto;

import com.workplace.airun.context.AiRunContext;
import com.workplace.global.util.Texts;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * AI 처리 기록 한 건의 보고 값(WP-1827). 같은 {@code runId} 의 보고는 저장소 upsert 가 한 행으로 합친다.
 *
 * @param runId 처리 ID — 합치기 키
 * @param tenantId 테넌트 — 저장 테넌트는 TenantContext 가 있으면 그것, 없으면 이 값(내부 수신 묶음은 이 값으로 라우팅)
 * @param kind 처리 종류(대문자 SNAKE, 48자 이하)
 * @param status RUNNING | SUCCEEDED | FAILED | SKIPPED
 */
public record AiRunRecord(
    UUID runId,
    Long tenantId,
    String kind,
    String targetType,
    String targetId,
    String targetLabel,
    String actorType,
    Long actorId,
    OffsetDateTime sourceAt,
    OffsetDateTime startedAt,
    OffsetDateTime endedAt,
    Long inputTokens,
    Long outputTokens,
    Long cacheReadTokens,
    Long cacheWriteTokens,
    String model,
    String credentialLabel,
    String status,
    String errorReason,
    String errorDetail,
    Integer attempt) {

  /** error_detail 길이 상한(자) — 저장 전 자르기와 청소기의 상세 합치기가 같이 쓴다. */
  public static final int DETAIL_MAX = 2000;

  /**
   * 토큰·모델 없이 끝난 처리(실패·건너뜀) 한 건을 만든다 — 21개 위치 인자를 호출 쪽이 되풀이하지 않게 한다 (WP-1829).
   *
   * @param ctx 대상·원천 시각(null 이면 빈 맥락)
   * @param actorType 주체 종류 — 호출 쪽이 정한다(실패는 호출 정보의 주체, 건너뜀은 맥락의 주체)
   * @param status FAILED | SKIPPED
   */
  public static AiRunRecord terminal(
      UUID runId,
      Long tenantId,
      String kind,
      AiRunContext ctx,
      String actorType,
      Long actorId,
      OffsetDateTime startedAt,
      OffsetDateTime endedAt,
      String status,
      String errorReason,
      String errorDetail) {
    AiRunContext c = ctx != null ? ctx : AiRunContext.empty();
    return new AiRunRecord(
        runId,
        tenantId,
        kind,
        c.targetType(),
        c.targetId(),
        c.targetLabel(),
        actorType,
        actorId,
        c.sourceAt(),
        startedAt,
        endedAt,
        null,
        null,
        null,
        null,
        null,
        null,
        status,
        errorReason,
        errorDetail,
        null);
  }

  /**
   * 칸별 최대 길이로 자른 사본을 돌려준다(먼저 NUL 문자를 제거 — Postgres text 는 NUL 을 거절한다) — 넘치면 거절하지 않고 잘라 저장한다(표의
   * VARCHAR 한도·error_detail 2,000자와 같은 값).
   */
  public AiRunRecord truncated() {
    return new AiRunRecord(
        runId,
        tenantId,
        cut(kind, 48),
        cut(targetType, 32),
        cut(targetId, 64),
        cut(targetLabel, 200),
        actorType,
        actorId,
        sourceAt,
        startedAt,
        endedAt,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cut(model, 100),
        cut(credentialLabel, 100),
        status,
        cut(errorReason, 200),
        cut(errorDetail, DETAIL_MAX),
        clampAttempt(attempt));
  }

  /**
   * attempt 를 0..Short.MAX_VALUE 로 묶는다 — 표 칸이 smallint 라 범위를 넘으면 shortValue() 가 엉뚱한 값(음수 등)으로 돌아가기
   * 때문.
   */
  private static Integer clampAttempt(Integer attempt) {
    return attempt == null ? null : Math.clamp(attempt, 0, Short.MAX_VALUE);
  }

  /** 문자 수 기준으로 자른다(서로게이트 쌍 중간에서 끊지 않는다). */
  private static String cut(String raw, int max) {
    if (raw == null) {
      return null;
    }
    // NUL 제거 후 자른다 — 제거로 길이가 줄 수 있어 자르기 전에 한다. 자르기는 서로게이트 쌍을 끊지 않는 공용 도우미에 맡긴다.
    return Texts.headUtf16(raw.indexOf('\u0000') >= 0 ? raw.replace("\u0000", "") : raw, max);
  }
}

package com.workplace.airun.repository;

import static com.workplace.jooq.Tables.AI_RUN;
import static org.jooq.impl.DSL.case_;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.excluded;
import static org.jooq.impl.DSL.greatest;
import static org.jooq.impl.DSL.least;
import static org.jooq.impl.DSL.val;

import com.workplace.airun.dto.AiRunRecord;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 처리 기록(ai_run) 리포지토리(WP-1827). 처리 ID 하나가 한 행이고, 같은 ID 의 보고(시작·종료·재전송, 순서 뒤바뀜 포함)는 {@link
 * #upsert} 가 합친다. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은 tenant_id 를 넣지 않는다).
 */
@Repository
@RequiredArgsConstructor
public class AiRunRepository {

  /** 보고 없이 멈춘 처리를 실패로 닫을 때 남기는 사유. */
  static final String STALE_REASON = "보고 없음";

  /**
   * 청소기가 닫은 행에 사유 없이 늦은 FAILED 가 왔을 때 남기는 사유 — 사유 없는 FAILED 를 남기지 않되 「보고 없음」 표지와 달라야 한다(표지가 남으면 그 뒤
   * 성공 재전송이 실제로 보고된 실패를 뒤집는다, WP-1827 리뷰 후속).
   */
  static final String UNREPORTED_REASON = "사유 미보고";

  private final DSLContext dsl;

  /** 상태 순위 — FAILED(3) > SUCCEEDED·SKIPPED(2) > RUNNING(1). */
  private static Field<Integer> rank(Field<String> status) {
    return case_(status).when("FAILED", 3).when("SUCCEEDED", 2).when("SKIPPED", 2).else_(1);
  }

  /** 새 값이 있으면 새 값, 없으면 기존 값 — coalesce(excluded(f), f). */
  private static <T> Field<T> preferNew(Field<T> f) {
    return coalesce(excluded(f), f);
  }

  /** 먼저 들어온 값을 유지(기존이 NULL 일 때만 새 값) — coalesce(f, excluded(f)). */
  private static <T> Field<T> keepFirst(Field<T> f) {
    return coalesce(f, excluded(f));
  }

  /** 늦은 보고가 이기면 보고 값(NULL 포함)으로 덮고, 아니면 먼저 들어온 값을 유지한다. */
  private static <T> Field<T> lateWinsOrKeepFirst(Condition lateReportWins, Field<T> f) {
    return lateWinsOrKeepFirst(lateReportWins, excluded(f), f);
  }

  /** 늦은 보고가 이기면 {@code lateValue} 로 덮고, 아니면 먼저 들어온 값을 유지한다. */
  private static <T> Field<T> lateWinsOrKeepFirst(
      Condition lateReportWins, Field<T> lateValue, Field<T> f) {
    return case_().when(lateReportWins, lateValue).else_(keepFirst(f));
  }

  /**
   * 기존 사유가 5xx 표지({@code http_<코드>})이고 이번 보고에 사유가 있으면 그 사유로 덮는다 — keep-first 의 예외.
   *
   * <p>왜: 표지는 API 쪽이 먼저 채우는 값이라 keep-first 를 그대로 두면 ai-agent 가 뒤에 보고한 실제 사유가 영구히 묻힌다. 사유가 비어 온
   * 보고(성공·건너뜀)는 표지를 지우지 않는다(WP-1829 리뷰 후속).
   */
  private static Condition overwriteHttpMarkerReason() {
    return AI_RUN.ERROR_REASON.like("http!_%", '!').and(excluded(AI_RUN.ERROR_REASON).isNotNull());
  }

  /**
   * 보고를 넣거나, 같은 (테넌트, 처리 ID) 가 있으면 합친다. 길이는 먼저 {@link AiRunRecord#truncated()} 로 자른다.
   *
   * <p>합치기 규칙: 상태는 순위가 높은 쪽(같으면 기존 유지), started_at 은 더 이른 값, ended_at 은 더 늦은 값(NULL 무시), 토큰·model·
   * credential_label 은 새 값이 있으면 새 값, target_*·actor_*·source_at·error_* 는 먼저 들어온 값, attempt 는 큰 값.
   *
   * <p>예외: 기존 행이 청소기가 닫은 「보고 없음」 FAILED 이면 종료 상태 보고가 상태·사유·상세·ended_at 을 모두 덮어쓴다(RUNNING 보고는 무시).
   *
   * <p>예외: 기존 사유가 5xx 표지({@code http_<코드>})이면 사유가 있는 보고가 그 사유를 덮어쓴다(WP-1829 리뷰 후속).
   */
  public void upsert(AiRunRecord raw) {
    AiRunRecord r = raw.truncated();
    Field<String> existingStatus = AI_RUN.STATUS;
    Field<String> incomingStatus = excluded(AI_RUN.STATUS);
    // 청소기가 「보고 없음」으로 닫은 행은 잠정 판정이다 — 종료 상태(RUNNING 이 아닌 상태)의 늦은 보고가 오면 그 보고가 이긴다.
    // RUNNING 보고는 닫힌 행을 다시 열지 못한다.
    Condition lateReportWins =
        existingStatus
            .eq("FAILED")
            .and(AI_RUN.ERROR_REASON.eq(STALE_REASON))
            .and(incomingStatus.ne("RUNNING"));
    // 늦은 보고가 이길 때 쓸 사유 — FAILED 가 사유를 비워 오면 「사유 미보고」(아래 ERROR_REASON 설명).
    Field<String> lateReason =
        case_()
            .when(
                incomingStatus.eq("FAILED").and(excluded(AI_RUN.ERROR_REASON).isNull()),
                val(UNREPORTED_REASON))
            .else_(excluded(AI_RUN.ERROR_REASON));
    dsl.insertInto(AI_RUN)
        .set(AI_RUN.RUN_ID, r.runId())
        .set(AI_RUN.KIND, r.kind())
        .set(AI_RUN.TARGET_TYPE, r.targetType())
        .set(AI_RUN.TARGET_ID, r.targetId())
        .set(AI_RUN.TARGET_LABEL, r.targetLabel())
        .set(AI_RUN.ACTOR_TYPE, r.actorType())
        .set(AI_RUN.ACTOR_ID, r.actorId())
        .set(AI_RUN.SOURCE_AT, r.sourceAt())
        .set(AI_RUN.STARTED_AT, r.startedAt())
        .set(AI_RUN.ENDED_AT, r.endedAt())
        .set(AI_RUN.INPUT_TOKENS, r.inputTokens())
        .set(AI_RUN.OUTPUT_TOKENS, r.outputTokens())
        .set(AI_RUN.CACHE_READ_TOKENS, r.cacheReadTokens())
        .set(AI_RUN.CACHE_WRITE_TOKENS, r.cacheWriteTokens())
        .set(AI_RUN.MODEL, r.model())
        .set(AI_RUN.CREDENTIAL_LABEL, r.credentialLabel())
        .set(AI_RUN.STATUS, r.status())
        .set(AI_RUN.ERROR_REASON, r.errorReason())
        .set(AI_RUN.ERROR_DETAIL, r.errorDetail())
        .set(AI_RUN.ATTEMPT, r.attempt() == null ? null : Short.valueOf(r.attempt().shortValue()))
        .onConflict(AI_RUN.TENANT_ID, AI_RUN.RUN_ID)
        .doUpdate()
        // 늦은 보고가 이기거나 새 순위가 더 높을 때만 새 상태로 — 같으면 기존 유지(SUCCEEDED 뒤 SKIPPED 가 뒤집지 않는다).
        .set(
            AI_RUN.STATUS,
            case_()
                .when(
                    lateReportWins.or(rank(incomingStatus).gt(rank(existingStatus))),
                    incomingStatus)
                .else_(existingStatus))
        .set(AI_RUN.STARTED_AT, least(AI_RUN.STARTED_AT, excluded(AI_RUN.STARTED_AT)))
        // 늦은 보고가 이기는 경우 청소기가 찍은 시각이 아니라 보고된 종료 시각을 쓴다(보고에 시각이 있을 때).
        .set(
            AI_RUN.ENDED_AT,
            case_()
                .when(
                    lateReportWins.and(excluded(AI_RUN.ENDED_AT).isNotNull()),
                    excluded(AI_RUN.ENDED_AT))
                .else_(greatest(AI_RUN.ENDED_AT, excluded(AI_RUN.ENDED_AT))))
        .set(AI_RUN.INPUT_TOKENS, preferNew(AI_RUN.INPUT_TOKENS))
        .set(AI_RUN.OUTPUT_TOKENS, preferNew(AI_RUN.OUTPUT_TOKENS))
        .set(AI_RUN.CACHE_READ_TOKENS, preferNew(AI_RUN.CACHE_READ_TOKENS))
        .set(AI_RUN.CACHE_WRITE_TOKENS, preferNew(AI_RUN.CACHE_WRITE_TOKENS))
        .set(AI_RUN.MODEL, preferNew(AI_RUN.MODEL))
        .set(AI_RUN.CREDENTIAL_LABEL, preferNew(AI_RUN.CREDENTIAL_LABEL))
        .set(AI_RUN.TARGET_TYPE, keepFirst(AI_RUN.TARGET_TYPE))
        .set(AI_RUN.TARGET_ID, keepFirst(AI_RUN.TARGET_ID))
        .set(AI_RUN.TARGET_LABEL, keepFirst(AI_RUN.TARGET_LABEL))
        .set(AI_RUN.ACTOR_TYPE, keepFirst(AI_RUN.ACTOR_TYPE))
        .set(AI_RUN.ACTOR_ID, keepFirst(AI_RUN.ACTOR_ID))
        .set(AI_RUN.SOURCE_AT, keepFirst(AI_RUN.SOURCE_AT))
        // 늦은 보고가 이기면 사유·상세를 한 묶음으로 보고 값으로 바꾼다(성공·건너뜀이면 NULL 로 「보고 없음」을 지운다). 늦은 FAILED 가 사유를
        // 비워 오면 「사유 미보고」로 채운다 — 사유 없는 FAILED 도, 표지가 남아 뒤집히는 FAILED 도 만들지 않는다(WP-1827 리뷰 후속).
        // 단, 기존 사유가 5xx 표지면 사유가 있는 보고가 덮어쓴다 — 표지가 실제 사유를 영구히 가리지 않게(WP-1829 리뷰 후속).
        .set(
            AI_RUN.ERROR_REASON,
            case_()
                .when(lateReportWins, lateReason)
                .when(overwriteHttpMarkerReason(), excluded(AI_RUN.ERROR_REASON))
                .else_(keepFirst(AI_RUN.ERROR_REASON)))
        .set(AI_RUN.ERROR_DETAIL, lateWinsOrKeepFirst(lateReportWins, AI_RUN.ERROR_DETAIL))
        .set(AI_RUN.ATTEMPT, greatest(AI_RUN.ATTEMPT, excluded(AI_RUN.ATTEMPT)))
        .set(AI_RUN.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }

  /**
   * 진행 중(RUNNING)인데 보고 없이 기준 시간을 넘긴 처리를 FAILED 로 닫는다. {@code longKinds} 에 속한 kind 는 {@code
   * longMax}, 나머지는 {@code defaultMax} 를 기준으로 하며, 한 번의 UPDATE 로 처리한다. 닫은 건수를 돌려준다.
   *
   * <p>kind 별 CASE 기준 시각은 색인 범위 조건이 되지 못하므로, 두 기준 중 늦은 쪽을 상수 상한으로 함께 걸어 부분 색인 {@code
   * ai_run_running_idx}(started_at, RUNNING 만)를 범위로 쓰게 한다(WP-1827 리뷰 후속).
   *
   * <p>사유는 늘 「보고 없음」으로 둔다 — 늦은 결과 보고 바로잡기(upsert 의 lateReportWins)가 이 표지로 청소기가 닫은 행을 알아본다. 이미 사유가
   * 있던 행이면 그 사유를 상세 앞에 옮긴다(상세 상한 2000자로 자른다).
   *
   * @param now 기준 시각(테스트·호출자가 정한다)
   */
  public int failStaleRunning(
      Set<String> longKinds, Duration longMax, Duration defaultMax, OffsetDateTime now) {
    OffsetDateTime longCutoff = now.minus(longMax);
    OffsetDateTime defaultCutoff = now.minus(defaultMax);
    // kind 별 기준 시각 — 긴 종류는 더 오래 기다린다.
    Field<OffsetDateTime> cutoff =
        case_().when(AI_RUN.KIND.in(longKinds), val(longCutoff)).else_(val(defaultCutoff));
    // 색인 범위용 상수 상한 — 두 기준 중 늦은 시각(이보다 늦게 시작한 행은 어느 기준으로도 아직 닫지 않는다).
    OffsetDateTime latestCutoff = longCutoff.isAfter(defaultCutoff) ? longCutoff : defaultCutoff;
    Field<String> detailWithOldReason =
        DSL.substring(
            case_()
                .when(AI_RUN.ERROR_REASON.isNull(), AI_RUN.ERROR_DETAIL)
                .when(AI_RUN.ERROR_DETAIL.isNull(), AI_RUN.ERROR_REASON)
                .else_(AI_RUN.ERROR_REASON.concat(val(" / ")).concat(AI_RUN.ERROR_DETAIL)),
            1,
            AiRunRecord.DETAIL_MAX);
    return dsl.update(AI_RUN)
        .set(AI_RUN.STATUS, "FAILED")
        .set(AI_RUN.ENDED_AT, now)
        .set(AI_RUN.ERROR_DETAIL, detailWithOldReason)
        .set(AI_RUN.ERROR_REASON, val(STALE_REASON))
        .set(AI_RUN.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(AI_RUN.STATUS.eq("RUNNING"))
        .and(AI_RUN.STARTED_AT.lt(latestCutoff))
        .and(AI_RUN.STARTED_AT.lt(cutoff))
        .execute();
  }

  /** started_at 이 {@code days} 일보다 오래된 행을 지운다(보존 기간 정리). 지운 건수를 돌려준다. */
  public int deleteOlderThan(int days) {
    return dsl.deleteFrom(AI_RUN)
        .where(AI_RUN.STARTED_AT.lt(OffsetDateTime.now().minusDays(days)))
        .execute();
  }
}

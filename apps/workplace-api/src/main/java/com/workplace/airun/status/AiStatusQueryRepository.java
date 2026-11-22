package com.workplace.airun.status;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT_USAGE;

import com.workplace.airun.status.dto.AiRunFilter;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * AI 현황 조회용 집계 리포지토리(WP-1831). ai_run 과 위임 작업(agent_work)을 DB 에서 집계한다 — 30일치 행을 옮기지 않고 구간·백분위·종류별
 * 묶음을 DB 가 계산한다. 테넌트 격리는 RLS 가 하므로 호출자(서비스)는 읽기 전용 트랜잭션 안에서 부른다. jOOQ 에 없는 {@code date_bin}·{@code
 * percentile_cont} 때문에 집계 SQL 은 템플릿 문자열로 쓴다(값은 모두 바인드 변수).
 */
@Repository
@RequiredArgsConstructor
public class AiStatusQueryRepository {

  /**
   * 구간 원점 — KST 월요일 자정(고정 오프셋). 세션 시간대와 무관하게 하루 구간이 KST 자정에 맞고, 서비스가 Java 로 만드는 구간 축과 같은 값이다({@link
   * #BIN_ORIGIN_EPOCH_SECOND}).
   */
  static final String BIN_ORIGIN_SQL = "TIMESTAMPTZ '2000-01-03 00:00:00+09'";

  /** {@link #BIN_ORIGIN_SQL} 의 epoch 초(2000-01-02T15:00:00Z). */
  public static final long BIN_ORIGIN_EPOCH_SECOND = 946825200L;

  /** 처리 시간(밀리초) 식 — 끝난 SUCCEEDED·FAILED 에만 FILTER 로 건다. */
  private static final String RUN_MS = "extract(epoch from (ended_at - started_at)) * 1000";

  /** 응답 시간 백분위 조각(끝난 SUCCEEDED·FAILED 만). */
  private static final String RUN_PCT =
      "percentile_cont(0.5) WITHIN GROUP (ORDER BY "
          + RUN_MS
          + ") FILTER (WHERE status IN ('SUCCEEDED','FAILED') AND ended_at IS NOT NULL) AS p50, "
          + "percentile_cont(0.95) WITHIN GROUP (ORDER BY "
          + RUN_MS
          + ") FILTER (WHERE status IN ('SUCCEEDED','FAILED') AND ended_at IS NOT NULL) AS p95";

  /** 건수·토큰·성공/실패 수 조각. */
  private static final String RUN_SUMS =
      "count(*) AS cnt, "
          + "coalesce(sum(input_tokens), 0) AS in_tok, coalesce(sum(output_tokens), 0) AS out_tok, "
          + "count(*) FILTER (WHERE status = 'SUCCEEDED') AS succeeded, "
          + "count(*) FILTER (WHERE status = 'FAILED') AS failed";

  /** 위임 작업의 첫 「실제 시작」 시각 — IssueMetricsRepository.findFirstAgentRunAt 과 같은 정의. */
  private static final String WORK_REAL_START =
      "(SELECT min(e.created_at) FROM agent_work_event e WHERE e.work_id = w.id "
          + "AND e.state NOT IN ('SUBMITTED','CANCELED','REJECTED'))";

  private final DSLContext dsl;

  /** 기간 전체 합계(위임 작업 제외 — ai_run 만). */
  public record RunTotals(
      long count,
      long inputTokens,
      long outputTokens,
      long succeeded,
      long failed,
      Double p50,
      Double p95) {

    /** 실패율 = FAILED / (SUCCEEDED + FAILED), 분모 0 이면 null. */
    public Double failureRate() {
      long done = succeeded + failed;
      return done == 0 ? null : (double) failed / done;
    }
  }

  /** 종류별 합계와 마지막 실패. */
  public record KindTotals(
      String kind, RunTotals totals, Instant lastFailureAt, String lastFailureReason) {}

  /** 구간 × 종류 처리량 한 칸. */
  public record BucketKindCell(Instant bucket, String kind, long tokens, long count) {}

  /** 구간별 응답 시간 백분위·실패 수. */
  public record BucketLatency(Instant bucket, long failed, Double p50, Double p95) {}

  /** 위임 작업 집계(배정이 기간 안인 작업 기준, 대기는 실제 시작이 기간 안인 작업 기준). */
  public record DelegatedTotals(
      long count, long succeeded, long failed, Double p50, Double p95, Double waitP95) {

    /** 실패율(위 대응 기준), 분모 0 이면 null. */
    public Double failureRate() {
      long done = succeeded + failed;
      return done == 0 ? null : (double) failed / done;
    }
  }

  /** 구간별 표본 칸 값의 최댓값(그 구간에 표본이 있을 때만 행이 있다). */
  public record BucketSample(Instant bucket, int slotUsed, int slotLimit, int queueWaiting) {}

  /** 구간 × 종류 밀린 건수 최댓값(그 종류가 표본 JSON 에 있던 구간만). */
  public record BucketBacklog(Instant bucket, String kind, int max) {}

  /** 구간 × 계정 5시간 사용률 최댓값과 그 구간에서 가장 최근 표본의 라벨. */
  public record BucketAccount(Instant bucket, long accountId, String label, double max) {}

  /** 계정의 창별 초기화 시각. */
  public record AccountResets(Instant resetsAt5h, Instant resetsAt7d) {}

  /** [from, to) 에 시작한 ai_run 전체 합계. */
  public RunTotals totals(Instant from, Instant to) {
    Record r =
        dsl.fetchOne(
            "SELECT "
                + RUN_SUMS
                + ", "
                + RUN_PCT
                + " FROM ai_run WHERE started_at >= ?::timestamptz AND started_at < ?::timestamptz",
            ts(from),
            ts(to));
    return toTotals(r);
  }

  /** [from, to) 종류별 합계 + 종류별 마지막 실패. */
  public List<KindTotals> kindTotals(Instant from, Instant to) {
    Map<String, Record> lastFailures = new HashMap<>();
    for (Record f :
        dsl.fetch(
            "SELECT DISTINCT ON (kind) kind, coalesce(ended_at, started_at) AS at, error_reason "
                + "FROM ai_run WHERE status = 'FAILED' AND started_at >= ?::timestamptz AND started_at < ?::timestamptz "
                + "ORDER BY kind, coalesce(ended_at, started_at) DESC, id DESC",
            ts(from),
            ts(to))) {
      lastFailures.put(f.get("kind", String.class), f);
    }
    List<KindTotals> out = new ArrayList<>();
    for (Record r :
        dsl.fetch(
            "SELECT kind, "
                + RUN_SUMS
                + ", "
                + RUN_PCT
                + " FROM ai_run WHERE started_at >= ?::timestamptz AND started_at < ?::timestamptz GROUP BY kind ORDER BY kind",
            ts(from),
            ts(to))) {
      String kind = r.get("kind", String.class);
      Record f = lastFailures.get(kind);
      out.add(
          new KindTotals(
              kind,
              toTotals(r),
              f == null ? null : f.get("at", OffsetDateTime.class).toInstant(),
              f == null ? null : f.get("error_reason", String.class)));
    }
    return out;
  }

  /** [from, to) 구간(date_bin) × 종류 처리량(토큰 합·건수). 행이 있는 칸만 돌려준다. */
  public List<BucketKindCell> throughputCells(Instant from, Instant to, Duration bucket) {
    List<BucketKindCell> out = new ArrayList<>();
    for (Record r :
        dsl.fetch(
            "SELECT date_bin(? * interval '1 second', started_at, "
                + BIN_ORIGIN_SQL
                + ") AS bucket, kind, "
                + "coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0) AS tokens, "
                + "count(*) AS cnt FROM ai_run WHERE started_at >= ?::timestamptz AND started_at < ?::timestamptz "
                + "GROUP BY 1, 2",
            bucket.toSeconds(),
            ts(from),
            ts(to))) {
      out.add(
          new BucketKindCell(
              r.get("bucket", OffsetDateTime.class).toInstant(),
              r.get("kind", String.class),
              r.get("tokens", Long.class),
              r.get("cnt", Long.class)));
    }
    return out;
  }

  /** [from, to) 구간별 응답 시간 p50·p95 와 FAILED 수. 행이 있는 구간만 돌려준다. */
  public List<BucketLatency> latencyBuckets(Instant from, Instant to, Duration bucket) {
    List<BucketLatency> out = new ArrayList<>();
    for (Record r :
        dsl.fetch(
            "SELECT date_bin(? * interval '1 second', started_at, "
                + BIN_ORIGIN_SQL
                + ") AS bucket, count(*) FILTER (WHERE status = 'FAILED') AS failed, "
                + RUN_PCT
                + " FROM ai_run WHERE started_at >= ?::timestamptz AND started_at < ?::timestamptz GROUP BY 1",
            bucket.toSeconds(),
            ts(from),
            ts(to))) {
      out.add(
          new BucketLatency(
              r.get("bucket", OffsetDateTime.class).toInstant(),
              r.get("failed", Long.class),
              r.get("p50", Double.class),
              r.get("p95", Double.class)));
    }
    return out;
  }

  /**
   * 위임 작업 집계. 건수·상태 대응(COMPLETED→SUCCEEDED, FAILED→FAILED)·처리 시간은 배정(agent_work.started_at)이 [from,
   * to) 인 작업, 대기 p95 는 실제 시작이 [from, to) 인 작업의 (배정→실제 시작).
   */
  public DelegatedTotals delegated(Instant from, Instant to) {
    Record r =
        dsl.fetchOne(
            "WITH w AS (SELECT w.id, w.state, w.started_at AS assigned, w.ended_at, "
                + WORK_REAL_START
                + " AS real_start FROM agent_work w "
                // 기간과 겹칠 수 있는 이력만 — 실제 시작 ≥ 배정, ≤ 끝이라 아래 모든 집계의 대상 행이 그대로 남는다.
                + "WHERE w.started_at < ?::timestamptz AND (w.ended_at IS NULL OR w.ended_at >= ?::timestamptz)) "
                + "SELECT "
                + "(SELECT count(*) FROM w WHERE assigned >= ?::timestamptz AND assigned < ?::timestamptz) AS cnt, "
                + "(SELECT count(*) FROM w WHERE assigned >= ?::timestamptz AND assigned < ?::timestamptz AND state = 'COMPLETED') AS succeeded, "
                + "(SELECT count(*) FROM w WHERE assigned >= ?::timestamptz AND assigned < ?::timestamptz AND state = 'FAILED') AS failed, "
                + "(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from (ended_at - real_start)) * 1000) "
                + "   FROM w WHERE assigned >= ?::timestamptz AND assigned < ?::timestamptz AND state IN ('COMPLETED','FAILED') AND real_start IS NOT NULL) AS p50, "
                + "(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch from (ended_at - real_start)) * 1000) "
                + "   FROM w WHERE assigned >= ?::timestamptz AND assigned < ?::timestamptz AND state IN ('COMPLETED','FAILED') AND real_start IS NOT NULL) AS p95, "
                + "(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch from (real_start - assigned)) * 1000) "
                + "   FROM w WHERE real_start >= ?::timestamptz AND real_start < ?::timestamptz) AS wait_p95",
            ts(to),
            ts(from),
            ts(from),
            ts(to),
            ts(from),
            ts(to),
            ts(from),
            ts(to),
            ts(from),
            ts(to),
            ts(from),
            ts(to),
            ts(from),
            ts(to));
    return new DelegatedTotals(
        r.get("cnt", Long.class),
        r.get("succeeded", Long.class),
        r.get("failed", Long.class),
        r.get("p50", Double.class),
        r.get("p95", Double.class),
        r.get("wait_p95", Double.class));
  }

  /** [from, to] 구간별 슬롯·대기열 칸의 최댓값(DB 에서 date_bin 으로 묶는다 — 표본 행을 옮기지 않는다). */
  public List<BucketSample> sampleBuckets(Instant from, Instant to, Duration bucket) {
    List<BucketSample> out = new ArrayList<>();
    for (Record r :
        dsl.fetch(
            "SELECT date_bin(? * interval '1 second', sampled_at, "
                + BIN_ORIGIN_SQL
                + ") AS bucket, max(slot_used) AS used, max(slot_limit) AS lim, "
                + "max(queue_waiting) AS queue FROM ai_capacity_sample "
                + "WHERE sampled_at >= ?::timestamptz AND sampled_at <= ?::timestamptz GROUP BY 1",
            bucket.toSeconds(),
            ts(from),
            ts(to))) {
      out.add(
          new BucketSample(
              r.get("bucket", OffsetDateTime.class).toInstant(),
              r.get("used", Integer.class),
              r.get("lim", Integer.class),
              r.get("queue", Integer.class)));
    }
    return out;
  }

  /** [from, to] 구간 × 종류 밀린 건수 최댓값. backlog JSON 객체를 jsonb_each_text 로 풀어 묶는다(모양이 틀린 칸은 건너뜀). */
  public List<BucketBacklog> backlogBuckets(Instant from, Instant to, Duration bucket) {
    List<BucketBacklog> out = new ArrayList<>();
    for (Record r :
        dsl.fetch(
            "SELECT date_bin(? * interval '1 second', s.sampled_at, "
                + BIN_ORIGIN_SQL
                + ") AS bucket, b.key AS kind, "
                + "max(CASE WHEN b.value ~ '^[0-9]{1,9}$' THEN b.value::int END) AS mx "
                + "FROM ai_capacity_sample s CROSS JOIN LATERAL jsonb_each_text("
                + "CASE WHEN jsonb_typeof(s.backlog) = 'object' THEN s.backlog ELSE '{}'::jsonb END) b "
                + "WHERE s.sampled_at >= ?::timestamptz AND s.sampled_at <= ?::timestamptz "
                + "GROUP BY 1, 2",
            bucket.toSeconds(),
            ts(from),
            ts(to))) {
      Integer mx = r.get("mx", Integer.class);
      if (mx != null) {
        out.add(
            new BucketBacklog(
                r.get("bucket", OffsetDateTime.class).toInstant(),
                r.get("kind", String.class),
                mx));
      }
    }
    return out;
  }

  /**
   * [from, to] 구간 × 계정 5h 사용률 최댓값. account_usage JSON 배열을 jsonb_array_elements 로 풀어 window=5h 만
   * 묶는다.
   */
  public List<BucketAccount> account5hBuckets(Instant from, Instant to, Duration bucket) {
    List<BucketAccount> out = new ArrayList<>();
    for (Record r :
        dsl.fetch(
            "SELECT date_bin(? * interval '1 second', s.sampled_at, "
                + BIN_ORIGIN_SQL
                + ") AS bucket, (a->>'accountId')::bigint AS account_id, "
                + "(array_agg(a->>'label' ORDER BY s.sampled_at DESC))[1] AS label, "
                + "max((a->>'usedPercent')::double precision) AS mx "
                + "FROM ai_capacity_sample s CROSS JOIN LATERAL jsonb_array_elements("
                + "CASE WHEN jsonb_typeof(s.account_usage) = 'array' THEN s.account_usage ELSE '[]'::jsonb END) a "
                + "WHERE s.sampled_at >= ?::timestamptz AND s.sampled_at <= ?::timestamptz "
                + "AND a->>'window' = '5h' AND jsonb_typeof(a->'accountId') = 'number' "
                + "AND jsonb_typeof(a->'usedPercent') = 'number' GROUP BY 1, 2",
            bucket.toSeconds(),
            ts(from),
            ts(to))) {
      String label = r.get("label", String.class);
      out.add(
          new BucketAccount(
              r.get("bucket", OffsetDateTime.class).toInstant(),
              r.get("account_id", Long.class),
              label == null ? "" : label,
              r.get("mx", Double.class)));
    }
    return out;
  }

  /** 계정별 5h·7d 사용량 초기화 시각(agent_account_usage.resets_at). 기록 없는 계정은 맵에 없다. */
  public Map<Long, AccountResets> accountResets(Collection<Long> accountIds) {
    Map<Long, AccountResets> out = new HashMap<>();
    if (accountIds.isEmpty()) {
      return out;
    }
    Map<Long, Instant> h5 = new HashMap<>();
    Map<Long, Instant> d7 = new HashMap<>();
    for (Record r :
        dsl.select(
                AGENT_ACCOUNT_USAGE.ACCOUNT_ID,
                AGENT_ACCOUNT_USAGE.WINDOW_KEY,
                AGENT_ACCOUNT_USAGE.RESETS_AT)
            .from(AGENT_ACCOUNT_USAGE)
            .where(AGENT_ACCOUNT_USAGE.ACCOUNT_ID.in(accountIds))
            .fetch()) {
      OffsetDateTime at = r.get(AGENT_ACCOUNT_USAGE.RESETS_AT);
      Instant v = at == null ? null : at.toInstant();
      Long id = r.get(AGENT_ACCOUNT_USAGE.ACCOUNT_ID);
      if ("5h".equals(r.get(AGENT_ACCOUNT_USAGE.WINDOW_KEY))) {
        h5.put(id, v);
      } else {
        d7.put(id, v);
      }
    }
    for (Long id : accountIds) {
      if (h5.containsKey(id) || d7.containsKey(id)) {
        out.put(id, new AccountResets(h5.get(id), d7.get(id)));
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ 처리 이력 목록·상세

  /** ai_run 쪽 선택 열 — 목록 합집합과 상세가 같은 열 모양을 쓰도록 한 곳에 둔다(접두 r., 실행 주체 이름은 u.). */
  private static final String RUN_COLUMNS =
      "'R' AS source, r.id AS sort_id, r.run_id::text AS ref, r.kind, r.target_type, r.target_id, "
          + "r.target_label, r.actor_type, r.actor_id, "
          + "CASE WHEN r.actor_type IN ('USER','AGENT') THEN u.name END AS actor_name, "
          + "r.status, r.started_at, r.ended_at, "
          + "CASE WHEN r.source_at IS NOT NULL THEN round(greatest(extract(epoch from (r.started_at - r.source_at)), 0) * 1000)::bigint END AS wait_ms, "
          + "round(extract(epoch from (r.ended_at - r.started_at)) * 1000)::bigint AS duration_ms, "
          + "r.input_tokens, r.output_tokens, r.model, r.error_reason, NULL::text AS q_extra";

  /** 위임 작업 쪽 선택 열(같은 열 모양). 실제 시작은 lateral rs.real_start, 이슈 키는 프로젝트 키-번호. */
  private static final String WORK_COLUMNS =
      "'W' AS source, w.id AS sort_id, w.id::text AS ref, 'DELEGATED_WORK' AS kind, "
          + "'ISSUE' AS target_type, p.key || '-' || i.number AS target_id, i.title AS target_label, "
          + "'AGENT' AS actor_type, w.worker_id AS actor_id, u.name AS actor_name, "
          + "CASE w.state WHEN 'COMPLETED' THEN 'SUCCEEDED' WHEN 'FAILED' THEN 'FAILED' "
          + "WHEN 'CANCELED' THEN 'SKIPPED' WHEN 'REJECTED' THEN 'SKIPPED' ELSE 'RUNNING' END AS status, "
          + "w.started_at, w.ended_at, "
          + "CASE WHEN rs.real_start IS NOT NULL THEN round(greatest(extract(epoch from (rs.real_start - w.started_at)), 0) * 1000)::bigint END AS wait_ms, "
          + "round(extract(epoch from (w.ended_at - rs.real_start)) * 1000)::bigint AS duration_ms, "
          + "NULL::bigint AS input_tokens, NULL::bigint AS output_tokens, NULL::text AS model, "
          + "NULL::text AS error_reason, p.key || '-' || i.number AS q_extra";

  /** 목록 한 줄의 읽은 값(출처 문자·정렬 id·run_id 문자열 포함). */
  public record RunRow(
      char source,
      long sortId,
      String ref,
      String kind,
      String targetType,
      String targetId,
      String targetLabel,
      String actorType,
      Long actorId,
      String actorName,
      String status,
      Instant startedAt,
      Instant endedAt,
      Long waitMs,
      Long durationMs,
      Long inputTokens,
      Long outputTokens,
      String model,
      String errorReason) {}

  /** 상세 한 건 — 목록 행에 상세 열을 더한다. */
  public record RunDetailRow(
      RunRow row,
      Long cacheReadTokens,
      Long cacheWriteTokens,
      String credentialLabel,
      Integer attempt,
      Instant sourceAt,
      String errorDetail) {}

  /**
   * 처리 이력 목록 — ai_run 과 위임 작업을 같은 열 모양으로 합쳐(UNION ALL) (시작 시각, 출처, id) 내림차순 키셋으로 limit 건 읽는다. 기간은 두
   * 쪽 모두 [from, to). 나머지 필터는 합친 열에 건다 — 위임 작업은 model 이 null·actor_type 이 AGENT·kind 가
   * DELEGATED_WORK 라 같은 조건으로 자연히 걸러진다. 값은 모두 바인드 변수이고 q 의 LIKE 예약 글자는 이스케이프한다.
   */
  public List<RunRow> listRuns(AiRunFilter f, AiRunCursor after, int limit) {
    List<Object> p = new ArrayList<>();
    StringBuilder sql = new StringBuilder("SELECT * FROM (SELECT ");
    sql.append(RUN_COLUMNS)
        .append(" FROM ai_run r LEFT JOIN \"user\" u ON u.id = r.actor_id")
        .append(" WHERE r.started_at >= ?::timestamptz AND r.started_at < ?::timestamptz")
        .append(" UNION ALL SELECT ")
        .append(WORK_COLUMNS)
        .append(" FROM agent_work w")
        .append(" CROSS JOIN LATERAL (SELECT ")
        .append(WORK_REAL_START)
        .append(" AS real_start) rs")
        .append(" LEFT JOIN issue i ON i.id = w.issue_id")
        .append(" LEFT JOIN project p ON p.id = i.project_id")
        .append(" LEFT JOIN \"user\" u ON u.id = w.worker_id")
        .append(
            " WHERE w.started_at >= ?::timestamptz AND w.started_at < ?::timestamptz) t WHERE 1=1");
    p.add(ts(f.from()));
    p.add(ts(f.to()));
    p.add(ts(f.from()));
    p.add(ts(f.to()));
    if (f.kinds() != null && !f.kinds().isEmpty()) {
      sql.append(" AND kind IN (");
      for (int i = 0; i < f.kinds().size(); i++) {
        sql.append(i == 0 ? "?" : ",?");
        p.add(f.kinds().get(i));
      }
      sql.append(")");
    }
    if (f.status() != null) {
      sql.append(" AND status = ?");
      p.add(f.status());
    }
    if (f.actorType() != null) {
      sql.append(" AND actor_type = ?");
      p.add(f.actorType());
    }
    if (f.model() != null) {
      sql.append(" AND model = ?");
      p.add(f.model());
    }
    if (f.q() != null) {
      String like = "%" + escapeLike(f.q()) + "%";
      sql.append(
          " AND (target_label ILIKE ? ESCAPE '\\' OR error_reason ILIKE ? ESCAPE '\\'"
              + " OR q_extra ILIKE ? ESCAPE '\\')");
      p.add(like);
      p.add(like);
      p.add(like);
    }
    if (after != null) {
      // 키셋 — (시작 시각, 출처, id) 가 커서보다 앞선(내림차순이라 더 작은) 행만.
      sql.append(
          " AND (started_at < ?::timestamptz OR (started_at = ?::timestamptz AND"
              + " (source < ? OR (source = ? AND sort_id < ?))))");
      p.add(ts(after.startedAt()));
      p.add(ts(after.startedAt()));
      p.add(String.valueOf(after.source()));
      p.add(String.valueOf(after.source()));
      p.add(after.id());
    }
    sql.append(" ORDER BY started_at DESC, source DESC, sort_id DESC LIMIT ?");
    p.add(limit);
    List<RunRow> out = new ArrayList<>();
    for (Record r : dsl.fetch(sql.toString(), p.toArray())) {
      out.add(toRunRow(r));
    }
    return out;
  }

  /** run_id 로 ai_run 한 건 상세. 없거나 다른 테넌트(RLS)면 비어 있다. */
  public Optional<RunDetailRow> findRun(UUID runId) {
    Record r =
        dsl.fetchOne(
            "SELECT "
                + RUN_COLUMNS
                + ", r.cache_read_tokens, r.cache_write_tokens, r.credential_label, r.attempt, "
                + "r.source_at, r.error_detail FROM ai_run r "
                + "LEFT JOIN \"user\" u ON u.id = r.actor_id WHERE r.run_id = ?",
            runId);
    if (r == null) {
      return Optional.empty();
    }
    OffsetDateTime sourceAt = r.get("source_at", OffsetDateTime.class);
    return Optional.of(
        new RunDetailRow(
            toRunRow(r),
            r.get("cache_read_tokens", Long.class),
            r.get("cache_write_tokens", Long.class),
            r.get("credential_label", String.class),
            r.get("attempt", Integer.class),
            sourceAt == null ? null : sourceAt.toInstant(),
            r.get("error_detail", String.class)));
  }

  private static RunRow toRunRow(Record r) {
    OffsetDateTime endedAt = r.get("ended_at", OffsetDateTime.class);
    return new RunRow(
        r.get("source", String.class).charAt(0),
        r.get("sort_id", Long.class),
        r.get("ref", String.class),
        r.get("kind", String.class),
        r.get("target_type", String.class),
        r.get("target_id", String.class),
        r.get("target_label", String.class),
        r.get("actor_type", String.class),
        r.get("actor_id", Long.class),
        r.get("actor_name", String.class),
        r.get("status", String.class),
        r.get("started_at", OffsetDateTime.class).toInstant(),
        endedAt == null ? null : endedAt.toInstant(),
        r.get("wait_ms", Long.class),
        r.get("duration_ms", Long.class),
        r.get("input_tokens", Long.class),
        r.get("output_tokens", Long.class),
        r.get("model", String.class),
        r.get("error_reason", String.class));
  }

  /** LIKE 예약 글자(\, %, _)를 이스케이프해 검색어를 글자 그대로 찾게 한다(ESCAPE '\'). */
  static String escapeLike(String s) {
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
  }

  private static RunTotals toTotals(Record r) {
    return new RunTotals(
        r.get("cnt", Long.class),
        r.get("in_tok", Long.class),
        r.get("out_tok", Long.class),
        r.get("succeeded", Long.class),
        r.get("failed", Long.class),
        r.get("p50", Double.class),
        r.get("p95", Double.class));
  }

  private static OffsetDateTime ts(Instant t) {
    return t.atOffset(ZoneOffset.UTC);
  }
}

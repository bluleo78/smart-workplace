package com.workplace.airun.status;

import com.workplace.airun.capacity.AiCapacitySample;
import com.workplace.airun.capacity.AiCapacitySampleRepository;
import com.workplace.airun.status.AiStatusAlertEvaluator.AccountUsagePoint;
import com.workplace.airun.status.AiStatusAlertEvaluator.BacklogPoint;
import com.workplace.airun.status.AiStatusAlertEvaluator.KindFailure;
import com.workplace.airun.status.AiStatusQueryRepository.AccountResets;
import com.workplace.airun.status.AiStatusQueryRepository.BucketAccount;
import com.workplace.airun.status.AiStatusQueryRepository.BucketBacklog;
import com.workplace.airun.status.AiStatusQueryRepository.BucketKindCell;
import com.workplace.airun.status.AiStatusQueryRepository.BucketLatency;
import com.workplace.airun.status.AiStatusQueryRepository.BucketSample;
import com.workplace.airun.status.AiStatusQueryRepository.DelegatedTotals;
import com.workplace.airun.status.AiStatusQueryRepository.KindTotals;
import com.workplace.airun.status.AiStatusQueryRepository.RunTotals;
import com.workplace.airun.status.dto.AiStatusAlert;
import com.workplace.airun.status.dto.AiStatusOverview;
import com.workplace.airun.status.dto.AiStatusOverview.AccountSeries;
import com.workplace.airun.status.dto.AiStatusOverview.AccountUsage;
import com.workplace.airun.status.dto.AiStatusOverview.Cell;
import com.workplace.airun.status.dto.AiStatusOverview.KindRow;
import com.workplace.airun.status.dto.AiStatusOverview.LastFailure;
import com.workplace.airun.status.dto.AiStatusOverview.Latency;
import com.workplace.airun.status.dto.AiStatusOverview.Metrics;
import com.workplace.airun.status.dto.AiStatusOverview.Pair;
import com.workplace.airun.status.dto.AiStatusOverview.Series;
import com.workplace.airun.status.dto.AiStatusOverview.Slot;
import com.workplace.airun.status.dto.AiStatusOverview.Throughput;
import com.workplace.airun.status.dto.AiStatusOverview.Tokens;
import com.workplace.airun.status.dto.AiStatusOverview.Usage;
import com.workplace.airun.status.dto.AiStatusOverview.Wait;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.TreeMap;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * AI 현황 개요 조립(WP-1831 설계 4-3). 저장소의 집계 행을 구간 축에 맞춰 채우고(없는 칸은 null), 지표·처리량·시계열·종류별 표·현재 사용률·경고를 한
 * 응답으로 만든다. 위임 작업은 종류별 표의 DELEGATED_WORK 행과 대기 시간에만 쓰고 AI 처리 지표·처리량에는 섞지 않는다.
 */
@Service
@RequiredArgsConstructor
public class AiStatusOverviewService {

  /** 위임 작업의 종류 코드(종류별 표). */
  static final String DELEGATED_KIND = "DELEGATED_WORK";

  /** 처리량에서 개별로 보여 주는 종류 수(나머지는 OTHER). */
  private static final int TOP_KINDS = 5;

  private static final String OTHER = "OTHER";

  /** 「최근 표본」으로 인정하는 나이 / 적체 판정에 쓰는 표본 범위. */
  private static final Duration RECENT_SAMPLE = Duration.ofMinutes(10);

  private static final Duration BACKLOG_WINDOW = Duration.ofMinutes(70);

  private final AiStatusQueryRepository repo;
  private final AiCapacitySampleRepository sampleRepo;
  private final ObjectMapper objectMapper;

  /** 표본 한 건을 JSON 까지 풀어 둔 값(구간 집계·현재값 계산에서 여러 번 읽는다). */
  private record Parsed(
      Instant at,
      AiCapacitySample raw,
      List<AccountUsagePoint> accounts,
      Map<String, Integer> backlog) {}

  /** 개요를 만든다. 기간은 [now−p, now), 직전은 [now−2p, now−p). */
  @Transactional(readOnly = true)
  public AiStatusOverview overview(AiStatusPeriod period, Instant now) {
    Duration len = period.length();
    Duration bucket = period.bucket();
    Instant from = now.minus(len);
    Instant prevFrom = from.minus(len);

    List<Instant> axis = axis(from, now, bucket);

    RunTotals cur = repo.totals(from, now);
    RunTotals prev = repo.totals(prevFrom, from);
    DelegatedTotals dCur = repo.delegated(from, now);
    DelegatedTotals dPrev = repo.delegated(prevFrom, from);

    // 표본 행은 작은 범위만 읽는다 — 직전 기간 끝 무렵(from−10분~from)과 적체 판정(최근 70분). 구간 시계열은 DB 에서 묶는다.
    Instant backlogFrom = now.minus(BACKLOG_WINDOW);
    List<Parsed> samples = new ArrayList<>();
    for (AiCapacitySample s : sampleRepo.findBetween(backlogFrom, now)) {
      samples.add(parse(s));
    }
    List<Parsed> prevEndSamples = new ArrayList<>();
    // 직전 기간 끝 무렵은 [from−10분, from) 반열린 구간 — 경계 표본을 함께 세면 현재 기간 구간 표본과 겹친다(WP-1831 리뷰).
    for (AiCapacitySample s : sampleRepo.findBetween(from.minus(RECENT_SAMPLE), from)) {
      prevEndSamples.add(parse(s));
    }
    Optional<Parsed> latest = sampleRepo.findLatestSince(now.minus(RECENT_SAMPLE)).map(this::parse);
    // findBetween 이 [from−10분, from) 으로 이미 거르고 오름차순으로 주므로 마지막 한 건이 그 구간의 최신 표본이다.
    Parsed prevEnd = lastOf(prevEndSamples);

    Metrics metrics =
        new Metrics(
            new Pair<>(cur.count(), prev.count()),
            new Pair<>(
                new Tokens(cur.inputTokens(), cur.outputTokens()),
                new Tokens(prev.inputTokens(), prev.outputTokens())),
            new Pair<>(cur.failureRate(), prev.failureRate()),
            new Pair<>(latency(cur), latency(prev)),
            new Pair<>(
                new Wait(ms(dCur.waitP95()), latest.map(p -> p.raw().queueWaiting()).orElse(null)),
                new Wait(
                    ms(dPrev.waitP95()), prevEnd == null ? null : prevEnd.raw().queueWaiting())),
            new Pair<>(
                latest.map(p -> new Slot(p.raw().slotUsed(), p.raw().slotLimit())).orElse(null),
                prevEnd == null
                    ? null
                    : new Slot(prevEnd.raw().slotUsed(), prevEnd.raw().slotLimit())),
            cur.limited(),
            cur.limited() == 0 ? List.of() : repo.limitedCredentials(from, now));

    List<KindTotals> kindCur = repo.kindTotals(from, now);
    List<KindTotals> kindPrev = repo.kindTotals(prevFrom, from);

    Throughput throughput = throughput(axis, repo.throughputCells(from, now, bucket), bucket);
    Series series = series(axis, bucket, from, now);
    List<KindRow> kinds = kindRows(kindCur, dCur);
    Usage usage = usage(latest.orElse(null));

    List<AiStatusAlert> alerts =
        AiStatusAlertEvaluator.evaluate(
            kindFailures(kindCur, kindPrev),
            latest.map(p -> p.raw().queueOldestWaitSec()).orElse(null),
            latest.map(Parsed::accounts).orElse(List.of()),
            samples.stream().map(p -> new BacklogPoint(p.at(), p.backlog())).toList(),
            now);

    return new AiStatusOverview(
        period.code(),
        bucket.toSeconds(),
        from,
        now,
        Instant.now(),
        metrics,
        throughput,
        series,
        kinds,
        usage,
        alerts);
  }

  // ---------------------------------------------------------------- 구간 축

  /** 구간 시작 시각 — 저장소 date_bin 과 같은 원점(KST 자정 고정)으로 내림한다. */
  static Instant binStart(Instant t, Duration bucket) {
    long b = bucket.toSeconds();
    long off =
        Math.floorMod(t.getEpochSecond() - AiStatusQueryRepository.BIN_ORIGIN_EPOCH_SECOND, b);
    return Instant.ofEpochSecond(t.getEpochSecond() - off);
  }

  /** 기간 첫 구간부터 지금 바로 앞 구간까지의 모든 구간 시작 시각. */
  private static List<Instant> axis(Instant from, Instant now, Duration bucket) {
    List<Instant> out = new ArrayList<>();
    Instant last = binStart(now, bucket);
    // now 가 구간 경계에 정확히 놓이면 그 경계에서 시작하는 구간에는 기간([from, now)) 행이 하나도 없어
    // 축 끝에 빈 칸이 하나 더 붙는다 — 경계 구간은 빼고 바로 앞 구간까지 둔다.
    if (!last.isBefore(now)) {
      last = last.minus(bucket);
    }
    for (Instant t = binStart(from, bucket); !t.isAfter(last); t = t.plus(bucket)) {
      out.add(t);
    }
    return out;
  }

  // ---------------------------------------------------------------- 처리량

  /** 상위 5 종류(토큰 → 건수 → 코드 순) + 나머지 합 OTHER. 빈 구간은 null 칸. */
  private static Throughput throughput(
      List<Instant> axis, List<BucketKindCell> cells, Duration bucket) {
    Map<String, long[]> perKind = new HashMap<>();
    for (BucketKindCell c : cells) {
      long[] sum = perKind.computeIfAbsent(c.kind(), k -> new long[2]);
      sum[0] += c.tokens();
      sum[1] += c.count();
    }
    List<String> ranked =
        perKind.keySet().stream()
            .sorted(
                Comparator.<String>comparingLong(k -> -perKind.get(k)[0])
                    .thenComparingLong(k -> -perKind.get(k)[1])
                    .thenComparing(Comparator.naturalOrder()))
            .toList();
    List<String> top = ranked.subList(0, Math.min(TOP_KINDS, ranked.size()));
    int otherCount = ranked.size() - top.size();

    Map<Instant, Integer> index = new HashMap<>();
    for (int i = 0; i < axis.size(); i++) {
      index.put(axis.get(i), i);
    }
    List<String> kinds = new ArrayList<>(top);
    if (otherCount > 0) {
      kinds.add(OTHER);
    }
    Map<String, List<Cell>> values = new LinkedHashMap<>();
    for (String k : kinds) {
      values.put(k, nulls(axis.size()));
    }
    for (BucketKindCell c : cells) {
      Integer i = index.get(c.bucket());
      if (i == null) {
        continue;
      }
      String key = top.contains(c.kind()) ? c.kind() : OTHER;
      List<Cell> arr = values.get(key);
      Cell old = arr.get(i);
      arr.set(
          i,
          old == null
              ? new Cell(c.tokens(), c.count())
              : new Cell(old.tokens() + c.tokens(), old.count() + c.count()));
    }
    return new Throughput(axis, kinds, values, otherCount);
  }

  // ---------------------------------------------------------------- 시계열

  /** 시계열 — 응답·실패는 ai_run, 표본 칸 값은 구간 최댓값을 DB 에서 받아 축에 맞춘다(없는 칸은 null). */
  private Series series(List<Instant> axis, Duration bucket, Instant from, Instant now) {
    int n = axis.size();
    Map<Instant, Integer> index = new HashMap<>();
    for (int i = 0; i < n; i++) {
      index.put(axis.get(i), i);
    }
    List<Long> p50 = nulls(n);
    List<Long> p95 = nulls(n);
    List<Long> failures = nulls(n);
    for (BucketLatency b : repo.latencyBuckets(from, now, bucket)) {
      Integer i = index.get(b.bucket());
      if (i == null) {
        continue;
      }
      p50.set(i, ms(b.p50()));
      p95.set(i, ms(b.p95()));
      failures.set(i, b.failed());
    }

    List<Integer> queue = nulls(n);
    List<Integer> used = nulls(n);
    List<Integer> limit = nulls(n);
    // 표본이 있던 구간 — 종류가 JSON 에 없던 구간은 0(밀린 것 없음), 표본 자체가 없던 구간은 null.
    boolean[] hasSample = new boolean[n];
    for (BucketSample b : repo.sampleBuckets(from, now, bucket)) {
      Integer i = index.get(b.bucket());
      if (i == null) {
        continue;
      }
      hasSample[i] = true;
      queue.set(i, b.queueWaiting());
      used.set(i, b.slotUsed());
      limit.set(i, b.slotLimit());
    }

    Map<String, List<Integer>> backlog = new TreeMap<>();
    for (BucketBacklog b : repo.backlogBuckets(from, now, bucket)) {
      Integer i = index.get(b.bucket());
      if (i != null) {
        backlog.computeIfAbsent(b.kind(), k -> nulls(n)).set(i, b.max());
      }
    }
    for (List<Integer> arr : backlog.values()) {
      for (int i = 0; i < n; i++) {
        if (arr.get(i) == null && hasSample[i]) {
          arr.set(i, 0);
        }
      }
    }

    // 계정별 5h — 라벨은 가장 늦은 구간의 값(구간 오름차순으로 덮어쓴다).
    List<BucketAccount> accountRows = new ArrayList<>(repo.account5hBuckets(from, now, bucket));
    accountRows.sort(Comparator.comparing(BucketAccount::bucket));
    Map<Long, String> labels = new TreeMap<>();
    Map<Long, List<Double>> accounts = new TreeMap<>();
    for (BucketAccount a : accountRows) {
      Integer i = index.get(a.bucket());
      if (i == null) {
        continue;
      }
      labels.put(a.accountId(), a.label());
      accounts.computeIfAbsent(a.accountId(), k -> nulls(n)).set(i, a.max());
    }
    List<AccountSeries> account5h = new ArrayList<>();
    for (Map.Entry<Long, List<Double>> e : accounts.entrySet()) {
      account5h.add(new AccountSeries(e.getKey(), labels.get(e.getKey()), e.getValue()));
    }
    return new Series(axis, p50, p95, failures, queue, used, limit, backlog, account5h);
  }

  // ---------------------------------------------------------------- 종류별 표·경고·사용률

  /** 종류별 표 — 실패율 큰 순(null 은 뒤) → 토큰 합 큰 순 → 코드. 위임 작업이 있으면 DELEGATED_WORK 한 행을 더한다(토큰 null). */
  private static List<KindRow> kindRows(List<KindTotals> kinds, DelegatedTotals d) {
    List<KindRow> rows = new ArrayList<>();
    for (KindTotals k : kinds) {
      RunTotals t = k.totals();
      rows.add(
          new KindRow(
              k.kind(),
              t.count(),
              t.failureRate(),
              ms(t.p50()),
              ms(t.p95()),
              t.inputTokens(),
              t.outputTokens(),
              k.lastFailureAt() == null
                  ? null
                  : new LastFailure(k.lastFailureAt(), k.lastFailureReason()),
              t.limited()));
    }
    if (d.count() > 0) {
      rows.add(
          new KindRow(
              DELEGATED_KIND,
              d.count(),
              d.failureRate(),
              ms(d.p50()),
              ms(d.p95()),
              null,
              null,
              null,
              0));
    }
    rows.sort(
        Comparator.comparing(
                KindRow::failureRate, Comparator.nullsLast(Comparator.<Double>reverseOrder()))
            .thenComparingLong(r -> -tokenSum(r))
            .thenComparing(KindRow::kind));
    return rows;
  }

  private static long tokenSum(KindRow r) {
    return (r.inputTokens() == null ? 0 : r.inputTokens())
        + (r.outputTokens() == null ? 0 : r.outputTokens());
  }

  /** 경고 판정 입력 — 종류별 현재 실패 수·실패율과 직전 기간 실패율(직전 행이 없으면 null). */
  private static List<KindFailure> kindFailures(List<KindTotals> cur, List<KindTotals> prev) {
    Map<String, Double> prevRate = new HashMap<>();
    for (KindTotals k : prev) {
      prevRate.put(k.kind(), k.totals().failureRate());
    }
    List<KindFailure> out = new ArrayList<>();
    for (KindTotals k : cur) {
      out.add(
          new KindFailure(
              k.kind(), k.totals().failed(), k.totals().failureRate(), prevRate.get(k.kind())));
    }
    return out;
  }

  /** 최근 표본 기준 현재 사용률. 표본이 없으면 값은 null, 계정은 빈 목록. */
  private Usage usage(Parsed latest) {
    if (latest == null) {
      return new Usage(null, null, null, List.of());
    }
    Map<Long, String> labels = new TreeMap<>();
    Map<Long, Double> h5 = new HashMap<>();
    Map<Long, Double> d7 = new HashMap<>();
    for (AccountUsagePoint a : latest.accounts()) {
      labels.put(a.accountId(), a.label());
      ("5h".equals(a.window()) ? h5 : d7).put(a.accountId(), a.usedPercent());
    }
    Map<Long, AccountResets> resets = repo.accountResets(labels.keySet());
    List<AccountUsage> accounts = new ArrayList<>();
    for (Map.Entry<Long, String> e : labels.entrySet()) {
      AccountResets r = resets.get(e.getKey());
      accounts.add(
          new AccountUsage(
              e.getKey(),
              e.getValue(),
              h5.get(e.getKey()),
              d7.get(e.getKey()),
              r == null ? null : r.resetsAt5h(),
              r == null ? null : r.resetsAt7d()));
    }
    return new Usage(
        latest.raw().slotUsed(), latest.raw().slotLimit(), latest.raw().queueWaiting(), accounts);
  }

  // ---------------------------------------------------------------- 표본 JSON

  /** 표본의 JSON 칸을 풀어 둔다. 모양이 틀린 항목은 건너뛴다(관리 화면이 깨지지 않게). */
  private Parsed parse(AiCapacitySample s) {
    List<AccountUsagePoint> accounts = new ArrayList<>();
    JsonNode arr = readJson(s.accountUsageJson());
    if (arr != null && arr.isArray()) {
      for (JsonNode a : arr) {
        AccountUsagePoint p = accountPoint(a);
        if (p != null) {
          accounts.add(p);
        }
      }
    }
    Map<String, Integer> backlog = new LinkedHashMap<>();
    JsonNode obj = readJson(s.backlogJson());
    if (obj != null && obj.isObject()) {
      for (Map.Entry<String, JsonNode> e : obj.properties()) {
        // int 범위 밖 값도 asInt() 가 예외를 던진다 — 같은 이유로 건너뛴다.
        if (e.getValue().isNumber() && e.getValue().canConvertToInt()) {
          backlog.put(e.getKey(), e.getValue().asInt());
        }
      }
    }
    return new Parsed(s.sampledAt().toInstant(), s, accounts, backlog);
  }

  /**
   * 계정 사용률 항목 하나 — 모양이 틀리면 null(그 항목만 건너뛴다). accountId 는 정수 long 범위, usedPercent 는 유한 실수만 받는다.
   * Jackson 3 의 {@code asLong()}·{@code asDouble()} 은 범위 밖 값에서 예외를 던지므로 표본 속 큰 수 하나가 개요 응답 전체를 500
   * 으로 만들기 때문이다(WP-1831 리뷰 ④). SQL 쪽 {@link AiStatusQueryRepository#account5hBuckets} 와 같은 기준으로
   * 거른다.
   */
  private static AccountUsagePoint accountPoint(JsonNode a) {
    JsonNode id = a.get("accountId");
    JsonNode pct = a.get("usedPercent");
    if (id == null || pct == null || !a.hasNonNull("window")) {
      return null;
    }
    if (!id.isIntegralNumber() || !id.canConvertToLong()) {
      return null;
    }
    if (!pct.isNumber()) {
      return null;
    }
    OptionalDouble used = pct.doubleValueOpt();
    if (used.isEmpty() || !Double.isFinite(used.getAsDouble())) {
      return null;
    }
    return new AccountUsagePoint(
        id.asLong(),
        a.hasNonNull("label") ? a.get("label").asString() : "",
        a.get("window").asString(),
        used.getAsDouble());
  }

  /** 표본 JSON 칸을 푼다. JSON 이 깨졌으면 null — 표본 하나가 개요 응답을 500 으로 만들지 않기 위해 예외를 밖으로 넘기지 않는다. */
  private JsonNode readJson(String json) {
    if (json == null || json.isBlank()) {
      return null;
    }
    try {
      return objectMapper.readTree(json);
    } catch (JacksonException e) {
      return null;
    }
  }

  /** 시각 오름차순 표본 목록의 마지막(없으면 null). 구간 경계는 조회 시 이미 걸러졌으므로 여기서 다시 보지 않는다. */
  private static Parsed lastOf(List<Parsed> samples) {
    if (samples.isEmpty()) {
      return null;
    }
    return samples.get(samples.size() - 1);
  }

  // ---------------------------------------------------------------- 작은 도구

  private static Latency latency(RunTotals t) {
    return new Latency(ms(t.p50()), ms(t.p95()));
  }

  /** 밀리초 실수를 반올림한 Long(null 유지). */
  private static Long ms(Double v) {
    return v == null ? null : Math.round(v);
  }

  private static <T> List<T> nulls(int n) {
    List<T> l = new ArrayList<>(n);
    for (int i = 0; i < n; i++) {
      l.add(null);
    }
    return l;
  }
}

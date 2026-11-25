package com.workplace.airun.status.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * AI 현황 개요 응답(WP-1831 설계 4-3). 구간 축(buckets)은 기간 첫 구간부터 지금 구간까지 모두 내고, 데이터가 없는 칸은 0 이 아니라 null 이다.
 * 시간 길이 값(응답·대기)은 밀리초 Long.
 *
 * @param period 기간 코드(1h·24h·7d·30d)
 * @param bucketSeconds 구간 크기(초)
 * @param from 기간 시작(포함)
 * @param to 기간 끝(제외, 요청 시각)
 * @param generatedAt 응답 생성 시각
 * @param metrics 지표 6종(현재·직전 기간)
 * @param throughput 구간 × 종류 처리량
 * @param series 작은 그래프용 시계열
 * @param kinds 종류별 표
 * @param usage 최근 표본 기준 현재 사용률
 * @param alerts 경고 목록
 */
public record AiStatusOverview(
    String period,
    long bucketSeconds,
    Instant from,
    Instant to,
    Instant generatedAt,
    Metrics metrics,
    Throughput throughput,
    Series series,
    List<KindRow> kinds,
    Usage usage,
    List<AiStatusAlert> alerts) {

  /** 현재·직전 기간 값 한 쌍. 직전 값이 없으면 previous 가 null. */
  public record Pair<T>(T current, T previous) {}

  /** 입력·출력 토큰 합. */
  public record Tokens(long input, long output) {}

  /** 밀리초 백분위(p50·p95). 끝난 처리가 없으면 각각 null. */
  public record Latency(Long p50, Long p95) {}

  /** 위임 작업 대기 p95(밀리초)와 그 시점 대기 건수(표본 없으면 null). */
  public record Wait(Long p95, Integer queueWaiting) {}

  /** 작업 칸 사용(최근 표본, 없으면 null 두 개). */
  public record Slot(Integer used, Integer limit) {}

  /**
   * 지표 6종 + 사용 한도 초과.
   *
   * @param limited 현재 기간에 사용 한도 초과(provider_limit)로 끝난 건수 — failureRate 에서는 빠진다
   * @param limitedCredentials 한도 초과가 난 자격 증명 라벨(최근 순·중복 없음·최대 3)
   */
  public record Metrics(
      Pair<Long> runCount,
      Pair<Tokens> tokens,
      Pair<Double> failureRate,
      Pair<Latency> responseTime,
      Pair<Wait> waitTime,
      Pair<Slot> slotUsage,
      long limited,
      List<String> limitedCredentials) {}

  /** 처리량 한 칸(토큰 합·건수). */
  public record Cell(Long tokens, Long count) {}

  /**
   * 처리량. kinds 는 상위 5 종류 + (더 있으면) "OTHER", values 의 각 배열은 buckets 와 같은 길이이고 빈 구간은 null.
   *
   * @param otherKindCount "OTHER" 에 묶인 종류 수
   */
  public record Throughput(
      List<Instant> buckets,
      List<String> kinds,
      Map<String, List<Cell>> values,
      int otherKindCount) {}

  /** 계정별 5시간 사용률 시계열(구간 최댓값, 표본 없는 구간 null). */
  public record AccountSeries(long accountId, String label, List<Double> values) {}

  /** 작은 그래프 시계열 — 모든 배열이 buckets 와 같은 길이. */
  public record Series(
      List<Instant> buckets,
      List<Long> responseP50,
      List<Long> responseP95,
      List<Long> failures,
      List<Integer> queueWaiting,
      List<Integer> slotUsed,
      List<Integer> slotLimit,
      Map<String, List<Integer>> backlog,
      List<AccountSeries> account5h) {}

  /** 종류별 마지막 실패. */
  public record LastFailure(Instant at, String reason) {}

  /** 종류별 표 한 행(토큰·실패율 등이 없으면 null). limited 는 사용 한도 초과 건수(실패율에서 빠진 것). */
  public record KindRow(
      String kind,
      long count,
      Double failureRate,
      Long p50,
      Long p95,
      Long inputTokens,
      Long outputTokens,
      LastFailure lastFailure,
      long limited) {}

  /** 계정 한 줄의 현재 사용률과 초기화 시각. */
  public record AccountUsage(
      long accountId,
      String label,
      Double usedPercent5h,
      Double usedPercent7d,
      Instant resetsAt5h,
      Instant resetsAt7d) {}

  /** 최근 표본(10분 안) 기준 현재 사용률. 표본이 없으면 값 필드는 null, accounts 는 빈 목록. */
  public record Usage(
      Integer slotUsed, Integer slotLimit, Integer queueWaiting, List<AccountUsage> accounts) {}
}

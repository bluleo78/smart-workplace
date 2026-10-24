package com.workplace.global.security.ratelimit;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 키(정책+IP)마다 토큰 버킷 하나를 메모리에 두는 속도 제한기(WP-763).
 *
 * <p>버킷은 {@code capacity} 개로 가득 찬 채 시작하고 1분에 {@code capacity} 개 비율로 다시 찬다 — 1분에 capacity 회까지 몰아서 보낼
 * 수 있고, 그 뒤로는 고르게 다시 허용된다. 상태는 이 인스턴스 메모리에만 있어 api 를 여러 대로 늘리면 한도가 「대수 × capacity」가 된다
 * (docs/ops/rate-limit.md). 새 의존성(Bucket4j) 대신 직접 둔 것은 메모리 버킷 하나면 충분하고 공유 저장소로 옮길 때 어차피 바꿀 부분이기
 * 때문이다.
 *
 * <p>IP 를 바꿔 가며 보내 맵이 커지는 것을 막으려고, 키가 {@link #SWEEP_THRESHOLD} 개를 넘으면 가득 찬(오래 쓰지 않은) 버킷을 지운다.
 */
public class TokenBucketLimiter {

  /** 이 개수를 넘으면 다 찬 버킷을 쓸어낸다 — 다 찬 버킷은 지워도 새로 만든 버킷과 같아 동작이 바뀌지 않는다. */
  static final int SWEEP_THRESHOLD = 10_000;

  private static final long REFILL_PERIOD_NANOS = Duration.ofMinutes(1).toNanos();

  private final Clock clock;
  private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

  public TokenBucketLimiter(Clock clock) {
    this.clock = clock;
  }

  /**
   * 키로 요청 하나를 받을지 정한다.
   *
   * @return 받으면 0, 거절하면 다시 시도할 수 있을 때까지의 초(1 이상)
   */
  public long tryConsume(String key, int capacity) {
    long now = nowNanos();
    if (buckets.size() > SWEEP_THRESHOLD) sweep(now);
    Bucket bucket = buckets.computeIfAbsent(key, k -> new Bucket(capacity, now));
    synchronized (bucket) {
      bucket.refill(now);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return 0;
      }
      // 토큰 하나가 다시 차는 데 걸리는 시간(올림 초)
      double nanosPerToken = (double) REFILL_PERIOD_NANOS / capacity;
      long waitNanos = (long) Math.ceil((1 - bucket.tokens) * nanosPerToken);
      return Math.max(1, (long) Math.ceil(waitNanos / 1_000_000_000.0));
    }
  }

  /** 테스트용 — 지금 들고 있는 키 수. */
  int size() {
    return buckets.size();
  }

  private void sweep(long now) {
    buckets
        .values()
        .removeIf(
            b -> {
              synchronized (b) {
                b.refill(now);
                return b.tokens >= b.capacity;
              }
            });
  }

  private long nowNanos() {
    Instant now = clock.instant();
    return now.getEpochSecond() * 1_000_000_000L + now.getNano();
  }

  /** 버킷 크기·남은 토큰·마지막으로 채운 시각. 크기는 키(정책)마다 다르므로 버킷이 들고 있는다. */
  private static final class Bucket {
    private final int capacity;
    private double tokens;
    private long refilledAt;

    Bucket(int capacity, long now) {
      this.capacity = capacity;
      this.tokens = capacity;
      this.refilledAt = now;
    }

    void refill(long now) {
      long elapsed = now - refilledAt;
      if (elapsed <= 0) return;
      tokens = Math.min(capacity, tokens + (double) elapsed * capacity / REFILL_PERIOD_NANOS);
      refilledAt = now;
    }
  }
}

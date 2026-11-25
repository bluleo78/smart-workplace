package com.workplace.airun;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;

/**
 * 잠금(ShedLock lockAtMostFor) 아래서 AI 를 차례로 부르는 회차의 시간 예산 (WP-2111).
 *
 * <p>왜: 호출 상한 기본값이 올라가고(예: 분류 60→120초) 배포에서 덮어쓸 수도 있어, 「회차당 N건」 같은 개수 상한만으로는 회차 최악 시간이 잠금을 넘을 수 있다.
 * 잠금이 먼저 풀리면 다른 파드가 같은 회차를 겹쳐 돈다. 그래서 다음 호출을 시작하기 전에 「지금 + 그 호출의 최악 시간(실행 상한 + 읽기 여유, {@link
 * AiCallTimeouts#readTimeoutFor})」이 마감을 넘는지 보고, 넘으면 그 회차를 멈춘다(남은 대상은 다음 회차).
 *
 * <p>마감 = 회차 시작 + (잠금 최대 − {@link #LOCK_MARGIN}). 여유는 DB 쓰기·임베딩 같은 AI 밖 작업 몫이다.
 */
public final class RoundDeadline {

  /** 잠금 최대에서 빼 두는 여유 — 마지막 호출 뒤의 저장·로그 같은 AI 밖 작업이 잠금 안에 끝나게. */
  public static final Duration LOCK_MARGIN = Duration.ofMinutes(2);

  private final Clock clock;

  /** 마감 시각 — null 이면 무제한(잠금 없이 부르는 진입점용). */
  private final Instant deadline;

  private RoundDeadline(Clock clock, Instant deadline) {
    this.clock = clock;
    this.deadline = deadline;
  }

  /**
   * 지금부터 잠금 최대 − 여유 뒤가 마감인 회차 예산. 회차 시작(잠금을 잡은 직후, 대상 수집 전)에 부른다 — 수집 시간도 잠금 안에서 흐르므로 마감을 늦게 잡지 않게.
   *
   * @throws IllegalArgumentException lockAtMostFor 가 {@link #LOCK_MARGIN} 이하 — 마감이 시작보다 앞서 회차가 아무것도
   *     못 하는 설정 실수를 기동·첫 회차에서 바로 드러낸다
   */
  public static RoundDeadline underLock(Clock clock, Duration lockAtMostFor) {
    if (lockAtMostFor.compareTo(LOCK_MARGIN) <= 0) {
      throw new IllegalArgumentException(
          "잠금 최대(" + lockAtMostFor + ")가 여유(" + LOCK_MARGIN + ") 이하라 회차 시간 예산이 없다");
    }
    return new RoundDeadline(clock, clock.instant().plus(lockAtMostFor.minus(LOCK_MARGIN)));
  }

  /** 마감 없음 — 사용자 요청·이벤트처럼 회차 잠금 밖에서 부르는 경로용. */
  public static RoundDeadline unlimited() {
    return new RoundDeadline(Clock.systemUTC(), null);
  }

  /** 지금 시작해 최악 worst 만큼 걸려도 마감 안에 끝나는지. */
  public boolean allows(Duration worst) {
    return deadline == null || !clock.instant().plus(worst).isAfter(deadline);
  }

  /**
   * 다음 대상을 시작해도 되는지 — 안 되면 경고 로그(남은 수)를 남기고 false. 호출자는 false 면 반복을 멈춘다.
   *
   * @param message 「{}」 하나에 남은 수가 들어가는 경고 문구
   */
  public boolean allowsOrWarn(Duration worst, Logger log, String message, int remaining) {
    if (allows(worst)) {
      return true;
    }
    log.warn(message, remaining);
    return false;
  }

  /** 마감까지 남은 시간에 최악 perCall 로 끝나는 호출 수(정수 나눗셈). 남은 시간이 perCall 보다 짧으면 0, 무제한이면 최대값. */
  public int fittingCalls(Duration perCall) {
    if (deadline == null) {
      return Integer.MAX_VALUE;
    }
    return (int) Math.min(Integer.MAX_VALUE, remaining().toMillis() / perCall.toMillis());
  }

  /** 마감까지 남은 시간(무제한이면 null, 지났으면 0). */
  public Duration remaining() {
    if (deadline == null) {
      return null;
    }
    Duration left = Duration.between(clock.instant(), deadline);
    return left.isNegative() ? Duration.ZERO : left;
  }
}

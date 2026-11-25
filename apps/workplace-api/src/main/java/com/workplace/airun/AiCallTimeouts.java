package com.workplace.airun;

import java.time.Duration;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.stereotype.Component;

/**
 * AI 호출 지점별 실행 상한과 HTTP 읽기 상한 계산 (WP-2111).
 *
 * <p>코드 기본값({@link AiCall})에 배포 설정 {@code workplace.ai.timeout-overrides}(환경변수
 * WORKPLACE_AI_TIMEOUT_OVERRIDES, Helm 값 api.aiTimeouts)의 덮어쓰기를 얹는다. 형식은 {@code
 * "HOME_PRIORITY_CLASSIFY=90s,WORK_PROFILE=3m"}. 잘못된 덮어쓰기(모르는 이름·형식 오류·범위 밖·중복)는 조용히 무시하지 않고 기동을
 * 실패시킨다.
 */
@Component
public class AiCallTimeouts {

  /** 클라이언트 읽기 상한 = 나르는 호출 상한의 최대 + 이 여유 — HTTP 가 실행 상한보다 먼저 끊지 않게 한다. */
  public static final Duration READ_MARGIN = Duration.ofSeconds(30);

  /** 덮어쓰기 최소. */
  private static final Duration MIN_OVERRIDE = Duration.ofSeconds(1);

  private final Map<AiCall, Duration> timeouts = new EnumMap<>(AiCall.class);

  public AiCallTimeouts(@Value("${workplace.ai.timeout-overrides:}") String overrides) {
    for (AiCall call : AiCall.values()) {
      timeouts.put(call, call.defaultTimeout());
    }
    applyOverrides(overrides);
  }

  /** 테스트용 — 덮어쓰기 없는 기본 표. */
  public static AiCallTimeouts defaults() {
    return new AiCallTimeouts("");
  }

  /** 호출 지점의 실행 상한. */
  public Duration timeout(AiCall call) {
    return timeouts.get(call);
  }

  /** 호출 지점의 실행 상한(ms) — ai-agent 요청의 timeoutMs 로 싣는다. */
  public int timeoutMs(AiCall call) {
    return Math.toIntExact(timeout(call).toMillis());
  }

  /** 그 클라이언트가 나르는 호출들의 실행 상한 최대 + READ_MARGIN. 덮어쓴 값을 반영한다. */
  public Duration readTimeoutFor(AiCall... calls) {
    return maxTimeout(calls).plus(READ_MARGIN);
  }

  /** 호출들의 실행 상한 중 최대. */
  private Duration maxTimeout(AiCall... calls) {
    Duration max = Duration.ZERO;
    for (AiCall call : calls) {
      if (timeout(call).compareTo(max) > 0) {
        max = timeout(call);
      }
    }
    return max;
  }

  /**
   * 나르는 호출들의 실행 상한 최대 + 지정한 여유. 사람이 화면에서 기다리는 동기 클라이언트(공용 메모리 quick 검사·추천)는 30초 여유가 대기를 늘리므로 짧은 여유로
   * 예전 읽기 상한을 지킨다. 덮어쓴 값을 반영한다.
   */
  public Duration readTimeoutWithMargin(Duration margin, AiCall... calls) {
    return maxTimeout(calls).plus(margin);
  }

  /** 하한(floor)과 {@link #readTimeoutFor(AiCall...)} 중 큰 값 — 기존 고정 읽기 상한을 내리지 않으려는 클라이언트용. */
  public Duration readTimeoutAtLeast(Duration floor, AiCall... calls) {
    Duration fromTable = readTimeoutFor(calls);
    return fromTable.compareTo(floor) > 0 ? fromTable : floor;
  }

  /** 쉼표로 나눈 이름=기간 항목을 검증하며 적용한다. 빈 값·빈 항목은 건너뛴다. */
  private void applyOverrides(String overrides) {
    if (overrides == null || overrides.isBlank()) {
      return;
    }
    Set<AiCall> seen = EnumSet.noneOf(AiCall.class);
    for (String raw : overrides.split(",")) {
      String entry = raw.strip();
      if (entry.isEmpty()) {
        continue;
      }
      int eq = entry.indexOf('=');
      if (eq < 0) {
        throw bad(entry, "'이름=기간' 형식이어야 한다");
      }
      String name = entry.substring(0, eq).strip();
      String value = entry.substring(eq + 1).strip();
      AiCall call;
      try {
        call = AiCall.valueOf(name);
      } catch (IllegalArgumentException e) {
        throw bad(name, "알 수 없는 AI 호출 이름이다");
      }
      if (!seen.add(call)) {
        throw bad(name, "같은 이름을 두 번 덮어쓸 수 없다");
      }
      Duration d;
      try {
        d = DurationStyle.detectAndParse(value);
      } catch (RuntimeException e) {
        throw bad(name, "기간 형식이 잘못됐다: '" + value + "' (예: 90s, 3m, PT2M)");
      }
      if (d.compareTo(MIN_OVERRIDE) < 0 || d.compareTo(call.maxOverride()) > 0) {
        throw bad(
            name, "허용 범위는 1초 이상 " + call.maxOverride().toSeconds() + "초 이하다: '" + value + "'");
      }
      timeouts.put(call, d);
    }
  }

  private static IllegalStateException bad(String name, String reason) {
    return new IllegalStateException(
        "workplace.ai.timeout-overrides 항목 '" + name + "' 오류: " + reason);
  }
}

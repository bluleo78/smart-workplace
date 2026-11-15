package com.workplace.global.time;

import java.time.Instant;
import java.util.regex.Pattern;

/**
 * 키셋 커서에 담긴 시각 읽기 — 이슈 목록({@code IssueCursor})과 홈 목록({@code CursorCodec})이 함께 쓴다.
 *
 * <p>커서는 시각을 {@link Instant#toString()}(마이크로초 보존)으로 담는다(WP-1618) — DB 시각은 마이크로초라, 밀리초로 자르면 다음 페이지
 * 조건({@code 시각 < 커서 OR (= 커서 AND id < …)})이 페이지 끝 행보다 이른 같은 밀리초 행을 건너뛴다. 밀리초 epoch 숫자로 담던 배포 전 커서도
 * 읽는다. 커서는 클라이언트가 돌려보내는 값이라 손으로 고친 값이 올 수 있어, 앱 공통 범위({@link SupportedDates}) 밖이면 거부한다 — 범위를 넘은 시각은
 * 뒤의 {@code OffsetDateTime.ofInstant}·DB 비교에서 500 이 된다.
 */
public final class CursorInstants {

  /** 배포 전 커서의 밀리초 epoch 숫자. */
  private static final Pattern EPOCH_MILLI = Pattern.compile("-?\\d+");

  private CursorInstants() {}

  /**
   * ISO-8601 시각 또는 밀리초 epoch 숫자를 읽는다.
   *
   * @throws IllegalArgumentException 형식이 틀리거나 범위 밖일 때(DateTimeParseException·NumberFormatException
   *     포함)
   */
  public static Instant parse(String s) {
    return checked(
        EPOCH_MILLI.matcher(s).matches()
            ? Instant.ofEpochMilli(Long.parseLong(s))
            : Instant.parse(s));
  }

  /** 이미 읽은 시각이 앱 공통 범위 안인지 본다 — 밖이면 {@link IllegalArgumentException}. */
  public static Instant checked(Instant t) {
    if (!SupportedDates.isSupported(t)) {
      throw new IllegalArgumentException(SupportedDates.MESSAGE);
    }
    return t;
  }
}

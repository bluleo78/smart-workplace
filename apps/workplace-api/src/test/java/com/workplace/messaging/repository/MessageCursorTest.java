package com.workplace.messaging.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.time.SupportedDates;
import com.workplace.messaging.repository.MessageRepository.Cursor;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * MessageRepository.Cursor 해석의 범위·칸 수 검사 테스트(WP-1583).
 *
 * <p>Instant 끝 시각은 호출부의 OffsetDateTime 변환에서 500, DB 범위 밖 시각은 409, 1900년 전 시각·덧붙은 칸은 조용히 200 으로 받았다.
 * 모두 「목록 위치(cursor)가 올바르지 않습니다」 IllegalArgumentException(→ 400)으로 거절해야 한다.
 */
class MessageCursorTest {

  private static final String MESSAGE = "목록 위치(cursor)가 올바르지 않습니다";

  /** 원문을 base64url(패딩 없음)로 감싸 커서 문자열을 만든다 — 클라이언트가 조작한 값을 흉내 낸다. */
  private static String raw(String s) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(s.getBytes(StandardCharsets.UTF_8));
  }

  /** 정상 커서는 시각(나노 포함)·id 가 그대로 돌아온다. */
  @Test
  void decode_roundTrip_preservesValues() {
    Instant ts = Instant.ofEpochSecond(1_700_000_000L, 123_456_789);
    Cursor decoded = Cursor.decode(Cursor.encode(new Cursor(ts, 42L)));

    assertThat(decoded.createdAt()).isEqualTo(ts);
    assertThat(decoded.id()).isEqualTo(42L);
  }

  /**
   * 거절해야 하는 원문들 — 모두 같은 문구의 IllegalArgumentException(→ 400).
   *
   * <ul>
   *   <li>Instant 가 표현할 수 있는 끝 시각 — 예전엔 호출부 OffsetDateTime 변환에서 500
   *   <li>DB(timestamptz) 범위 밖 시각 — 예전엔 409
   *   <li>1900년 전 시각 — 예전엔 조용히 받았다
   *   <li>칸이 덧붙은 값·끝에 빈 칸이 덧붙은 값 — 예전엔 넷째 칸을 버리고 받았다
   *   <li>칸이 모자란 값
   * </ul>
   */
  @ParameterizedTest
  @ValueSource(
      strings = {
        "31556889864403199|0|1",
        "9999999999999|0|1",
        "-99999999999|0|1",
        "1700000000|0|5|junk",
        "1700000000|0|5|",
        "1700000000|0"
      })
  void decode_invalidRaw_isRejected(String rawValue) {
    assertThatThrownBy(() -> Cursor.decode(raw(rawValue)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage(MESSAGE);
  }

  /** 지원 범위의 양 끝(포함)은 통과한다. */
  @Test
  void decode_supportedBoundaries_areAccepted() {
    Instant min = SupportedDates.MIN_INSTANT;
    Instant max = SupportedDates.MAX_INSTANT;

    assertThat(Cursor.decode(Cursor.encode(new Cursor(min, 1L))).createdAt()).isEqualTo(min);
    assertThat(Cursor.decode(Cursor.encode(new Cursor(max, 1L))).createdAt()).isEqualTo(max);
  }
}

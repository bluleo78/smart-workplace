package com.workplace.chat.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.repository.ChatMessageRepository.Cursor;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * ChatMessageRepository.Cursor 인코딩 정밀도 테스트.
 *
 * <p>과거 toEpochMilli() 인코딩은 밀리초 미만(마이크로초)을 절삭해, 동일 밀리초에 생성된 서로 다른 메시지가 커서 경계에서 같은 시각으로 뭉개져 누락(유실)될
 * 수 있었다. epochSecond|nano 정밀도로 이를 방지한다.
 */
class ChatMessageCursorTest {

  /** 마이크로초(밀리초 미만) 정밀도가 round-trip 후에도 보존된다. */
  @Test
  void encodeDecode_preservesSubMillisecondPrecision() {
    // 123.456789ms 지점 — toEpochMilli() 였다면 .456789 가 절삭됨
    Instant ts = Instant.ofEpochSecond(1_700_000_000L, 123_456_789);
    Cursor decoded = Cursor.decode(Cursor.encode(new Cursor(ts, 42L)));

    assertThat(decoded.createdAt()).isEqualTo(ts);
    assertThat(decoded.createdAt().getNano()).isEqualTo(123_456_789);
    assertThat(decoded.id()).isEqualTo(42L);
  }

  /** 동일 밀리초 내 서로 다른 마이크로초 두 시각은 서로 다른 커서로 인코딩된다(경계 구분 가능). */
  @Test
  void encode_sameMillisecondDifferentMicros_producesDistinctCursors() {
    // 둘 다 toEpochMilli() 시 123ms 로 floor → 과거 인코딩에선 충돌. 실제론 서로 다른 시각.
    Instant a = Instant.ofEpochSecond(1_700_000_000L, 123_000_000); // 123.000ms
    Instant b = Instant.ofEpochSecond(1_700_000_000L, 123_500_000); // 123.500ms (같은 ms, 다른 micros)

    String ca = Cursor.encode(new Cursor(a, 1L));
    String cb = Cursor.encode(new Cursor(b, 2L));

    assertThat(ca).isNotEqualTo(cb);
    // 디코드 시각도 보존되어 경계 비교가 정확하다
    assertThat(Cursor.decode(ca).createdAt()).isEqualTo(a);
    assertThat(Cursor.decode(cb).createdAt()).isEqualTo(b);
  }
}

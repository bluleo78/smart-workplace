package com.workplace.airun.status;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.exception.InvalidCursorException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.Test;

/** AI 실행 이력 커서의 직렬화·해석 검증. */
class AiRunCursorTest {

  private static String b64(String raw) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
  }

  @Test
  void roundTrip_keepsMicros() {
    var c = new AiRunCursor(Instant.parse("2026-11-22T00:00:00.123456Z"), 'W', 42L);
    assertThat(AiRunCursor.decode(c.encode())).isEqualTo(c);
  }

  @Test
  void decode_garbageThrows() {
    assertThatThrownBy(() -> AiRunCursor.decode("!!")).isInstanceOf(InvalidCursorException.class);
  }

  @Test
  void decode_badSourceThrows() {
    assertThatThrownBy(() -> AiRunCursor.decode(b64("2026-11-22T00:00:00Z|X|1")))
        .isInstanceOf(InvalidCursorException.class);
  }

  @Test
  void decode_wrongPartsOrNumberThrows() {
    assertThatThrownBy(() -> AiRunCursor.decode(b64("2026-11-22T00:00:00Z|R")))
        .isInstanceOf(InvalidCursorException.class);
    assertThatThrownBy(() -> AiRunCursor.decode(b64("2026-11-22T00:00:00Z|R|abc")))
        .isInstanceOf(InvalidCursorException.class);
    assertThatThrownBy(() -> AiRunCursor.decode(b64("nope|R|1")))
        .isInstanceOf(InvalidCursorException.class);
  }
}

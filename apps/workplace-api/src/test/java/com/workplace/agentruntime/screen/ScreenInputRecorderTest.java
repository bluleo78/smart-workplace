package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** ScreenInputRecorder 의 봉인·되돌려 넣기(WP-2014) 단위 테스트 — Spring 없이 버퍼 동작만 확인한다. */
class ScreenInputRecorderTest {

  private static byte[] b(String s) {
    return s.getBytes(StandardCharsets.UTF_8);
  }

  /** 상한을 넘기는 입력 — 상한 바이트 + 10. */
  private static byte[] overCap() {
    byte[] big = new byte[ScreenInputRecorder.CAP_BYTES + 10];
    Arrays.fill(big, (byte) 'a');
    return big;
  }

  @Test
  void append_afterFinalDrain_returnsFalseAndIsNotRecorded() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    assertThat(r.append(b("a"))).isTrue();
    assertThat(r.drain(true)).containsExactly("a");
    assertThat(r.append(b("b"))).isFalse();
    assertThat(r.drain(true)).isEmpty();
  }

  @Test
  void append_beforeFinalDrain_isIncludedInFinalDrain() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    r.append(b("ls"));
    assertThat(r.drain(true)).containsExactly("ls");
  }

  @Test
  void append_pastCap_returnsTrueButIsNotRecorded() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    assertThat(r.append(overCap())).isTrue();
    assertThat(r.append(b("x"))).isTrue();
    List<String> out = r.drain(false);
    assertThat(out).hasSize(2);
    assertThat(out.get(0)).hasSize(ScreenInputRecorder.CAP_BYTES);
    assertThat(out.get(1)).isEqualTo(ScreenInputRecorder.CAP_MARKER);
    assertThat(r.drain(false)).isEmpty();
  }

  @Test
  void requeue_thenNewInput_drainReturnsRequeuedFirstThenNew() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    r.append(b("a"));
    List<String> c = r.drain(false);
    assertThat(c).containsExactly("a");
    assertThat(r.requeue(c)).isTrue();
    r.append(b("b"));
    assertThat(r.drain(false)).containsExactly("a", "b");
    assertThat(r.drain(false)).isEmpty();
  }

  @Test
  void requeue_ofCapMarker_isReturnedOnceOnNextDrain() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    r.append(overCap());
    List<String> c = r.drain(false);
    assertThat(r.requeue(c)).isTrue();
    assertThat(r.drain(false)).isEqualTo(c);
    assertThat(r.drain(false)).isEmpty();
  }

  @Test
  void requeue_afterFinalDrain_returnsFalse() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    r.drain(true);
    assertThat(r.requeue(List.of("x"))).isFalse();
  }

  @Test
  void requeue_beforeFinalDrain_isIncludedInFinalDrain() {
    ScreenInputRecorder r = new ScreenInputRecorder();
    r.append(b("a"));
    List<String> c = r.drain(false);
    r.requeue(c);
    assertThat(r.drain(true)).containsExactly("a");
  }
}

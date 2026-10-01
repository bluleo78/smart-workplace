package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

/** PushConfig 기동 점검 — 잘못된 VAPID 연락처는 경고하고, 정상이거나 푸시 비활성이면 조용해야 한다(WP-152). */
@ExtendWith(OutputCaptureExtension.class)
class PushConfigTest {

  @Test
  void warnsOnDefaultLocalhostSubject(CapturedOutput output) {
    new PushConfig(new PushProperties(true, true, null, null, null, null)).warnOnBadSubject();

    assertThat(output)
        .contains("[push] VAPID subject 'mailto:admin@localhost'")
        .contains("WORKPLACE_PUSH_SUBJECT");
  }

  @Test
  void silentForRealSubject(CapturedOutput output) {
    new PushConfig(new PushProperties(true, true, "mailto:dh.yang@iacloud.kr", null, null, null))
        .warnOnBadSubject();

    assertThat(output).doesNotContain("VAPID subject");
  }

  /** 폐쇄망 등 푸시 비활성 서버는 subject 를 쓰지 않으므로 경고하지 않는다. */
  @Test
  void silentWhenPushDisabled(CapturedOutput output) {
    new PushConfig(new PushProperties(false, true, null, null, null, null)).warnOnBadSubject();

    assertThat(output).doesNotContain("VAPID subject");
  }
}

package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** PushProperties.subjectProblem — Apple 이 거부하는 VAPID 연락처를 기동 시 잡아내는지(WP-152). */
class PushPropertiesTest {

  private static PushProperties withSubject(String subject) {
    return new PushProperties(true, true, subject, null, null, null);
  }

  @ParameterizedTest
  @ValueSource(strings = {"mailto:dh.yang@iacloud.kr", "https://genia-works.iacloud.kr/contact"})
  void realContact_hasNoProblem(String subject) {
    assertThat(withSubject(subject).subjectProblem()).isNull();
  }

  /** 미설정이면 기본값(mailto:admin@localhost)으로 보정되며, 그 기본값 자체가 Apple 거부 대상이라 경고돼야 한다. */
  @Test
  void blankSubject_defaultsToLocalhost_andIsFlagged() {
    PushProperties props = withSubject(null);

    assertThat(props.subject()).isEqualTo("mailto:admin@localhost");
    assertThat(props.subjectProblem()).contains("localhost");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "mailto:admin@LOCALHOST",
        "mailto:ops@dev.local",
        "https://localhost:8443/push",
        "mailto:admin@app.localhost"
      })
  void localDomains_areFlagged(String subject) {
    assertThat(withSubject(subject).subjectProblem()).startsWith("실제 도메인이 아님");
  }

  @Test
  void mailtoWithoutAt_isFlagged() {
    assertThat(withSubject("mailto:admin").subjectProblem()).contains("메일 주소");
  }

  @Test
  void nonMailtoNonHttps_isFlagged() {
    assertThat(withSubject("admin@iacloud.kr").subjectProblem()).contains("형식");
  }
}

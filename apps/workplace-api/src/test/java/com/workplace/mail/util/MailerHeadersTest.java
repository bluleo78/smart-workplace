package com.workplace.mail.util;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-1364: X-Mailer 값으로 Gen:iA Works 발송을 가리는 판정 표. */
class MailerHeadersTest {

  @Test
  void isSentByGeniaWorks_table() {
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of("Gen:iA Works 0.9.46"))).isTrue();
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of(" Gen:iA Works dev "))).isTrue();
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of("x", "Gen:iA Works 1"))).isTrue();
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of("Microsoft Outlook 16.0"))).isFalse();
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of("gen:ia works 1"))).isFalse(); // 대소문자 구분
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of("Gen:iA Works"))).isTrue(); // 버전 없음
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of("Gen:iA WorksBot 2"))).isFalse(); // 다른 제품
    assertThat(MailerHeaders.isSentByGeniaWorks(Arrays.asList((String) null))).isFalse();
    assertThat(MailerHeaders.isSentByGeniaWorks(List.of())).isFalse();
    assertThat(MailerHeaders.isSentByGeniaWorks(null)).isFalse();
  }
}

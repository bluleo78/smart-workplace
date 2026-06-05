package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.MailSyncStatus;
import com.workplace.mail.service.MailSyncProgress;
import org.junit.jupiter.api.Test;

class MailSyncProgressTest {

  @Test
  void guardAndLifecycle() {
    MailSyncProgress p = new MailSyncProgress();
    assertThat(p.tryStart(1L)).isTrue();
    assertThat(p.tryStart(1L)).isFalse();

    MailSyncStatus s1 = p.snapshot(1L);
    assertThat(s1.phase()).isEqualTo("LIST");
    assertThat(s1.running()).isTrue();

    p.startBodies(1L, 3);
    p.incBody(1L);
    MailSyncStatus s2 = p.snapshot(1L);
    assertThat(s2.phase()).isEqualTo("BODIES");
    assertThat(s2.total()).isEqualTo(3);
    assertThat(s2.done()).isEqualTo(1);
    assertThat(s2.running()).isTrue();

    p.finish(1L);
    MailSyncStatus s3 = p.snapshot(1L);
    assertThat(s3.phase()).isEqualTo("IDLE");
    assertThat(s3.running()).isFalse();
    assertThat(p.tryStart(1L)).isTrue();
  }

  @Test
  void snapshot_unknownAccount_isIdle() {
    MailSyncProgress p = new MailSyncProgress();
    MailSyncStatus s = p.snapshot(99L);
    assertThat(s.phase()).isEqualTo("IDLE");
    assertThat(s.running()).isFalse();
  }
}

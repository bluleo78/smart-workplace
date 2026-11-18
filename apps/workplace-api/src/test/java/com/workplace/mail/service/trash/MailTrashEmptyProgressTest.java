package com.workplace.mail.service.trash;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.MailTrashEmptyStatus;
import org.junit.jupiter.api.Test;

/**
 * 휴지통 비우기 진행 상태(WP-1682) 단위 테스트 — 계정당 하나만 돌고(RUNNING 이면 다시 시작하지 않는다), 중간에 멈추면 남은 메일을 실패로 세어 {@code
 * deleted + failed = total} 을 맞추며, 끝난 뒤 다시 시작하면 0 부터 센다. 실행기가 거절하면 시작 전(IDLE)으로 돌아간다.
 */
class MailTrashEmptyProgressTest {

  private final MailTrashEmptyProgress p = new MailTrashEmptyProgress();

  @Test
  void lifecycle() {
    assertThat(p.snapshot(1).state()).isEqualTo("IDLE");
    assertThat(p.tryStart(1)).isTrue();
    assertThat(p.tryStart(1)).isFalse();
    MailTrashEmptyStatus running = p.snapshot(1);
    assertThat(running.state()).isEqualTo("RUNNING");
    assertThat(running.total()).isNull(); // 스냅샷 전
    assertThat(running.startedAt()).isNotNull();

    p.setTotal(1, 5);
    p.addDeleted(1, 2);
    p.addFailed(1, 1);
    p.fail(1, "SERVER_UNREACHABLE");

    MailTrashEmptyStatus s = p.snapshot(1);
    assertThat(s.state()).isEqualTo("FAILED");
    assertThat(s.total()).isEqualTo(5);
    assertThat(s.deleted()).isEqualTo(2);
    assertThat(s.deleted() + s.failed()).isEqualTo(5); // 남은 2통은 실패로
    assertThat(s.errorCode()).isEqualTo("SERVER_UNREACHABLE");
    assertThat(s.error()).isEqualTo("메일 서버에 연결하지 못했습니다");
    assertThat(s.finishedAt()).isNotNull();

    assertThat(p.tryStart(1)).isTrue(); // 끝난 뒤 다시 시작하면 0 부터
    MailTrashEmptyStatus again = p.snapshot(1);
    assertThat(again.state()).isEqualTo("RUNNING");
    assertThat(again.deleted()).isZero();
    assertThat(again.failed()).isZero();
    assertThat(again.total()).isNull();
    assertThat(again.errorCode()).isNull();
    assertThat(again.finishedAt()).isNull();
  }

  @Test
  void finish_isDone_keepsCounts_otherAccountsUntouched() {
    p.tryStart(1);
    p.setTotal(1, 3);
    p.addDeleted(1, 2);
    p.addFailed(1, 1);
    p.finish(1);

    MailTrashEmptyStatus s = p.snapshot(1);
    assertThat(s.state()).isEqualTo("DONE");
    assertThat(s.deleted()).isEqualTo(2);
    assertThat(s.failed()).isEqualTo(1);
    assertThat(s.finishedAt()).isNotNull();
    assertThat(s.errorCode()).isNull();
    assertThat(p.snapshot(2).state()).isEqualTo("IDLE");
  }

  @Test
  void failBeforeSnapshot_keepsTotalUnknown() {
    p.tryStart(1);
    p.fail(1, "TRASH_CHANGED");

    MailTrashEmptyStatus s = p.snapshot(1);
    assertThat(s.state()).isEqualTo("FAILED");
    assertThat(s.total()).isNull();
    assertThat(s.failed()).isZero();
  }

  @Test
  void release_returnsToIdle() {
    assertThat(p.tryStart(1)).isTrue();
    p.release(1);

    MailTrashEmptyStatus s = p.snapshot(1);
    assertThat(s.state()).isEqualTo("IDLE");
    assertThat(s.total()).isNull();
    assertThat(s.deleted()).isZero();
    assertThat(s.failed()).isZero();
    assertThat(s.startedAt()).isNull();
    assertThat(s.finishedAt()).isNull();
    assertThat(s.errorCode()).isNull();
    assertThat(s.error()).isNull();
    assertThat(p.tryStart(1)).isTrue();
  }
}

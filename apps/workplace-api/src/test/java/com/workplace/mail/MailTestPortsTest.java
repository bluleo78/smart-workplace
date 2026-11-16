package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * WP-1645: GreenMail 포트 쌍 고르기. 다른 저장소 사본이 같은 워커 번호로 동시에 돌아도 같은 쌍을 고르지 않는지 본다. 스프링 컨텍스트가 필요 없는 순수
 * 로직이라 통합 테스트 기반을 쓰지 않는다.
 */
class MailTestPortsTest {

  /** 이 테스트 JVM 의 MailTestPorts 가 이미 쥔 쌍과 겹치지 않게, 실제 사용 쌍에서 멀리 떨어진 워커 번호로 시작한다. */
  private static int farWorker() {
    int used = (MailTestPorts.SMTP - 31000) / 2;
    return Math.floorMod(used + MailTestPorts.SLOTS / 2, MailTestPorts.SLOTS);
  }

  @Test
  void 같은_워커_번호라도_잠금을_쥔_쌍은_건너뛰고_다음_쌍을_고른다(@TempDir Path lockDir) throws Exception {
    int worker = farWorker();
    MailTestPorts.Reservation first = MailTestPorts.reserve(worker, lockDir);
    try {
      // 다른 사본이 같은 워커 번호로 뜬 경우와 같다 — 첫 쌍의 잠금이 쥐어져 있으니 다른 쌍이어야 한다.
      MailTestPorts.Reservation second = MailTestPorts.reserve(worker, lockDir);
      try {
        assertThat(second.smtp()).isNotEqualTo(first.smtp());
        assertThat(second.smtp()).isEqualTo(first.smtp() + 2);
      } finally {
        second.channel().close();
      }
    } finally {
      first.channel().close();
    }
  }

  @Test
  void 잠금을_풀면_같은_쌍을_다시_고른다(@TempDir Path lockDir) throws Exception {
    int worker = farWorker();
    MailTestPorts.Reservation first = MailTestPorts.reserve(worker, lockDir);
    int smtp = first.smtp();
    first.channel().close(); // JVM 이 끝나 잠금이 풀린 경우

    MailTestPorts.Reservation again = MailTestPorts.reserve(worker, lockDir);
    try {
      assertThat(again.smtp()).isEqualTo(smtp);
    } finally {
      again.channel().close();
    }
  }

  @Test
  void 잠금_밖의_프로세스가_포트를_쥐고_있으면_그_쌍을_건너뛴다(@TempDir Path lockDir) throws Exception {
    int worker = farWorker();
    int expectedSmtp = 31000 + worker * 2;
    // 잠금 파일을 모르는 프로세스(옛 코드로 도는 다른 사본 등)가 IMAP 포트를 이미 열어 둔 경우.
    try (ServerSocket squatter = new ServerSocket()) {
      squatter.bind(new InetSocketAddress("127.0.0.1", expectedSmtp + 1));
      MailTestPorts.Reservation r = MailTestPorts.reserve(worker, lockDir);
      try {
        assertThat(r.smtp()).isEqualTo(expectedSmtp + 2);
      } finally {
        r.channel().close();
      }
    }
  }
}

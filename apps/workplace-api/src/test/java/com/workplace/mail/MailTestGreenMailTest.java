package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.server.AbstractServer;
import java.lang.reflect.Field;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/**
 * WP-1641: {@link MailTestGreenMail} 이 GreenMail 서버의 클라이언트 소켓 읽기 제한을 끄고 기동 대기를 60초로 늘리는지 확인한다.
 *
 * <p>Spring 없이 순수 JUnit 으로 돈다. 테스트 메서드마다 GreenMail 이 재기동되므로(기본 per-method) 같은 검증을 테스트 두 개로 두어 두 번째
 * 새 서버에도 제한이 꺼져 있음을 본다.
 */
class MailTestGreenMailTest {

  /** {@code withConfiguration} 을 거친 뒤에도 인스턴스가 {@link MailTestGreenMail} 이어야 한다(부모가 this 를 돌려줌). */
  @RegisterExtension
  static GreenMailExtension greenMail =
      new MailTestGreenMail()
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  /** 서버의 private clientSocketTimeout 을 리플렉션으로 읽는다(getter 가 없다). */
  private static int clientSocketTimeout(AbstractServer server) throws Exception {
    Field f = AbstractServer.class.getDeclaredField("clientSocketTimeout");
    f.setAccessible(true);
    return f.getInt(server);
  }

  /** 첫 기동의 SMTP·IMAP 서버가 읽기 제한 없음(0)이다. */
  @Test
  void serversHaveNoClientSocketTimeout_first() throws Exception {
    assertThat(greenMail).isInstanceOf(MailTestGreenMail.class);
    assertThat(clientSocketTimeout(greenMail.getSmtp())).isZero();
    assertThat(clientSocketTimeout(greenMail.getImap())).isZero();
  }

  /** 재기동으로 새로 만들어진 서버에도 읽기 제한이 꺼져 있다. */
  @Test
  void serversHaveNoClientSocketTimeout_second() throws Exception {
    assertThat(greenMail).isInstanceOf(MailTestGreenMail.class);
    assertThat(clientSocketTimeout(greenMail.getSmtp())).isZero();
    assertThat(clientSocketTimeout(greenMail.getImap())).isZero();
  }

  /** 서버 기동 대기가 60초다(JVM 정지 직후에도 기동 실패하지 않도록). */
  @Test
  void startupTimeoutIs60s() {
    assertThat(greenMail.getImap().getServerSetup().getServerStartupTimeout()).isEqualTo(60_000L);
    assertThat(greenMail.getSmtp().getServerSetup().getServerStartupTimeout()).isEqualTo(60_000L);
  }

  /** 공유 SMTP 설정(MailTestPorts)으로 보낸 메일이 같은 포트의 GreenMail 에 도착한다. */
  @Test
  void deliversThroughSharedSmtpSetup() {
    MailTestPorts.sendText("box@test.local", "a@example.com", "s", "b");
    assertThat(greenMail.waitForIncomingEmail(1)).isTrue();
  }
}

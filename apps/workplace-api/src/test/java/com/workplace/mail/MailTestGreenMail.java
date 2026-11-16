package com.workplace.mail;

import com.icegreen.greenmail.junit5.GreenMailExtension;
import org.junit.jupiter.api.extension.ExtensionContext;

/**
 * 메일 테스트용 GreenMail 확장(WP-1641). {@link MailTestPorts#SMTP_IMAP} 포트로 기동하되 서버 쪽 클라이언트 소켓 읽기 제한을 끈다.
 *
 * <p>GreenMail 은 접속한 클라이언트 소켓에 기본 30초 SO_TIMEOUT 을 건다. 포드·JVM 이 30초 이상 멈추면(전체 정지) 그 사이 유휴였던 IMAP
 * 연결이 서버에서 끊겨 테스트가 간헐 실패한다. 이 제한은 {@code GreenMail.start()} 때마다 서버 객체가 새로 만들어지며 기본값으로 돌아가므로, 매
 * 기동(beforeEach/beforeAll) 직후 SMTP·IMAP 서버에 0(제한 없음)을 다시 건다.
 */
public class MailTestGreenMail extends GreenMailExtension {

  /** 포트는 포크별 고정 쌍({@link MailTestPorts#SMTP_IMAP}) 을 쓴다. */
  public MailTestGreenMail() {
    super(MailTestPorts.SMTP_IMAP);
  }

  /**
   * 메일 도착 대기 — GreenMail 기본 5초 대신 {@link MailTestPorts#WAIT} 까지 기다린다. 도착하는 즉시 돌아오므로 느려지지 않고, JVM
   * 정지로 배달이 늦어져도 실패하지 않는다. 호출부는 짧은 형태({@code waitForIncomingEmail(n)}) 그대로 쓴다(WP-1641).
   */
  @Override
  public boolean waitForIncomingEmail(int emailCount) {
    return waitForIncomingEmail(MailTestPorts.WAIT.toMillis(), emailCount);
  }

  /** 메서드마다 재기동하는 기본 수명주기에서, 새로 뜬 서버의 읽기 제한을 끈다. */
  @Override
  public void beforeEach(ExtensionContext context) {
    super.beforeEach(context);
    disableClientSocketTimeout();
  }

  /** 클래스 단위(per-class) 수명주기로 쓸 때도 같게 처리한다. */
  @Override
  public void beforeAll(ExtensionContext context) {
    super.beforeAll(context);
    disableClientSocketTimeout();
  }

  /**
   * 기동된 SMTP·IMAP 서버의 클라이언트 소켓 읽기 제한을 0(없음)으로 둔다. 접속마다 적용되므로 기동 뒤에 걸어도 유효하다. per-method 모드의
   * beforeAll 처럼 아직 GreenMail 이 만들어지지 않은 때는 {@code isRunning()} 이 NPE 라 null 부터 거른다.
   */
  private void disableClientSocketTimeout() {
    if (getGreenMail() != null && isRunning()) {
      getSmtp().setClientSocketTimeout(0);
      getImap().setClientSocketTimeout(0);
    }
  }
}

package com.workplace.mail;

import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetup;
import com.icegreen.greenmail.util.ServerSetupTest;

/**
 * GreenMail 테스트 서버 포트(WP-114). Gradle 테스트 포크(JVM)마다 서로 다른 고정 포트 쌍을 쓴다.
 *
 * <p>고정 포트(ServerSetupTest 기본 IMAP 3143 / SMTP 3025)를 모든 포크가 쓰면 병렬 포크의 메일 테스트가 동시에 같은 포트를 열려다
 * "Could not start mail server" 로 실패한다. 한 JVM 안에서는 클래스들이 순차 실행되므로 같은 포트를 재사용해도 된다 — GreenMail 서버와
 * 테스트가 심는 계정(imap/smtp 포트)이 같은 값을 가리키도록 이 상수를 함께 쓴다.
 *
 * <p>OS 가 고른 빈 포트(ServerSocket(0))는 쓰지 않는다. 그 포트는 임시(ephemeral) 범위라, GreenMail 이 테스트마다 재기동하는 사이
 * DB·HTTP 아웃바운드 연결이 같은 번호를 가져가 간헐 실패할 수 있다. 대신 임시 범위(Linux 32768~, macOS 49152~) 아래이고 로컬 E2E 랜덤
 * 포트(20000~29999)와도 겹치지 않는 31000~32599 에서 Gradle 워커 번호({@code org.gradle.test.worker})로 쌍을 정한다.
 */
public final class MailTestPorts {

  private static final int BASE = 31000;

  /** 포트 쌍 개수(31000 + 2×800 = 32600 < 32768). 워커 번호는 데몬 수명 동안 증가하므로 나머지로 접는다. */
  private static final int SLOTS = 800;

  private static final int SLOT =
      Math.floorMod(Integer.parseInt(System.getProperty("org.gradle.test.worker", "0")), SLOTS);

  /** GreenMail SMTP 포트(평문). */
  public static final int SMTP = BASE + SLOT * 2;

  /** GreenMail IMAP 포트(평문). */
  public static final int IMAP = SMTP + 1;

  private static final ServerSetup SMTP_SETUP = ServerSetupTest.SMTP.port(SMTP);

  /** {@code ServerSetupTest.SMTP_IMAP} 과 같은 구성에서 포트만 위 값으로 바꾼 것. */
  public static final ServerSetup[] SMTP_IMAP = {SMTP_SETUP, ServerSetupTest.IMAP.port(IMAP)};

  private MailTestPorts() {}

  /**
   * GreenMail 로 평문 메일 1통을 보낸다. {@code GreenMailUtil.sendTextEmailTest} 는 고정 SMTP 3025 로 보내므로 대신 이
   * 포트를 쓴다.
   */
  public static void sendText(String to, String from, String subject, String body) {
    GreenMailUtil.sendTextEmail(to, from, subject, body, SMTP_SETUP);
  }
}

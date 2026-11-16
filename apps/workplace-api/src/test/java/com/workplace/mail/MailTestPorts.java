package com.workplace.mail;

import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetup;
import com.icegreen.greenmail.util.ServerSetupTest;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.Properties;

/**
 * GreenMail 테스트 서버 포트(WP-114). Gradle 테스트 포크(JVM)마다 서로 다른 고정 포트 쌍을 쓴다.
 *
 * <p>고정 포트(ServerSetupTest 기본 IMAP 3143 / SMTP 3025)를 모든 포크가 쓰면 병렬 포크의 메일 테스트가 동시에 같은 포트를 열려다
 * "Could not start mail server" 로 실패한다. 한 JVM 안에서는 클래스들이 순차 실행되므로 같은 포트를 재사용해도 된다 — GreenMail 서버와
 * 테스트가 심는 계정(imap/smtp 포트)이 같은 값을 가리키도록 이 상수를 함께 쓴다.
 *
 * <p>OS 가 고른 빈 포트(ServerSocket(0))는 쓰지 않는다. 그 포트는 임시(ephemeral) 범위라, GreenMail 이 테스트마다 재기동하는 사이
 * DB·HTTP 아웃바운드 연결이 같은 번호를 가져가 간헐 실패할 수 있다. 대신 임시 범위(Linux 32768~, macOS 49152~) 아래이고 로컬 E2E 랜덤
 * 포트(20000~29999)와도 겹치지 않는 31000~32599 에서 고른다.
 *
 * <p>WP-1645: 워커 번호({@code org.gradle.test.worker})는 Gradle 데몬마다 처음부터 매겨지므로, 다른 저장소 사본(클론·워크트리)이 같은
 * 호스트에서 동시에 테스트를 돌리면 같은 쌍을 골라 늦게 뜬 쪽이 BindException 으로 깨졌다. 그래서 워커 번호는 시작 쌍으로만 쓰고, 쌍마다 임시 폴더의 잠금
 * 파일({@code java.io.tmpdir/workplace-greenmail-ports/<SMTP>.lock})을 잡은 JVM 만 그 쌍을 쓴다. 잠금은 JVM 이
 * 끝나면(비정상 종료 포함) OS 가 풀어 주므로 남은 파일이 다음 실행을 막지 않는다. 잠금을 못 잡았거나 잠금 밖의 프로세스가 포트를 이미 쓰고 있으면 다음 쌍으로
 * 넘어간다.
 */
public final class MailTestPorts {

  private static final int BASE = 31000;

  /** 포트 쌍 개수(31000 + 2×800 = 32600 < 32768). 워커 번호는 데몬 수명 동안 증가하므로 나머지로 접는다. */
  static final int SLOTS = 800;

  /** 사본 사이에서 쌍을 나누는 잠금 파일 폴더 — 같은 호스트의 모든 사본이 같은 임시 폴더를 본다. */
  private static final Path LOCK_DIR =
      Path.of(System.getProperty("java.io.tmpdir"), "workplace-greenmail-ports");

  /** 이 JVM 이 고른 쌍과 그 잠금. 잠금 객체를 정적 필드로 쥐고 있어야 GC 로 채널이 닫혀 잠금이 풀리지 않는다 — JVM 이 끝날 때까지 쥔다. */
  private static final Reservation RESERVED =
      reserve(Integer.parseInt(System.getProperty("org.gradle.test.worker", "0")), LOCK_DIR);

  /** GreenMail SMTP 포트(평문). */
  public static final int SMTP = RESERVED.smtp();

  /** GreenMail IMAP 포트(평문). */
  public static final int IMAP = SMTP + 1;

  private static final ServerSetup SMTP_SETUP = ServerSetupTest.SMTP.port(SMTP);

  /** {@code ServerSetupTest.SMTP_IMAP} 과 같은 구성에서 포트만 위 값으로 바꾼 것. */
  public static final ServerSetup[] SMTP_IMAP = {SMTP_SETUP, ServerSetupTest.IMAP.port(IMAP)};

  private MailTestPorts() {}

  /** 잡은 포트 쌍(SMTP, IMAP=SMTP+1)과 그 쌍의 잠금 — 잠금을 쥐는 동안 다른 사본은 이 쌍을 고르지 않는다. */
  record Reservation(int smtp, FileChannel channel, FileLock lock) {}

  /** 워커 번호에서 시작해 잠금을 잡을 수 있고 두 포트가 비어 있는 첫 쌍을 고른다(WP-1645). 다 돌아도 없으면 테스트를 더 진행할 수 없으니 실패시킨다. */
  static Reservation reserve(int worker, Path lockDir) {
    try {
      Files.createDirectories(lockDir);
    } catch (IOException e) {
      throw new IllegalStateException("GreenMail 포트 잠금 폴더를 만들 수 없습니다: " + lockDir, e);
    }
    int start = Math.floorMod(worker, SLOTS);
    for (int i = 0; i < SLOTS; i++) {
      int smtp = BASE + Math.floorMod(start + i, SLOTS) * 2;
      Reservation r = tryReserve(smtp, lockDir);
      if (r != null) {
        return r;
      }
    }
    throw new IllegalStateException("GreenMail 에 쓸 빈 포트 쌍이 없습니다(31000~32599)");
  }

  /** 이 쌍의 잠금을 잡고 두 포트가 비어 있으면 예약을, 아니면 잠금을 풀고 null 을 돌려준다. */
  private static Reservation tryReserve(int smtp, Path lockDir) {
    FileChannel channel = null;
    try {
      channel =
          FileChannel.open(
              lockDir.resolve(smtp + ".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
      FileLock lock;
      try {
        lock = channel.tryLock();
      } catch (OverlappingFileLockException e) {
        lock = null; // 같은 JVM 이 이미 쥔 쌍
      }
      if (lock != null && isFree(smtp) && isFree(smtp + 1)) {
        return new Reservation(smtp, channel, lock);
      }
      channel.close(); // 잠금도 함께 풀린다
      return null;
    } catch (IOException e) {
      closeQuietly(channel);
      return null;
    }
  }

  /** GreenMail 과 같은 주소(127.0.0.1)에 지금 바인드할 수 있는지 — 잠금을 쓰지 않는 프로세스가 쥔 포트를 거른다. */
  private static boolean isFree(int port) {
    try (ServerSocket s = new ServerSocket()) {
      s.setReuseAddress(true);
      s.bind(new InetSocketAddress("127.0.0.1", port));
      return true;
    } catch (IOException e) {
      return false;
    }
  }

  private static void closeQuietly(FileChannel channel) {
    if (channel == null) {
      return;
    }
    try {
      channel.close();
    } catch (IOException ignored) {
      // 닫기 실패는 다음 쌍을 고르는 데 영향이 없다
    }
  }

  /**
   * GreenMail 로 평문 메일 1통을 보낸다. {@code GreenMailUtil.sendTextEmailTest} 는 고정 SMTP 3025 로 보내므로 대신 이
   * 포트를 쓴다.
   */
  public static void sendText(String to, String from, String subject, String body) {
    GreenMailUtil.sendTextEmail(to, from, subject, body, SMTP_SETUP);
  }

  /**
   * WP-148: 외부 클라이언트(Outlook·모바일)가 읽음을 바꾼 것처럼 GreenMail 서버 쪽 \Seen 을 직접 바꾼다. 제목이 일치하는 INBOX 메시지만
   * 대상이며 계정은 {@code box@test.local/pw} 로 고정이다.
   */
  public static void setServerSeen(String subject, boolean seen) throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Store store = Session.getInstance(props).getStore("imap");
    store.connect("127.0.0.1", IMAP, "box@test.local", "pw");
    try {
      Folder inbox = store.getFolder("INBOX");
      inbox.open(Folder.READ_WRITE);
      try {
        for (Message m : inbox.getMessages()) {
          if (subject.equals(m.getSubject())) {
            m.setFlag(Flags.Flag.SEEN, seen);
          }
        }
      } finally {
        inbox.close(false);
      }
    } finally {
      store.close();
    }
  }

  /**
   * WP-959: 다른 메일 앱에서 보관한 것처럼 GreenMail INBOX 의 제목 일치 메시지를 {@code target} 폴더로 옮긴다(COPY → Deleted
   * 플래그 → EXPUNGE). target 이 null 이면 옮기지 않고 지우기만 한다. 계정 box@test.local/pw 고정.
   */
  public static void moveServerMessage(String subject, String target) throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Store store = Session.getInstance(props).getStore("imap");
    store.connect("127.0.0.1", IMAP, "box@test.local", "pw");
    try {
      Folder inbox = store.getFolder("INBOX");
      inbox.open(Folder.READ_WRITE);
      try {
        Message[] hits =
            Arrays.stream(inbox.getMessages())
                .filter(m -> matchesSubject(m, subject))
                .toArray(Message[]::new);
        if (target != null) {
          Folder dest = store.getFolder(target);
          if (!dest.exists()) {
            dest.create(Folder.HOLDS_MESSAGES);
          }
          inbox.copyMessages(hits, dest);
        }
        for (Message m : hits) {
          m.setFlag(Flags.Flag.DELETED, true);
        }
      } finally {
        inbox.close(true); // expunge — 서버에서 실제로 빠진다
      }
    } finally {
      store.close();
    }
  }

  private static boolean matchesSubject(Message m, String subject) {
    try {
      return subject.equals(m.getSubject());
    } catch (Exception e) {
      return false;
    }
  }

  /** WP-187: GreenMail 서버 쪽 \Seen 을 읽는다(제목 일치 INBOX 첫 메시지, 계정 box@test.local/pw 고정). */
  public static boolean isServerSeen(String subject) throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Store store = Session.getInstance(props).getStore("imap");
    store.connect("127.0.0.1", IMAP, "box@test.local", "pw");
    try {
      Folder inbox = store.getFolder("INBOX");
      inbox.open(Folder.READ_ONLY);
      try {
        for (Message m : inbox.getMessages()) {
          if (subject.equals(m.getSubject())) {
            return m.isSet(Flags.Flag.SEEN);
          }
        }
        throw new IllegalStateException("no message: " + subject);
      } finally {
        inbox.close(false);
      }
    } finally {
      store.close();
    }
  }

  /** 헤더 1개를 덧붙인 평문 메일 1통을 보낸다(WP-149 자동 발송 헤더 판정 테스트용). */
  public static void sendWithHeader(
      String to, String from, String subject, String body, String headerName, String headerValue) {
    try {
      MimeMessage m = new MimeMessage(GreenMailUtil.getSession(SMTP_SETUP));
      m.setFrom(new InternetAddress(from));
      m.setRecipient(Message.RecipientType.TO, new InternetAddress(to));
      m.setSubject(subject, "UTF-8");
      m.setText(body, "UTF-8");
      m.setHeader(headerName, headerValue);
      Transport.send(m);
    } catch (MessagingException e) {
      throw new IllegalStateException(e);
    }
  }
}

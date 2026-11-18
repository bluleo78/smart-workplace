package com.workplace.mail;

import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.MimeMessage;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Properties;

/**
 * GreenMail 메일 서버를 앱 코드를 거치지 않고 직접 들여다보고 꾸미는 테스트 도우미(WP-1682). 완전 삭제 테스트가 「서버에 무엇이 남았나」를 앱의 동기화와
 * 무관하게 확인하고, 다른 클라이언트가 한 일(메일 넣기·{@code \Deleted} 붙이기)을 흉내 내는 데 쓴다. {@code MailMoveImapTest} 의 같은
 * 이름 도우미를 본떴다(그 파일은 고치지 않는다). 계정은 GreenMail 사용자 {@code box@test.local}/{@code pw}.
 */
final class ImapServerProbe {

  private ImapServerProbe() {}

  /** 열린 IMAP 저장소로 할 일. */
  interface StoreWork {
    void run(Store store) throws Exception;
  }

  /** 테스트 계정으로 GreenMail 에 접속해 work 를 돌리고 닫는다. */
  static void withStore(StoreWork work) throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Store store = Session.getInstance(props).getStore("imap");
    store.connect("127.0.0.1", MailTestPorts.IMAP, "box@test.local", "pw");
    try {
      work.run(store);
    } finally {
      store.close();
    }
  }

  /** 서버 메일함의 메일 제목들({@code \Deleted} 만 붙은 메일도 포함 — 지워지지 않았으므로). */
  static List<String> serverSubjects(String folder) throws Exception {
    List<String> out = new ArrayList<>();
    withStore(
        store -> {
          Folder f = store.getFolder(folder);
          f.open(Folder.READ_ONLY);
          for (Message m : f.getMessages()) {
            out.add(m.getSubject());
          }
          f.close(false);
        });
    return out;
  }

  /** 서버 메일함에 메일 한 통을 바로 넣는다(다른 앱이 넣은 메일처럼). */
  static void appendToServer(String folder, String subject) throws Exception {
    withStore(
        store -> {
          MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
          m.setFrom("sender@test.local");
          m.setRecipients(Message.RecipientType.TO, "box@test.local");
          m.setSubject(subject, "UTF-8");
          m.setText("본문 " + subject, "UTF-8");
          m.setSentDate(new Date());
          store.getFolder(folder).appendMessages(new Message[] {m});
        });
  }

  /**
   * 제목이 subject 인 서버 메일에 {@code \Deleted} 만 붙인다 — 다른 클라이언트가 지울 표시만 해 두고 아직 EXPUNGE 하지 않은 상태. 닫을 때도
   * expunge 하지 않는다({@code close(false)}).
   */
  static void markDeletedOnServer(String folder, String subject) throws Exception {
    withStore(
        store -> {
          Folder f = store.getFolder(folder);
          f.open(Folder.READ_WRITE);
          for (Message m : f.getMessages()) {
            if (subject.equals(m.getSubject())) {
              m.setFlag(Flags.Flag.DELETED, true);
            }
          }
          f.close(false);
        });
  }

  /** 제목이 subject 인 서버 메일에 {@code \Deleted} 가 붙어 있는지. */
  static boolean isDeletedOnServer(String folder, String subject) throws Exception {
    boolean[] deleted = {false};
    withStore(
        store -> {
          Folder f = store.getFolder(folder);
          f.open(Folder.READ_ONLY);
          for (Message m : f.getMessages()) {
            if (subject.equals(m.getSubject()) && m.isSet(Flags.Flag.DELETED)) {
              deleted[0] = true;
            }
          }
          f.close(false);
        });
    return deleted[0];
  }
}

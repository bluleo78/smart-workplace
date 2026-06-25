package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.service.MailSentAppender;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

/** MailSentAppender — 서버 Sent 폴더가 있으면 APPEND, 없으면 조용히 skip(예외 없음). */
class MailSentAppenderTest {

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("me@test.local", "me@test.local", "pw"));

  private final MailSentAppender appender = new MailSentAppender();

  private EmailAccountResponse account() {
    return new EmailAccountResponse(
        1L,
        "me@test.local",
        "나",
        "127.0.0.1",
        3143,
        MailSecurity.NONE,
        "me@test.local",
        "127.0.0.1",
        3025,
        MailSecurity.NONE,
        "me@test.local",
        null,
        null,
        null,
        false,
        null,
        MailProvider.IMAP);
  }

  private MimeMessage simpleMessage() throws Exception {
    MimeMessage m = new MimeMessage(Session.getInstance(new Properties()));
    m.setFrom(new InternetAddress("me@test.local"));
    m.setRecipient(Message.RecipientType.TO, new InternetAddress("rcpt@test.local"));
    m.setSubject("appended");
    m.setText("body");
    m.saveChanges();
    return m;
  }

  @Test
  void append_intoExistingSentFolder() throws Exception {
    // 서버에 Sent 폴더를 미리 생성.
    Store store = imapStore();
    Folder sent = store.getFolder("Sent");
    sent.create(Folder.HOLDS_MESSAGES);
    store.close();

    appender.appendQuietly(account(), "pw", simpleMessage());

    Store s2 = imapStore();
    Folder sentReopen = s2.getFolder("Sent");
    sentReopen.open(Folder.READ_ONLY);
    assertThat(sentReopen.getMessageCount()).isEqualTo(1);
    // APPEND된 메시지가 보낸 그 메시지(subject "appended")이고 \Seen 플래그가 설정됐는지 검증.
    jakarta.mail.Message appended = sentReopen.getMessage(1);
    assertThat(appended.getSubject()).isEqualTo("appended");
    assertThat(appended.isSet(jakarta.mail.Flags.Flag.SEEN)).isTrue();
    sentReopen.close(false);
    s2.close();
  }

  @Test
  void append_noSentFolder_doesNotThrow() throws Exception {
    // Sent 폴더가 없어도 예외 없이 조용히 종료.
    appender.appendQuietly(account(), "pw", simpleMessage());
  }

  private Store imapStore() throws Exception {
    Properties props = new Properties();
    props.put("mail.store.protocol", "imap");
    Session session = Session.getInstance(props);
    Store store = session.getStore("imap");
    store.connect("127.0.0.1", 3143, "me@test.local", "pw");
    return store;
  }
}

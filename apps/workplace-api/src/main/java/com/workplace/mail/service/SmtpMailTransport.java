package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.util.MailAttachmentSizes;
import jakarta.mail.Address;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;
import org.eclipse.angus.mail.smtp.SMTPSenderFailedException;
import org.eclipse.angus.mail.smtp.SMTPTransport;
import org.springframework.stereotype.Component;

/**
 * IMAP/SMTP 계정 전송기. 비밀번호를 직접 조회·복호화하고 SMTP 로 발송한다(봉투 수신자=To+Cc+Bcc). IMAP APPEND(Sent 보관)는 호출 측
 * MailComposeService → MailSentAppender 가 수행한다.
 */
@Component
@RequiredArgsConstructor
public class SmtpMailTransport implements MailTransport {

  /** 받는 서버가 메일 크기로 거절했을 때 사용자 문구(WP-574). */
  static final String SIZE_REJECTED_MESSAGE = "받는 메일 서버가 허용하는 크기를 넘었어요. 첨부를 줄이거나 나눠서 보내 주세요";

  /** 연결·읽기 타임아웃(ms) — 행 방지. */
  private static final int TIMEOUT_MS = 10_000;

  /**
   * 첨부가 있는 메일의 읽기·쓰기 타임아웃(ms, WP-574). 25MB 첨부는 base64 로 약 34MB 를 DATA 로 쓰고, 서버는 본문을 다 받은 뒤 크기·바이러스
   * 검사를 마치고서야 최종 250 을 돌려준다. 10초로는 그 응답을 기다리다 끊겨 이미 나간 메일을 실패로 처리할 수 있어(사용자는 다시 보낸다) 2분으로 늘린다. 연결
   * 타임아웃은 그대로 10초.
   */
  static final int ATTACHMENT_IO_TIMEOUT_MS = 120_000;

  private final MailAccountCredentials credentials;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  @Override
  public String transmit(
      long userId, EmailAccountResponse account, MimeMessage message, OutgoingMail mail) {
    // 자격증명 조회(RLS 읽기 트랜잭션)는 MailAccountCredentials 가 맡고, 여기서는 I/O 만 한다(WP-574).
    String password = credentials.password(userId, account.id());
    // 잰 메일 크기(바이트) — 서버가 SIZE 를 알리지 않아 재지 않았으면 -1. 552 거절 안내에 쓴다(WP-1329).
    long measuredSize = -1;
    try {
      Session session = smtpSession(account, !mail.attachments().isEmpty());
      Address[] envelope = envelope(mail);
      Transport transport = session.getTransport("smtp");
      try {
        transport.connect(account.smtpHost(), account.smtpPort(), account.smtpUsername(), password);
        // WP-1329: 서버가 EHLO 로 알린 크기 한도를 넘으면 DATA 를 다 올린 뒤 552 로 거절당하기 전에 미리 막는다(두 크기를 알려 준다).
        measuredSize = requireWithinServerSize(transport, message, partBytes(mail));
        transport.sendMessage(message, envelope);
      } finally {
        try {
          transport.close();
        } catch (MessagingException ignored) {
          // 발송 성공 여부에 영향 없음
        }
      }
    } catch (MessagingException e) {
      // WP-574: 크기 초과 거절(552 / 5.3.4)은 서버 장애가 아니라 사용자가 고칠 수 있는 오류 — 400 + 안내 문구.
      if (isSizeRejection(e)) {
        // WP-1329: 거절된 메일 크기를 함께 알린다 — 미리 재지 않았으면 여기서 잰다(거절 때만이라 평소 비용 없음).
        long size = measuredSize >= 0 ? measuredSize : measureQuietly(message);
        throw new MailValidationException(sizeRejectedMessage(size, !mail.attachments().isEmpty()));
      }
      throw new MailSendException("메일 발송에 실패했습니다", e);
    }
    // SMTP 는 MIME 에 넣은 Message-ID 그대로 나간다
    return mail.messageId();
  }

  /** 첨부가 전송 중 커지는 배율 안내(WP-1329) — 표준 MIME base64(원본 57바이트 → 78바이트, 줄바꿈 포함) 기준 약 1.37배. */
  private static final String ENCODING_GROWTH_NOTE = "첨부는 전송 중 약 1.37배 커져요";

  /**
   * 서버 크기 한도 사전 판정(WP-1329). 연결 뒤 EHLO 응답의 SIZE 확장(RFC 1870)을 읽어, 한도가 있으면 실제로 나갈 메일 바이트를 세어 넘으면 보내기
   * 전에 거절한다. 받는 쪽 대부분이 25MB 안팎에서 막는데 첨부는 base64 로 약 1.37배 커져, 원본 합계 25MB 검사를 통과한 메일도 서버에서 552 로 거절될
   * 수 있다 — DATA 를 다 올리고 거절당하는 대신 바로 두 크기를 알려 준다.
   *
   * @return 잰 메일 크기(바이트). 서버가 SIZE 를 알리지 않았거나 0(한도 없음)이면 재지 않고 -1
   * @throws MailValidationException 메일 크기가 서버 한도를 넘음
   */
  static long requireWithinServerSize(Transport transport, MimeMessage message)
      throws MessagingException {
    return requireWithinServerSize(transport, message, -1);
  }

  /**
   * {@link #requireWithinServerSize(Transport, MimeMessage)} 와 같되, 첨부·인라인 원본 합계({@code
   * knownPartBytes}, 모르면 -1)로 base64 후 크기를 어림해 한도의 90% 아래면 재지 않는다 — 재기는 메일 전체를 한 번 더 인코딩하므로 한도 근처일
   * 때만 한다(WP-1329 리뷰).
   */
  static long requireWithinServerSize(Transport transport, MimeMessage message, long knownPartBytes)
      throws MessagingException {
    if (!(transport instanceof SMTPTransport smtp)) {
      return -1;
    }
    long limit = parseSizeLimit(smtp.getExtensionParameter("SIZE"));
    if (limit <= 0) {
      return -1;
    }
    if (knownPartBytes >= 0 && knownPartBytes / 57.0 * 78.0 < limit * 0.9) {
      return -1;
    }
    long size = measure(message);
    if (size > limit) {
      throw new MailValidationException(sizeExceededMessage(limit, size, knownPartBytes != 0));
    }
    return size;
  }

  /** 첨부·인라인 이미지 원본 바이트 합계 — 서버 한도 근처인지 어림하는 데 쓴다(본문·헤더는 빠져 작게 잡힌다 — 90% 여유가 덮는다). */
  private static long partBytes(OutgoingMail mail) {
    long sum = 0;
    for (OutgoingMail.AttachmentPart a : mail.attachments()) {
      sum += a.content().length;
    }
    for (OutgoingMail.InlineImagePart i : mail.inlineImages()) {
      sum += i.content().length;
    }
    return sum;
  }

  /** EHLO SIZE 파라미터 → 바이트 한도. 없음·빈 값·숫자 아님은 0(한도를 모름 = 판정하지 않음). RFC 1870 의 "SIZE 0" 도 한도 없음이다. */
  static long parseSizeLimit(String param) {
    if (param == null || param.isBlank()) {
      return 0;
    }
    try {
      return Math.max(Long.parseLong(param.trim()), 0);
    } catch (NumberFormatException e) {
      return 0;
    }
  }

  /**
   * 나갈 메일의 정확한 바이트 수 — writeTo 결과를 세기만 하는 스트림에 써서 잰다(메일 전체를 메모리에 한 번 더 쌓지 않는다). writeTo 는 저장 전이면
   * saveChanges 를 먼저 해 실제 전송과 같은 헤더·인코딩으로 잰다.
   */
  static long measure(MimeMessage message) throws MessagingException {
    CountingOutputStream out = new CountingOutputStream();
    try {
      // SMTPTransport 가 DATA 를 쓸 때 빼는 헤더(Bcc·Content-Length)는 세지 않는다 — 실제 전송 크기와 같게.
      message.writeTo(out, new String[] {"Bcc", "Content-Length"});
    } catch (IOException e) {
      throw new MessagingException("메일 크기를 재지 못했어요", e);
    }
    return out.count;
  }

  /** 552 안내용 크기 재기 — 실패해도 안내만 빠지게 -1(원래 거절 사유를 가리지 않는다). */
  private static long measureQuietly(MimeMessage message) {
    try {
      return measure(message);
    } catch (MessagingException | RuntimeException e) {
      return -1;
    }
  }

  /**
   * 서버 한도 사전 판정 문구 — 「메일 서버가 허용하는 크기(25.0MB)를 넘었어요(이 메일 27.4MB — …)」. EHLO SIZE 는 내 보내는 서버의 한도라
   * 「받는」 서버로 단정하지 않는다. 한도는 내림, 메일 크기는 올림으로 적어 두 수가 같아 보이지 않게 한다. 첨부가 있을 때만 커지는 배율을 덧붙인다.
   */
  static String sizeExceededMessage(long limitBytes, long messageBytes, boolean hasParts) {
    return "메일 서버가 허용하는 크기("
        + MailAttachmentSizes.formatMbFloor(limitBytes)
        + ")를 넘었어요(이 메일 "
        + MailAttachmentSizes.formatMb(messageBytes)
        + (hasParts ? " — " + ENCODING_GROWTH_NOTE : "")
        + "). 첨부를 줄이거나 나눠서 보내 주세요";
  }

  /** 552 거절 문구 — 잰 크기가 있으면 함께 알린다(WP-1329). 없으면 기존 문구 그대로. */
  static String sizeRejectedMessage(long messageBytes, boolean hasAttachments) {
    if (messageBytes < 0) {
      return SIZE_REJECTED_MESSAGE;
    }
    return "받는 메일 서버가 허용하는 크기를 넘었어요(이 메일 "
        + MailAttachmentSizes.formatMb(messageBytes)
        + (hasAttachments ? " — " + ENCODING_GROWTH_NOTE : "")
        + "). 첨부를 줄이거나 나눠서 보내 주세요";
  }

  /** 쓴 바이트 수만 세는 스트림(WP-1329 메일 크기 재기). */
  private static final class CountingOutputStream extends OutputStream {
    private long count;

    @Override
    public void write(int b) {
      count++;
    }

    @Override
    public void write(byte[] b, int off, int len) {
      count += len;
    }
  }

  /** 확장 상태 코드 5.2.2(RFC 3463 메일함 가득 참) — 5.2.20 같은 다른 코드와 섞이지 않게 앞뒤를 끊어 본다. */
  private static final Pattern MAILBOX_FULL = Pattern.compile("(?<![\\d.])5\\.2\\.2(?!\\d)");

  /**
   * SMTP 크기 초과 거절인지 — 응답 코드 552(RFC 5321 저장 공간 초과, 크기 제한에 쓰인다) 또는 확장 상태 코드 5.3.4(메시지가 고정 크기 한도를 넘음,
   * RFC 3463). 예외가 원인·다음 예외(getNextException)로 감싸여 오므로 사슬을 따라가며 본다.
   *
   * <p>단 확장 코드 5.2.2(받는 쪽 메일함 가득 참)가 붙은 552 는 크기 초과가 아니다 — 첨부를 줄여도 풀리지 않으므로 「크기를 넘었어요」로 안내하면 사용자를
   * 잘못 이끈다. 그 층은 건너뛰고 사슬의 다음 예외를 본다(일반 발송 실패로 끝난다).
   */
  static boolean isSizeRejection(Throwable error) {
    Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    Throwable t = error;
    while (t != null && seen.add(t)) {
      String msg = t.getMessage();
      boolean mailboxFull = msg != null && MAILBOX_FULL.matcher(msg).find();
      if (!mailboxFull) {
        if (returnCode(t) == 552) {
          return true;
        }
        if (msg != null && (msg.contains("5.3.4") || msg.trim().startsWith("552"))) {
          return true;
        }
      }
      Throwable next = t instanceof MessagingException me ? me.getNextException() : null;
      t = next != null ? next : t.getCause();
    }
    return false;
  }

  /** Angus SMTP 예외의 응답 코드(없으면 -1). */
  private static int returnCode(Throwable t) {
    if (t instanceof SMTPSendFailedException e) {
      return e.getReturnCode();
    }
    if (t instanceof SMTPAddressFailedException e) {
      return e.getReturnCode();
    }
    if (t instanceof SMTPSenderFailedException e) {
      return e.getReturnCode();
    }
    return -1;
  }

  /** To+Cc+Bcc 전체를 SMTP 봉투 수신자로 합친다. */
  private Address[] envelope(OutgoingMail mail) throws MessagingException {
    List<Address> all = new ArrayList<>();
    addAll(all, mail.to());
    addAll(all, mail.cc());
    addAll(all, mail.bcc());
    return all.toArray(new Address[0]);
  }

  private void addAll(List<Address> acc, List<String> addrs) throws MessagingException {
    if (addrs == null) {
      return;
    }
    for (String a : addrs) {
      acc.add(new InternetAddress(a));
    }
  }

  /** SMTP 세션(MailConnectionTester 와 동일 보안/타임아웃 정책). */
  private Session smtpSession(EmailAccountResponse account, boolean hasAttachments) {
    MailSecurity security = account.smtpSecurity();
    Properties props = new Properties();
    props.put("mail.transport.protocol", "smtp");
    props.put("mail.smtp.auth", "true");
    props.put("mail.smtp.connectiontimeout", String.valueOf(TIMEOUT_MS));
    int ioTimeout = hasAttachments ? ATTACHMENT_IO_TIMEOUT_MS : TIMEOUT_MS;
    props.put("mail.smtp.timeout", String.valueOf(ioTimeout));
    // 쓰기 타임아웃 — 큰 DATA 를 쓰다 상대가 받지 않을 때도 끝없이 걸리지 않게(읽기와 같은 값).
    props.put("mail.smtp.writetimeout", String.valueOf(ioTimeout));
    if (security == MailSecurity.SSL_TLS) {
      props.put("mail.smtp.ssl.enable", "true");
    } else if (security == MailSecurity.STARTTLS) {
      props.put("mail.smtp.starttls.enable", "true");
      props.put("mail.smtp.starttls.required", "true");
    }
    return Session.getInstance(props);
  }
}

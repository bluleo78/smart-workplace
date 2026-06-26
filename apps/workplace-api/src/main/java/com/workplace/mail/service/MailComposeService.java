package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 작성+발송 오케스트레이션. 순서가 핵심:
 *
 * <ol>
 *   <li>계정 소유 검증.
 *   <li>수신자 검증, Message-ID 직접 생성, 답장이면 부모 thread_id/Message-ID/References 상속.
 *   <li>MIME 조립(공유 MailMimeBuilder) + 공급자별 전송기(MailTransport) 디스패치 — 유일한 사용자 노출 실패 지점(실패 시 502, 로컬
 *       저장 안 함).
 *   <li>로컬 SENT 행 저장(표시 원본).
 *   <li>IMAP 계정만 best-effort APPEND(Graph 는 saveToSentItems 로 서버가 자동 저장).
 * </ol>
 */
@Service
@RequiredArgsConstructor
public class MailComposeService {

  private static final String SENT = "SENT";
  private static final int SNIPPET_MAX = 280;

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final MailMimeBuilder mimeBuilder;
  private final List<MailTransport> transports;
  private final MailSentAppender appender;

  /** 본인 계정으로 메일 발송. 발송 성공 시 로컬 SENT 행 id + Message-ID 반환. */
  @Transactional
  public SendResult send(long userId, long accountId, MailSendRequest req) {
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));

    List<String> to = clean(req.to());
    List<String> cc = clean(req.cc());
    List<String> bcc = clean(req.bcc());
    if (to.isEmpty() && cc.isEmpty() && bcc.isEmpty()) {
      throw new MailValidationException("수신자를 한 명 이상 입력하세요");
    }
    validateAddresses(to);
    validateAddresses(cc);
    validateAddresses(bcc);

    // Message-ID 직접 생성(전송본·APPEND·로컬 행 공유).
    String messageId = UUID.randomUUID() + "@" + domainOf(account.emailAddress());

    // 답장: 부모 스레드/헤더 상속. 신규/전달: 새 스레드(자기 ID 루트).
    String threadId = messageId;
    String inReplyTo = null;
    String references = null;
    if (req.inReplyToMessageId() != null) {
      ReplyContext ctx =
          messageRepo
              .findReplyContextByIdAndUser(userId, req.inReplyToMessageId())
              .orElseThrow(() -> new EmailMessageNotFoundException(req.inReplyToMessageId()));
      threadId = ctx.threadId();
      inReplyTo = ctx.parentMessageId();
      references = buildReferences(ctx.parentReferences(), ctx.parentMessageId());
    }

    Instant now = Instant.now();
    OutgoingMail mail =
        new OutgoingMail(
            messageId,
            threadId,
            account.emailAddress(),
            account.displayName(),
            to,
            cc,
            bcc,
            nz(req.subject()),
            req.bodyText(),
            req.bodyHtml(),
            inReplyTo,
            references,
            snippet(req.bodyText()),
            now);

    // 1) MIME 조립(공유 빌더) + 공급자별 전송기 디스패치 — 유일한 사용자 노출 실패.
    MimeMessage message;
    try {
      message = mimeBuilder.build(account, mail);
    } catch (MessagingException e) {
      throw new MailSendException("메일 구성에 실패했습니다", e);
    }
    transportFor(account.provider()).transmit(userId, account, message, mail);

    // 2) 로컬 SENT 행(표시 원본).
    long folderId = folderRepo.ensureFolder(accountId, SENT).id();
    long localId = messageRepo.insertSent(accountId, folderId, mail);

    // 3) IMAP 계정만 best-effort APPEND(Graph 는 saveToSentItems 로 서버가 자동 저장).
    if (account.provider() == MailProvider.IMAP) {
      appender.appendQuietly(account, userId, message);
    }

    return new SendResult(localId, messageId);
  }

  /** 공급자에 맞는 전송기 선택. 미지원 공급자는 MailSendException 으로 조기 실패. */
  private MailTransport transportFor(MailProvider provider) {
    return transports.stream()
        .filter(t -> t.provider() == provider)
        .findFirst()
        .orElseThrow(() -> new MailSendException("지원하지 않는 메일 공급자: " + provider));
  }

  /** null 제거 + trim + 공백 제거. */
  private List<String> clean(List<String> addrs) {
    List<String> out = new ArrayList<>();
    if (addrs == null) {
      return out;
    }
    for (String a : addrs) {
      if (a != null && !a.isBlank()) {
        out.add(a.trim());
      }
    }
    return out;
  }

  /** strict 파싱으로 주소 형식 검증(헤더 인젝션 방지). 실패 시 400. */
  private void validateAddresses(List<String> addrs) {
    for (String a : addrs) {
      try {
        new InternetAddress(a, true);
      } catch (AddressException e) {
        throw new MailValidationException("올바르지 않은 이메일 주소: " + a);
      }
    }
  }

  /** References = 부모 References(있으면) + "<부모 Message-ID>"(있으면). 둘 다 없으면 null. */
  private String buildReferences(String parentReferences, String parentMessageId) {
    String pid = parentMessageId != null ? "<" + parentMessageId + ">" : null;
    if (pid == null) {
      return (parentReferences != null && !parentReferences.isBlank())
          ? parentReferences.trim()
          : null;
    }
    if (parentReferences == null || parentReferences.isBlank()) {
      return pid;
    }
    return parentReferences.trim() + " " + pid;
  }

  private String domainOf(String email) {
    int at = email.indexOf('@');
    return at >= 0 && at < email.length() - 1 ? email.substring(at + 1) : "localhost";
  }

  private String nz(String s) {
    return s == null ? "" : s;
  }

  /** 본문 텍스트에서 미리보기 스니펫(공백 정규화 후 최대 280자). */
  private String snippet(String text) {
    if (text == null) {
      return null;
    }
    String collapsed = text.replaceAll("\\s+", " ").trim();
    if (collapsed.isEmpty()) {
      return null;
    }
    return collapsed.length() <= SNIPPET_MAX ? collapsed : collapsed.substring(0, SNIPPET_MAX);
  }
}

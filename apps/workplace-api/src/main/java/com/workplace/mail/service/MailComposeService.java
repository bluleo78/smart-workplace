package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.InlineImagePart;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.InlineSourceMeta;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.service.MailAttachmentService.AttachmentDownload;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
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
 *
 * <p>WP-69: 답장·전달 인용문이 cid: 로 참조하는 원본 첨부(inlineImages)는 prepare 에서 소유·타입·용량만 검증하고, send 에서 바이트를 조회해
 * 같은 Content-ID 의 인라인 파트로 다시 붙인다.
 */
@Service
@RequiredArgsConstructor
public class MailComposeService {

  private static final String SENT = "SENT";
  private static final int SNIPPET_MAX = 280;

  /** 인용문 인라인 이미지 최대 개수(WP-69). */
  static final int MAX_INLINE_IMAGES = 20;

  /**
   * 인라인 이미지 원본 합계 상한 — Graph MIME sendMail 은 base64 요청 본문 4MB 제한(MIME 내부 base64 + 요청 base64 로 원본 대비
   * 약 1.8배)이라 2MB, SMTP 는 일반 릴레이 한도 내 10MB.
   */
  static final long MAX_INLINE_TOTAL_GRAPH = 2L * 1024 * 1024;

  static final long MAX_INLINE_TOTAL_SMTP = 10L * 1024 * 1024;

  /** Content-ID 허용 문자 — 출력 가능 ASCII 중 공백·꺾쇠·따옴표 제외(헤더 인젝션 차단), 최대 250자. */
  private static final Pattern CONTENT_ID = Pattern.compile("^[\\x21-\\x7E&&[^<>\"]]{1,250}$");

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final MailMimeBuilder mimeBuilder;
  private final List<MailTransport> transports;
  private final MailSentAppender appender;
  private final EmailAttachmentRepository attachmentRepo;
  private final MailAttachmentService attachmentService;

  /**
   * 발송 사전검증(#842) — 확인카드 승인 전에 "승인 후에야 드러날 실패"를 미리 드러내기 위한 dry-run. 실행 경로(send)와 완전히 동일한 술어를
   * 공유하며(prepare) 전송·폴더 생성 등 어떤 쓰기도 하지 않는다.
   *
   * @throws EmailAccountNotFoundException 내 계정이 아님
   * @throws MailValidationException 수신자 0명 또는 잘못된 주소 형식
   * @throws EmailMessageNotFoundException 답장 대상 원본 메일 없음
   * @throws MailSendException 지원하지 않는 메일 공급자
   */
  @Transactional(readOnly = true)
  public void validateSendable(long userId, long accountId, MailSendRequest req) {
    prepare(userId, accountId, req);
  }

  /**
   * 발송 전 검증 + 조회 결과 취합. send 와 validateSendable 이 공유하는 유일한 술어 정의 지점 — 검증 순서(계정 소유 → 수신자 → 주소 형식 →
   * 답장 컨텍스트 → 공급자 전송기)가 곧 예외 우선순위다. 읽기만 수행한다.
   */
  private SendPlan prepare(long userId, long accountId, MailSendRequest req) {
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

    // 답장이면 부모 메일(내 소유) 존재 확인 — 없으면 404.
    ReplyContext replyCtx = null;
    if (req.inReplyToMessageId() != null) {
      replyCtx =
          messageRepo
              .findReplyContextByIdAndUser(userId, req.inReplyToMessageId())
              .orElseThrow(() -> new EmailMessageNotFoundException(req.inReplyToMessageId()));
    }

    // 공급자별 전송기 존재 확인 — 미지원 공급자를 MIME 조립 전에 조기 차단.
    MailTransport transport = transportFor(account.provider());
    List<InlineSource> inline =
        validateInlineImages(userId, account.provider(), req.inlineImages());
    return new SendPlan(account, to, cc, bcc, replyCtx, transport, inline);
  }

  /**
   * 인용문 인라인 이미지 검증(WP-69) — 바이트는 읽지 않는다(validateSendable 읽기 전용 유지). 개수 → Content-ID 형식 → 소유(원본 첨부
   * 존재) → image/* → 공급자별 총용량 순.
   */
  private List<InlineSource> validateInlineImages(
      long userId, MailProvider provider, List<InlineImageRef> refs) {
    if (refs.isEmpty()) {
      return List.of();
    }
    if (refs.size() > MAX_INLINE_IMAGES) {
      throw new MailValidationException("인용문 이미지는 최대 " + MAX_INLINE_IMAGES + "개까지 보낼 수 있습니다");
    }
    List<InlineSource> out = new ArrayList<>();
    long total = 0;
    for (InlineImageRef ref : refs) {
      if (ref == null
          || ref.attachmentId() == null
          || ref.contentId() == null
          || !CONTENT_ID.matcher(ref.contentId()).matches()) {
        throw new MailValidationException("인용문 이미지 참조가 올바르지 않습니다");
      }
      InlineSourceMeta meta =
          attachmentRepo
              .findInlineSourceMeta(userId, ref.attachmentId())
              .orElseThrow(() -> new MailValidationException("인용문 이미지 원본을 찾을 수 없습니다"));
      if (!InlineImageSupport.isImage(meta.contentType())) {
        throw new MailValidationException("인용문 이미지가 이미지 파일이 아닙니다");
      }
      total += meta.sizeBytes();
      out.add(new InlineSource(ref, meta));
    }
    long max = provider == MailProvider.M365_GRAPH ? MAX_INLINE_TOTAL_GRAPH : MAX_INLINE_TOTAL_SMTP;
    if (total > max) {
      throw new MailValidationException(
          "인용문 이미지 용량이 너무 큽니다(최대 " + (max / (1024 * 1024)) + "MB). 인용문을 제거하고 보내세요");
    }
    return out;
  }

  /** 검증을 통과한 인라인 이미지 원본 — send 에서 바이트를 조회한다. */
  private record InlineSource(InlineImageRef ref, InlineSourceMeta meta) {}

  /** 원본 첨부 바이트를 조회해 인라인 파트로 만든다. 실패 시 발송 전체를 실패시킨다 — 이미지를 빼고 보내면 수신자에게 깨진 참조가 남으므로 조용히 누락하지 않는다. */
  private List<InlineImagePart> loadInlineImages(long userId, List<InlineSource> sources) {
    List<InlineImagePart> parts = new ArrayList<>();
    for (InlineSource src : sources) {
      try {
        AttachmentDownload dl = attachmentService.download(userId, src.ref().attachmentId());
        parts.add(
            new InlineImagePart(
                src.ref().contentId(),
                src.meta().filename(),
                src.meta().contentType(),
                dl.content()));
      } catch (RuntimeException e) {
        throw new MailSendException("인용문 이미지를 가져오지 못했습니다. 인용문을 제거하고 다시 보내세요", e);
      }
    }
    return parts;
  }

  /** prepare 산출물 — 검증 통과 사실 + 재조회 없이 재사용할 값들. replyCtx 는 신규/전달이면 null. */
  private record SendPlan(
      EmailAccountResponse account,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      ReplyContext replyCtx,
      MailTransport transport,
      List<InlineSource> inline) {}

  /** 본인 계정으로 메일 발송. 발송 성공 시 로컬 SENT 행 id + Message-ID 반환. */
  @Transactional
  public SendResult send(long userId, long accountId, MailSendRequest req) {
    // 검증은 사전검증(validateSendable)과 동일 경로 — 술어 포크 금지.
    SendPlan plan = prepare(userId, accountId, req);
    EmailAccountResponse account = plan.account();
    List<String> to = plan.to();
    List<String> cc = plan.cc();
    List<String> bcc = plan.bcc();

    // Message-ID 직접 생성(전송본·APPEND·로컬 행 공유).
    String messageId = UUID.randomUUID() + "@" + domainOf(account.emailAddress());

    // 답장: 부모 스레드/헤더 상속. 신규/전달: 새 스레드(자기 ID 루트).
    String threadId = messageId;
    String inReplyTo = null;
    String references = null;
    if (plan.replyCtx() != null) {
      ReplyContext ctx = plan.replyCtx();
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
            now,
            loadInlineImages(userId, plan.inline()));

    // 1) MIME 조립(공유 빌더) + 공급자별 전송기 디스패치 — 유일한 사용자 노출 실패.
    MimeMessage message;
    try {
      message = mimeBuilder.build(account, mail);
    } catch (MessagingException e) {
      throw new MailSendException("메일 구성에 실패했습니다", e);
    }
    plan.transport().transmit(userId, account, message, mail);

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

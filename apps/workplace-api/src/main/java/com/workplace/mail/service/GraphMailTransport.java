package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.OutgoingMail.AttachmentPart;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphApiClient.DraftRef;
import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * M365_GRAPH 계정 전송기. 조립된 MIME 을 base64 로 직렬화해 Graph sendMail API 로 발송한다. 스레딩
 * 헤더(In-Reply-To/References)는 MailMimeBuilder 가 이미 포함하므로 직렬화만 담당. Graph 가 saveToSentItems 기본 동작으로
 * 서버 Sent 에 자동 저장하므로 별도 APPEND 가 없다.
 *
 * <p>WP-574 큰 메일: sendMail 요청 본문은 4MB 제한이라, 인코딩된 MIME 이 {@link #SEND_MAIL_LIMIT} 를 넘고 일반 첨부가 있으면 초안
 * 경로로 보낸다 — ① 일반 첨부를 뺀 MIME(본문·인용문 이미지·스레딩 헤더 유지)으로 초안 생성 ② 첨부마다 3MB 미만은 attachments API, 이상은 업로드
 * 세션 조각 PUT ③ 초안 send. 중간에 실패하면 초안 삭제를 시도하고 사용자 오류로 끝낸다. 보낸편지함 저장은 Graph 가 한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GraphMailTransport implements MailTransport {

  /**
   * sendMail 로 보낼 수 있는 base64 MIME 길이 상한 — Graph 요청 본문 4MB(4,194,304) 제한에 여유를 둔 값. 넘으면 초안+첨부 API
   * 경로로 보낸다.
   */
  static final int SEND_MAIL_LIMIT = 3_500_000;

  /** 이 크기 미만 첨부는 attachments API 로 한 번에 붙인다(Graph 권장 경계 3MB). 이상은 업로드 세션. */
  static final int DIRECT_ATTACHMENT_LIMIT = 3 * 1024 * 1024;

  /** 업로드 세션 조각 크기 — Graph 가 요구하는 320KiB 배수(10배 = 3,200KiB, 조각 상한 4MB 미만). */
  static final int UPLOAD_CHUNK = 320 * 1024 * 10;

  static final String LARGE_SEND_FAILED = "첨부가 큰 메일을 보내지 못했어요. 잠시 뒤 다시 보내 주세요";

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;
  private final MailMimeBuilder mimeBuilder;

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  @Override
  public String transmit(
      long userId, EmailAccountResponse account, MimeMessage message, OutgoingMail mail) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      // WP-574: 크기를 먼저 추정해 큰 메일은 전체 MIME 을 직렬화하지 않고 바로 초안 경로로 보낸다 — 25MB 첨부 메일을 base64 로 두 번
      // 감싸 문자열로 만들면 요청 하나에 수백 MB 가 든다. 직렬화는 sendMail 한도 근처의 작은 메일만.
      long estimate = estimateBase64Length(mail);
      if (needsDraftPath(mail, estimate)) {
        return sendLarge(token, account, mail);
      }
      String base64 = toBase64(withBcc(message, mail), estimate);
      if (base64.length() > SEND_MAIL_LIMIT && !mail.attachments().isEmpty()) {
        // 추정이 모자랐던 경계 사례 — 이미 만든 문자열을 버리고 초안 경로로
        base64 = null;
        return sendLarge(token, account, mail);
      }
      // 작은 메일(또는 첨부 없이 본문만 큰 메일 — 초안으로 나눌 것이 없다): 기존 sendMail 한 번
      graphApiClient.sendMail(token, base64);
      // sendMail(raw MIME)은 MIME 의 Message-ID 를 그대로 쓴다
      return mail.messageId();
    } catch (IOException | MessagingException e) {
      throw new MailSendException("Graph 메일 직렬화/발송 실패", e);
    }
  }

  /**
   * 초안 경로로 보낼지(WP-574) — 일반 첨부가 있고 추정한 base64 MIME 길이가 sendMail 상한을 넘으면. 첨부 없이 본문만 큰 메일은 나눌 것이 없어
   * sendMail 로 보낸다(실패하면 그대로 오류).
   */
  static boolean needsDraftPath(OutgoingMail mail, long estimatedBase64Length) {
    return !mail.attachments().isEmpty() && estimatedBase64Length > SEND_MAIL_LIMIT;
  }

  /**
   * 직렬화하지 않고 base64 MIME 길이를 넉넉히 추정한다. 첨부·인라인 이미지는 MIME 안 base64(×4/3, 76자 줄바꿈 ×78/76) 다음 요청
   * base64(×4/3). 본문(text·html 두 파트)은 quoted-printable 이 한글 바이트를 최대 3배로 늘리므로 3배로 잡는다. 헤더·경계 여유
   * 16KB.
   */
  static long estimateBase64Length(OutgoingMail mail) {
    long body = (utf8Length(mail.bodyText()) + utf8Length(mail.bodyHtml())) * 3;
    long binary = 0;
    for (AttachmentPart a : mail.attachments()) {
      binary += a.content().length;
    }
    for (var img : mail.inlineImages()) {
      binary += img.content().length;
    }
    long mime = body + binary * 4 / 3 * 78 / 76 + 16 * 1024;
    return mime * 4 / 3 + 4;
  }

  /** UTF-8 바이트 수를 바이트 배열을 만들지 않고 센다(본문이 커도 추정에 할당이 없다). */
  static long utf8Length(String s) {
    if (s == null) {
      return 0;
    }
    long n = 0;
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c < 0x80) {
        n += 1;
      } else if (c < 0x800) {
        n += 2;
      } else if (Character.isHighSurrogate(c)
          && i + 1 < s.length()
          && Character.isLowSurrogate(s.charAt(i + 1))) {
        n += 4; // 서로게이트 쌍 = 보조 평면 문자 1개
        i++;
      } else {
        n += 3;
      }
    }
    return n;
  }

  /**
   * 큰 메일 경로(WP-574) — 초안 생성 → (실제 Message-ID 확인) → 첨부 붙이기 → 초안 send. 실제 Message-ID 는 확인한 값을, 확인하지
   * 못하면 MIME 의 값을 돌려준다. 첨부는 모두 API 로 붙인다(초안 MIME 에는 본문·인용문 이미지만 — 크기를 확실히 4MB 아래로 두려고). 초안 MIME
   * 문자열은 요청 인자로만 쓰고 지역 변수로 붙잡지 않는다. 실패하면 만든 초안을 지우려고 시도한다(404 는 이미 없음으로 성공 취급).
   */
  private String sendLarge(String token, EmailAccountResponse account, OutgoingMail mail)
      throws IOException, MessagingException {
    String draftId = null;
    try {
      DraftRef draft = graphApiClient.createDraftFromMime(token, draftBase64(account, mail));
      draftId = draft.id();
      String actual = actualMessageId(token, draft);
      for (AttachmentPart att : mail.attachments()) {
        attach(token, draftId, att);
      }
      graphApiClient.sendDraft(token, draftId);
      return actual != null ? actual : mail.messageId();
    } catch (RuntimeException e) {
      if (draftId != null) {
        deleteDraftQuietly(token, draftId);
      }
      throw new MailSendException(LARGE_SEND_FAILED, e);
    }
  }

  /**
   * 초안의 실제 Message-ID(꺾쇠 제외) — Exchange 가 MIME 의 값 대신 자체 internetMessageId 를 붙일 수 있어, 로컬 SENT 행이 받는
   * 사람의 답장(In-Reply-To)과 스레드로 묶이려면 실제 값을 남겨야 한다. 생성 응답에 있으면 그 값, 없으면 send 전에 한 번 읽는다. 읽기 실패는 발송을 막지
   * 않는다(MIME 값으로 남긴다).
   */
  private String actualMessageId(String token, DraftRef draft) {
    String raw = draft.internetMessageId();
    if (raw == null) {
      try {
        raw = graphApiClient.getInternetMessageId(token, draft.id());
      } catch (RuntimeException e) {
        log.warn("초안 internetMessageId 조회 실패 — MIME 의 Message-ID 로 기록: {}", e.toString());
        return null;
      }
    }
    if (raw == null) {
      return null;
    }
    String trimmed = raw.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      trimmed = trimmed.substring(1, trimmed.length() - 1);
    }
    return trimmed.isEmpty() ? null : trimmed;
  }

  /** 일반 첨부를 뺀 초안 MIME(본문·인용문 이미지·스레딩 헤더·Bcc) 의 base64. */
  private String draftBase64(EmailAccountResponse account, OutgoingMail mail)
      throws IOException, MessagingException {
    OutgoingMail draftMail = mail.withoutAttachments();
    return toBase64(
        withBcc(mimeBuilder.build(account, draftMail), draftMail), estimateBase64Length(draftMail));
  }

  /** 첨부 하나를 초안에 붙인다 — 3MB 미만은 한 번에, 이상은 업로드 세션으로 나눠 PUT. */
  private void attach(String token, String draftId, AttachmentPart att) {
    String name = att.filenameOrDefault();
    String type = att.concreteContentType();
    byte[] content = att.content();
    if (content.length < DIRECT_ATTACHMENT_LIMIT) {
      graphApiClient.addFileAttachment(token, draftId, name, type, content);
      return;
    }
    String uploadUrl =
        graphApiClient.createAttachmentUploadSession(token, draftId, name, type, content.length);
    for (int from = 0; from < content.length; from += UPLOAD_CHUNK) {
      int to = Math.min(from + UPLOAD_CHUNK, content.length);
      graphApiClient.uploadAttachmentChunk(uploadUrl, content, from, to);
    }
  }

  /** 실패한 발송의 초안을 지운다(best-effort) — 지우지 못해도 원래 실패를 가리지 않는다. */
  private void deleteDraftQuietly(String token, String draftId) {
    try {
      graphApiClient.delete(token, "/me/messages/" + draftId);
    } catch (RuntimeException e) {
      log.warn("큰 메일 발송 실패 후 초안 삭제도 실패 — 임시 보관함에 남을 수 있음: {}", e.toString());
    }
  }

  /**
   * Graph 는 raw MIME 의 Bcc 헤더를 받아 블라인드 발송 후 전달본에서 제거한다. SMTP 는 envelope 로 처리하므로 공유 빌더엔 Bcc 를 넣지 않음
   * — Graph 전송기에서만 주입.
   */
  private static MimeMessage withBcc(MimeMessage message, OutgoingMail mail)
      throws MessagingException {
    if (mail.bcc() != null && !mail.bcc().isEmpty()) {
      Address[] bcc = new InternetAddress[mail.bcc().size()];
      for (int i = 0; i < mail.bcc().size(); i++) {
        bcc[i] = new InternetAddress(mail.bcc().get(i));
      }
      message.setRecipients(Message.RecipientType.BCC, bcc);
      message.saveChanges();
    }
    return message;
  }

  /**
   * MimeMessage → base64 문자열. 원본 MIME 바이트 배열을 따로 만들지 않고 base64 인코더로 바로 흘려 쓴다(복사본 하나 덜기). 버퍼는 추정 길이로
   * 미리 잡아 늘리며 다시 복사하지 않게 한다.
   */
  private static String toBase64(MimeMessage message, long estimatedLength)
      throws IOException, MessagingException {
    int capacity = (int) Math.min(estimatedLength, Integer.MAX_VALUE - 16);
    ByteArrayOutputStream out = new ByteArrayOutputStream(capacity);
    try (OutputStream encoder = Base64.getEncoder().wrap(out)) {
      message.writeTo(encoder);
    }
    return out.toString(StandardCharsets.US_ASCII);
  }
}

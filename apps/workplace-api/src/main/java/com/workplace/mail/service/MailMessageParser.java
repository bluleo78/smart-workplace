package com.workplace.mail.service;

import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedBody;
import com.workplace.mail.dto.ParsedMessage;
import jakarta.mail.Address;
import jakarta.mail.Flags;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeUtility;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * IMAP MimeMessage → {@link ParsedMessage}. 멀티파트(alternative/mixed)를 재귀로 훑어 text/html 본문과 첨부 메타를
 * 분리하고, RFC 헤더(Message-ID/References/In-Reply-To)로 스레드 그룹키를 도출한다. 첨부 바이너리는 읽지 않고 메타만 수집한다.
 */
@Component
public class MailMessageParser {

  /** 목록 미리보기 스니펫 최대 길이(컬럼 VARCHAR(280)). */
  private static final int SNIPPET_MAX = 280;

  // 컬럼 길이 상한(V32 스키마) — 초과 시 절단해 INSERT 오버플로(트랜잭션 abort)를 방지한다.
  private static final int ADDR_MAX = 320;
  private static final int NAME_MAX = 255;
  private static final int ID_MAX = 998; // message_id/thread_id/in_reply_to, subject 공통

  private static final Pattern ANGLE_ID = Pattern.compile("<([^>]+)>");

  /**
   * MimeMessage 를 파싱(헤더 + 본문 + 첨부). uid 는 스레드키 합성 fallback 과 증분 키로 쓰인다.
   *
   * <p>Task 7 에서 동기화가 {@link #parseMetadata} + {@link #parseBody} 로 전환되면 제거 예정 — 현재 {@code
   * MailSyncService} 가 여전히 사용한다.
   */
  public ParsedMessage parse(long uid, Message msg) throws MessagingException, IOException {
    String messageId = normalizeId(firstHeader(msg, "Message-ID"));
    String inReplyTo = normalizeId(firstHeader(msg, "In-Reply-To"));
    String references = firstHeader(msg, "References");
    String threadId = deriveThreadId(references, inReplyTo, messageId, uid);

    String fromAddress = null;
    String fromName = null;
    Address[] from = msg.getFrom();
    if (from != null && from.length > 0 && from[0] instanceof InternetAddress ia) {
      fromAddress = ia.getAddress();
      fromName = ia.getPersonal();
    }

    String to = addressesToString(msg.getRecipients(Message.RecipientType.TO));
    String cc = addressesToString(msg.getRecipients(Message.RecipientType.CC));
    String subject = msg.getSubject();

    Instant sentAt = toInstant(msg.getSentDate());
    Instant receivedAt = toInstant(msg.getReceivedDate());
    if (receivedAt == null) {
      receivedAt = sentAt; // IMAP 서버가 수신일을 안 주면 발신일로 대체
    }

    boolean seen = msg.getFlags().contains(Flags.Flag.SEEN);

    StringBuilder text = new StringBuilder();
    StringBuilder html = new StringBuilder();
    List<ParsedAttachment> attachments = new ArrayList<>();
    collectBody(msg, text, html, attachments);

    String bodyText = text.length() == 0 ? null : text.toString();
    String bodyHtml = html.length() == 0 ? null : html.toString();
    String snippet = buildSnippet(bodyText, bodyHtml);

    return new ParsedMessage(
        uid,
        truncate(messageId, ID_MAX),
        truncate(threadId, ID_MAX),
        truncate(inReplyTo, ID_MAX),
        references, // mail_references 는 TEXT — 절단 불필요
        truncate(fromAddress, ADDR_MAX),
        truncate(fromName, NAME_MAX),
        to, // to_addresses 는 TEXT
        cc, // cc_addresses 는 TEXT
        truncate(subject, ID_MAX),
        sentAt,
        receivedAt,
        seen,
        !attachments.isEmpty(),
        bodyText, // body_text 는 TEXT
        bodyHtml, // body_html 은 TEXT
        snippet,
        attachments);
  }

  /**
   * 헤더/봉투만 파싱(본문 미수집). 목록 동기화용 — collectBody 를 호출하지 않아 본문 IMAP 다운로드를 유발하지 않는다. uid 는 스레드키 합성
   * fallback 과 증분 키로 쓰인다. 본문/스니펫/첨부 플래그는 본문 적재 단계에서 {@link #parseBody} 로 확정한다.
   */
  public ParsedMessage parseMetadata(long uid, Message msg) throws MessagingException {
    String messageId = normalizeId(firstHeader(msg, "Message-ID"));
    String inReplyTo = normalizeId(firstHeader(msg, "In-Reply-To"));
    String references = firstHeader(msg, "References");
    String threadId = deriveThreadId(references, inReplyTo, messageId, uid);

    String fromAddress = null;
    String fromName = null;
    Address[] from = msg.getFrom();
    if (from != null && from.length > 0 && from[0] instanceof InternetAddress ia) {
      fromAddress = ia.getAddress();
      fromName = ia.getPersonal();
    }

    String to = addressesToString(msg.getRecipients(Message.RecipientType.TO));
    String cc = addressesToString(msg.getRecipients(Message.RecipientType.CC));
    String subject = msg.getSubject();

    Instant sentAt = toInstant(msg.getSentDate());
    Instant receivedAt = toInstant(msg.getReceivedDate());
    if (receivedAt == null) {
      receivedAt = sentAt; // IMAP 서버가 수신일을 안 주면 발신일로 대체
    }

    boolean seen = msg.getFlags().contains(Flags.Flag.SEEN);

    return new ParsedMessage(
        uid,
        truncate(messageId, ID_MAX),
        truncate(threadId, ID_MAX),
        truncate(inReplyTo, ID_MAX),
        references, // mail_references 는 TEXT — 절단 불필요
        truncate(fromAddress, ADDR_MAX),
        truncate(fromName, NAME_MAX),
        to, // to_addresses 는 TEXT
        cc, // cc_addresses 는 TEXT
        truncate(subject, ID_MAX),
        sentAt,
        receivedAt,
        seen,
        false, // hasAttachment — 본문 적재 시 확정
        null, // bodyText — 본문 적재 시 확정
        null, // bodyHtml — 본문 적재 시 확정
        null, // snippet — 본문 적재 시 확정
        java.util.List.of());
  }

  /** 본문/첨부만 파싱(OnDemand/백그라운드 본문 적재용). collectBody 로 IMAP 본문을 내려받아 text/html/스니펫/첨부를 수집한다. */
  public ParsedBody parseBody(Message msg) throws MessagingException, IOException {
    StringBuilder text = new StringBuilder();
    StringBuilder html = new StringBuilder();
    List<ParsedAttachment> attachments = new ArrayList<>();
    collectBody(msg, text, html, attachments);

    String bodyText = text.length() == 0 ? null : text.toString();
    String bodyHtml = html.length() == 0 ? null : html.toString();
    String snippet = buildSnippet(bodyText, bodyHtml);

    return new ParsedBody(bodyText, bodyHtml, snippet, !attachments.isEmpty(), attachments);
  }

  /** 길이 상한이 있는 컬럼용 절단(상한 초과분 제거). null/이내면 그대로. */
  private String truncate(String value, int max) {
    if (value == null || value.length() <= max) {
      return value;
    }
    return value.substring(0, max);
  }

  /** 파트를 재귀로 훑어 본문(text/html)과 첨부 메타를 분리 수집. */
  private void collectBody(
      Part part, StringBuilder text, StringBuilder html, List<ParsedAttachment> attachments)
      throws MessagingException, IOException {
    if (part.isMimeType("multipart/*")) {
      Multipart mp = (Multipart) part.getContent();
      for (int i = 0; i < mp.getCount(); i++) {
        collectBody(mp.getBodyPart(i), text, html, attachments);
      }
      return;
    }
    if (isAttachment(part)) {
      attachments.add(toAttachment(part));
      return;
    }
    if (part.isMimeType("text/plain")) {
      Object c = part.getContent();
      if (c instanceof String s) {
        text.append(s);
      }
    } else if (part.isMimeType("text/html")) {
      Object c = part.getContent();
      if (c instanceof String s) {
        html.append(s);
      }
    }
    // 그 외(text/calendar 등)는 v1 에서 무시
  }

  /** 첨부 판정: Content-Disposition=attachment 이거나 파일명이 있는 비-멀티파트 파트(인라인 이미지 포함). */
  private boolean isAttachment(Part part) throws MessagingException {
    String disposition = part.getDisposition();
    if (Part.ATTACHMENT.equalsIgnoreCase(disposition)) {
      return true;
    }
    String filename = part.getFileName();
    return filename != null && !filename.isBlank() && !part.isMimeType("text/*");
  }

  private ParsedAttachment toAttachment(Part part) throws MessagingException {
    String filename = part.getFileName();
    if (filename != null) {
      try {
        filename = MimeUtility.decodeText(filename);
      } catch (IOException ignored) {
        // 디코딩 실패 시 원본 파일명 유지
      }
    }
    String contentId = firstHeader(part, "Content-ID");
    if (contentId != null) {
      contentId = contentId.replaceAll("[<>]", "").trim();
    }
    int size = part.getSize();
    return new ParsedAttachment(
        filename, stripParams(part.getContentType()), Math.max(size, 0), contentId);
  }

  /** "text/plain; charset=utf-8" → "text/plain". */
  private String stripParams(String contentType) {
    if (contentType == null) {
      return null;
    }
    int semi = contentType.indexOf(';');
    return (semi < 0 ? contentType : contentType.substring(0, semi)).trim();
  }

  /** 스레드 루트키: References 첫 id → In-Reply-To → 자기 Message-ID → 합성("uid:{uid}"). NOT NULL 보장. */
  private String deriveThreadId(String references, String inReplyTo, String messageId, long uid) {
    String rootRef = firstAngleId(references);
    if (rootRef != null) {
      return rootRef;
    }
    if (inReplyTo != null) {
      return inReplyTo;
    }
    if (messageId != null) {
      return messageId;
    }
    return "uid:" + uid;
  }

  /** References 문자열에서 첫 &lt;id&gt; 를 정규화해 반환(없으면 null). */
  private String firstAngleId(String references) {
    if (references == null) {
      return null;
    }
    Matcher m = ANGLE_ID.matcher(references);
    return m.find() ? m.group(1).trim() : null;
  }

  /** 양끝 &lt;&gt; 제거 + trim. 빈 값이면 null. 도출/저장에서 동일 규칙으로 정규화해 그룹핑 누락을 막는다. */
  private String normalizeId(String raw) {
    if (raw == null) {
      return null;
    }
    String v = raw.trim();
    if (v.startsWith("<") && v.endsWith(">") && v.length() >= 2) {
      v = v.substring(1, v.length() - 1).trim();
    }
    return v.isEmpty() ? null : v;
  }

  private String firstHeader(Part part, String name) throws MessagingException {
    String[] h = part.getHeader(name);
    return (h != null && h.length > 0) ? h[0] : null;
  }

  private String addressesToString(Address[] addrs) {
    if (addrs == null || addrs.length == 0) {
      return null;
    }
    return InternetAddress.toString(addrs);
  }

  private Instant toInstant(Date date) {
    return date == null ? null : date.toInstant();
  }

  /** 본문에서 미리보기 스니펫 생성(text 우선, 없으면 html 태그 제거). 공백 정규화 후 최대 길이로 자름. */
  private String buildSnippet(String bodyText, String bodyHtml) {
    String src = bodyText;
    if (src == null && bodyHtml != null) {
      src = bodyHtml.replaceAll("(?s)<[^>]+>", " ");
    }
    if (src == null) {
      return null;
    }
    String collapsed = src.replaceAll("\\s+", " ").trim();
    if (collapsed.isEmpty()) {
      return null;
    }
    return collapsed.length() <= SNIPPET_MAX ? collapsed : collapsed.substring(0, SNIPPET_MAX);
  }
}

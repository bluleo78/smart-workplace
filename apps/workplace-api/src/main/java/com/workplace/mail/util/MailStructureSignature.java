package com.workplace.mail.util;

import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.ContentType;
import java.util.Locale;

/**
 * IMAP 메시지의 MIME 구조 요약 문자열(WP-130 content 공유 지문 재료).
 *
 * <p>동기화 시점에 BODYSTRUCTURE(FetchProfile CONTENT_INFO) 로 이미 받아 둔 값만 읽는다 — 본문을 내려받지 않는다. IMAP 의
 * multipart {@code getContent()} 는 BODYSTRUCTURE 로 파트 트리를 만들 뿐 본문을 fetch 하지 않는다. {@code
 * message/rfc822} 등 그 외 타입은 재귀하지 않는다(내용 fetch 방지).
 *
 * <p>최상위 메시지의 {@code getSize()} 는 RFC822.SIZE(수신 서버가 붙인 Received 헤더 포함, 수신함마다 다름)라 쓰지 않는다. 최상위는
 * 타입·인코딩·줄 수만, 하위 파트는 크기까지 넣는다.
 */
public final class MailStructureSignature {

  /** 비정상적으로 깊은 multipart 중첩 방어(스택·비용 상한). */
  private static final int MAX_DEPTH = 8;

  private MailStructureSignature() {}

  /**
   * 구조 요약을 만든다. 어떤 예외든 삼키고 null 을 반환한다 — 파싱 실패가 동기화에서 메일을 누락시키면 안 되고, null 은 "공유하지 않음"으로
   * 처리된다(fail-closed).
   */
  public static String of(Part message) {
    try {
      StringBuilder sb = new StringBuilder();
      append(sb, message, 0, true);
      return sb.toString();
    } catch (Exception e) {
      return null;
    }
  }

  private static void append(StringBuilder sb, Part p, int depth, boolean top) throws Exception {
    String type = baseType(p.getContentType());
    sb.append('[').append(type);
    if (type.startsWith("multipart/") && depth < MAX_DEPTH) {
      // BODYSTRUCTURE 기반 파트 트리 — 본문 fetch 없음
      Multipart mp = (Multipart) p.getContent();
      for (int i = 0; i < mp.getCount(); i++) {
        append(sb, mp.getBodyPart(i), depth + 1, false);
      }
    } else {
      sb.append(';')
          .append(lower(p instanceof jakarta.mail.internet.MimePart mp ? mp.getEncoding() : null));
      if (!top) {
        sb.append(';').append(p.getSize());
      }
      sb.append(';').append(p.getLineCount());
      sb.append(';').append(lower(p.getDisposition()));
      sb.append(';').append(p.getFileName() == null ? "" : p.getFileName());
    }
    sb.append(']');
  }

  private static String baseType(String contentType) {
    if (contentType == null) {
      return "";
    }
    try {
      return new ContentType(contentType).getBaseType().toLowerCase(Locale.ROOT);
    } catch (Exception e) {
      // 파라미터가 깨진 Content-Type — 원문 소문자로 대체(여전히 결정적)
      return contentType.trim().toLowerCase(Locale.ROOT);
    }
  }

  private static String lower(String s) {
    return s == null ? "" : s.toLowerCase(Locale.ROOT);
  }
}

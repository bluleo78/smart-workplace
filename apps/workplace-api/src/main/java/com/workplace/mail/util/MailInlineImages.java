// MailInlineImages.java — 메일 화면이 「본문 인라인 이미지」로 보고 첨부 목록에서 빼는 첨부 판정(WP-1392)
package com.workplace.mail.util;

import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.service.InlineImageSupport;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 메일 상세 화면(웹 {@code lib/mailInlineImages.ts} 의 {@code resolveCidTargets}, WP-65·WP-70)과 같은 규칙으로, 본문
 * HTML 의 {@code src="cid:…"} 참조가 가리키는 첨부를 찾는다. 화면은 이 첨부를 본문에 그리고 첨부 목록에서는 뺀다 — 드라이브 「첨부 모아보기」도 메일
 * 화면이 첨부로 보여 주는 것만 보이려고 같은 판정을 서버에서 한다.
 *
 * <p>MIME Content-ID 유무만으로는 판정하지 않는다: Apple Mail 등은 모든 파트에 Content-ID 를 달아 진짜 첨부까지 숨게 되고, Graph 경로는
 * Content-ID 를 저장하지 않아 인라인 이미지가 새어 나온다. 화면처럼 「본문이 실제로 참조하는가」로 본다.
 *
 * <p>화면과 다른 점 하나: 화면은 인라인 이미지를 받아 오다 실패하면 목록에 다시 보인다(본문·목록 어디에서도 사라지지 않게). 서버는 받아 오기를 하지 않으므로 그 경우는
 * 반영하지 않는다.
 */
public final class MailInlineImages {

  /** 인라인 대상 상한 — 화면의 MAX_INLINE_BYTES 와 같다(이보다 크면 화면이 본문에 그리지 않고 첨부로 남긴다). */
  public static final long MAX_INLINE_BYTES = 5L * 1024 * 1024;

  /**
   * src 속성의 cid: 참조를 찾는 <b>PostgreSQL</b> 정규식(regexp_matches, 'gi' 플래그로 쓴다) — 화면의 CID_SRC_RE({@code
   * /((?<![\w-])src\s*=\s*)(?:"cid:([^"]*)"|'cid:([^']*)'|cid:([^\s>/]+))/gi}) 를 옮긴 것. 본문 HTML 전체를
   * 앱으로 읽지 않고 DB 에서 참조 값만 뽑으려고 SQL 쪽에 둔다(WP-1392).
   *
   * <p>옮기며 바꾼 표기(뜻은 같다): 화면의 접두 캡처 그룹은 쓰지 않아 뺐다 — 결과 배열은 [큰따옴표, 작은따옴표, 따옴표 없음] 세 칸이고 맞은 칸 하나만 NULL
   * 이 아니다. {@code \w}·{@code \s} 는 Postgres 에서 로캘에 따라 비ASCII 문자까지 포함할 수 있어 ASCII 문자 집합으로 풀어
   * 적었다({@code [A-Za-z0-9_]}, 공백·탭·개행·CR·FF·VT). 앞 글자 부정 후방 탐색 {@code (?<!…)} 은 Postgres 9.6+ 가
   * 지원한다.
   */
  public static final String CID_SRC_PG_REGEX =
      "(?<![A-Za-z0-9_-])src[ \\t\\n\\r\\f\\v]*=[ \\t\\n\\r\\f\\v]*"
          + "(?:\"cid:([^\"]*)\"|'cid:([^']*)'|cid:([^ \\t\\n\\r\\f\\v>/]+))";

  private MailInlineImages() {}

  /** 화면이 본문 인라인 후보로 보는 첨부인가 — 이미지(image/*)이면서 상한 이하. 판정과 후보 거르기가 같은 규칙을 쓴다. */
  public static boolean isInlinable(String contentType, long sizeBytes) {
    return InlineImageSupport.isImage(contentType) && sizeBytes <= MAX_INLINE_BYTES;
  }

  /**
   * 본문이 참조하는 cid 값들(rawRefs — {@link #CID_SRC_PG_REGEX} 로 뽑은 정규화 전 값)이 가리켜 화면이 본문에 그리는(목록에서 빼는) 첨부
   * id. attachments 는 메일 상세 응답과 같은 값·순서(ordinal 오름차순, 없으면 뒤, 다음 id)여야 한다 — 한 cid 에 여러 첨부가 맞으면 앞의 것
   * 하나만 쓰인다.
   */
  public static Set<Long> inlinedIds(
      Collection<String> rawRefs, List<EmailAttachmentMeta> attachments) {
    Set<Long> out = new LinkedHashSet<>();
    // 인라인 후보(이미지·상한 이하)는 메일마다 한 번만 거른다
    List<EmailAttachmentMeta> inlinable =
        attachments.stream().filter(a -> isInlinable(a.contentType(), a.sizeBytes())).toList();
    if (inlinable.isEmpty()) return out;
    Set<String> cids = new LinkedHashSet<>();
    for (String raw : rawRefs) {
      // 화면은 빈 값("cid:")을 건너뛴다(빈 문자열은 falsy)
      if (raw != null && !raw.isEmpty()) cids.add(normalize(raw));
    }
    for (String cid : cids) {
      EmailAttachmentMeta att = find(cid, inlinable);
      if (att != null) out.add(att.id());
    }
    return out;
  }

  /**
   * cid 에 대응하는 첨부 — 화면의 findCidAttachment 와 같다. 인라인 후보(이미 거른 것) 중 (1) Content-ID 가 같은 것, 없으면 (2)
   * 파일명이 cid 또는 cid 의 「@」 앞부분과 같은 것(Graph 는 Content-ID 를 저장하지 않지만 발신 클라이언트가 cid 를 파일명으로 쓰는 경우가 많다).
   */
  private static EmailAttachmentMeta find(String cid, List<EmailAttachmentMeta> inlinable) {
    for (EmailAttachmentMeta a : inlinable) {
      String c = a.contentId();
      if (c != null && !c.isEmpty() && normalize(c).equals(cid)) return a;
    }
    int at = cid.indexOf('@');
    String local = at < 0 ? cid : cid.substring(0, at);
    for (EmailAttachmentMeta a : inlinable) {
      if (a.filename() == null) continue;
      String name = a.filename().toLowerCase(Locale.ROOT);
      if (name.equals(cid) || name.equals(local)) return a;
    }
    return null;
  }

  /** cid 비교용 정규화 — 앞뒤 공백·꺾쇠 제거, URL 디코딩, 소문자화(화면의 normalizeCid). */
  static String normalize(String raw) {
    String v = raw.strip();
    if (v.startsWith("<")) v = v.substring(1);
    if (v.endsWith(">")) v = v.substring(0, v.length() - 1);
    return decodeUriComponent(v).toLowerCase(Locale.ROOT);
  }

  /**
   * JS decodeURIComponent 와 같은 디코딩 — %XX 를 UTF-8 바이트로 풀고, 잘못된 % 시퀀스나 UTF-8 이면 원문을 그대로 돌려준다(화면이 예외 시
   * 원문을 쓰는 것과 같다). URLDecoder 는 「+」를 공백으로 바꿔 쓰지 않는다.
   */
  static String decodeUriComponent(String v) {
    if (v.indexOf('%') < 0) return v;
    StringBuilder out = new StringBuilder(v.length());
    int i = 0;
    while (i < v.length()) {
      char ch = v.charAt(i);
      if (ch != '%') {
        out.append(ch);
        i++;
        continue;
      }
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      while (i < v.length() && v.charAt(i) == '%') {
        // % 뒤에 두 자리가 없으면 잘못된 시퀀스
        if (i + 2 >= v.length()) return v;
        int hi = Character.digit(v.charAt(i + 1), 16);
        int lo = Character.digit(v.charAt(i + 2), 16);
        if (hi < 0 || lo < 0) return v;
        bytes.write((hi << 4) | lo);
        i += 3;
      }
      try {
        out.append(
            StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray())));
      } catch (CharacterCodingException e) {
        return v;
      }
    }
    return out.toString();
  }
}

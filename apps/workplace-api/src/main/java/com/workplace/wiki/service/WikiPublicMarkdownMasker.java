package com.workplace.wiki.service;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriUtils;

/**
 * 외부(비로그인) 공유 보기의 본문 가림(WP-579, 설계 「볼 수 없는 링크 가림」). 가림은 서버에서 끝낸다 — 웹은 받은 마크다운을 그대로 그린다.
 *
 * <p>바꾸는 것
 *
 * <ul>
 *   <li>멘션 토큰 — 사람 {@code <@id>}·이슈 {@code <#issue:id>}·범위 밖 페이지 {@code <#page:id>}·알 수 없는 종류(앞으로
 *       생길 드라이브 등)는 {@link #NO_ACCESS}, 범위 안 페이지는 그 제목 글자. 저장 형태 세 가지를 모두 본다: 마크다운 토큰, GFM 으로 못 쓰는
 *       표의 HTML 폴백(#742)이 쓰는 칩 {@code <span data-mtype data-id>&lt;@3&gt;</span>}, 글자로 이스케이프된
 *       {@code &lt;@3&gt;}. 코드 안 토큰도 가린다(외부에 사람·이슈 id 를 남기지 않는다).
 *   <li>링크 — 외부 http(s) 링크만 남기고, 앱 내부 주소(상대 경로·같은 오리진·프로토콜 상대·그 밖의 스킴)는 링크를 떼고 글자만. 마크다운 {@code
 *       [t](u)}·참조형 정의·자동 링크 {@code <u>}·HTML {@code <a href>} 모두.
 *   <li>이미지 — 범위 안 페이지의 노트 첨부({@code /api/v1/wiki/pages/{p}/attachments/{f}/content})는 공개 첨부 주소로
 *       바꾸고, 범위 밖 페이지 첨부·그 밖의 내부 주소 이미지는 이미지를 빼며(마크다운은 대체 글자만), 외부 이미지는 그대로 둔다.
 * </ul>
 *
 * <p>범위 안 페이지 제목은 ASCII 구두점을 문자 참조({@code &#124;} 등)로 넣는다 — 마크다운 글자·GFM 표 셀·HTML 블록 어디서든 글자 그대로 보이고
 * 표 구분자·마크업으로 해석되지 않는다.
 */
@Component
public class WikiPublicMarkdownMasker {
  /** 가린 자리표시 — 마크다운·HTML 어디서도 특수 의미가 없는 홑화살괄호(‹ ›)로 감싼다. */
  public static final String NO_ACCESS = "‹접근 권한 없음›";

  // ── 멘션 ──────────────────────────────────────────────────────────────
  /** 칩 HTML(닫는 태그까지) — 속성 순서 무관. 내용(토큰 글자)째 바꾼다. */
  private static final Pattern MENTION_SPAN =
      Pattern.compile("(?is)<span\\b([^>]*\\bdata-mtype\\b[^>]*)>.*?</span\\s*>");

  /** 닫는 태그 없이 남은 칩 여는 태그 — 실패 시 닫힘으로 자리표시를 둔다. */
  private static final Pattern MENTION_SPAN_OPEN =
      Pattern.compile("(?i)<span\\b[^>]*\\bdata-mtype\\b[^>]*>");

  private static final Pattern ATTR_MTYPE =
      Pattern.compile("(?i)\\bdata-mtype\\s*=\\s*[\"']?([A-Za-z]+)");
  private static final Pattern ATTR_ID = Pattern.compile("(?i)\\bdata-id\\s*=\\s*[\"']?(\\d+)");

  /** HTML 이미지·링크의 주소 속성 — 값은 따옴표(", ')·맨값 셋 중 하나로 잡는다(1~3 그룹). */
  private static final Pattern ATTR_SRC = attrPattern("src");

  private static final Pattern ATTR_HREF = attrPattern("href");

  /** 마크다운 토큰 {@code <@id>}·{@code <#종류:id>} 와 글자로 이스케이프된 같은 토큰. */
  private static final Pattern MENTION_TOKEN =
      Pattern.compile("(?:<|&lt;)(?:@(\\d+)|#([A-Za-z]+):(\\d+))(?:>|&gt;)");

  // ── HTML 링크·이미지 ────────────────────────────────────────────────────
  private static final Pattern HTML_IMG = Pattern.compile("(?i)<img\\b[^>]*>");
  private static final Pattern HTML_A = Pattern.compile("(?is)<a\\b([^>]*)>(.*?)</a\\s*>");

  // ── 마크다운 링크·이미지 ─────────────────────────────────────────────────
  // 소유 한정자(*+)로 백트래킹 폭주를 막는다 — 각 갈래의 첫 글자가 겹치지 않거나, 겹쳐도 먼저 맞은 갈래로 충분하다.
  private static final String DEST =
      "<[^<>\\n]*>|(?:\\\\.|[^\\s()\\\\]|\\((?:\\\\.|[^\\s()\\\\])*+\\))*+";
  private static final String TITLE =
      "\\s+(?:\"(?:\\\\.|[^\"\\\\])*+\"|'(?:\\\\.|[^'\\\\])*+'|\\((?:\\\\.|[^()\\\\])*+\\))";
  private static final String ALT = "(?:\\\\.|[^\\[\\]\\\\])*+";
  // 링크 글자 — 인라인 코드·(이미 처리한) 이미지 하나를 품을 수 있다.
  private static final String TEXT =
      "(?:\\\\.|`[^`\\n]*+`|!\\[" + ALT + "\\]\\((?:\\\\.|[^()\\\\\\n])*+\\)|[^\\[\\]\\\\])*+";

  private static final Pattern MD_IMAGE =
      Pattern.compile("!\\[(" + ALT + ")\\]\\(\\s*(" + DEST + ")(" + TITLE + ")?\\s*\\)");
  private static final Pattern MD_LINK =
      Pattern.compile(
          "(?<![!\\\\])\\[(" + TEXT + ")\\]\\(\\s*(" + DEST + ")(" + TITLE + ")?\\s*\\)");

  /**
   * 참조형 링크 정의 한 줄 {@code [id]: url "title"} — 인용({@code >})·목록 표시 안에 있어도 정의다. 1=컨테이너 접두, 2=이름,
   * 3=나머지.
   */
  private static final Pattern MD_DEFINITION =
      Pattern.compile(
          "(?m)^((?:[ \\t]*(?:>|[-*+]|\\d{1,9}[.)]))*+[ \\t]*)\\[((?:\\\\.|[^\\[\\]\\\\])++)\\]:([^\\n]*)(?:\\n|$)");

  /** 정의 나머지 = 주소 + (제목)? — 1=주소, 2=제목 부분. 제목 모양이 아니면 정의가 아니다(글자로 보이는 문장). */
  private static final Pattern DEFINITION_REST =
      Pattern.compile("^[ \\t]*(<[^<>\\n]*>|\\S+)((?:" + TITLE + ")?)[ \\t]*$");

  /**
   * 마지막 안전망 — 어떤 태그에서든(닫히지 않은 태그, 앞 속성값 안의 {@code >} 뒤 포함) 주소를 싣는 속성. 값은 {@link
   * #neutralizeUrlAttrs} 가 직접 읽는다. 앞이 낱말·{@code -}·{@code :}·{@code .} 이면 다른 이름의 일부(data-src 등)라
   * 제외.
   */
  private static final Pattern URL_ATTR =
      Pattern.compile(
          "(?i)(?<![\\w:.-])(href|src|srcset|xlink:href|action|formaction|poster|background|cite|data|ping"
              + "|lowsrc|dynsrc|longdesc|manifest|codebase|archive|usemap|profile|icon)(\\s*=\\s*)");

  /** 자동 링크 {@code <scheme:...>}. */
  private static final Pattern AUTOLINK =
      Pattern.compile("<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\\s]*)>");

  /** 노트 첨부 경로(오리진을 뗀 뒤) — {@code WikiAttachmentService.ATTACHMENT_URL} 과 같은 모양. */
  private static final Pattern ATTACHMENT_PATH =
      Pattern.compile(
          "^/api/v1/wiki/pages/(\\d{1,19})/attachments/(\\d{1,19})/content(?:[?#].*)?$");

  /** 공개 첨부 주소(이 마스커가 만든 모양) — 토큰은 호출마다 다르므로 토큰 자리는 따로 비교한다. */
  private static final Pattern PUBLIC_ATTACHMENT_PATH =
      Pattern.compile("^/api/v1/public/wiki/shares/([^/?#]+)/pages/(\\d+)/attachments/(\\d+)$");

  private static final Pattern BACKSLASH_ESCAPE = Pattern.compile("\\\\(\\p{Punct})");

  /** 웹 오리진(끝 / 없음, 소문자) — 같은 오리진 절대 주소를 앱 내부 링크로 본다. */
  private final String origin;

  public WikiPublicMarkdownMasker(@Value("${workplace.public-base-url}") String publicBaseUrl) {
    String b = publicBaseUrl == null ? "" : publicBaseUrl.trim();
    while (b.endsWith("/")) {
      b = b.substring(0, b.length() - 1);
    }
    this.origin = b.toLowerCase(Locale.ROOT);
  }

  /**
   * 본문을 외부 보기용으로 가린다.
   *
   * @param markdown 저장된 본문(null 이면 빈 문자열)
   * @param sharedPageTitles 공유 범위 안 페이지 id → 제목. 키 집합이 곧 범위다(이 밖의 페이지 멘션·첨부는 가린다)
   * @param token 공개 첨부 주소에 넣을 공유 토큰
   */
  public String mask(String markdown, Map<Long, String> sharedPageTitles, String token) {
    if (markdown == null || markdown.isEmpty()) {
      return "";
    }
    Ctx ctx = new Ctx(sharedPageTitles, token);
    String s = markdown;
    // 1) 멘션 — 칩 HTML 을 먼저(안의 토큰 글자째), 남은 여는 태그, 그다음 토큰.
    s = replace(s, MENTION_SPAN, m -> mentionFromAttrs(m.group(1), ctx));
    s = replace(s, MENTION_SPAN_OPEN, m -> NO_ACCESS);
    s = replace(s, MENTION_TOKEN, m -> mentionFromToken(m, ctx));
    // 2) HTML 이미지·링크(폴백 표 셀과 본문 raw HTML).
    s = replace(s, HTML_IMG, m -> htmlImage(m.group(), ctx));
    s = replace(s, HTML_A, m -> htmlAnchor(m, ctx));
    // 3) 마크다운 이미지를 링크보다 먼저 — 링크 글자에 든 이미지를 링크 패턴이 먹지 않게.
    s = replace(s, MD_IMAGE, m -> mdLinkOrImage(m, "!", ctx));
    s = replace(s, MD_LINK, m -> mdLinkOrImage(m, "", ctx));
    s = replace(s, MD_DEFINITION, m -> mdDefinition(m, ctx));
    s = neutralizeLinkTails(s, ctx);
    s = replace(s, AUTOLINK, m -> autolink(m, ctx));
    // 4) 마지막 안전망 — 위에서 못 잡은 HTML 주소 속성(iframe·source·area·srcset 포함)은 외부·공개 첨부가 아니면 지운다.
    return neutralizeUrlAttrs(s, ctx);
  }

  // ── 멘션 ──────────────────────────────────────────────────────────────

  private String mentionFromAttrs(String attrs, Ctx ctx) {
    Matcher t = ATTR_MTYPE.matcher(attrs);
    Matcher i = ATTR_ID.matcher(attrs);
    if (t.find() && i.find() && "PAGE".equalsIgnoreCase(t.group(1))) {
      return pageTitleOrMask(i.group(1), ctx);
    }
    return NO_ACCESS;
  }

  private String mentionFromToken(Matcher m, Ctx ctx) {
    if (m.group(2) != null && "page".equals(m.group(2))) {
      return pageTitleOrMask(m.group(3), ctx);
    }
    return NO_ACCESS;
  }

  private String pageTitleOrMask(String id, Ctx ctx) {
    String title = ctx.title(parseId(id));
    return title == null ? NO_ACCESS : escapeTitle(title);
  }

  // ── 링크·이미지 ─────────────────────────────────────────────────────────

  private String htmlImage(String tag, Ctx ctx) {
    Attr src = Attr.find(tag, ATTR_SRC);
    if (src == null) {
      return tag;
    }
    Target t = classify(htmlDecode(src.value), ctx);
    return switch (t.kind) {
      case EXTERNAL -> tag;
      case ATTACHMENT -> src.replaceIn(tag, t.url);
      case INTERNAL -> "";
    };
  }

  private String htmlAnchor(Matcher m, Ctx ctx) {
    String whole = m.group();
    Attr href = Attr.find(m.group(1), ATTR_HREF);
    if (href == null) {
      return whole;
    }
    Target t = classify(htmlDecode(href.value), ctx);
    return switch (t.kind) {
      case EXTERNAL -> whole;
      case ATTACHMENT -> "<a" + href.replaceIn(m.group(1), t.url) + ">" + m.group(2) + "</a>";
      case INTERNAL -> m.group(2);
    };
  }

  /**
   * 마크다운 이미지({@code bang="!"})·링크({@code bang=""}) — 외부는 그대로, 범위 안 첨부는 공개 주소로, 그 밖은 대체 글자·링크 글자만
   * 남긴다. 1=글자, 2=주소, 3=제목.
   */
  private String mdLinkOrImage(Matcher m, String bang, Ctx ctx) {
    Target t = classify(mdDest(m.group(2)), ctx);
    return switch (t.kind) {
      case EXTERNAL -> m.group();
      case ATTACHMENT -> bang + "[" + m.group(1) + "](" + t.url + nz(m.group(3)) + ")";
      case INTERNAL -> m.group(1);
    };
  }

  /**
   * 참조형 정의 — 외부·공개 첨부는 그대로, 범위 안 첨부는 공개 주소로, 그 밖은 줄을 지운다(참조하던 {@code [글자][이름]} 은 글자로 남는다). 주소가 다음
   * 줄에 있는 정의(나머지가 빔)도 정의 줄을 지워 다음 줄이 글자로만 남게 한다. 나머지가 한 줄 「주소 + 제목」 모양이 아니면(여러 줄 제목이거나 정의가 아닌 문장) 첫
   * 주소가 외부일 때만 그대로 두고, 아니면 이름 앞 {@code [} 를 이스케이프해 글자로 고정한다.
   */
  private String mdDefinition(Matcher m, Ctx ctx) {
    String rest = m.group(3);
    if (rest.isBlank()) {
      return "";
    }
    Matcher r = DEFINITION_REST.matcher(rest);
    if (!r.matches()) {
      // 한 줄로 풀리지 않는 모양(여러 줄 제목 등) — 첫 주소가 외부면 그대로, 아니면 이름 앞 [ 를 이스케이프해 정의가 될 수 없게 한다(글자는 같게 보인다).
      String first = rest.trim().split("\\s+", 2)[0];
      if (classify(mdDest(first), ctx).kind == Kind.EXTERNAL) {
        return m.group();
      }
      return m.group(1) + "\\[" + m.group().substring(m.group(1).length() + 1);
    }
    Target t = classify(mdDest(r.group(1)), ctx);
    return switch (t.kind) {
      case EXTERNAL -> m.group();
      case ATTACHMENT -> {
        String eol = m.group().endsWith("\n") ? "\n" : "";
        yield m.group(1) + "[" + m.group(2) + "]: " + t.url + r.group(2) + eol;
      }
      case INTERNAL -> "";
    };
  }

  /**
   * 정규식으로 못 푼 링크 모양(겹친 대괄호·두 겹 괄호·여러 줄 제목 등)의 남은 {@code ](} 를 선형으로 훑는다(정규식은 {@code ](} 가 많고 {@code
   * )} 없는 긴 줄에서 제곱 시간이 된다 — 익명 요청으로 닿는 경로).
   *
   * <ul>
   *   <li>같은 줄에 닫는 {@code )} 가 있으면 그 안의 첫 주소로 판정 — 외부·공개 첨부는 그대로, 범위 안 첨부는 공개 주소, 그 밖은 {@code ]} 만
   *       남긴다.
   *   <li>같은 줄에 없으면(여러 줄 제목·닫히지 않음) 바로 뒤가 외부 http(s) 로 시작할 때만 두고, 아니면 {@code (} 를 이스케이프해 링크가 될 수 없게
   *       한다(글자는 그대로 보인다). 길이 상한이 없어 아무리 긴 주소도 링크로 남지 않는다.
   * </ul>
   *
   * <p>「다음 {@code )} 또는 줄바꿈」 위치를 기억해 두어 같은 구간을 다시 훑지 않는다 — 전체가 본문 길이에 비례한다.
   */
  private String neutralizeLinkTails(String s, Ctx ctx) {
    int len = s.length();
    StringBuilder out = new StringBuilder(len);
    int i = 0;
    int stop = -1; // 마지막으로 찾은 「) 또는 줄바꿈」 위치(없으면 len) — k+2 ≤ stop 인 동안 다시 쓸 수 있다
    int k;
    while ((k = s.indexOf("](", i)) >= 0) {
      if (k + 2 > stop) {
        stop = k + 2;
        while (stop < len && s.charAt(stop) != ')' && s.charAt(stop) != '\n') {
          stop++;
        }
      }
      out.append(s, i, k);
      if (stop < len && s.charAt(stop) == ')') {
        out.append(linkTail(s.substring(k + 2, stop), ctx));
        i = stop + 1;
      } else {
        out.append(startsExternal(s, k + 2) ? "](" : "]\\(");
        i = k + 2;
      }
    }
    out.append(s, i, len);
    return out.toString();
  }

  /** {@code ](inner)} 하나의 판정 결과 문자열. */
  private String linkTail(String rawInner, Ctx ctx) {
    String inner = rawInner.trim();
    String dest =
        inner.startsWith("<")
            ? inner.substring(0, inner.indexOf('>') + 1)
            : inner.split("\\s+", 2)[0];
    Target t = classify(mdDest(dest), ctx);
    return switch (t.kind) {
      case EXTERNAL -> "](" + rawInner + ")";
      case ATTACHMENT -> "](" + t.url + ")";
      case INTERNAL -> "]";
    };
  }

  /** p 부터가 외부(다른 오리진) http(s) 주소로 시작하는지 — 앞부분만 본다(상수 시간). */
  private boolean startsExternal(String s, int p) {
    if (!s.regionMatches(true, p, "http://", 0, 7) && !s.regionMatches(true, p, "https://", 0, 8)) {
      return false;
    }
    String head = s.substring(p, Math.min(s.length(), p + origin.length() + 1));
    return !sameOrigin(head.toLowerCase(Locale.ROOT));
  }

  /** 자동 링크 — 외부 http(s)·공개 첨부만 링크로 남기고, 그 밖(같은 오리진·javascript:·mailto: 등)은 꺾쇠를 떼어 글자로. */
  private String autolink(Matcher m, Ctx ctx) {
    return classify(m.group(1), ctx).kind == Kind.EXTERNAL ? m.group() : m.group(1);
  }

  /**
   * 마지막 안전망 — 남은 주소 속성을 훑어 외부 http(s)·공개 첨부가 아니면 이름과 값을 지운다. srcset 은 후보 주소가 모두 허용일 때만 남긴다. 따옴표가
   * 닫히지 않아 값을 확정할 수 없으면 속성 이름을 {@code data-masked} 로 바꿔 주소 속성이 아니게 한다(뒤 본문을 지우지 않으려고).
   */
  private String neutralizeUrlAttrs(String s, Ctx ctx) {
    Matcher m = URL_ATTR.matcher(s);
    StringBuilder out = new StringBuilder(s.length());
    int last = 0;
    int from = 0;
    while (m.find(from)) {
      int valStart = m.end();
      int valEnd;
      String value;
      char q = valStart < s.length() ? s.charAt(valStart) : ' ';
      if (q == '"' || q == '\'') {
        int close = s.indexOf(q, valStart + 1);
        if (close < 0) {
          out.append(s, last, m.start()).append("data-masked").append(m.group(2));
          last = valStart;
          from = valStart;
          continue;
        }
        value = s.substring(valStart + 1, close);
        valEnd = close + 1;
      } else {
        int e = valStart;
        while (e < s.length() && !Character.isWhitespace(s.charAt(e)) && s.charAt(e) != '>') {
          e++;
        }
        value = s.substring(valStart, e);
        valEnd = e;
      }
      if (!allowedAttrValue(m.group(1), htmlDecode(value), ctx)) {
        out.append(s, last, m.start());
        last = valEnd;
      }
      from = valEnd;
    }
    out.append(s, last, s.length());
    return out.toString();
  }

  private boolean allowedAttrValue(String name, String value, Ctx ctx) {
    if (!"srcset".equalsIgnoreCase(name)) {
      return classify(value, ctx).kind == Kind.EXTERNAL;
    }
    for (String candidate : value.split(",")) {
      String url = candidate.trim().split("\\s+", 2)[0];
      if (url.isEmpty() || classify(url, ctx).kind != Kind.EXTERNAL) {
        return false;
      }
    }
    return true;
  }

  /**
   * 주소 분류 — 외부 http(s)·이미 바꾼 공개 첨부 주소는 EXTERNAL(그대로 둠), 범위 안 페이지의 노트 첨부(상대·같은 오리진)는 ATTACHMENT(공개
   * 주소), 그 밖은 모두 INTERNAL(상대·같은 오리진·프로토콜 상대 {@code //}·{@code javascript:} 등 — 실패 시 닫힘).
   */
  private Target classify(String dest, Ctx ctx) {
    String d = dest.trim();
    String lower = d.toLowerCase(Locale.ROOT);
    String path = null;
    if (lower.startsWith("/") && !lower.startsWith("//")) {
      path = d;
    } else if (sameOrigin(lower)) {
      path = d.substring(origin.length());
      if (path.isEmpty()) {
        path = "/";
      }
    } else if (lower.startsWith("http://") || lower.startsWith("https://")) {
      return Target.EXTERNAL_TARGET;
    }
    if (path != null) {
      // 이미 바꾼 공개 첨부 주소(이 토큰·범위 안 페이지)는 그대로 둔다 — 외부와 같은 취급.
      Matcher pub = PUBLIC_ATTACHMENT_PATH.matcher(path);
      if (pub.matches()
          && pub.group(1).equals(UriUtils.encodePathSegment(ctx.token, StandardCharsets.UTF_8))
          && ctx.title(parseId(pub.group(2))) != null) {
        return Target.EXTERNAL_TARGET;
      }
      Matcher a = ATTACHMENT_PATH.matcher(path);
      if (a.matches() && ctx.title(parseId(a.group(1))) != null) {
        return new Target(
            Kind.ATTACHMENT,
            "/api/v1/public/wiki/shares/"
                + UriUtils.encodePathSegment(ctx.token, StandardCharsets.UTF_8)
                + "/pages/"
                + a.group(1)
                + "/attachments/"
                + a.group(2));
      }
    }
    return Target.INTERNAL_TARGET;
  }

  /** 소문자 주소가 웹 오리진에 속하는지 — 오리진 뒤가 끝이거나 / ? # 이어야 한다(오리진을 접두로 둔 다른 호스트 배제). */
  private boolean sameOrigin(String lower) {
    if (origin.isEmpty() || !lower.startsWith(origin)) {
      return false;
    }
    if (lower.length() == origin.length()) {
      return true;
    }
    char c = lower.charAt(origin.length());
    return c == '/' || c == '?' || c == '#';
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  /** 마크다운 주소 — {@code <...>} 감싸기와 백슬래시 이스케이프를 푼다. */
  private static String mdDest(String raw) {
    String d = raw.trim();
    if (d.startsWith("<") && d.endsWith(">")) {
      d = d.substring(1, d.length() - 1);
    }
    return BACKSLASH_ESCAPE.matcher(d).replaceAll("$1");
  }

  private static String htmlDecode(String v) {
    return v.replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&");
  }

  /** 제목 → ASCII 구두점을 문자 참조로, 줄바꿈은 공백으로. */
  static String escapeTitle(String title) {
    StringBuilder b = new StringBuilder(title.length() + 16);
    title
        .codePoints()
        .forEach(
            cp -> {
              if (cp == '\n' || cp == '\r' || cp == '\t') {
                b.append(' ');
              } else if (cp < 128 && isAsciiPunct(cp)) {
                b.append("&#").append(cp).append(';');
              } else {
                b.appendCodePoint(cp);
              }
            });
    return b.toString();
  }

  private static boolean isAsciiPunct(int c) {
    return (c >= 33 && c <= 47)
        || (c >= 58 && c <= 64)
        || (c >= 91 && c <= 96)
        || (c >= 123 && c <= 126);
  }

  private static Long parseId(String s) {
    try {
      return Long.parseLong(s);
    } catch (NumberFormatException e) {
      return null; // 19자리 범위 초과 — 어떤 페이지도 아니다
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
  }

  private static String replace(String s, Pattern p, Function<Matcher, String> f) {
    Matcher m = p.matcher(s);
    StringBuilder out = new StringBuilder(s.length());
    while (m.find()) {
      m.appendReplacement(out, Matcher.quoteReplacement(f.apply(m)));
    }
    m.appendTail(out);
    return out.toString();
  }

  private record Ctx(Map<Long, String> titles, String token) {
    /** 범위 안 페이지의 제목, 범위 밖·잘못된 id(null)면 null — Map.of 처럼 null 키 조회를 거부하는 맵도 받는다. */
    String title(Long pageId) {
      return pageId == null ? null : titles.get(pageId);
    }
  }

  private enum Kind {
    EXTERNAL,
    ATTACHMENT,
    INTERNAL
  }

  private record Target(Kind kind, String url) {
    static final Target EXTERNAL_TARGET = new Target(Kind.EXTERNAL, null);
    static final Target INTERNAL_TARGET = new Target(Kind.INTERNAL, null);
  }

  /** 속성 하나를 찾는 패턴 — 앞이 낱말·{@code -} 이면 다른 이름의 일부(data-src 등)라 제외. 값은 1~3 그룹 중 하나. */
  private static Pattern attrPattern(String name) {
    return Pattern.compile(
        "(?i)(?<![\\w-])" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>\"']+))");
  }

  /** HTML 태그 속성 하나 — 값과 그 값의 위치(따옴표 안). */
  private record Attr(String value, int start, int end) {
    /** 미리 컴파일한 속성 패턴({@link #ATTR_SRC}·{@link #ATTR_HREF})으로 태그에서 첫 속성을 찾는다. */
    private static Attr find(String tag, Pattern attr) {
      Matcher m = attr.matcher(tag);
      if (!m.find()) {
        return null;
      }
      for (int g = 1; g <= 3; g++) {
        if (m.group(g) != null) {
          return new Attr(m.group(g), m.start(g), m.end(g));
        }
      }
      return null;
    }

    /** 값을 바꾼 태그 문자열(새 값은 따옴표 안에 들어가도 안전한 주소). */
    private String replaceIn(String tag, String newValue) {
      return tag.substring(0, start) + newValue + tag.substring(end);
    }
  }
}

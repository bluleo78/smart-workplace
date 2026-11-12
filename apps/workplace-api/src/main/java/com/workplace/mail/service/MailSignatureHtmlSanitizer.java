package com.workplace.mail.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.safety.Cleaner;
import org.jsoup.safety.Safelist;
import org.springframework.stereotype.Component;

/**
 * 메일 서명 HTML 정리기(WP-1517) — Outlook 에서 붙여 넣은 서명 HTML 에서 스크립트·이벤트 속성·위험한 CSS 를 지우고 글꼴·색·표·링크·이미지는
 * 남긴다. 상태가 없다.
 *
 * <p>서명은 보내는 메일 본문에 그대로 실리고 작성창·설정 화면에서 다시 그려지므로 저장 전에 서버가 한 번 정리한다. img src 는 프로토콜 검사 없이 받는다 — 어떤
 * 이미지를 남길지는 서비스의 이미지 처리(data:·외부 URL 저장, 내 서명 이미지 경로만 허용)가 정한다.
 */
@Component
public class MailSignatureHtmlSanitizer {

  /** 정확히 이 이름이면 허용하는 CSS 속성. */
  private static final Set<String> CSS_EXACT =
      Set.of(
          "color",
          "background-color",
          "line-height",
          "letter-spacing",
          "width",
          "height",
          "max-width",
          "vertical-align");

  /** 이 접두사로 시작하면 허용하는 CSS 속성(font-family·text-align·margin-left·border-top 등). */
  private static final List<String> CSS_PREFIXES =
      List.of("font-", "text-", "margin", "padding", "border");

  /** 표 계열 태그에 더하는 Outlook 서식 속성. */
  private static final String[] TABLE_ATTRS = {
    "width", "height", "align", "valign", "bgcolor", "border", "cellpadding", "cellspacing"
  };

  /**
   * 크기(width·height·max-width) 상한 — 서명은 본문 폭 안의 작은 블록이라 800px(=50em, 100%)을 넘을 이유가 없다. 넘으면 받는 쪽 화면을
   * 밀어낸다.
   */
  static final double MAX_SIZE_PX = 800;

  static final double MAX_SIZE_EM = 50;
  static final double MAX_SIZE_PERCENT = 100;

  /** 크기 CSS 속성 — 값이 {@link #SIZE_VALUE} 모양이고 상한 안일 때만 남긴다. */
  private static final Set<String> CSS_SIZE = Set.of("width", "height", "max-width");

  /** 크기 값 — auto, 0, 또는 양수 + px·%·em(pt·vw·calc() 등은 보지 않고 뺀다). */
  private static final Pattern SIZE_VALUE =
      Pattern.compile("^(?:auto|0|(\\d+(?:\\.\\d+)?|\\.\\d+)(px|%|em))$");

  /** HTML width·height 속성 값 — 정수(px) 또는 정수%. */
  private static final Pattern SIZE_ATTR = Pattern.compile("^(\\d+(?:\\.\\d+)?)(%?)$");

  /** 음수 길이 — 값 안 어디든 {@code -3px}·{@code -.5em} 처럼 빼기 부호 뒤 숫자가 오면(단어 안 하이픈 제외). */
  private static final Pattern NEGATIVE_NUMBER = Pattern.compile("(?:^|[\\s,(])-\\s*\\.?\\d");

  private final Safelist safelist = buildSafelist();

  /**
   * 허용 목록 — relaxed 에 font·style·표 서식 속성을 더하고, img src 의 프로토콜 검사를 없애고, 링크는 http·https·mailto·tel 만.
   */
  private static Safelist buildSafelist() {
    Safelist s =
        Safelist.relaxed()
            .addTags("font")
            .addAttributes("font", "color", "face", "size")
            .addAttributes(":all", "style")
            .addAttributes("img", "src", "alt", "width", "height", "style")
            .removeProtocols("img", "src", "http", "https")
            .removeProtocols("a", "href", "ftp")
            .addProtocols("a", "href", "tel");
    for (String tag : new String[] {"table", "td", "th"}) {
      s.addAttributes(tag, TABLE_ATTRS);
    }
    return s;
  }

  /**
   * HTML 을 정리해 body 요소로 돌려준다(이미지 처리 전). style 속성은 허용 CSS 선언만 남기고, 남는 게 없으면 속성을 지운다.
   *
   * @param html 붙여 넣은 서명 HTML(null 은 빈 문자열)
   */
  public Element clean(String html) {
    Document dirty = Jsoup.parseBodyFragment(html == null ? "" : html);
    Document cleaned = new Cleaner(safelist).clean(dirty);
    cleaned.outputSettings().prettyPrint(false);
    Element body = cleaned.body();
    // width·height 속성(img·표)도 style 과 같은 상한 — 속성으로 5000px 를 주면 style 상한을 비켜 간다.
    for (Element el : body.select("[width], [height]")) {
      for (String attr : new String[] {"width", "height"}) {
        if (el.hasAttr(attr) && !sizeAttrAllowed(el.attr(attr))) {
          el.removeAttr(attr);
        }
      }
    }
    for (Element el : body.select("[style]")) {
      String style = filterStyle(el.attr("style"));
      if (style.isEmpty()) {
        el.removeAttr("style");
      } else {
        el.attr("style", style);
      }
    }
    return body;
  }

  /** 정리한 body 의 안쪽 HTML(들여쓰기 없이 — {@link #clean} 이 문서의 prettyPrint 를 이미 껐다). */
  public static String toHtml(Element body) {
    return body.html();
  }

  /** 글자(공백·nbsp 제외)도 {@code <img>} 도 없으면 빈 서명이다 — 이때 서버는 html 을 '' 로 저장한다. */
  public static boolean isBlank(Element body) {
    if (!body.select("img").isEmpty()) {
      return false;
    }
    return body.text().replace(' ', ' ').isBlank();
  }

  /**
   * style 문자열에서 허용 속성 선언만 남긴다. 값에 {@code url(}·{@code expression}·{@code javascript:}·역슬래시(CSS
   * 이스케이프로 앞 검사를 피하는 것을 막는다)가 있으면 그 선언을 뺀다.
   *
   * <p>보내는 메일에 실리는 서명이 받는 쪽 화면을 망가뜨리지 않게, margin·padding·text-indent 의 음수 값(본문 위 글자를 덮거나 글자를 숨긴다)은
   * 빼고, width·height·max-width 는 px·%·em 이고 상한(800px·100%·50em) 안일 때만 남긴다.
   */
  static String filterStyle(String style) {
    List<String> kept = new ArrayList<>();
    for (String decl : style.split(";")) {
      int colon = decl.indexOf(':');
      if (colon <= 0) continue;
      String prop = decl.substring(0, colon).trim().toLowerCase(Locale.ROOT);
      String value = decl.substring(colon + 1).trim();
      if (value.isEmpty() || !allowedProperty(prop)) continue;
      String lower = value.toLowerCase(Locale.ROOT);
      if (lower.contains("url(")
          || lower.contains("expression")
          || lower.contains("javascript:")
          || lower.contains("\\")) {
        continue;
      }
      // 음수 margin·padding·text-indent 는 서명을 본문 글자 위로 끌어올리거나 글자를 화면 밖으로 숨긴다.
      if ((prop.startsWith("margin") || prop.startsWith("padding") || prop.equals("text-indent"))
          && NEGATIVE_NUMBER.matcher(lower).find()) {
        continue;
      }
      if (CSS_SIZE.contains(prop) && !sizeAllowed(lower)) {
        continue;
      }
      kept.add(prop + ":" + value);
    }
    return String.join(";", kept);
  }

  /** CSS 크기 값이 모양({@link #SIZE_VALUE})에 맞고 단위별 상한 안인가. */
  static boolean sizeAllowed(String value) {
    Matcher m = SIZE_VALUE.matcher(value.trim());
    if (!m.matches()) return false;
    if (m.group(1) == null) return true; // auto·0
    double n = Double.parseDouble(m.group(1));
    return switch (m.group(2)) {
      case "px" -> n <= MAX_SIZE_PX;
      case "%" -> n <= MAX_SIZE_PERCENT;
      default -> n <= MAX_SIZE_EM;
    };
  }

  /** HTML width·height 속성 값이 숫자(px)·숫자% 이고 상한 안인가. */
  static boolean sizeAttrAllowed(String value) {
    Matcher m = SIZE_ATTR.matcher(value.trim());
    if (!m.matches()) return false;
    double n = Double.parseDouble(m.group(1));
    return m.group(2).isEmpty() ? n <= MAX_SIZE_PX : n <= MAX_SIZE_PERCENT;
  }

  private static boolean allowedProperty(String prop) {
    if (CSS_EXACT.contains(prop)) return true;
    for (String prefix : CSS_PREFIXES) {
      if (prop.startsWith(prefix)) return true;
    }
    return false;
  }
}

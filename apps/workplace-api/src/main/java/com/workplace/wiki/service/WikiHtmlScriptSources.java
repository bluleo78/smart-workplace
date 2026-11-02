package com.workplace.wiki.service;

import com.workplace.fileai.security.HtmlScriptRules;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.wiki.dto.WikiPageKind;
import java.util.ArrayList;
import java.util.List;

/**
 * 노트의 스크립트가 든 HTML 소스와 그 지문(WP-1290 노트 HTML 보안 점검). 점검 결과는 (페이지, 지문)으로 묶이고, 공개 보기는 지금 내려보내는 내용의 지문에
 * 끝난 점검이 있을 때만 스크립트를 돌린다 — 그래서 웹({@code htmlScriptsHash})과 글자 하나까지 같은 규칙이어야 한다. 어긋나면 지문이 달라 점검이 없는
 * 것으로 보여 스크립트를 막는 쪽(fail closed)으로 틀린다.
 *
 * <ul>
 *   <li>노트(NOTE): 본문 마크다운의 HTML 블록 소스 중 스크립트가 든 것({@link HtmlScriptRules#hasScripts}).
 *   <li>HTML 문서(HTML): 원본 HTML 전체가 소스 하나(스크립트가 들었을 때).
 *   <li>지문: 소스를 문자열 자연 순서(UTF-16 코드 단위 — JS {@code Array.prototype.sort()} 와 같다)로 정렬해 {@link
 *       #SEPARATOR} 로 잇고, UTF-8 바이트의 SHA-256 소문자 16진수.
 * </ul>
 */
public final class WikiHtmlScriptSources {

  private WikiHtmlScriptSources() {}

  /** 소스 사이 구분 글자 — 웹과 같아야 한다. */
  public static final String SEPARATOR = "\n<!-- wp-html-block -->\n";

  /**
   * 스크립트가 든 HTML 소스들(문서 순서, 같은 소스도 그대로 여러 개).
   *
   * @param kind 페이지 종류(null 이면 NOTE)
   * @param markdown 노트 본문 마크다운(HTML 문서면 보지 않는다)
   * @param html HTML 문서의 원본(노트면 보지 않는다)
   */
  public static List<String> of(WikiPageKind kind, String markdown, String html) {
    List<String> kept = new ArrayList<>();
    if (kind == WikiPageKind.HTML) {
      if (HtmlScriptRules.hasScripts(html)) kept.add(html);
      return kept;
    }
    for (String source : WikiPublicMarkdownMasker.htmlEmbedSources(markdown)) {
      if (HtmlScriptRules.hasScripts(source)) kept.add(source);
    }
    return kept;
  }

  /** 정렬한 소스를 구분 글자로 이은 것 — 지문과 AI 요지({@code ScriptDigest.build})의 입력. */
  public static String joined(List<String> sources) {
    List<String> sorted = new ArrayList<>(sources);
    sorted.sort(null); // String 자연 순서 = UTF-16 코드 단위 비교(JS 기본 정렬과 같다).
    return String.join(SEPARATOR, sorted);
  }

  /** 소스들의 지문 — {@link #joined} 의 UTF-8 SHA-256 소문자 16진수(64자). */
  public static String hash(List<String> sources) {
    return sha256Hex(joined(sources));
  }

  /** 이미 이은 글자의 지문. */
  public static String sha256Hex(String joined) {
    return CapabilityTokens.sha256Hex(joined);
  }
}

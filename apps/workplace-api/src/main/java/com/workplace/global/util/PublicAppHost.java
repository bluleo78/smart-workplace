package com.workplace.global.util;

import java.net.IDN;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 공개 웹 주소({@code workplace.public-base-url})의 호스트 — 채팅 링크가 「우리 앱 주소」인지 가르는 기준(WP-1165).
 *
 * <p>서버의 OG 제외(LinkPreviewDispatcher)와 웹의 앱 카드 판정(GET /api/v1/app-links/config 로 받은 값)이 같은 값을 쓰도록
 * 한곳에서 만든다. 정규화는 웹 {@code URL.hostname} 과 같게 한다 — userinfo·포트는 버리고(기본 포트든 아니든 비교에 쓰지 않는다), 국제화 도메인은
 * punycode 로, 소문자로. 링크 쪽 호스트도 {@link #normalizeHost} 로 같게 다듬어 견준다.
 */
public final class PublicAppHost {

  // scheme://[userinfo@]host[:port]... — 앱 주소 판정과 같은 모양(http·https 만).
  private static final Pattern BASE =
      Pattern.compile(
          "^https?://(?:[^/?#@]*@)?([^/?#:]+)(?::\\d*)?(?:[/?#].*)?$", Pattern.CASE_INSENSITIVE);

  private PublicAppHost() {}

  /** 공개 웹 주소의 호스트(정규화). 비었거나 읽을 수 없는 값이면 null — 그때는 아무 주소도 우리 앱으로 보지 않는다. */
  public static String of(String publicBaseUrl) {
    String s = CapabilityTokens.normalizeBaseUrl(publicBaseUrl);
    if (s.isEmpty()) return null;
    Matcher m = BASE.matcher(s);
    return m.matches() ? normalizeHost(m.group(1)) : null;
  }

  /** 호스트 비교용 정규화 — 웹 URL.hostname 처럼 국제화 도메인은 punycode, 소문자. punycode 로 바꿀 수 없는 값은 소문자로만. */
  public static String normalizeHost(String host) {
    try {
      return IDN.toASCII(host, IDN.ALLOW_UNASSIGNED).toLowerCase(Locale.ROOT);
    } catch (IllegalArgumentException e) {
      return host.toLowerCase(Locale.ROOT);
    }
  }
}

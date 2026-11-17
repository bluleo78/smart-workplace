package com.workplace.auth.oauth.service;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * OAuth redirect_uri 규칙(WP-1685) — DCR 등록과 CIMD 문서가 같은 규칙을 쓴다. 상태가 없는 순수 함수만 둔다.
 *
 * <ul>
 *   <li>등록: 1~10개, 각 2000자 이하, 프래그먼트 없음, {@code https} 이거나 루프백 {@code http://localhost}·{@code
 *       http://127.0.0.1}·{@code http://[::1]} 만.
 *   <li>비교: 문자열이 정확히 같아야 한다. 예외는 루프백 http 하나 — RFC 8252 §7.3 대로 포트만 무시하고 나머지(scheme·host·path·
 *       query)는 정확히 같아야 한다(Claude Code 같은 네이티브 클라이언트가 실행마다 임의 포트를 연다).
 * </ul>
 */
public final class RedirectUris {

  /** 등록할 수 있는 redirect_uri 최대 개수. */
  public static final int MAX_COUNT = 10;

  /** redirect_uri 한 개의 최대 길이(자). */
  public static final int MAX_LENGTH = 2000;

  /** 루프백 http 로 인정하는 호스트 — java.net.URI#getHost 가 돌려주는 모양(IPv6 는 대괄호 포함) 그대로, 소문자만. */
  private static final Set<String> LOOPBACK_HOSTS = Set.of("localhost", "127.0.0.1", "[::1]");

  /**
   * 루프백 http 주소를 「scheme://host」·「포트」·「나머지」로 나눈다. 호스트 바로 뒤가 포트·경로·쿼리·끝이어야 해서 {@code
   * http://localhost:1@evil.example} 처럼 사용자 정보로 호스트를 속인 주소는 걸리지 않는다(그러면 정확한 비교로 떨어진다).
   */
  private static final Pattern LOOPBACK_HTTP =
      Pattern.compile("^(http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\]))(?::\\d{1,5})?([/?].*)?$");

  private RedirectUris() {}

  /**
   * 등록하려는 redirect_uri 목록을 검사한다.
   *
   * @return 문제가 있으면 그 이유(한국어, 오류 설명으로 그대로 쓴다), 없으면 빈 값
   */
  public static Optional<String> validateForRegistration(List<String> uris) {
    if (uris == null || uris.isEmpty()) {
      return Optional.of("redirect_uris 가 하나 이상 있어야 합니다.");
    }
    if (uris.size() > MAX_COUNT) {
      return Optional.of("redirect_uris 는 " + MAX_COUNT + "개까지 등록할 수 있습니다.");
    }
    for (String uri : uris) {
      Optional<String> problem = validateOne(uri);
      if (problem.isPresent()) return problem;
    }
    return Optional.empty();
  }

  /**
   * 인가 요청의 resource(RFC 8707) 형식인지 — 2000자 이하, 프래그먼트 없음, 호스트 있는 절대 주소, {@code https} 이거나 루프백
   * ({@code localhost}·{@code 127.0.0.1}·{@code [::1]}) {@code http}. 주소 하나의 규칙은 redirect_uri 등록과
   * 같지만, 목록 개수 규칙·redirect_uri 오류 문구와 묶이지 않게 따로 둔다(리뷰 D4.2).
   */
  public static boolean isValidResource(String resource) {
    return validateOne(resource).isEmpty();
  }

  /** redirect_uri 한 개 검사 — 길이·형식·프래그먼트·scheme·루프백 호스트. */
  private static Optional<String> validateOne(String uri) {
    if (uri == null || uri.isBlank()) {
      return Optional.of("빈 redirect_uri 가 있습니다.");
    }
    if (uri.length() > MAX_LENGTH) {
      return Optional.of("redirect_uri 는 " + MAX_LENGTH + "자 이하여야 합니다.");
    }
    // 프래그먼트는 URI 파싱 전에 글자로 막는다 — 인코딩되지 않은 '#' 은 어디에 있든 프래그먼트 시작이다.
    if (uri.indexOf('#') >= 0) {
      return Optional.of("redirect_uri 에 프래그먼트(#)를 넣을 수 없습니다: " + uri);
    }
    URI parsed;
    try {
      parsed = new URI(uri);
    } catch (URISyntaxException e) {
      return Optional.of("올바른 주소가 아닙니다: " + uri);
    }
    String scheme = parsed.getScheme();
    String host = parsed.getHost();
    if (!parsed.isAbsolute() || host == null || host.isEmpty()) {
      return Optional.of("호스트가 있는 절대 주소여야 합니다: " + uri);
    }
    if ("https".equals(scheme)) return Optional.empty();
    // http 는 루프백만 — 호스트 이름은 정확히(소문자) 비교해 localhost.evil.example 같은 이름을 걸러낸다. 사용자 정보로 속인 주소는
    // getHost 가 실제 호스트(evil.example)를 돌려주므로 여기서 걸린다.
    if ("http".equals(scheme) && LOOPBACK_HOSTS.contains(host)) return Optional.empty();
    return Optional.of(
        "redirect_uri 는 https 이거나 루프백(localhost·127.0.0.1·[::1]) http 여야 합니다: " + uri);
  }

  /**
   * 요청의 redirect_uri 가 등록된 값과 맞는지 — 정확히 같거나, 둘 다 루프백 http 이고 포트만 다를 때 맞다.
   *
   * @param registered 등록된 redirect_uri(이미 등록 검사를 통과한 값)
   * @param requested 인가 요청이 보낸 redirect_uri
   */
  public static boolean matches(String registered, String requested) {
    if (registered == null || requested == null) return false;
    if (registered.equals(requested)) return true;
    String a = withoutLoopbackPort(registered);
    String b = withoutLoopbackPort(requested);
    return a != null && a.equals(b);
  }

  /** 루프백 http 주소면 포트를 뺀 문자열, 아니면 null. */
  private static String withoutLoopbackPort(String uri) {
    Matcher m = LOOPBACK_HTTP.matcher(uri);
    if (!m.matches()) return null;
    return m.group(1) + (m.group(2) == null ? "" : m.group(2));
  }

  /** 주소의 호스트(동의 화면·「연결된 앱」 표시용) — 뽑지 못하면 null. */
  public static String hostOf(String uri) {
    try {
      return new URI(uri).getHost();
    } catch (URISyntaxException e) {
      return null;
    }
  }
}

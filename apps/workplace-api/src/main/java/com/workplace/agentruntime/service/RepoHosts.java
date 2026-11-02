package com.workplace.agentruntime.service;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 저장소 호스트 규칙(WP-1268) — 저장소 URL 에서 호스트만 뽑고, 토큰을 등록할 호스트 이름을 정규화·검증하는 순수 함수 모음.
 *
 * <p>호스트는 소문자 호스트 이름만(스킴·포트·경로 없음)이다. runner 가 Secret 키·Pod 파일 경로에 그대로 쓰므로 형식을 엄격히 고정한다(경로 이탈·특수문자
 * 차단).
 */
public final class RepoHosts {

  private RepoHosts() {}

  /**
   * 호스트 이름 형식 — 라벨은 영숫자로 시작·끝나고 가운데 하이픈 허용, 전체 240자 이하. 240자는 runner 의 Secret 키 {@code
   * repo-<kind>-<host>} 가 쿠버네티스 키 상한(253자)을 넘지 않게 잡은 값이다.
   */
  private static final Pattern HOST =
      Pattern.compile(
          "^(?=.{1,240}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$");

  /** {@code git@host:owner/repo} 꼴(scp 문법) — 스킴이 없고 사용자@ 가 있다. */
  private static final Pattern SCP_LIKE = Pattern.compile("^[^@/\\s]+@([^:/\\s]+):(?!//).+$");

  /**
   * 입력 호스트를 trim+소문자로 맞춰 형식을 검사한다.
   *
   * @return 정규화한 호스트, 형식이 틀리면 null
   */
  public static String normalize(String host) {
    if (host == null) return null;
    String h = host.trim().toLowerCase(Locale.ROOT);
    return HOST.matcher(h).matches() ? h : null;
  }

  /**
   * 저장소 URL 들이 필요로 하는 호스트 중 활성 토큰이 없는 것(호스트 오름차순, 중복 없음). 호스트를 읽을 수 없는 URL 은 건너뛴다.
   *
   * @param repositoryUrls 저장소 URL 들
   * @param activeHosts 토큰이 있는 호스트들
   */
  public static List<String> missing(
      Collection<String> repositoryUrls, Collection<String> activeHosts) {
    Set<String> needed = new TreeSet<>();
    for (String url : repositoryUrls) {
      String host = hostOf(url);
      if (host != null) needed.add(host);
    }
    needed.removeAll(activeHosts);
    return List.copyOf(needed);
  }

  /**
   * 저장소 URL → 호스트. {@code https://host/...}, {@code http://host/...}, {@code
   * ssh://git@host[:port]/...}, {@code git@host:owner/repo} 를 읽고 포트·사용자 정보는 버린다.
   *
   * @return 소문자 호스트, 못 읽으면 null
   */
  public static String hostOf(String url) {
    if (url == null) return null;
    String u = url.trim();
    if (u.isEmpty()) return null;
    int scheme = u.indexOf("://");
    if (scheme < 0) {
      Matcher m = SCP_LIKE.matcher(u);
      return m.matches() ? normalize(m.group(1)) : null;
    }
    String proto = u.substring(0, scheme).toLowerCase(Locale.ROOT);
    if (!proto.equals("https") && !proto.equals("http") && !proto.equals("ssh")) return null;
    String rest = u.substring(scheme + 3);
    int end = rest.length();
    for (char c : new char[] {'/', '?', '#'}) {
      int i = rest.indexOf(c);
      if (i >= 0 && i < end) end = i;
    }
    String authority = rest.substring(0, end);
    int at = authority.lastIndexOf('@');
    if (at >= 0) authority = authority.substring(at + 1);
    int colon = authority.lastIndexOf(':');
    if (colon >= 0) {
      String port = authority.substring(colon + 1);
      if (!port.matches("\\d*")) return null;
      authority = authority.substring(0, colon);
    }
    return normalize(authority);
  }
}

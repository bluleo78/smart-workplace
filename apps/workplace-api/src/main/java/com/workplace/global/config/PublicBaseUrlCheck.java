package com.workplace.global.config;

import java.net.URI;
import java.util.Locale;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * 운영(prod) 기동 시 공개 웹 주소({@code workplace.public-base-url}) 검사(WP-369).
 *
 * <p>드라이브 전송 링크는 외부 MCP 클라이언트가 이 주소로 접속한다. 값이 비었거나 localhost 면 링크가 조용히 쓸모없어지고 사용자에게만 드러나므로 경고가 아니라
 * 기동 실패로 막는다(기본값 localhost 는 local·test 전용). 빈 생성 단계에서 예외를 던져 컨텍스트 기동을 멈춘다.
 */
@Component
@Profile("prod")
public class PublicBaseUrlCheck {
  /** 외부에서 닿지 않는 루프백·와일드카드 호스트. */
  private static final Set<String> LOCAL_HOSTS =
      Set.of("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]");

  public PublicBaseUrlCheck(@Value("${workplace.public-base-url:}") String publicBaseUrl) {
    String problem = problemOf(publicBaseUrl);
    if (problem != null) {
      throw new IllegalStateException(
          "workplace.public-base-url(WEB_BASE_URL) 설정 오류: "
              + problem
              + " — 운영은 WEB_BASE_URL 에 외부에서 닿는 웹 주소(예: https://<web-host>)를 설정하세요");
    }
  }

  /**
   * 공개 주소의 문제를 설명하는 문구, 문제가 없으면 null. http/https 절대 URL 이고 호스트가 루프백이 아니어야 한다.
   *
   * <p>테스트가 prod 프로필을 띄우지 않고 규칙만 검증할 수 있게 순수 함수로 둔다.
   */
  static String problemOf(String url) {
    if (url == null || url.isBlank()) {
      return "값이 비어 있습니다";
    }
    URI uri;
    try {
      uri = URI.create(url.trim());
    } catch (IllegalArgumentException e) {
      return "올바른 URL 이 아닙니다";
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!scheme.equals("http") && !scheme.equals("https")) {
      return "http/https 주소가 아닙니다";
    }
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
    if (host.isEmpty()) {
      return "호스트가 없습니다";
    }
    if (LOCAL_HOSTS.contains(host) || host.endsWith(".localhost")) {
      return "localhost(루프백) 주소입니다";
    }
    return null;
  }
}

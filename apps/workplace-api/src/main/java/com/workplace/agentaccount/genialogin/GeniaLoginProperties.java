package com.workplace.agentaccount.genialogin;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Gen:iA 브라우저 로그인(PKCE) 설정(workplace.agent-account.genia-login, WP-1461). 누락된 값은 기본값으로 보정한다.
 *
 * @param serverUrl Gen:iA 서버 기준 주소(끝 {@code /} 제거). 운영은 GENIA_SERVER_URL 로 바꾼다
 * @param client 로그인 시작 때 서버에 알리는 클라이언트 이름
 * @param connectTimeout 연결 타임아웃
 * @param readTimeout 응답 타임아웃
 * @param caCertFile 서버가 사설 CA 인증서를 쓸 때 추가로 신뢰할 CA PEM 파일 경로(없으면 JDK 기본 신뢰만)
 */
@ConfigurationProperties("workplace.agent-account.genia-login")
public record GeniaLoginProperties(
    String serverUrl,
    String client,
    Duration connectTimeout,
    Duration readTimeout,
    String caCertFile) {

  /** 누락된 값을 기본값으로 채우고 serverUrl 끝의 슬래시를 없앤다(경로 이어 붙일 때 이중 슬래시 방지). */
  public GeniaLoginProperties {
    if (serverUrl == null || serverUrl.isBlank())
      serverUrl = "https://genia-code-server.iacloud.kr";
    while (serverUrl.endsWith("/")) serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
    if (client == null || client.isBlank()) client = "genia-works";
    if (connectTimeout == null) connectTimeout = Duration.ofSeconds(5);
    if (readTimeout == null) readTimeout = Duration.ofSeconds(10);
    if (caCertFile != null && caCertFile.isBlank()) caCertFile = null;
  }
}

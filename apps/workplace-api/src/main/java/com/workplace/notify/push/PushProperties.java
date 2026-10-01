package com.workplace.notify.push;

import java.time.Duration;
import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Web Push 설정(workplace.push). enabled=false 면 발송·키 생성을 하지 않고 config API 가 비활성으로 응답한다(폐쇄망).
 * preview=false 면 알림에 본문 대신 고정 문구를 보낸다(온프레미스 보안 요구). VAPID 키는 base64url raw(공개 65B, 개인 32B) — 비어
 * 있으면 DB 키 사용.
 */
@ConfigurationProperties("workplace.push")
public record PushProperties(
    boolean enabled,
    boolean preview,
    String subject,
    Duration timeout,
    String vapidPublicKey,
    String vapidPrivateKey) {

  /** 필수값 기본 보정 — yml 누락 시에도 안전하게 동작. */
  public PushProperties {
    if (subject == null || subject.isBlank()) subject = "mailto:admin@localhost";
    if (timeout == null) timeout = Duration.ofSeconds(5);
  }

  /**
   * VAPID 연락처(sub) 점검 — 문제가 있으면 사유, 없으면 null. Apple 푸시 서비스(web.push.apple.com)는 sub 가 localhost 류
   * 주소이면 발송을 403 으로 거부한다(FCM 은 허용해 iPhone 만 조용히 실패 — WP-152). RFC 8292 상 sub 는 mailto: 또는 https:
   * URI 여야 한다.
   */
  public String subjectProblem() {
    String domain;
    if (subject.startsWith("mailto:")) {
      domain = subject.substring(subject.lastIndexOf('@') + 1);
    } else if (subject.startsWith("https://")) {
      domain = subject.substring("https://".length()).split("[/:?#]", 2)[0];
    } else {
      return "mailto: 또는 https: 형식이 아님";
    }
    domain = domain.toLowerCase(Locale.ROOT);
    if (domain.isEmpty()
        || domain.equals("localhost")
        || domain.endsWith(".localhost")
        || domain.endsWith(".local")) {
      return "실제 도메인이 아님(" + domain + ") — Apple 푸시가 거부함";
    }
    return null;
  }

  /** env 로 키쌍이 모두 주어졌는지. */
  public boolean hasEnvKeys() {
    return vapidPublicKey != null
        && !vapidPublicKey.isBlank()
        && vapidPrivateKey != null
        && !vapidPrivateKey.isBlank();
  }
}

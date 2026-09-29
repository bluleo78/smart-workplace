package com.workplace.notify.push;

import java.time.Duration;
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

  /** env 로 키쌍이 모두 주어졌는지. */
  public boolean hasEnvKeys() {
    return vapidPublicKey != null
        && !vapidPublicKey.isBlank()
        && vapidPrivateKey != null
        && !vapidPrivateKey.isBlank();
  }
}

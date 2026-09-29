package com.workplace.notify.push;

import io.jsonwebtoken.Jwts;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * RFC 8292 VAPID Authorization 헤더 생성. 푸시 서비스는 aud(endpoint origin)·exp(≤24h)·sub(연락처)를 담은 ES256 JWT
 * 와 공개키로 발신 서버를 식별한다. exp 는 12시간으로 둔다(서비스별 24h 상한 대비 여유).
 */
@Component
public class VapidSigner {

  private static final Duration TTL = Duration.ofHours(12);
  private final Supplier<VapidKeys> keys;
  private final String subject;
  private final Clock clock;

  @Autowired
  public VapidSigner(VapidKeyProvider keys, PushProperties props) {
    this(keys, props.subject(), Clock.systemUTC());
  }

  VapidSigner(Supplier<VapidKeys> keys, String subject, Clock clock) {
    this.keys = keys;
    this.subject = subject;
    this.clock = clock;
  }

  /**
   * endpoint 에 대한 "vapid t=<jwt>, k=<공개키>" 값.
   *
   * <p>{@code single(aud)} 는 jjwt 가 "RFC 상 필수 기능이라 절대 제거하지 않지만 배열 표현을 권장하기 위해" 의도적으로
   * {@code @Deprecated} 표시만 해 둔 API 다(jjwt {@code ClaimsMutator.AudienceCollection} 주석 참고). aud 를
   * 배열이 아닌 단일 문자열로 둬야 하는 푸시 서비스(RFC 8292) 호환을 위해 그대로 사용한다.
   */
  @SuppressWarnings("deprecation")
  public String authorization(String endpoint) {
    VapidKeys k = keys.get();
    URI u = URI.create(endpoint);
    String aud = u.getScheme() + "://" + u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
    String jwt =
        Jwts.builder()
            .header()
            .add("typ", "JWT")
            .and()
            .audience()
            .single(aud)
            .expiration(Date.from(clock.instant().plus(TTL)))
            .subject(subject)
            .signWith(k.privateKey(), Jwts.SIG.ES256)
            .compact();
    return "vapid t=" + jwt + ", k=" + k.publicKeyBase64Url();
  }
}

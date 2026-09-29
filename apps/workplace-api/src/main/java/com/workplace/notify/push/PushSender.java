package com.workplace.notify.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 수신자 → 구독 조회 → 암호화 → 발송 → 결과 반영. 호출자(PushDispatcher)가 pushExecutor 스레드에서 동기 호출한다. 한 구독의 실패/예외는 로그만
 * 남기고 다른 구독 발송을 계속한다(best-effort, 재시도 큐 없음). DB 트랜잭션 없이 호출해 외부 HTTP 동안 커넥션을 잡지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PushSender {

  /** 연속 일시 실패 허용 한도 — 도달 시 구독 삭제. */
  static final int MAX_FAILURES = 5;

  private final PushProperties props;
  private final PushSubscriptionRepository subscriptions;
  private final NotificationPreferenceService preferences;
  private final WebPushEncryptor encryptor;
  private final VapidSigner signer;
  private final EndpointValidator endpointValidator;
  private final PushGateway gateway;
  private final ObjectMapper objectMapper;

  /** 사용자들에게 발송. 비활성·빈 수신자·설정 off 는 건너뛴다. */
  public void send(Collection<Long> userIds, PushMessage message) {
    if (!props.enabled() || userIds.isEmpty()) return;
    Set<Long> targets = preferences.filterEnabled(userIds, message.category());
    if (targets.isEmpty()) return;
    List<PushSubscriptionRow> subs = subscriptions.findByUserIds(targets);
    if (subs.isEmpty()) return;
    byte[] json = payload(props.preview() ? message : message.redacted());
    // 한 번의 send 안에서만 재사용하는 캐시 — 같은 푸시 서비스(FCM 등)로 가는 구독이 대부분이라 origin 별 DNS 검증과 origin(aud)별 VAPID
    // 서명을 1회로 줄인다. 전역 캐시를 두지 않는 이유: 발송 직전 재검증(DNS 재바인딩 완화)과 JWT 만료 관리를 단순하게 유지하기 위해.
    Map<String, Boolean> allowedByOrigin = new HashMap<>();
    Map<String, String> authByOrigin = new HashMap<>();
    for (PushSubscriptionRow sub : subs) {
      try {
        deliverOne(sub, json, message, allowedByOrigin, authByOrigin);
      } catch (Exception e) {
        log.warn("[push] 구독 {} 발송 중 예외: {}", sub.id(), e.getMessage());
        failed(sub);
      }
    }
  }

  /** 서비스워커 계약(v=1) JSON. */
  byte[] payload(PushMessage m) {
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("v", 1);
    p.put("tenantId", m.tenantId());
    p.put("category", m.category().name());
    p.put("title", m.title());
    p.put("body", m.body());
    p.put("url", m.url());
    p.put("tag", m.tag());
    try {
      return objectMapper.writeValueAsBytes(p);
    } catch (Exception e) {
      throw new IllegalStateException("푸시 payload 직렬화 실패", e);
    }
  }

  private void deliverOne(
      PushSubscriptionRow sub,
      byte[] json,
      PushMessage m,
      Map<String, Boolean> allowedByOrigin,
      Map<String, String> authByOrigin) {
    URI uri = parse(sub.endpoint());
    if (uri == null || !allowed(sub.endpoint(), uri, allowedByOrigin)) {
      subscriptions.deleteById(sub.id()); // 파싱 불가 또는 재해석 결과 내부 주소 — 폐기
      return;
    }
    byte[] body = encryptor.encrypt(json, EcKeys.b64d(sub.p256dh()), EcKeys.b64d(sub.auth()));
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("TTL", String.valueOf(m.ttlSeconds()));
    headers.put("Urgency", m.urgency());
    headers.put("Content-Encoding", "aes128gcm");
    headers.put("Content-Type", "application/octet-stream");
    headers.put(
        "Authorization",
        authByOrigin.computeIfAbsent(origin(uri), o -> signer.authorization(sub.endpoint())));
    int status = gateway.deliver(sub.endpoint(), body, headers);
    if (status >= 200 && status < 300) {
      subscriptions.markSuccess(sub.id());
    } else if (status == 404 || status == 410) {
      subscriptions.deleteById(sub.id()); // 만료·해지된 구독
    } else if (status == 413) {
      log.error("[push] payload 초과(413) — 구독 {} 유지, payload 크기 점검 필요", sub.id());
    } else {
      failed(sub); // 429·5xx·타임아웃(-1)·기타
    }
  }

  /** endpoint 파싱. 실패하면 null — EndpointValidator 와 같이 "허용 안 됨"으로 취급한다. */
  private static URI parse(String endpoint) {
    try {
      return URI.create(endpoint);
    } catch (RuntimeException e) {
      return null;
    }
  }

  /**
   * EndpointValidator 결과를 origin 단위로 재사용한다(DNS 조회가 비싼 부분). 검증 결과는 scheme·host 로만 정해지고 길이 제한만
   * endpoint 별이라 길이는 매번 따로 본다.
   */
  private boolean allowed(String endpoint, URI uri, Map<String, Boolean> cache) {
    if (endpoint.length() > EndpointValidator.MAX_LENGTH) return false;
    return cache.computeIfAbsent(origin(uri), k -> endpointValidator.isAllowed(endpoint));
  }

  /** VAPID aud 와 같은 기준(scheme://host[:port])의 origin — 서명 캐시 키. */
  private static String origin(URI u) {
    return u.getScheme() + "://" + u.getHost() + (u.getPort() == -1 ? "" : ":" + u.getPort());
  }

  private void failed(PushSubscriptionRow sub) {
    if (subscriptions.incrementFailure(sub.id()) >= MAX_FAILURES) {
      subscriptions.deleteById(sub.id());
    }
  }
}

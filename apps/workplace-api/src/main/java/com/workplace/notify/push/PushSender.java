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
    // 캐시 값은 Outcome 전체(단순 boolean 아님) — DNS 조회 실패(UNRESOLVED)를 BLOCKED 로 뭉개면 일시적 네트워크 문제로
    // 그 origin 의 모든 구독이 영구 삭제되는 사고가 난다.
    Map<String, EndpointValidator.Outcome> outcomeByOrigin = new HashMap<>();
    Map<String, String> authByOrigin = new HashMap<>();
    // 실패는 구독마다 찍지 않고 (host, status) 별로 모아 1줄로 남긴다 — VAPID 오류·푸시 서비스 장애는 같은 host 구독 전부에 같은 원인으로
    // 난다(WP-152).
    Map<String, Rejection> rejections = new LinkedHashMap<>();
    for (PushSubscriptionRow sub : subs) {
      try {
        deliverOne(sub, json, message, outcomeByOrigin, authByOrigin, rejections);
      } catch (Exception e) {
        log.warn("[push] 구독 {} 발송 중 예외: {}", sub.id(), e.getMessage());
        failed(sub);
      }
    }
    // endpoint 경로는 구독 토큰이라 host 만 남긴다.
    rejections.forEach(
        (key, r) ->
            log.warn(
                "[push] 발송 실패 host={} status={} count={} reason={}",
                r.host(),
                r.status(),
                r.count(),
                r.reason()));
  }

  /** 발송 1회 안의 (host, status) 별 실패 집계 — 사유는 첫 건 것만 둔다. */
  private record Rejection(String host, int status, int count, String reason) {}

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
      Map<String, EndpointValidator.Outcome> outcomeByOrigin,
      Map<String, String> authByOrigin,
      Map<String, Rejection> rejections) {
    URI uri = parse(sub.endpoint());
    if (uri == null) {
      subscriptions.deleteById(sub.id()); // 파싱 불가 — 폐기
      return;
    }
    switch (outcomeFor(sub.endpoint(), uri, outcomeByOrigin)) {
      case BLOCKED -> {
        subscriptions.deleteById(sub.id()); // 재해석 결과 내부 주소·형식 오류 — 폐기
        return;
      }
      case UNRESOLVED -> {
        failed(sub); // DNS 조회 실패 — 일시적일 수 있어 삭제 대신 발송 실패로만 집계(재시도 여지)
        return;
      }
      case ALLOWED -> {
        // 계속 진행
      }
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
    PushGateway.Result result = gateway.deliver(sub.endpoint(), body, headers);
    int status = result.status();
    if (status >= 200 && status < 300) {
      subscriptions.markSuccess(sub.id());
    } else if (status == 404 || status == 410) {
      subscriptions.deleteById(sub.id()); // 만료·해지된 구독 — 정상 정리 흐름이라 로그 없음
    } else if (status == 413) {
      log.error("[push] payload 초과(413) — 구독 {} 유지, payload 크기 점검 필요", sub.id());
    } else {
      failed(sub); // 403(VAPID 거부)·429·5xx·타임아웃(-1)·기타
      rejections.merge(
          uri.getHost() + " " + status,
          new Rejection(uri.getHost(), status, 1, result.reason()),
          (a, b) -> new Rejection(a.host(), a.status(), a.count() + 1, a.reason()));
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
  private EndpointValidator.Outcome outcomeFor(
      String endpoint, URI uri, Map<String, EndpointValidator.Outcome> cache) {
    if (endpoint.length() > EndpointValidator.MAX_LENGTH) return EndpointValidator.Outcome.BLOCKED;
    return cache.computeIfAbsent(origin(uri), k -> endpointValidator.check(endpoint));
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

package com.workplace.notify.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collection;
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
    for (PushSubscriptionRow sub : subs) {
      try {
        deliverOne(sub, json, message);
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

  private void deliverOne(PushSubscriptionRow sub, byte[] json, PushMessage m) {
    if (!endpointValidator.isAllowed(sub.endpoint())) {
      subscriptions.deleteById(sub.id()); // 재해석 결과 내부 주소 — 폐기
      return;
    }
    byte[] body = encryptor.encrypt(json, EcKeys.b64d(sub.p256dh()), EcKeys.b64d(sub.auth()));
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("TTL", String.valueOf(m.ttlSeconds()));
    headers.put("Urgency", m.urgency());
    headers.put("Content-Encoding", "aes128gcm");
    headers.put("Content-Type", "application/octet-stream");
    headers.put("Authorization", signer.authorization(sub.endpoint()));
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

  private void failed(PushSubscriptionRow sub) {
    if (subscriptions.incrementFailure(sub.id()) >= MAX_FAILURES) {
      subscriptions.deleteById(sub.id());
    }
  }
}

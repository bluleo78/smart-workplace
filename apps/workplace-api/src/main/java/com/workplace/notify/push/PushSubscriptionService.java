package com.workplace.notify.push;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 기기 구독 등록/해제. 브라우저가 준 키·endpoint 를 검증해 잘못된 값이 발송 단계까지 가지 않게 한다. */
@Service
@RequiredArgsConstructor
public class PushSubscriptionService {

  /** 사용자당 최대 구독 수 — 초과 시 오래된 것부터 삭제. */
  static final int MAX_PER_USER = 20;

  private final PushSubscriptionRepository repo;
  private final EndpointValidator endpointValidator;

  /** 구독 등록(같은 endpoint 면 소유자 이전). 검증 실패는 IllegalArgumentException(400). */
  @Transactional
  public void register(long userId, String endpoint, String p256dh, String auth, String userAgent) {
    if (!endpointValidator.isAllowed(endpoint)) {
      throw new IllegalArgumentException("허용되지 않는 푸시 endpoint 입니다");
    }
    EcKeys.decodePublic(EcKeys.b64d(p256dh)); // 65바이트 비압축점 검증(형식 오류 시 IAE)
    if (EcKeys.b64d(auth).length != 16) {
      throw new IllegalArgumentException("auth 비밀은 16바이트여야 합니다");
    }
    String ua =
        userAgent == null ? null : userAgent.substring(0, Math.min(userAgent.length(), 512));
    repo.upsert(userId, endpoint, p256dh, auth, ua);
    repo.trimToLimit(userId, MAX_PER_USER);
  }

  /** 본인 구독 해제(타인 endpoint 는 조용히 무시). */
  @Transactional
  public void unregister(long userId, String endpoint) {
    repo.deleteByUserAndEndpoint(userId, endpoint);
  }
}

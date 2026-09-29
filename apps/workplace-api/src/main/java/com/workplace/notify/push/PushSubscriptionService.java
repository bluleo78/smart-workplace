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

  /**
   * 구독 등록(같은 endpoint 면 소유자 이전). 검증 실패는 IllegalArgumentException(400).
   *
   * <p>등록 시점은 발송(PushSender)과 달리 BLOCKED(내부 주소·형식 오류)·UNRESOLVED(DNS 조회 실패) 를 구분하지 않고 모두 거부한다 — 지금
   * 검증할 수 없는 endpoint 를 일단 저장했다가 나중에 재시도할 이유가 없고(사용자가 다시 토글하면 그만), 등록은 발송처럼 대량 구독을 다루지 않아 일시 장애로 정상
   * 사용자가 피해를 볼 여지도 적다.
   */
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

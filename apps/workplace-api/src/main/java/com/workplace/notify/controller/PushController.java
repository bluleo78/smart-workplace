package com.workplace.notify.controller;

import com.workplace.notify.dto.PushConfigResponse;
import com.workplace.notify.dto.PushSubscriptionDeleteRequest;
import com.workplace.notify.dto.PushSubscriptionRequest;
import com.workplace.notify.push.NotificationPreferenceService;
import com.workplace.notify.push.PushCategory;
import com.workplace.notify.push.PushProperties;
import com.workplace.notify.push.PushSubscriptionService;
import com.workplace.notify.push.VapidKeyProvider;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Web Push API. 구독·설정은 사용자 단위 글로벌 데이터라 테넌트 미선택 토큰으로도 호출 가능하다(테넌트 선택 전 로그인 직후 재등록). 저장소를 직접 주입하지
 * 않는다(ArchUnit: 저장소 주입 컨트롤러는 @Transactional 필요) — 트랜잭션은 서비스가 연다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/push")
public class PushController {

  private final PushProperties props;
  private final VapidKeyProvider vapidKeys;
  private final PushSubscriptionService subscriptions;
  private final NotificationPreferenceService preferences;

  /** 푸시 가능 여부 + VAPID 공개키. 비활성이면 키를 만들지도 노출하지도 않는다. */
  @GetMapping("/config")
  public ResponseEntity<PushConfigResponse> config() {
    if (!props.enabled()) return ResponseEntity.ok(new PushConfigResponse(false, null));
    return ResponseEntity.ok(new PushConfigResponse(true, vapidKeys.get().publicKeyBase64Url()));
  }

  /** 이 기기 구독 등록/갱신. */
  @PostMapping("/subscriptions")
  public ResponseEntity<Void> subscribe(
      @AuthenticationPrincipal Long callerId,
      @RequestHeader(value = "User-Agent", required = false) String userAgent,
      @Valid @RequestBody PushSubscriptionRequest req) {
    subscriptions.register(
        callerId, req.endpoint(), req.keys().p256dh(), req.keys().auth(), userAgent);
    return ResponseEntity.noContent().build();
  }

  /** 이 기기 구독 해제(로그아웃·토글 off). */
  @DeleteMapping("/subscriptions")
  public ResponseEntity<Void> unsubscribe(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody PushSubscriptionDeleteRequest req) {
    subscriptions.unregister(callerId, req.endpoint());
    return ResponseEntity.noContent().build();
  }

  /** 종류별 설정 전체. */
  @GetMapping("/preferences")
  public ResponseEntity<Map<PushCategory, Boolean>> getPreferences(
      @AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(preferences.get(callerId));
  }

  /** 종류별 설정 부분 업데이트 — 알 수 없는 키는 역직렬화 단계에서 400. */
  @PutMapping("/preferences")
  public ResponseEntity<Map<PushCategory, Boolean>> updatePreferences(
      @AuthenticationPrincipal Long callerId, @RequestBody Map<PushCategory, Boolean> changes) {
    return ResponseEntity.ok(preferences.update(callerId, changes));
  }
}

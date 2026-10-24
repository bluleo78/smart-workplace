package com.workplace.notify.controller;

import com.workplace.notify.dto.NotificationSettingsResponse;
import com.workplace.notify.dto.UpdateNotificationSettingsRequest;
import com.workplace.notify.service.NotificationSettingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 앱·항목·행위자별 알림 설정 API. 설정은 사용자 단위 글로벌 데이터라 테넌트 미선택 토큰으로도 동작한다. 저장소를 직접 주입하지 않는다(ArchUnit: 저장소 주입
 * 컨트롤러는 @Transactional 필요) — 트랜잭션은 서비스가 연다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/notification-settings")
public class NotificationSettingsController {

  private final NotificationSettingService settings;

  /** 내 설정 전체(저장값 또는 기본값). */
  @GetMapping
  public ResponseEntity<NotificationSettingsResponse> get(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(settings.get(callerId));
  }

  /** 바뀐 앱 스위치·칸만 저장하고 전체를 돌려준다. 없는 칸·모르는 항목·null 값은 400. */
  @PutMapping
  public ResponseEntity<NotificationSettingsResponse> update(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody UpdateNotificationSettingsRequest req) {
    return ResponseEntity.ok(settings.update(callerId, req));
  }
}

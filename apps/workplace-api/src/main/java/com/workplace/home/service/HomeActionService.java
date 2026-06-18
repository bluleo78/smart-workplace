package com.workplace.home.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.global.security.PermissionChecker;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

/**
 * 확인 플로우 서버 실행기(B2/#333 M2). 도크 확인 카드 승인 시 actionType 으로 도메인 액션을 결정적으로 실행한다.
 *
 * <p>핵심 안전 원칙: 실행은 항상 인증된 호출자(callerId=principal, 에이전트 아님) 권한·owner 경계 안에서만. (1) actionType→필요권한
 * 맵으로 프로그램적 권한 검사(@RequirePermission 인터셉터가 동적 actionType 을 못 거므로), (2) params(JsonNode)→DTO
 * 매핑은 @Valid 바인딩 밖이라 Validator 로 명시 검증, (3) 도메인 서비스 호출.
 *
 * <p>도메인 간 직접 호출(home→calendar)은 의도적 — 이벤트로는 생성 결과를 동기 반환할 수 없다. M3 에서 디스패처가 mail/contacts 등 도메인
 * 서비스를 누적한다.
 *
 * <p>anti-tamper 토큰: 현재 사용자 권한 경계로 보호(제안이 사용자 권한을 벗어날 수 없음). M3+ 에서 서명 토큰 추가 예정.
 */
@Service
@RequiredArgsConstructor
public class HomeActionService {

  private final CalendarEventService calendarEventService;
  private final PermissionChecker permissionChecker;
  private final Validator validator;
  private final ObjectMapper objectMapper;

  /** actionType → 필요 권한 코드. M3 에서 mail.send→mail:write 등 추가. */
  private static final Map<String, String> REQUIRED_PERMISSION =
      Map.of("calendar.create_event", "calendar:write");

  /** 확인 카드 승인 실행 — 권한 검사 → 매핑·검증 → 도메인 실행. 결과 객체 반환(컨트롤러가 201). */
  public Object confirm(long callerId, String actionType, JsonNode params) {
    String required = REQUIRED_PERMISSION.get(actionType);
    if (required == null) {
      // 미지원 actionType → 400.
      throw new IllegalArgumentException("지원하지 않는 actionType: " + actionType);
    }
    if (!permissionChecker.hasPermission(callerId, required)) {
      // 권한 우회 방지 — 인터셉터 대신 프로그램적 검사.
      throw new AccessDeniedException("필요 권한 없음: " + required);
    }
    if ("calendar.create_event".equals(actionType)) {
      CalendarEventRequest req = mapAndValidate(params, CalendarEventRequest.class);
      return calendarEventService.create(callerId, req);
    }
    throw new IllegalArgumentException("지원하지 않는 actionType: " + actionType);
  }

  /** JsonNode→DTO 변환 후 bean-validation 명시 수행(@Valid 바인딩 밖이라 자동 발동 안 함). */
  private <T> T mapAndValidate(JsonNode params, Class<T> type) {
    T dto = objectMapper.convertValue(params, type);
    Set<ConstraintViolation<T>> violations = validator.validate(dto);
    if (!violations.isEmpty()) {
      throw new IllegalArgumentException(
          "잘못된 params: " + violations.iterator().next().getMessage());
    }
    return dto;
  }
}

package com.workplace.health;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 단순 헬스 엔드포인트.
 *
 * <p>Spring Actuator의 /actuator/health 외에, 외부 LB/모니터가 가볍게 호출할 수 있도록 /api/v1/health 도 함께 제공한다.
 */
@RestController
@RequestMapping("/api/v1/health")
public class HealthController {

  @GetMapping
  public Map<String, String> health() {
    return Map.of("status", "ok");
  }
}

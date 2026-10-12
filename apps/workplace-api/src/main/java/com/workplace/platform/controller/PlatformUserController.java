package com.workplace.platform.controller;

import com.workplace.platform.dto.PlatformUserLookupResponse;
import com.workplace.platform.dto.PlatformUserSearchItem;
import com.workplace.platform.service.PlatformUserService;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 운영자 콘솔 — 전역 사용자 이메일 조회.
 *
 * <p>{@code /api/platform/**} 는 SecurityConfig 에서 ROLE_PLATFORM(플랫폼 토큰)으로 게이트되므로 별도
 * {@code @RequirePermission} 은 두지 않는다.
 */
@RestController
@RequestMapping("/api/platform/users")
@RequiredArgsConstructor
public class PlatformUserController {

  private final PlatformUserService platformUserService;

  /** 이메일로 전역 사용자 존재 여부를 조회한다 — 있으면 200, 없으면 404(기존 사용자 멤버 추가 흐름의 사전 확인). */
  @GetMapping("/lookup")
  public ResponseEntity<PlatformUserLookupResponse> lookup(@RequestParam String email) {
    Optional<PlatformUserLookupResponse> found = platformUserService.lookupByEmail(email);
    return found.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
  }

  /** 이메일·이름·아이디 부분일치 자동완성 검색(WP-337) — 테넌트 생성의 소유자 선택에 쓴다. 2글자 미만이면 빈 목록. */
  @GetMapping("/search")
  public List<PlatformUserSearchItem> search(
      @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "20") int limit) {
    return platformUserService.search(q, limit);
  }
}

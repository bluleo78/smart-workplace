package com.workplace.help.controller;

import com.workplace.global.security.PermissionChecker;
import com.workplace.help.dto.HelpSectionResponse;
import com.workplace.help.exception.HelpSectionNotFoundException;
import com.workplace.help.service.HelpManualCatalog;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 매뉴얼 절 조회 API(WP-1510) — 로그인한 누구나. MCP manual 도구가 검색 결과의 id 로 절 본문을 읽는다. 관리자 전용 장의 절은 관리자 역할에게만
 * 보이고, 아니면 없는 id 와 같은 404 다(검색과 같은 판단 — permissionChecker.userHasRole(ADMIN)). 응답 links 에서도 그런 절 id
 * 는 뺀다.
 *
 * <p>id 는 경로 한 칸이다. 대체 id {@code <chapter>#<slug>} 의 {@code #} 은 호출자가 %23 으로 인코딩해
 * 보내고(encodeURIComponent), 스프링이 풀어 준다. PathPatternParser 는 {@code .} 을 확장자로 떼지 않아 {@code
 * agents.token} 도 통째로 잡힌다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/help")
public class HelpSectionController {

  private final HelpManualCatalog catalog;
  private final PermissionChecker permissionChecker;

  /** 절 하나를 돌려준다. 없거나 볼 수 없으면 404. */
  @GetMapping("/sections/{id}")
  public ResponseEntity<HelpSectionResponse> section(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") String id) {
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    return catalog
        // links 도 같은 판단·같은 목록 판으로 거른다 — 관리자 장 절 id 를 구성원에게 드러내지 않게
        .lookup(id, admin)
        .map(f -> HelpSectionResponse.from(f.entry(), f.links()))
        .map(ResponseEntity::ok)
        .orElseThrow(HelpSectionNotFoundException::new);
  }
}

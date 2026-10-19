package com.workplace.member.controller;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.security.RequirePermission;
import com.workplace.member.dto.MemberSummary;
import com.workplace.member.service.MemberDirectoryService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 구성원(현재 테넌트 멤버) 디렉터리 (#833).
 *
 * <p>계정 관리용 {@code /api/v1/users}(ADMIN 전용, user:read/user:write/role:assign)와 의도적으로 분리했다. 이쪽은 "우리
 * 워크스페이스에 누가 있는가"를 답하는 조회 전용 표면이라 {@code member:read} 로 모든 구성원에게 열려 있다. 사람 이름 → userId 를 확정하는 표준
 * 경로이며, AI 도구(search_members)도 여기를 쓴다.
 */
@RestController
@RequestMapping("/api/v1/members")
@RequirePermission("member:read")
@RequiredArgsConstructor
@Validated
public class MemberController {

  private final MemberDirectoryService service;

  /** 구성원 목록/검색. kind 로 사람(HUMAN)/AI(AGENT) 를 좁히고, includeInactive 로 비활성까지 포함한다. */
  @GetMapping
  public ResponseEntity<PageResponse<MemberSummary>> list(
      @RequestParam(value = "search", required = false) String search,
      @RequestParam(value = "kind", required = false, defaultValue = "ALL")
          @Pattern(regexp = "HUMAN|AGENT|ALL", message = "kind 는 HUMAN, AGENT, ALL 중 하나여야 합니다")
          String kind,
      @RequestParam(value = "includeInactive", required = false, defaultValue = "false")
          boolean includeInactive,
      @RequestParam(value = "page", required = false, defaultValue = "0")
          @Min(value = 0, message = "page 는 0 이상이어야 합니다")
          int page,
      // 한 번에 받는 양 상한(WP-552) — 연락처 목록과 같은 100. 웹·MCP 호출은 모두 100 이하다.
      @RequestParam(value = "size", required = false, defaultValue = "20")
          @Min(value = 1, message = "size 는 1~100 이어야 합니다")
          @Max(value = 100, message = "size 는 1~100 이어야 합니다")
          int size) {
    return ResponseEntity.ok(service.list(search, kind, includeInactive, page, size));
  }

  /** 구성원 단건. 다른 테넌트 사용자는 404 — 존재 자체를 노출하지 않는다. */
  @GetMapping("/{userId}")
  public ResponseEntity<MemberSummary> get(@PathVariable("userId") long userId) {
    return service.get(userId).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
  }
}

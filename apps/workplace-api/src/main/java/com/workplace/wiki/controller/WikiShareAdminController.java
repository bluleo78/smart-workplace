package com.workplace.wiki.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.wiki.dto.WikiShareListItemResponse;
import com.workplace.wiki.dto.WikiSharePolicy;
import com.workplace.wiki.dto.WikiShareRevokeRequest;
import com.workplace.wiki.service.WikiSharePolicyService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 공유 관리자 API(WP-579) — 설정 › 노트 공유 화면이 부른다(웹 {@code api/wiki.ts} 의
 * getSharePolicy·saveSharePolicy·listAllShares· revokeShares 와 1:1). 모두 {@code wiki_share:manage}
 * 권한이 있어야 한다(시스템 ADMIN 역할).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/admin/wiki")
@RequirePermission("wiki_share:manage")
public class WikiShareAdminController {
  private final WikiSharePolicyService policyService;

  /** 외부 공유 허용 스위치 조회. */
  @GetMapping("/share-policy")
  public ResponseEntity<WikiSharePolicy> policy() {
    return ResponseEntity.ok(new WikiSharePolicy(policyService.isExternalShareEnabled()));
  }

  /** 외부 공유 허용 스위치 저장 — 끄면 기존 외부 링크가 모두 지워진다(다시 켜도 되살아나지 않는다). */
  @PutMapping("/share-policy")
  public ResponseEntity<WikiSharePolicy> savePolicy(
      @AuthenticationPrincipal Long adminId, @Valid @RequestBody WikiSharePolicy req) {
    policyService.setExternalShareEnabled(adminId, req.externalShareEnabled());
    return ResponseEntity.ok(req);
  }

  /** 워크스페이스 전체 공유 목록(최근 변경순) — limit·offset 으로 끊어 읽는다(기본 500건). */
  @GetMapping("/shares")
  public ResponseEntity<List<WikiShareListItemResponse>> shares(
      @RequestParam(name = "limit", defaultValue = "500") int limit,
      @RequestParam(name = "offset", defaultValue = "0") int offset) {
    return ResponseEntity.ok(policyService.listAll(limit, offset));
  }

  /** 선택한 페이지의 공유 일괄 해제(204) — 공유가 없는 페이지는 건너뛴다. */
  @PostMapping("/shares/revoke")
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal Long adminId, @RequestBody WikiShareRevokeRequest req) {
    policyService.revokeShares(adminId, req.pageIds());
    return ResponseEntity.noContent().build();
  }
}

package com.workplace.auth.controller;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.dto.UserApiTokenResponse;
import com.workplace.auth.service.UserApiTokenService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 본인 PAT 관리 API. 본인 리소스이므로 @RequirePermission 없음 — 인증 principal 이 곧 소유자. */
@RestController
@RequestMapping("/api/v1/users/me/api-tokens")
@RequiredArgsConstructor
public class MyApiTokenController {
  private final UserApiTokenService service;

  /** 본인 PAT 목록 조회(회수된 것 포함, 평문/해시 미포함). */
  @GetMapping
  public List<UserApiTokenResponse> list(@AuthenticationPrincipal Long callerId) {
    return service.list(callerId);
  }

  /** 신규 PAT 발급 — 평문은 이 응답에서만 1회 노출된다. */
  @PostMapping
  public UserApiTokenIssueResponse issue(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody IssueUserTokenRequest req) {
    return service.issue(callerId, req);
  }

  /** 본인 PAT 회수 — 타인/미존재/이미 회수된 토큰은 404. */
  @DeleteMapping("/{tokenId}")
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal Long callerId, @PathVariable Long tokenId) {
    service.revoke(callerId, tokenId);
    return ResponseEntity.noContent().build();
  }
}

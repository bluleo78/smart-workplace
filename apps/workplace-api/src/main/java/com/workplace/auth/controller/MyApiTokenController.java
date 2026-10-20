package com.workplace.auth.controller;

import com.workplace.auth.dto.IssueUserTokenRequest;
import com.workplace.auth.dto.UserApiTokenIssueResponse;
import com.workplace.auth.dto.UserApiTokenResponse;
import com.workplace.auth.service.UserApiTokenService;
import com.workplace.global.security.AuthDetails;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
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
      @AuthenticationPrincipal Long callerId,
      Authentication authentication,
      @Valid @RequestBody IssueUserTokenRequest req) {
    // WP-597: 새 PAT 는 웹 로그인 세션(JWT)에서만 만든다. PAT 로 PAT 를 만들 수 있으면 원래 PAT 를 폐기해도 그 PAT 로 만든 PAT 가
    // 남아(비밀번호를 바꿔도) 유출된 토큰을 끊어 낼 수 없다. PAT·API 키·Internal 인증은 AuthDetails 가 없다.
    if (AuthDetails.methodOf(authentication) == null) {
      throw new AccessDeniedException("API 토큰은 웹 로그인 세션에서만 만들 수 있습니다");
    }
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

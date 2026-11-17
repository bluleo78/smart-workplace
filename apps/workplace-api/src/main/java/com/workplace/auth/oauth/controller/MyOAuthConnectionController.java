package com.workplace.auth.oauth.controller;

import com.workplace.auth.oauth.dto.OAuthConnectionResponse;
import com.workplace.auth.oauth.service.OAuthConnectionService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 「내 OAuth 연결」 API(WP-1685) — PAT 목록({@code MyApiTokenController})과 같은 자리·같은 인증 규칙. 본인 리소스라
 * {@code @RequirePermission} 이 없다 — 인증 principal 이 곧 소유자다.
 *
 * <p>끊기는 PAT 폐기처럼 웹 세션을 요구하지 않는다 — 권한을 넓히는 동작이 아니라 줄이는 동작이라 어떤 인증으로든 본인 연결은 끊을 수 있어야 한다.
 */
@RestController
@RequestMapping("/api/v1/users/me/oauth-connections")
@RequiredArgsConstructor
public class MyOAuthConnectionController {

  private final OAuthConnectionService service;

  /** 내 살아 있는 연결 목록(모든 워크스페이스). */
  @GetMapping
  public List<OAuthConnectionResponse> list(@AuthenticationPrincipal Long callerId) {
    return service.list(callerId);
  }

  /** 내 연결 끊기 — 연결·토큰 폐기 + 감사. 남의 것·없는 것·이미 끊긴 것은 404. */
  @DeleteMapping("/{connectionId}")
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal Long callerId, @PathVariable long connectionId) {
    service.revoke(callerId, connectionId);
    return ResponseEntity.noContent().build();
  }
}

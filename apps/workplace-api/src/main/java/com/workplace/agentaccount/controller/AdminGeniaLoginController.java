package com.workplace.agentaccount.controller;

import com.workplace.agentaccount.dto.GeniaLoginResponse;
import com.workplace.agentaccount.dto.GeniaLoginStartRequest;
import com.workplace.agentaccount.genialogin.GeniaLoginService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.security.RequireWebSession;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Gen:iA 브라우저 로그인 관리자 API(WP-1461) — 붙여 넣기 대신 브라우저 로그인으로 Gen:iA 계정을 추가하거나 다시 로그인한다. 계정 등록과 같은
 * 권한(ADMIN + user:write)이고, 키를 새로 넣는 동작이라 세 엔드포인트 모두 웹 로그인 세션만 받는다. 진행은 시작한 사람만 보고 지울 수 있다.
 */
@RestController
@RequestMapping("/api/v1/admin/agent-accounts/genia-logins")
@RequiredArgsConstructor
@RequireAdmin
@RequireWebSession
@RequirePermission("user:write")
public class AdminGeniaLoginController {

  private final GeniaLoginService service;

  /** 로그인 시작(201) — 인증 주소와 진행 id 를 돌려준다. Gen:iA 서버에 닿지 못하면 502. */
  @PostMapping
  public ResponseEntity<GeniaLoginResponse> start(
      Authentication auth, @Valid @RequestBody GeniaLoginStartRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.start((Long) auth.getPrincipal(), req));
  }

  /** 진행 상태 — 웹이 2초마다 부른다. 이 호출 안에서 간격이 됐을 때만 Gen:iA 를 폴링한다. 없음·남의 것 404. */
  @GetMapping("/{loginId}")
  public GeniaLoginResponse status(Authentication auth, @PathVariable String loginId) {
    return service.status((Long) auth.getPrincipal(), loginId);
  }

  /** 진행 취소(204) — 없어도 204(창 닫기 취소는 멱등). */
  @DeleteMapping("/{loginId}")
  public ResponseEntity<Void> cancel(Authentication auth, @PathVariable String loginId) {
    service.cancel((Long) auth.getPrincipal(), loginId);
    return ResponseEntity.noContent().build();
  }
}

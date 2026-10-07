package com.workplace.wiki.controller;

import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.CollabDocResponse;
import com.workplace.wiki.dto.StoreCollabDocRequest;
import com.workplace.wiki.outbound.CollabProperties;
import com.workplace.wiki.service.WikiCollabDocService;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 동기화 서버(workplace-collab) → API 내부 엔드포인트(WP-286). 동기화 서버는 DB 에 직접 붙지 않고 이 엔드포인트로 문서 상태를 읽고 쓴다.
 *
 * <p>인증은 기존 서비스 간 방식({@code Authorization: Internal <token>}, WorkerCallbackController 선례)을 따르고,
 * 테넌트는 {@code X-Tenant-Id} 헤더로 받아 요청 범위에 설정한다 — 마지막 접속자가 떠난 뒤의 지연 저장처럼 사용자 토큰이 없는 호출도 RLS 를 통과해야 하기
 * 때문이다. 테넌트 헤더는 내부 토큰 검증을 통과한 호출에서만 읽는다. SecurityConfig 는 /internal/** 를 permitAll 로 통과시키므로 토큰 검사는
 * 여기서 한다.
 *
 * <p>@Transactional 을 두지 않는다 — 트랜잭션이 TenantContext 설정보다 먼저 시작되면 TenantAwareTransactionManager 가 헤더의
 * 테넌트를 GUC 로 주입하지 못한다. 트랜잭션은 서비스 메서드에서 시작한다.
 */
@RestController
@RequestMapping("/internal/wiki/pages")
@RequiredArgsConstructor
public class WikiCollabInternalController {
  private static final String INTERNAL_PREFIX = "Internal ";

  private final CollabProperties props;
  private final WikiCollabDocService service;

  /** 문서 로드 — 저장된 Yjs 상태(있으면)와 현재 body·version. */
  @GetMapping("/{id}/doc")
  public ResponseEntity<CollabDocResponse> load(
      @RequestHeader(value = "Authorization", required = false) String auth,
      @RequestHeader(value = "X-Tenant-Id", required = false) String tenantId,
      @PathVariable("id") long pageId) {
    return withTenant(auth, tenantId, () -> ResponseEntity.ok(service.load(pageId)));
  }

  /**
   * 문서 저장 — 상태 원본 + 파생 body 를 버전 검사 없이 저장하고 새 version 을 돌려준다. body 없이 bodyVersion 만 오면 상태만 저장하고 현재
   * version 을 돌려준다(편집 없는 최초 이관·body 앞섬 반영 — {@link StoreCollabDocRequest}).
   */
  @PutMapping("/{id}/doc")
  public ResponseEntity<Map<String, Integer>> store(
      @RequestHeader(value = "Authorization", required = false) String auth,
      @RequestHeader(value = "X-Tenant-Id", required = false) String tenantId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody StoreCollabDocRequest req) {
    return withTenant(
        auth, tenantId, () -> ResponseEntity.ok(Map.of("version", service.store(pageId, req))));
  }

  /**
   * 내부 토큰 검증 → 테넌트 헤더 해석 → TenantContext 설정 후 실행. 순서가 의미 있다: 토큰이 틀리면 헤더 형식과 무관하게 401 이 먼저다(테넌트 헤더를
   * String 으로 받아 직접 파싱하는 이유 — Long 바인딩이면 형식 오류가 토큰 검사보다 먼저 400 이 된다).
   */
  private <T> ResponseEntity<T> withTenant(
      String auth, String tenantHeader, Supplier<ResponseEntity<T>> body) {
    if (!validToken(auth)) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
    Long tenantId = parseTenant(tenantHeader);
    if (tenantId == null) {
      return ResponseEntity.badRequest().build();
    }
    TenantContext.set(tenantId);
    try {
      return body.get();
    } finally {
      TenantContext.clear();
    }
  }

  private static Long parseTenant(String header) {
    if (header == null || header.isBlank()) {
      return null;
    }
    try {
      long id = Long.parseLong(header.trim());
      return id > 0 ? id : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /**
   * 상수 시간 비교 — JwtAuthenticationFilter·WorkerCallbackController 와 같은 방식. 토큰 미설정이면 전부
   * 거부(fail-closed).
   */
  private boolean validToken(String auth) {
    String token = props.internalToken();
    if (token == null || token.isBlank() || auth == null || !auth.startsWith(INTERNAL_PREFIX)) {
      return false;
    }
    byte[] a = auth.substring(INTERNAL_PREFIX.length()).getBytes(StandardCharsets.UTF_8);
    byte[] b = token.getBytes(StandardCharsets.UTF_8);
    return a.length == b.length && MessageDigest.isEqual(a, b);
  }
}

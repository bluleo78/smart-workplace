package com.workplace.platform.controller;

import com.workplace.platform.dto.AddExistingTenantMemberRequest;
import com.workplace.platform.dto.AddTenantMemberRequest;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.platform.dto.UpdateTenantQuotaRequest;
import com.workplace.platform.service.PlatformTenantService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 운영자 콘솔 — 테넌트 관리 엔드포인트.
 *
 * <p>{@code /api/platform/**} 는 SecurityConfig 에서 ROLE_PLATFORM(플랫폼 토큰)으로 게이트되므로 별도
 * {@code @RequirePermission} 은 두지 않는다.
 */
@RestController
@RequestMapping("/api/platform/tenants")
@RequiredArgsConstructor
public class PlatformTenantController {

  private final PlatformTenantService platformTenantService;

  /** 테넌트 생성 — 201 + 생성된 상세. */
  @PostMapping
  public ResponseEntity<TenantDetailResponse> create(@Valid @RequestBody CreateTenantRequest req) {
    TenantDetailResponse created = platformTenantService.createTenant(req);
    return ResponseEntity.status(HttpStatus.CREATED).body(created);
  }

  /** 전체 테넌트 목록. */
  @GetMapping
  public ResponseEntity<List<TenantSummaryResponse>> list() {
    return ResponseEntity.ok(platformTenantService.listTenants());
  }

  /** 테넌트 상세 — 없으면 404. */
  @GetMapping("/{id}")
  public ResponseEntity<TenantDetailResponse> get(@PathVariable Long id) {
    return ResponseEntity.ok(platformTenantService.getTenant(id));
  }

  /** 테넌트 정지(SUSPENDED). */
  @PostMapping("/{id}/suspend")
  public ResponseEntity<Void> suspend(@PathVariable Long id) {
    platformTenantService.suspend(id);
    return ResponseEntity.noContent().build();
  }

  /** 테넌트 활성화(ACTIVE). */
  @PostMapping("/{id}/activate")
  public ResponseEntity<Void> activate(@PathVariable Long id) {
    platformTenantService.activate(id);
    return ResponseEntity.noContent().build();
  }

  /** 테넌트 멤버 목록. */
  @GetMapping("/{id}/members")
  public ResponseEntity<List<TenantMemberResponse>> members(@PathVariable Long id) {
    return ResponseEntity.ok(platformTenantService.getMembers(id));
  }

  /** 테넌트에 멤버(소유자/일반) 추가 — 계정 생성 포함. 201 + 추가된 멤버(#497). */
  @PostMapping("/{id}/members")
  public ResponseEntity<TenantMemberResponse> addMember(
      @PathVariable Long id, @Valid @RequestBody AddTenantMemberRequest req) {
    TenantMemberResponse added = platformTenantService.addMember(id, req);
    return ResponseEntity.status(HttpStatus.CREATED).body(added);
  }

  /** 테넌트에 기존(전역) 사용자를 멤버로 추가 — 계정 생성 없이 membership 만 부여. 201 + 추가된 멤버. */
  @PostMapping("/{id}/members/existing")
  public ResponseEntity<TenantMemberResponse> addExistingMember(
      @PathVariable Long id, @Valid @RequestBody AddExistingTenantMemberRequest req) {
    TenantMemberResponse added = platformTenantService.addExistingMember(id, req);
    return ResponseEntity.status(HttpStatus.CREATED).body(added);
  }

  /** 테넌트 드라이브 한도 변경(플랫폼 운영자, #81). */
  @PatchMapping("/{id}/quota")
  public ResponseEntity<TenantDetailResponse> updateQuota(
      @PathVariable Long id, @Valid @RequestBody UpdateTenantQuotaRequest req) {
    return ResponseEntity.ok(platformTenantService.updateQuota(id, req.quotaBytes()));
  }
}

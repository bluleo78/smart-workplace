package com.workplace.contacts.controller;

import com.workplace.contacts.dto.ContactFacets;
import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.FavoriteRequest;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.security.RequirePermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 통합 연락처 API. 읽기는 contact:read, 쓰기는 contact:write 권한 필요. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/contacts")
@RequirePermission("contact:read")
public class ContactController {
  private final ContactService service;

  /** 멤버+외부 통합 목록/검색. type 기본 ALL, favorite 필터, 커서 페이지네이션. */
  @GetMapping
  public ResponseEntity<ContactPage> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "search", required = false) String search,
      @RequestParam(value = "type", required = false, defaultValue = "ALL") String type,
      @RequestParam(value = "favorite", required = false, defaultValue = "false") boolean favorite,
      @RequestParam(value = "organization", required = false) String organization,
      @RequestParam(value = "title", required = false) String title,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "limit", required = false, defaultValue = "0") int limit) {
    return ResponseEntity.ok(
        service.list(callerId, search, type, favorite, organization, title, cursor, limit));
  }

  /** 외부 연락처 고급 필터용 조직·직책 distinct 목록. contact:read 로 충분. */
  @GetMapping("/facets")
  public ResponseEntity<ContactFacets> facets(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.facets(callerId));
  }

  /** 멤버 상세(프로필 + 소속 그룹). */
  @GetMapping("/members/{userId}")
  public ResponseEntity<MemberDetail> member(
      @AuthenticationPrincipal Long callerId, @PathVariable("userId") long userId) {
    return ResponseEntity.ok(service.getMember(callerId, userId));
  }

  /** 외부 연락처 상세. PERSONAL 은 owner 만(아니면 404). */
  @GetMapping("/external/{id}")
  public ResponseEntity<ExternalContactDetail> external(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    return ResponseEntity.ok(service.getExternal(callerId, id));
  }

  /** 외부 연락처 생성. contact:write 필요. owner=caller. force=true 면 이름+이메일 중복 경고를 무시하고 강행 저장(#790). */
  @PostMapping("/external")
  @RequirePermission("contact:write")
  public ResponseEntity<ExternalContactDetail> createExternal(
      @AuthenticationPrincipal Long callerId,
      @Valid @RequestBody ExternalContactRequest req,
      @RequestParam(value = "force", required = false, defaultValue = "false") boolean force) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req, force));
  }

  /**
   * 외부 연락처 부분 수정(#839) — 생략 필드는 유지, 빈 문자열은 비움. owner/ADMIN 만. force 의미는 createExternal 과 동일(#790).
   */
  @PatchMapping("/external/{id}")
  @RequirePermission("contact:write")
  public ResponseEntity<ExternalContactDetail> updateExternal(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @Valid @RequestBody UpdateExternalContactRequest req,
      @RequestParam(value = "force", required = false, defaultValue = "false") boolean force) {
    return ResponseEntity.ok(service.update(callerId, id, req, force));
  }

  /** 외부 연락처 삭제. owner/ADMIN 만. */
  @DeleteMapping("/external/{id}")
  @RequirePermission("contact:write")
  public ResponseEntity<Void> deleteExternal(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }

  /** 즐겨찾기 추가 — 멱등. 인증된 owner 스코프(contact:read)면 충분. */
  @PostMapping("/favorites")
  public ResponseEntity<Void> addFavorite(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody FavoriteRequest req) {
    service.addFavorite(callerId, req);
    return ResponseEntity.noContent().build();
  }

  /** 즐겨찾기 해제 — 멱등(부재여도 204). */
  @DeleteMapping("/favorites")
  public ResponseEntity<Void> removeFavorite(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody FavoriteRequest req) {
    service.removeFavorite(callerId, req);
    return ResponseEntity.noContent().build();
  }
}

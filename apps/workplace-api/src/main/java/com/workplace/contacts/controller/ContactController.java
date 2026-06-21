package com.workplace.contacts.controller;

import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.MemberDetail;
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
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "limit", required = false, defaultValue = "0") int limit) {
    return ResponseEntity.ok(service.list(callerId, search, type, favorite, cursor, limit));
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

  /** 외부 연락처 생성. contact:write 필요. owner=caller. */
  @PostMapping("/external")
  @RequirePermission("contact:write")
  public ResponseEntity<ExternalContactDetail> createExternal(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody ExternalContactRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(callerId, req));
  }

  /** 외부 연락처 수정(전체 교체). owner/ADMIN 만. */
  @PatchMapping("/external/{id}")
  @RequirePermission("contact:write")
  public ResponseEntity<ExternalContactDetail> updateExternal(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long id,
      @Valid @RequestBody ExternalContactRequest req) {
    return ResponseEntity.ok(service.update(callerId, id, req));
  }

  /** 외부 연락처 삭제. owner/ADMIN 만. */
  @DeleteMapping("/external/{id}")
  @RequirePermission("contact:write")
  public ResponseEntity<Void> deleteExternal(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    service.delete(callerId, id);
    return ResponseEntity.noContent().build();
  }
}

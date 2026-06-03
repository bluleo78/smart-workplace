package com.workplace.contacts.controller;

import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.service.ContactService;
import com.workplace.global.security.RequirePermission;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 통합 연락처 조회 API(읽기 전용). contact:read 권한 필요(USER 기본 보유). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/contacts")
@RequirePermission("contact:read")
public class ContactController {
  private final ContactService service;

  /** 멤버+외부 통합 목록/검색. type 기본 ALL, 커서 페이지네이션. */
  @GetMapping
  public ResponseEntity<ContactPage> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "search", required = false) String search,
      @RequestParam(value = "type", required = false, defaultValue = "ALL") String type,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "limit", required = false, defaultValue = "0") int limit) {
    return ResponseEntity.ok(service.list(callerId, search, type, cursor, limit));
  }

  /** 멤버 상세(프로필 + 소속 그룹). */
  @GetMapping("/members/{userId}")
  public ResponseEntity<MemberDetail> member(
      @AuthenticationPrincipal Long callerId, @PathVariable("userId") long userId) {
    return ResponseEntity.ok(service.getMember(userId));
  }

  /** 외부 연락처 상세. PERSONAL 은 owner 만(아니면 404). */
  @GetMapping("/external/{id}")
  public ResponseEntity<ExternalContactDetail> external(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long id) {
    return ResponseEntity.ok(service.getExternal(callerId, id));
  }
}

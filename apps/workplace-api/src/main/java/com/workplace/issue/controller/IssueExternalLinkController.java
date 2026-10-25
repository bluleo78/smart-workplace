package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueExternalLinkView;
import com.workplace.issue.dto.SaveIssueExternalLinkRequest;
import com.workplace.issue.service.IssueExternalLinkService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 이슈 외부 링크 추가·수정·삭제(WP-887) — 다른 시스템 이슈를 관계·키·제목·주소로 붙인다. 권한(주소 이슈 멤버)은 서비스가 본다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/external-links")
@RequiredArgsConstructor
public class IssueExternalLinkController {

  private final IssueExternalLinkService externalLinkService;

  /** 외부 링크 붙이기 — 같은 주소·유형·방향이면 그대로 200. 응답은 이 이슈의 갱신된 외부 링크 목록. */
  @PostMapping
  @RequirePermission("issue:write")
  public ResponseEntity<List<IssueExternalLinkView>> add(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @Valid @RequestBody SaveIssueExternalLinkRequest req) {
    return ResponseEntity.ok(externalLinkService.add((Long) auth.getPrincipal(), key, number, req));
  }

  /** 외부 링크 고치기(유형·방향·키·제목 — 주소는 그대로). 응답은 갱신된 목록. */
  @PutMapping("/{linkId}")
  @RequirePermission("issue:write")
  public ResponseEntity<List<IssueExternalLinkView>> update(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long linkId,
      @Valid @RequestBody SaveIssueExternalLinkRequest req) {
    return ResponseEntity.ok(
        externalLinkService.update((Long) auth.getPrincipal(), key, number, linkId, req));
  }

  /** 외부 링크 지우기 — 없거나 이 이슈의 링크가 아니면 아무것도 하지 않고 204(멱등). */
  @DeleteMapping("/{linkId}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> remove(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable long linkId) {
    externalLinkService.remove((Long) auth.getPrincipal(), key, number, linkId);
    return ResponseEntity.noContent().build();
  }
}

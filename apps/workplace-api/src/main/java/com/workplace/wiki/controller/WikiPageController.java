package com.workplace.wiki.controller;

import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.service.WikiPageService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 위키 단건 페이지 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/pages")
public class WikiPageController {
  private final WikiPageService pageService;

  @GetMapping("/{id}")
  public ResponseEntity<WikiPageDetail> get(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(pageService.get(callerId, pageId));
  }

  /** 저장(낙관적 동시성). 충돌 시 서비스가 WikiConflictException → 409. */
  @PutMapping("/{id}")
  public ResponseEntity<WikiPageDetail> save(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody SavePageRequest req) {
    return ResponseEntity.ok(pageService.save(callerId, pageId, req));
  }

  @PatchMapping("/{id}/move")
  public ResponseEntity<Void> move(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody MovePageRequest req) {
    pageService.move(callerId, pageId, req);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    pageService.delete(callerId, pageId);
    return ResponseEntity.noContent().build();
  }
}

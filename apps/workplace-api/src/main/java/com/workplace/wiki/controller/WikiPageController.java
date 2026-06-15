package com.workplace.wiki.controller;

import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiBacklinksResponse;
import com.workplace.wiki.dto.WikiMentionRef;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.service.WikiHydrationService;
import com.workplace.wiki.service.WikiPageService;
import jakarta.validation.Valid;
import java.util.List;
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
  private final WikiHydrationService hydrationService;

  @GetMapping("/{id}")
  public ResponseEntity<WikiPageDetail> get(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(pageService.get(callerId, pageId));
  }

  /**
   * 본문 토큰(유저/페이지/이슈)을 칩 라벨·라우트 메타로 하이드레이션. get() 으로 VIEWER 가드 후 그 페이지의 현재 본문으로 해석한다. 비가시/비실존 대상은
   * 제외.
   */
  @GetMapping("/{id}/mentions")
  public ResponseEntity<List<WikiMentionRef>> mentions(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    WikiPageDetail page = pageService.get(callerId, pageId);
    return ResponseEntity.ok(hydrationService.resolveMentions(callerId, page.body()));
  }

  /** 이 페이지를 참조하는 source 페이지(백링크). get() 으로 VIEWER 가드 후 가시 source 만 반환. */
  @GetMapping("/{id}/backlinks")
  public ResponseEntity<WikiBacklinksResponse> backlinks(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    pageService.get(callerId, pageId); // VIEWER 가드(비멤버는 404)
    return ResponseEntity.ok(hydrationService.backlinks(callerId, pageId));
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

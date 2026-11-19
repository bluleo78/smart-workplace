package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiStarredIdsResponse;
import com.workplace.wiki.dto.WikiStarredPageResponse;
import com.workplace.wiki.service.WikiStarService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 페이지 「즐겨찾기」 API(WP-1765) — 넣기·빼기와 내 즐겨찾기 목록. 인증 필요, 늘 로그인한 사람 자신의 즐겨찾기만 다룬다(다른 사람 id 를 받는 인자가
 * 없다).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki")
public class WikiStarController {
  private final WikiStarService service;

  /** 즐겨찾기 넣기 → 204. 이미 있어도 204(멱등). 없거나 읽을 수 없는 노트는 같은 404. */
  @PutMapping("/pages/{pageId}/star")
  public ResponseEntity<Void> star(
      @AuthenticationPrincipal Long callerId, @PathVariable long pageId) {
    service.star(callerId, pageId);
    return ResponseEntity.noContent().build();
  }

  /** 즐겨찾기 빼기 → 204. 없어도 204(멱등 — 내 행만 지운다). */
  @DeleteMapping("/pages/{pageId}/star")
  public ResponseEntity<Void> unstar(
      @AuthenticationPrincipal Long callerId, @PathVariable long pageId) {
    service.unstar(callerId, pageId);
    return ResponseEntity.noContent().build();
  }

  /** 내 즐겨찾기 한 쪽(즐겨찾기한 순). cursor 는 이전 응답의 nextCursor, limit 은 1~50(기본 50). 깨진 cursor 는 400. */
  @GetMapping("/starred")
  public ResponseEntity<WikiStarredPageResponse> list(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "cursor", required = false) String cursor,
      @RequestParam(value = "limit", required = false) Integer limit) {
    return ResponseEntity.ok(service.list(callerId, cursor, limit));
  }

  /** 내가 즐겨찾기한 노트 id 전부(거르지 않음, 순서 무관). */
  @GetMapping("/starred/ids")
  public ResponseEntity<WikiStarredIdsResponse> ids(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(service.ids(callerId));
  }
}

package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiPageShareRequest;
import com.workplace.wiki.dto.WikiPageShareResponse;
import com.workplace.wiki.dto.WikiPageShareStateResponse;
import com.workplace.wiki.dto.WikiShareEventResponse;
import com.workplace.wiki.service.WikiShareService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 페이지 공유 설정 API(WP-579) — 공유 창이 부른다(웹 {@code api/wiki.ts} 의 공유 설정 호출과 1:1). 모두 그 페이지 스페이스의
 * EDITOR 이상이고, 공유 토큰 헤더는 받지 않는다(공유로 들어온 사람은 공유를 바꾸지 못한다).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki/pages/{id}/share")
public class WikiShareController {
  private final WikiShareService shareService;

  /** 공유 창 상태 — 이 페이지 공유(없으면 null)·외부 공유 허용·상위 공유 포함·대기 중 접근 요청. */
  @GetMapping
  public ResponseEntity<WikiPageShareStateResponse> state(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(shareService.state(callerId, pageId));
  }

  /** 공유 만들기·바꾸기 — 없으면 만들고 있으면 덮어쓴다(토큰 유지). */
  @PutMapping
  public ResponseEntity<WikiPageShareResponse> save(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @Valid @RequestBody WikiPageShareRequest req) {
    return ResponseEntity.ok(shareService.save(callerId, pageId, req));
  }

  /** 링크 다시 만들기 — 이전 링크와 그 링크로 열린 화면은 바로 막힌다. */
  @PostMapping("/regenerate")
  public ResponseEntity<WikiPageShareResponse> regenerate(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(shareService.regenerate(callerId, pageId));
  }

  /** 공유 해제(204, 멱등) — 기록은 남는다. */
  @DeleteMapping
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    shareService.revoke(callerId, pageId);
    return ResponseEntity.noContent().build();
  }

  /** 「이 페이지와 하위는 상위 공유에서 제외」 켜기(204, 멱등, WP-987). */
  @PutMapping("/exclusion")
  public ResponseEntity<Void> exclude(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    shareService.setExcluded(callerId, pageId, true);
    return ResponseEntity.noContent().build();
  }

  /** 상위 공유 제외 풀기(204, 멱등, WP-987) — 상위 공유 창의 「제외 풀기」도 이것을 부른다(하위 페이지 id 로). */
  @DeleteMapping("/exclusion")
  public ResponseEntity<Void> include(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    shareService.setExcluded(callerId, pageId, false);
    return ResponseEntity.noContent().build();
  }

  /** 공유 기록(최신순 200건). */
  @GetMapping("/events")
  public ResponseEntity<List<WikiShareEventResponse>> events(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long pageId) {
    return ResponseEntity.ok(shareService.events(callerId, pageId));
  }
}

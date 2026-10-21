package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiShareAccessRequestResult;
import com.workplace.wiki.dto.WikiShareListItemResponse;
import com.workplace.wiki.dto.WikiShareResolvedResponse;
import com.workplace.wiki.service.WikiShareAccessRequestService;
import com.workplace.wiki.service.WikiShareLinkService;
import com.workplace.wiki.service.WikiShareService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 노트 공유 링크 열기·접근 요청·공유 목록 API(WP-579) — 웹 {@code api/wiki.ts} 의 {@code resolveShare}·{@code
 * requestShareAccess}·{@code decideShareAccess}·{@code listSharedPages}·{@code listMyShares} 와 1:1.
 * 링크 열기·요청은 로그인한 워크스페이스 멤버가 부르고, 승인·거절은 그 페이지 스페이스의 EDITOR 이상이다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki")
public class WikiShareLinkController {
  private final WikiShareLinkService linkService;
  private final WikiShareAccessRequestService requestService;
  private final WikiShareService shareService;

  /** 스페이스의 공유 중인 페이지 목록 — VIEWER 이상. 토큰은 EDITOR 이상에게만 실린다. */
  @GetMapping("/spaces/{id}/shares")
  public ResponseEntity<List<WikiShareListItemResponse>> spaceShares(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(shareService.listBySpace(callerId, spaceId));
  }

  /** 내가 만든 공유(스페이스를 가로질러) — 토큰 포함. {@code /shares/{token}} 보다 구체적인 경로라 먼저 매칭된다. */
  @GetMapping("/shares/mine")
  public ResponseEntity<List<WikiShareListItemResponse>> mine(
      @AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(shareService.listMine(callerId));
  }

  /**
   * 링크 열기 — 볼 수 있는 페이지 묶음·member 플래그. 열 때마다 조회 수가 오른다. 다른 워크스페이스 링크는 409(그곳 멤버면 전환, 아니고 외부 링크면 외부
   * 보기), 지정한 사람이 아니면 403(접근 요청 가능).
   */
  @GetMapping("/shares/{token}")
  public ResponseEntity<WikiShareResolvedResponse> resolve(
      @AuthenticationPrincipal Long callerId, @PathVariable("token") String token) {
    return ResponseEntity.ok(linkService.resolve(callerId, token));
  }

  /**
   * 접근 요청 — 200 {status}: PENDING(보냄·이미 대기 중), DENIED(같은 공유에 24시간 안에 거절됨 — 새 요청·알림 없음),
   * NOT_NEEDED(요청할 필요 없음).
   */
  @PostMapping("/shares/{token}/access-requests")
  public ResponseEntity<WikiShareAccessRequestResult> request(
      @AuthenticationPrincipal Long callerId, @PathVariable("token") String token) {
    return ResponseEntity.ok(requestService.request(callerId, token));
  }

  /** 접근 요청 승인(204) — 요청자가 지정한 사람에 더해진다. */
  @PostMapping("/pages/{id}/share/access-requests/{reqId}/approve")
  public ResponseEntity<Void> approve(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @PathVariable("reqId") long requestId) {
    requestService.approve(callerId, pageId, requestId);
    return ResponseEntity.noContent().build();
  }

  /** 접근 요청 거절(204). */
  @PostMapping("/pages/{id}/share/access-requests/{reqId}/deny")
  public ResponseEntity<Void> deny(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long pageId,
      @PathVariable("reqId") long requestId) {
    requestService.deny(callerId, pageId, requestId);
    return ResponseEntity.noContent().build();
  }
}

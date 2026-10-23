package com.workplace.messaging.controller;

import com.workplace.messaging.service.LinkPreviewService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 메시지 링크 미리보기 — 보낸 사람의 지우기와 썸네일 프록시(WP-874). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging/messages/{id}/link-previews")
public class LinkPreviewController {

  private final LinkPreviewService linkPreviewService;

  /** 보낸 사람만 미리보기를 지운다. 204. 다른 사람=403, 볼 수 없는·없는 메시지=404, 보관된 채널=409. */
  @DeleteMapping
  public ResponseEntity<Void> dismiss(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long messageId) {
    linkPreviewService.dismiss(callerId, messageId);
    return ResponseEntity.noContent().build();
  }

  /**
   * 썸네일을 서버가 대신 가져와 내려준다. 읽을 수 없는 채널·없는 이미지·가져오기 실패는 모두 404. Content-Type 은 바이트로 판정한 형식이다 (nosniff
   * 는 SecurityConfig 가 모든 응답에 붙인다).
   */
  @GetMapping("/{position}/image")
  public ResponseEntity<byte[]> image(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long messageId,
      @PathVariable("position") int position) {
    return linkPreviewService
        .fetchImage(callerId, messageId, position)
        .map(
            img ->
                ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(img.contentType()))
                    .cacheControl(CacheControl.maxAge(java.time.Duration.ofDays(1)).cachePrivate())
                    .body(img.body()))
        .orElseGet(() -> ResponseEntity.notFound().build());
  }
}

package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ChannelCatchupResponse;
import com.workplace.messaging.service.ChannelCatchupService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 채널 캐치업 카드 — 진입 시 미읽음 요약. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ChannelCatchupController {
  private final ChannelCatchupService catchupService;

  /** since = 진입-고정 watermark(프론트의 lastReadMessageId). 그 이후 미읽음만 요약. */
  @GetMapping("/channels/{id}/catchup")
  public ResponseEntity<ChannelCatchupResponse> catchup(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @RequestParam("since") long since) {
    return ResponseEntity.ok(catchupService.summarize(callerId, channelId, since));
  }
}

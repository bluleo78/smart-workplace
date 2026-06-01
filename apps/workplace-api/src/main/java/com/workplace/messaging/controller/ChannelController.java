package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateChannelRequest;
import com.workplace.messaging.service.ChannelService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 채널 목록/생성/참여. Phase 1 은 공개 채널만. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ChannelController {

  private final ChannelService channelService;

  @GetMapping("/channels")
  public ResponseEntity<List<ChannelResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(channelService.list(callerId));
  }

  @PostMapping("/channels")
  public ResponseEntity<ChannelResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateChannelRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(channelService.create(callerId, req.name()));
  }

  @PostMapping("/channels/{id}/join")
  public ResponseEntity<Void> join(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.join(callerId, channelId);
    return ResponseEntity.noContent().build();
  }
}

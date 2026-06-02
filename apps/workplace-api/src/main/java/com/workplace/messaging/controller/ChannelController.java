package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.dto.CreateChannelRequest;
import com.workplace.messaging.dto.RenameChannelRequest;
import com.workplace.messaging.service.ChannelService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 채널 목록/탐색/생성/상세/관리. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class ChannelController {

  private final ChannelService channelService;

  /** 내 채널(사이드바). */
  @GetMapping("/channels")
  public ResponseEntity<List<ChannelResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(channelService.list(callerId));
  }

  /** 공개 채널 탐색. */
  @GetMapping("/channels/discover")
  public ResponseEntity<List<ChannelResponse>> discover(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "q", required = false) String q) {
    return ResponseEntity.ok(channelService.discover(callerId, q));
  }

  /** 채널 생성. */
  @PostMapping("/channels")
  public ResponseEntity<ChannelResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateChannelRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(channelService.create(callerId, req.name(), req.visibility()));
  }

  /** 채널 상세. */
  @GetMapping("/channels/{id}")
  public ResponseEntity<ChannelResponse> detail(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    return ResponseEntity.ok(channelService.getDetail(callerId, channelId));
  }

  /** 이름 변경. */
  @PatchMapping("/channels/{id}")
  public ResponseEntity<ChannelResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody RenameChannelRequest req) {
    return ResponseEntity.ok(channelService.rename(callerId, channelId, req.name()));
  }

  /** 아카이브. */
  @PostMapping("/channels/{id}/archive")
  public ResponseEntity<Void> archive(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.archive(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 아카이브 해제. */
  @PostMapping("/channels/{id}/unarchive")
  public ResponseEntity<Void> unarchive(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.unarchive(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 하드 삭제(시스템 ADMIN). */
  @DeleteMapping("/channels/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.hardDelete(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 공개 채널 참여. */
  @PostMapping("/channels/{id}/join")
  public ResponseEntity<Void> join(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    channelService.join(callerId, channelId);
    return ResponseEntity.noContent().build();
  }
}

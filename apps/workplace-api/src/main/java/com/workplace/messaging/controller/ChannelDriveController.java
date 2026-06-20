package com.workplace.messaging.controller;

import com.workplace.messaging.dto.ChannelDriveSpaceResponse;
import com.workplace.messaging.service.ChannelDriveService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 채널 연동 드라이브 공간 진입(ensure). 채널 '파일' 탭에서 호출. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging/channels/{id}")
public class ChannelDriveController {

  private final ChannelDriveService channelDrive;

  /** 연동 공간 보장(없으면 생성) 후 spaceId 반환. */
  @PostMapping("/drive-space")
  public ResponseEntity<ChannelDriveSpaceResponse> ensure(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    return ResponseEntity.ok(channelDrive.ensure(callerId, channelId));
  }
}

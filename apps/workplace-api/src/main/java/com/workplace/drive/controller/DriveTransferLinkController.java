package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveDownloadLinkResponse;
import com.workplace.drive.service.DriveTransferLinkService;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 드라이브 전송 링크 발급 API(WP-369). 인증 필요 — 발급된 링크는 인증 없이 한 번 쓸 수 있다. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveTransferLinkController {
  private final DriveTransferLinkService service;

  /** 다운로드 링크 발급(VIEWER 이상) → 201 + 10분짜리 일회용 URL(평문 토큰 포함, 이 응답에서만). */
  @PostMapping("/files/{id}/download-link")
  public ResponseEntity<DriveDownloadLinkResponse> createDownloadLink(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.issueDownloadLink(callerId, driveFileId));
  }
}

package com.workplace.drive.controller;

import com.workplace.drive.dto.CreateUploadLinkRequest;
import com.workplace.drive.dto.DriveDownloadLinkResponse;
import com.workplace.drive.dto.DriveUploadLinkResponse;
import com.workplace.drive.service.DriveTransferLinkService;
import jakarta.validation.Valid;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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

  /**
   * 업로드 링크 발급(EDITOR 이상, 폴더는 같은 공간) → 201 + 10분짜리 일회용 PUT URL(평문 토큰 포함, 이 응답에서만). {@code curl -T 파일
   * URL} 로 올린다.
   */
  @PostMapping("/spaces/{id}/upload-link")
  public ResponseEntity<DriveUploadLinkResponse> createUploadLink(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody CreateUploadLinkRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.issueUploadLink(callerId, spaceId, req));
  }

  /**
   * 기존 파일 지정 업로드 링크 발급(EDITOR 이상, 본문 없음) → 201 + 업로드 링크와 같은 응답. PUT 하면 이름으로 찾지 않고 이 파일에 새 버전을
   * 더한다(발급 뒤 이름이 바뀌어도 같은 파일). {@code maxBytes} 는 그 파일 이름 기준 범주 상한.
   */
  @PostMapping("/files/{id}/upload-link")
  public ResponseEntity<DriveUploadLinkResponse> createFileUploadLink(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.issueFileUploadLink(callerId, driveFileId));
  }
}

package com.workplace.drive.controller;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.CreatedShareLinkResponse;
import com.workplace.drive.dto.ShareLinkResponse;
import com.workplace.drive.service.DriveShareLinkService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 공유 링크 관리 API(생성/목록/폐기). 인증 필요, 생성 권한 EDITOR. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveShareLinkController {
  private final DriveShareLinkService service;

  /** 공유 링크 생성 → 201 + 평문 토큰(1회). */
  @PostMapping("/files/{id}/share-links")
  public ResponseEntity<CreatedShareLinkResponse> create(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestBody CreateShareLinkRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create(callerId, driveFileId, req));
  }

  /** 파일의 링크 목록(토큰 미포함). */
  @GetMapping("/files/{id}/share-links")
  public ResponseEntity<List<ShareLinkResponse>> list(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(service.list(callerId, driveFileId));
  }

  /** 링크 폐기 → 204. */
  @DeleteMapping("/share-links/{linkId}")
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal Long callerId, @PathVariable("linkId") long linkId) {
    service.revoke(callerId, linkId);
    return ResponseEntity.noContent().build();
  }
}

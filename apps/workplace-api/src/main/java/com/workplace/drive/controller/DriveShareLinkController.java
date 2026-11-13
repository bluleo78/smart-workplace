package com.workplace.drive.controller;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.ShareLinkResponse;
import com.workplace.drive.service.DriveShareLinkService;
import jakarta.validation.Valid;
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

  /** 공유 링크 생성 → 201 + 목록과 같은 모양의 항목(평문 토큰·만든 사람 이름·만든 시각 포함, WP-1528). */
  @PostMapping("/files/{id}/share-links")
  public ResponseEntity<ShareLinkResponse> create(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @Valid @RequestBody CreateShareLinkRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create(callerId, driveFileId, req));
  }

  /** 파일의 링크 목록(토큰·만든 사람 이름 포함, EDITOR 이상 — WP-1528). */
  @GetMapping("/files/{id}/share-links")
  public ResponseEntity<List<ShareLinkResponse>> list(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(service.list(callerId, driveFileId));
  }

  /** 폴더 공유 링크 생성 → 201(WP-1538). 파일 링크와 같은 모양. */
  @PostMapping("/folders/{id}/share-links")
  public ResponseEntity<ShareLinkResponse> createForFolder(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long folderId,
      @Valid @RequestBody CreateShareLinkRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create(callerId, new DriveShareLinkService.Target.Folder(folderId), req));
  }

  /** 폴더의 링크 목록(EDITOR 이상, WP-1538). */
  @GetMapping("/folders/{id}/share-links")
  public ResponseEntity<List<ShareLinkResponse>> listForFolder(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long folderId) {
    return ResponseEntity.ok(
        service.list(callerId, new DriveShareLinkService.Target.Folder(folderId)));
  }

  /** 링크 폐기 → 204. */
  @DeleteMapping("/share-links/{linkId}")
  public ResponseEntity<Void> revoke(
      @AuthenticationPrincipal Long callerId, @PathVariable("linkId") long linkId) {
    service.revoke(callerId, linkId);
    return ResponseEntity.noContent().build();
  }
}

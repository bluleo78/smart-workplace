package com.workplace.drive.controller;

import com.workplace.drive.dto.BacklinkResponse;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.VirtualAttachmentPage;
import com.workplace.drive.service.DriveLinkService;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 드라이브 백링크·가상 첨부 뷰·첨부 import API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveLinkController {

  private final DriveLinkService service;

  /** 파일에 연결된 소스(이슈/메시지) 중 caller 가 접근 가능한 것만 반환. */
  @GetMapping("/files/{driveFileId}/backlinks")
  public ResponseEntity<List<BacklinkResponse>> backlinks(
      @AuthenticationPrincipal Long callerId, @PathVariable long driveFileId) {
    return ResponseEntity.ok(service.backlinks(callerId, driveFileId));
  }

  /**
   * caller 가 접근 가능한 이슈/메시지의 첨부를 attachedAt DESC 병합, 커서 페이지네이션.
   *
   * @param source ALL|ISSUE|MESSAGE (기본 ALL)
   * @param cursor ISO-8601 Instant (null=최신부터)
   * @param limit 최대 항목 수 (최대 100, 기본 50)
   */
  @GetMapping("/attachments")
  public ResponseEntity<VirtualAttachmentPage> attachments(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(defaultValue = "ALL") String source,
      @RequestParam(required = false) String q,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "50") int limit) {
    return ResponseEntity.ok(
        service.virtualAttachments(callerId, source, q, cursor, Math.max(1, Math.min(limit, 100))));
  }

  /** import 요청 본문. */
  public record ImportRequest(long fileId) {}

  /** 특정 폴더에 첨부 import: 같은 file.id 를 가리키는 drive_file 생성. */
  @PostMapping("/spaces/{spaceId}/folders/{folderId}/import-attachment")
  public ResponseEntity<DriveFileResponse> importToFolder(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long spaceId,
      @PathVariable Long folderId,
      @RequestBody ImportRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.importAttachment(callerId, spaceId, folderId, req.fileId()));
  }

  /** 루트 폴더에 첨부 import (folderId 생략). */
  @PostMapping("/spaces/{spaceId}/import-attachment")
  public ResponseEntity<DriveFileResponse> importToRoot(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long spaceId,
      @RequestBody ImportRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.importAttachment(callerId, spaceId, null, req.fileId()));
  }
}

package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveTrashListResponse;
import com.workplace.drive.service.DriveTrashService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 드라이브 휴지통 API — 조회/복원/영구삭제/비우기. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveTrashController {

  private final DriveTrashService trash;

  /** 특정 스페이스의 휴지통 항목 목록을 반환한다. */
  @GetMapping("/spaces/{id}/trash")
  public ResponseEntity<DriveTrashListResponse> list(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(trash.listTrash(callerId, spaceId));
  }

  /** 휴지통의 파일을 원래 위치로 복원한다. */
  @PostMapping("/files/{id}/restore")
  public ResponseEntity<Void> restoreFile(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    trash.restoreFile(callerId, driveFileId);
    return ResponseEntity.noContent().build();
  }

  /** 휴지통의 폴더를 원래 위치로 복원한다. */
  @PostMapping("/folders/{id}/restore")
  public ResponseEntity<Void> restoreFolder(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long folderId) {
    trash.restoreFolder(callerId, folderId);
    return ResponseEntity.noContent().build();
  }

  /** 파일을 휴지통에서 영구 삭제한다. */
  @DeleteMapping("/files/{id}/purge")
  public ResponseEntity<Void> purgeFile(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    trash.purgeFile(callerId, driveFileId);
    return ResponseEntity.noContent().build();
  }

  /** 폴더를 휴지통에서 영구 삭제한다. */
  @DeleteMapping("/folders/{id}/purge")
  public ResponseEntity<Void> purgeFolder(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long folderId) {
    trash.purgeFolder(callerId, folderId);
    return ResponseEntity.noContent().build();
  }

  /** 스페이스의 휴지통을 비운다 (전체 영구 삭제). */
  @DeleteMapping("/spaces/{id}/trash")
  public ResponseEntity<Void> empty(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    trash.emptyTrash(callerId, spaceId);
    return ResponseEntity.noContent().build();
  }
}

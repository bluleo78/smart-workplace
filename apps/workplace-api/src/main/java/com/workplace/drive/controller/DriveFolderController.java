package com.workplace.drive.controller;

import com.workplace.drive.dto.CreateFolderRequest;
import com.workplace.drive.dto.DriveFolderPathSegment;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveItemListResponse;
import com.workplace.drive.dto.RenameFolderRequest;
import com.workplace.drive.dto.TargetParentRequest;
import com.workplace.drive.service.DriveFolderService;
import jakarta.validation.Valid;
import java.io.IOException;
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

/** 드라이브 폴더/항목 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveFolderController {
  private final DriveFolderService folderService;

  /** 폴더의 조상 경로(루트→대상) — breadcrumb 용. */
  @GetMapping("/folders/{id}/path")
  public ResponseEntity<List<DriveFolderPathSegment>> path(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long folderId) {
    return ResponseEntity.ok(folderService.path(callerId, folderId));
  }

  /** 한 폴더(또는 루트, parentId 미지정)의 하위 폴더+파일 목록. */
  @GetMapping("/spaces/{id}/items")
  public ResponseEntity<DriveItemListResponse> items(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestParam(value = "parentId", required = false) Long parentId) {
    return ResponseEntity.ok(folderService.listItems(callerId, spaceId, parentId));
  }

  @PostMapping("/spaces/{id}/folders")
  public ResponseEntity<DriveFolderResponse> create(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody CreateFolderRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(folderService.create(callerId, spaceId, req.parentId(), req.name()));
  }

  @PatchMapping("/folders/{id}")
  public ResponseEntity<DriveFolderResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long folderId,
      @Valid @RequestBody RenameFolderRequest req) {
    return ResponseEntity.ok(folderService.rename(callerId, folderId, req.name()));
  }

  @DeleteMapping("/folders/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long folderId) {
    folderService.delete(callerId, folderId);
    return ResponseEntity.noContent().build();
  }

  @PatchMapping("/folders/{id}/move")
  public ResponseEntity<Void> move(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long folderId,
      @RequestBody TargetParentRequest req) {
    folderService.move(callerId, folderId, req.targetParentId());
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/folders/{id}/copy")
  public ResponseEntity<DriveFolderResponse> copy(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long folderId,
      @RequestBody TargetParentRequest req)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(folderService.copy(callerId, folderId, req.targetParentId()));
  }
}

package com.workplace.drive.controller;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFileVersionResponse;
import com.workplace.drive.dto.FileSummaryResponse;
import com.workplace.drive.dto.RenameFileRequest;
import com.workplace.drive.dto.TargetFolderRequest;
import com.workplace.drive.service.DriveFileService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.fileai.dto.ExtractedTextSlice;
import jakarta.validation.Valid;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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
import org.springframework.web.multipart.MultipartFile;

/** 드라이브 파일 업로드/다운로드/이름 변경/삭제 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveFileController {
  private final DriveFileService fileService;

  @PostMapping(value = "/spaces/{id}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<DriveFileResponse> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @RequestParam(value = "folderId", required = false) Long folderId,
      @RequestParam("file") MultipartFile file)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(fileService.upload(callerId, spaceId, folderId, file));
  }

  @GetMapping("/files/{id}/download")
  public ResponseEntity<Resource> download(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    FileContentResult c = fileService.download(callerId, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(c.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(c.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  /** 인라인 미리보기 — download 와 동일 콘텐츠를 inline disposition 으로 서빙. */
  @GetMapping("/files/{id}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    FileContentResult c = fileService.download(callerId, driveFileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(c.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.inline().filename(c.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  /** 썸네일 — 없으면 404(프론트가 원본 인라인으로 폴백). */
  @GetMapping("/files/{id}/thumbnail")
  public ResponseEntity<Resource> thumbnail(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId)
      throws IOException {
    Optional<FileContentResult> opt = fileService.thumbnail(callerId, driveFileId);
    if (opt.isEmpty()) {
      return ResponseEntity.notFound().build();
    }
    FileContentResult c = opt.get();
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.IMAGE_PNG);
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  @DeleteMapping("/files/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    fileService.delete(callerId, driveFileId);
    return ResponseEntity.noContent().build();
  }

  /** 파일 이름 변경(WP-335) — 같은 폴더 동명 활성 파일이 있으면 409. */
  @PatchMapping("/files/{id}")
  public ResponseEntity<DriveFileResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @Valid @RequestBody RenameFileRequest req) {
    return ResponseEntity.ok(fileService.rename(callerId, driveFileId, req.name()));
  }

  @PatchMapping("/files/{id}/move")
  public ResponseEntity<Void> move(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestBody TargetFolderRequest req) {
    fileService.move(callerId, driveFileId, req.targetFolderId());
    return ResponseEntity.noContent().build();
  }

  /** 파일 콘텐츠 요약(#526) — 파이프라인이 저장한 요약·상태 조회. download 와 동일 게이트. */
  @GetMapping("/files/{id}/summary")
  public ResponseEntity<FileSummaryResponse> summary(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(fileService.fileSummary(callerId, driveFileId));
  }

  /**
   * 파일 추출 텍스트 구간 읽기(WP-346) — 이슈 첨부 /text 와 같은 요청·응답 형식. 에이전트가 PDF·오피스 파일을 글자로 나눠 읽는다. limit 상한
   * 32,000자(초과분은 클램프). download 와 동일 게이트.
   */
  @GetMapping("/files/{id}/text")
  public ResponseEntity<ExtractedTextSlice> readText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "32000") int limit) {
    return ResponseEntity.ok(fileService.readText(callerId, driveFileId, offset, limit));
  }

  /** 버전 이력 목록(#79). */
  @GetMapping("/files/{id}/versions")
  public ResponseEntity<java.util.List<DriveFileVersionResponse>> versions(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long driveFileId) {
    return ResponseEntity.ok(fileService.listVersions(callerId, driveFileId));
  }

  /** 특정 버전 다운로드(#79). */
  @GetMapping("/files/{id}/versions/{versionNo}/download")
  public ResponseEntity<Resource> downloadVersion(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @PathVariable("versionNo") int versionNo)
      throws IOException {
    FileContentResult c = fileService.downloadVersion(callerId, driveFileId, versionNo);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(c.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(c.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(c.size());
    return ResponseEntity.ok().headers(headers).body(c.resource());
  }

  /** 특정 버전으로 롤백(#79) — 새 버전 생성. */
  @PostMapping("/files/{id}/versions/{versionNo}/rollback")
  public ResponseEntity<DriveFileResponse> rollback(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @PathVariable("versionNo") int versionNo)
      throws IOException {
    return ResponseEntity.ok(fileService.rollback(callerId, driveFileId, versionNo));
  }

  @PostMapping("/files/{id}/copy")
  public ResponseEntity<DriveFileResponse> copy(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long driveFileId,
      @RequestBody TargetFolderRequest req)
      throws IOException {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(fileService.copy(callerId, driveFileId, req.targetFolderId()));
  }
}

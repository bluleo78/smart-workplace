package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.issue.service.IssueAttachmentStorage;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 이슈 첨부 컨트롤러 — 업로드/목록/삭제/다운로드.
 *
 * <p>다운로드는 별도 엔드포인트(/content) 로 둔다: 기존 {@code /api/v1/files/{id}/content} 는 uploader-only 라 멤버 전체에게
 * 노출되지 않기 때문.
 */
@RestController
@RequestMapping("/api/v1/projects/{key}/issues/{number}/attachments")
@RequiredArgsConstructor
public class IssueAttachmentController {

  private final IssueAttachmentService service;

  /** 다중 multipart 업로드. files 필드명 고정. */
  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @RequirePermission("issue:write")
  public ResponseEntity<List<IssueAttachmentResponse>> upload(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @RequestParam("files") List<MultipartFile> files) {
    return ResponseEntity.ok(service.upload((Long) auth.getPrincipal(), key, number, files));
  }

  /** 첨부 목록 — 멤버만. */
  @GetMapping
  @RequirePermission("project:read")
  public ResponseEntity<List<IssueAttachmentResponse>> list(
      Authentication auth, @PathVariable String key, @PathVariable int number) {
    return ResponseEntity.ok(service.list((Long) auth.getPrincipal(), key, number));
  }

  /** 단건 삭제 — 첨부자 또는 OWNER. */
  @DeleteMapping("/{fileId}")
  @RequirePermission("issue:write")
  public ResponseEntity<Void> delete(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable Long fileId) {
    service.delete((Long) auth.getPrincipal(), key, number, fileId);
    return ResponseEntity.noContent().build();
  }

  /** 다운로드 — 멤버 전체. Content-Disposition: attachment 로 파일명 유지. */
  @GetMapping("/{fileId}/content")
  @RequirePermission("project:read")
  public ResponseEntity<Resource> download(
      Authentication auth,
      @PathVariable String key,
      @PathVariable int number,
      @PathVariable Long fileId) {
    IssueAttachmentStorage.StoredFile f =
        service.download((Long) auth.getPrincipal(), key, number, fileId);

    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }
}

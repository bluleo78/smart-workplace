package com.workplace.wiki.controller;

import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentService;
import java.nio.charset.StandardCharsets;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 노트 본문 이미지 첨부 API. 인가는 서비스 레이어(WikiPermissions)가 전담한다. */
@RestController
@RequestMapping("/api/v1/wiki/pages/{pageId}/attachments")
@RequiredArgsConstructor
public class WikiAttachmentController {

  private final WikiAttachmentService service;

  @PostMapping
  public ResponseEntity<WikiAttachmentResponse> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @RequestParam("file") MultipartFile file) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.upload(callerId, pageId, file));
  }

  /**
   * 본문 &lt;img&gt; 가 직접 부르는 경로라 inline 으로 내려준다.
   *
   * <p>이슈 첨부는 attachment() 라 &lt;img&gt; 로 쓸 수 없다. 매직바이트 화이트리스트로 이미지만 통과시키고 X-Content-Type-Options:
   * nosniff 가 전역 적용(SecurityConfig)되어 있어 inline 이 안전하다.
   */
  @GetMapping("/{fileId}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable long fileId) {
    var f = service.download(callerId, pageId, fileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.inline().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }

  @DeleteMapping("/{fileId}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable long fileId) {
    service.delete(callerId, pageId, fileId);
    return ResponseEntity.noContent().build();
  }
}

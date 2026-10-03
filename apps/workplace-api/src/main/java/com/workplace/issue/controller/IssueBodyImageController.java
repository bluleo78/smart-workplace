package com.workplace.issue.controller;

import com.workplace.global.security.RequirePermission;
import com.workplace.issue.dto.IssueBodyImageResponse;
import com.workplace.issue.service.IssueBodyImageService;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** 이슈 본문 이미지 API(WP-199). 프로젝트 단위 인가(생성 가능자)는 서비스가 전담하고, 전역 권한은 이슈 첨부 업로드와 같은 issue:write 를 쓴다. */
@RestController
@RequestMapping("/api/v1/projects/{key}/issue-images")
@RequiredArgsConstructor
public class IssueBodyImageController {

  private final IssueBodyImageService service;

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @RequirePermission("issue:write")
  public ResponseEntity<IssueBodyImageResponse> upload(
      @AuthenticationPrincipal Long callerId,
      @PathVariable String key,
      @RequestParam("file") MultipartFile file) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.upload(callerId, key, file));
  }

  /**
   * 본문 <img> 용이라 inline 으로 내려준다. 매직바이트 화이트리스트로 이미지만 저장되고 nosniff 는 SecurityConfig 가 전역 적용한다. 로그인
   * 토큰이 Bearer 라 브라우저 <img> 는 직접 못 부르고 프론트가 axios blob 으로 받는다.
   */
  @GetMapping("/{fileId}")
  @RequirePermission("project:read")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId, @PathVariable String key, @PathVariable long fileId) {
    var f = service.load(callerId, key, fileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.inline().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    headers.setCacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePrivate());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }
}

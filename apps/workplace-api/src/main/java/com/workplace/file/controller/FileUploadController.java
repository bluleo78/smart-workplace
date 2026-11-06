package com.workplace.file.controller;

import com.workplace.file.dto.FileUploadResponse;
import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.FileUploadService.FileContentResult;
import com.workplace.file.service.MimeNormalizer;
import com.workplace.global.security.RequirePermission;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/files")
@RequiredArgsConstructor
public class FileUploadController {

  private final FileUploadService fileUploadService;

  @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @RequirePermission("ai:write")
  public ResponseEntity<List<FileUploadResponse>> uploadFiles(
      @RequestParam("files") List<MultipartFile> files, Authentication authentication)
      throws IOException {
    Long userId = (Long) authentication.getPrincipal();
    List<FileUploadResponse> responses = fileUploadService.uploadFiles(files, userId);
    return ResponseEntity.ok(responses);
  }

  @GetMapping("/{fileId}")
  @RequirePermission("ai:write")
  public ResponseEntity<FileUploadResponse> getFileInfo(
      @PathVariable Long fileId, Authentication authentication) {
    Long userId = (Long) authentication.getPrincipal();
    FileUploadResponse response = fileUploadService.getFileInfo(fileId, userId);
    return ResponseEntity.ok(response);
  }

  /**
   * 파일 콘텐츠 다운로드. OOM 방지를 위해 byte[] 대신 Resource(스트리밍)로 응답한다. Spring의 ResourceHttpMessageConverter가
   * 청크 단위로 전송하므로 대용량 파일(최대 256MB)도 힙 메모리를 과소비하지 않는다.
   */
  @GetMapping("/{fileId}/content")
  public ResponseEntity<Resource> getFileContent(
      @PathVariable Long fileId, Authentication authentication) throws IOException {
    Long userId = (Long) authentication.getPrincipal();
    FileContentResult result = fileUploadService.getFileContent(fileId, userId);

    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(result.mimeType()));
    // WP-1406: 이미지 4종만 inline, 그 외(html·svg 등)는 attachment 로 내려 API 출처에서 렌더되지 않게 한다.
    ContentDisposition.Builder disposition =
        MimeNormalizer.INLINE_CONTENT_MIMES.contains(result.mimeType())
            ? ContentDisposition.inline()
            : ContentDisposition.attachment();
    headers.setContentDisposition(
        disposition.filename(result.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(result.size());
    // WP-1323: 드라이브 파일 원본도 이 경로로 읽을 수 있다 — AI 가 만든 text/html·svg 가 이 출처로 실행되지 않게 샌드박스.
    headers.set("Content-Security-Policy", "sandbox");

    return ResponseEntity.ok().headers(headers).body(result.resource());
  }
}

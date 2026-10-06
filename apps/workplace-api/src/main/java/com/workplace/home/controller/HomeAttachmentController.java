package com.workplace.home.controller;

import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.home.dto.HomeAttachment;
import com.workplace.home.dto.HomeUploadedFile;
import com.workplace.home.service.HomeAttachmentService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 메인 AI 채팅 첨부(WP-234) — 선업로드와 세션 첨부 조회·읽기. 웹과 ai-agent(Internal + X-On-Behalf-Of 사용자 대행)가 같은 엔드포인트를
 * 쓴다. 권한은 서비스가 세션 소유자로 판정하므로 @RequirePermission 을 쓰지 않는다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/home")
public class HomeAttachmentController {

  private final HomeAttachmentService service;

  /** 선업로드 — fileId 메타 목록. files 파트가 없으면 서비스가 한국어 400 을 낸다(스프링 기본 오류 대신). */
  @PostMapping(value = "/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public List<HomeUploadedFile> upload(
      @AuthenticationPrincipal Long callerId,
      @RequestParam(value = "files", required = false) List<MultipartFile> files) {
    return service.upload(callerId, files);
  }

  /**
   * inline 으로 내려줄 mime — 웹 썸네일·ai-agent 이미지 블록이 쓰는 4종. 그 외(특히 사용자가 올린 HTML·SVG)는 attachment 로 내려
   * API 출처에서 렌더되지 않게 한다(CONTRACT NOTE 1).
   */
  private static final Set<String> INLINE_MIMES =
      Set.of("image/jpeg", "image/png", "image/gif", "image/webp");

  /** 세션 첨부 목록 — 요약 경계 이전 메시지의 첨부까지 메시지·파일 순. */
  @GetMapping("/sessions/{sid}/attachments")
  public List<HomeAttachment> list(@AuthenticationPrincipal Long callerId, @PathVariable UUID sid) {
    return service.list(callerId, sid);
  }

  /** 첨부 추출 텍스트 구간 읽기. limit 기본 12000(ai-agent 도구 기본과 같음), 상한 32000. */
  @GetMapping("/sessions/{sid}/attachments/{fileId}/text")
  public ExtractedTextSlice text(
      @AuthenticationPrincipal Long callerId,
      @PathVariable UUID sid,
      @PathVariable long fileId,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "12000") int limit) {
    // 상한 32000 — 과대 요청은 에러 대신 상한으로 줄인다(음수·0 은 서비스가 400).
    return service.readText(callerId, sid, fileId, offset, Math.min(limit, MAX_TEXT_LIMIT));
  }

  /** 구간 읽기 limit 상한. */
  private static final int MAX_TEXT_LIMIT = 32000;

  /** 원본 스트리밍 — Content-Type 은 저장된 mime, 이미지 4종만 inline. */
  @GetMapping("/sessions/{sid}/attachments/{fileId}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId, @PathVariable UUID sid, @PathVariable long fileId) {
    var f = service.content(callerId, sid, fileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(mediaTypeOf(f.mimeType()));
    ContentDisposition.Builder disposition =
        INLINE_MIMES.contains(f.mimeType())
            ? ContentDisposition.inline()
            : ContentDisposition.attachment();
    headers.setContentDisposition(
        disposition.filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }

  /** 저장된 mime 이 파싱되지 않으면 octet-stream — 500 대신 내려받기로 처리. */
  private static MediaType mediaTypeOf(String mime) {
    try {
      return MediaType.parseMediaType(mime);
    } catch (InvalidMediaTypeException e) {
      return MediaType.APPLICATION_OCTET_STREAM;
    }
  }
}

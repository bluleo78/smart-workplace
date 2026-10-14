package com.workplace.wiki.controller;

import com.workplace.fileai.controller.ViewImageResponses;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.service.AttachmentViewService;
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

  private final AttachmentViewService attachmentView;

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

  /**
   * 첨부 추출 텍스트 구간 읽기(WP-358) — 이슈 첨부 /text 와 같은 응답({@link ExtractedTextSlice}). limit 상한 32,000자(초과는
   * 클램프). 권한은 /content 와 같다(VIEWER 이상, 비멤버·미바인딩은 404).
   */
  @GetMapping("/{fileId}/text")
  public ResponseEntity<ExtractedTextSlice> readText(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable long fileId,
      @RequestParam(defaultValue = "0") int offset,
      @RequestParam(defaultValue = "32000") int limit) {
    return ResponseEntity.ok(service.readText(callerId, pageId, fileId, offset, limit));
  }

  /** 첨부를 모델 입력용 이미지로 보여 준다(WP-250) — 규칙·권한·트랜잭션(R5)은 {@link AttachmentViewService} 참조. */
  @GetMapping("/{fileId}/view")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable long fileId,
      @RequestParam(required = false) Integer page) {
    return ViewImageResponses.of(
        attachmentView.view(service.resolveViewFileId(callerId, pageId, fileId), page));
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

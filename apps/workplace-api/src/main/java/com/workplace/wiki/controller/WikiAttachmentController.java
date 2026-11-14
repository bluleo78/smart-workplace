package com.workplace.wiki.controller;

import com.workplace.fileai.controller.ViewImageResponses;
import com.workplace.fileai.dto.ExtractedTextSlice;
import com.workplace.fileai.service.AttachmentViewService;
import com.workplace.wiki.dto.ClaimWikiImagesRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiShareAccess;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 노트 본문 첨부 API(이미지·파일, WP-1545). 인가는 서비스 레이어(WikiPermissions·WikiShareAccess)가 전담한다.
 *
 * <p>공유 링크(WP-579): 업로드·클레임·content·text·view 는 {@link WikiShareAccess#HEADER} 를 받는다(보기는 VIEWER,
 * 붙여넣기는 편집 링크). 삭제는 받지 않는다.
 */
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
      @RequestParam("file") MultipartFile file,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.upload(callerId, pageId, file, shareToken));
  }

  /**
   * 스테이징 이미지 클레임(WP-424) — 먼저 올려 둔 파일(POST /staged-files/…)의 fileIds 를 이 페이지의 첨부로 묶는다.
   * 권한(EDITOR)·한도는 업로드와 같고, 응답의 url 을 본문에 쓰면 저장 때 영구화된다.
   */
  @PostMapping("/claim")
  public ResponseEntity<List<WikiAttachmentResponse>> claim(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @Valid @RequestBody ClaimWikiImagesRequest req,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.ok(service.claimStaged(callerId, pageId, req.fileIds(), shareToken));
  }

  /**
   * 첨부 원본 — 본문 &lt;img&gt; 가 직접 부르는 경로라 바이트로 판정된 이미지는 inline, 그 밖(PDF·로그 등, WP-1545)은 attachment 로
   * 내려준다. 머리글 규칙은 {@link WikiAttachmentHeaders} — 외부 공유 경로와 같다.
   */
  @GetMapping("/{fileId}/content")
  public ResponseEntity<Resource> content(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable long fileId,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    var f = service.download(callerId, pageId, fileId, shareToken);
    return ResponseEntity.ok()
        .headers(WikiAttachmentHeaders.of(f))
        .body(new FileSystemResource(f.path()));
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
      @RequestParam(defaultValue = "32000") int limit,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ResponseEntity.ok(service.readText(callerId, pageId, fileId, offset, limit, shareToken));
  }

  /**
   * 첨부를 모델 입력용 이미지로 보여 준다(WP-250) — 규칙·권한·트랜잭션(R5)은 {@link AttachmentViewService} 참조. 이미지·PDF(쪽
   * 지정)만 그리고, 그 밖의 첨부(WP-1545)는 같은 서비스가 한국어 안내와 함께 4xx(UNSUPPORTED 등)로 거절한다.
   */
  @GetMapping("/{fileId}/view")
  public ResponseEntity<byte[]> view(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long pageId,
      @PathVariable long fileId,
      @RequestParam(required = false) Integer page,
      @RequestHeader(value = WikiShareAccess.HEADER, required = false) String shareToken) {
    return ViewImageResponses.of(
        attachmentView.view(service.resolveViewFileId(callerId, pageId, fileId, shareToken), page));
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

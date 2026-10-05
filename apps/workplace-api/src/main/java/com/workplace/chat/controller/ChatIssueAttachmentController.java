package com.workplace.chat.controller;

import com.workplace.chat.service.ChatIssueAttachmentService;
import com.workplace.issue.dto.IssueAttachmentResponse;
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
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 이슈 챗 스레드 경유 이슈 첨부 조회(WP-244). 스레드 열람 권한으로 그 스레드가 딸린 이슈의 첨부 목록·원본을 준다 — 이슈 챗에 멘션된 AGENT 처럼 프로젝트
 * 멤버가 아닌 스레드 멤버도 대화가 다루는 이슈의 첨부를 읽을 수 있게 하되, 기존 이슈 첨부 API 의 권한은 건드리지 않는다.
 *
 * <p>추출 텍스트는 별도 경로 없이 기존 {@code GET /threads/{id}/attachments/{fileId}/text} 가 이슈 첨부 fileId 도 받는다.
 * 권한 판정은 서비스가 하므로 @RequirePermission 미사용(ChatMessageAttachmentController 와 같은 방식).
 */
@RestController
@RequestMapping("/api/v1/chat/threads/{id}/issue-attachments")
@RequiredArgsConstructor
public class ChatIssueAttachmentController {

  private final ChatIssueAttachmentService service;

  /** 스레드가 딸린 이슈의 첨부 목록(추출 상태 포함). 항목 형태는 이슈 첨부 목록 API 와 같다. */
  @GetMapping
  public ResponseEntity<List<IssueAttachmentResponse>> list(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long threadId) {
    return ResponseEntity.ok(service.list(callerId, threadId));
  }

  /** 스레드가 딸린 이슈의 첨부 다운로드. 그 이슈의 첨부가 아니면 404. */
  @GetMapping("/{fileId}/content")
  public ResponseEntity<Resource> download(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long threadId,
      @PathVariable long fileId) {
    IssueAttachmentStorage.StoredFile f = service.download(callerId, threadId, fileId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(f.mimeType()));
    headers.setContentDisposition(
        ContentDisposition.attachment().filename(f.originalName(), StandardCharsets.UTF_8).build());
    headers.setContentLength(f.sizeBytes());
    return ResponseEntity.ok().headers(headers).body(new FileSystemResource(f.path()));
  }
}

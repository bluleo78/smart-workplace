package com.workplace.mail.controller;

import com.workplace.mail.dto.ComposeAttachmentResponse;
import com.workplace.mail.dto.MailSendRequest;
import com.workplace.mail.dto.SendResult;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailComposeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * 메일 작성+발송 REST. 새 메일·답장·전달 공용 단일 엔드포인트. @AuthenticationPrincipal callerId(=본인) 스코프 — 본인 소유 계정으로만
 * 발송(아니면 404).
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail")
public class MailComposeController {

  private final MailComposeService composeService;
  private final MailComposeAttachmentService attachmentService;

  /**
   * 작성 첨부 임시 업로드(WP-574) → 201 + {id, name, size, mimeType, expiresAt}. 발송 때 id 를 attachmentIds 로
   * 넘긴다. 파일 하나 25MB 까지, 24시간 안에 보내지 않으면 지워진다. 본인만 쓸 수 있다(업로더 = 호출자).
   */
  @PostMapping(value = "/compose-attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ResponseEntity<ComposeAttachmentResponse> uploadAttachment(
      @AuthenticationPrincipal Long callerId, @RequestParam("file") MultipartFile file) {
    return ResponseEntity.status(HttpStatus.CREATED).body(attachmentService.upload(callerId, file));
  }

  /** 메일 발송. inReplyToMessageId 가 있으면 답장으로 스레드 상속. */
  @PostMapping("/accounts/{accountId}/send")
  public SendResult send(
      @AuthenticationPrincipal Long callerId,
      @PathVariable long accountId,
      @RequestBody MailSendRequest request) {
    return composeService.send(callerId, accountId, request);
  }
}

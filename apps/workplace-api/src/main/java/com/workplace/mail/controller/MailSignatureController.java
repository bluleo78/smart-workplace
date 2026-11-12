package com.workplace.mail.controller;

import com.workplace.mail.dto.MailSignatureResponse;
import com.workplace.mail.dto.MailSignatureUpdateRequest;
import com.workplace.mail.dto.SignatureImageStageRequest;
import com.workplace.mail.dto.SignatureImageStaged;
import com.workplace.mail.service.MailSignatureService;
import com.workplace.mail.service.MailSignatureService.ImageContent;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 메일 서명 REST(WP-1517). 서명은 사용자당 하나이고 본인 것만 다룬다(@AuthenticationPrincipal callerId). 설정 › 메일 계정의
 * 「서명」 카드와 작성창이 쓴다.
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/mail/signature")
public class MailSignatureController {

  private final MailSignatureService signatureService;

  /** 내 서명. 아직 없으면 빈 서명과 기본 스위치(새 메일 켬, 답장·전달 끔). */
  @GetMapping
  public MailSignatureResponse get(@AuthenticationPrincipal Long callerId) {
    return signatureService.get(callerId);
  }

  /** 서명 저장 — 서버가 HTML 을 정리하고, 남길 수 없는 이미지는 빼고 droppedImageCount 로 알려 준다. */
  @PutMapping
  public MailSignatureResponse update(
      @AuthenticationPrincipal Long callerId, @RequestBody MailSignatureUpdateRequest request) {
    return signatureService.update(callerId, request);
  }

  /**
   * 내 서명 이미지 바이트(본인 것만, 남의 것·없는 id 는 404). 설정 화면과 작성창이 인증 요청으로 받아 그린다. 직접 열어도 스크립트가 돌지 않게 {@code
   * Content-Security-Policy: sandbox} 를 붙이고(nosniff 는 SecurityConfig 가 전역으로 붙인다), 내용이 바뀌지 않는 파일이라
   * 하루 동안 브라우저 캐시를 허용한다.
   */
  @GetMapping("/images/{imageId}")
  public ResponseEntity<byte[]> image(
      @AuthenticationPrincipal Long callerId, @PathVariable long imageId) {
    ImageContent content = signatureService.readImage(callerId, imageId);
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(content.mimeType()));
    headers.set(HttpHeaders.CONTENT_DISPOSITION, "inline");
    headers.set("Content-Security-Policy", "sandbox");
    headers.setCacheControl("private, max-age=86400");
    return ResponseEntity.ok().headers(headers).body(content.bytes());
  }

  /**
   * 서명 이미지의 발송용 사본(작성창 업로드)을 만든다 — 보내기 직전 작성창이 부르고, 응답 uploadId 로 본문 src 를 {@code
   * /api/v1/files/{uploadId}/content} 로 바꿔 붙여 넣은 이미지처럼 보낸다. 요청 순서·중복은 한 번. 하나라도 내 것이 아니면 404.
   */
  @PostMapping("/images/stage")
  public List<SignatureImageStaged> stage(
      @AuthenticationPrincipal Long callerId, @RequestBody SignatureImageStageRequest request) {
    return signatureService.stageImages(callerId, request.imageIds());
  }
}

package com.workplace.home.controller;

import com.workplace.home.dto.HomeUploadedFile;
import com.workplace.home.service.HomeAttachmentService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
}

package com.workplace.messaging.controller;

import com.workplace.messaging.dto.CreateDmRequest;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.service.DmService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** DM 목록/생성. 메시지 송수신은 기존 채널 메시지 엔드포인트(DM 채널 id)를 재사용. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging")
public class DmController {

  private final DmService dmService;

  /** 내 DM 목록(최근순, 참여자 동봉). */
  @GetMapping("/dms")
  public ResponseEntity<List<DmResponse>> list(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(dmService.listMyDms(callerId));
  }

  /** DM find-or-create. 기존 재사용=200, 신규=201. */
  @PostMapping("/dms")
  public ResponseEntity<DmResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateDmRequest req) {
    DmService.DmResult res = dmService.createOrGet(callerId, req.userIds());
    return ResponseEntity.status(res.created() ? HttpStatus.CREATED : HttpStatus.OK).body(res.dm());
  }
}

package com.workplace.auth.controller;

import com.workplace.auth.service.AgentRemovalService;
import com.workplace.global.security.RequireAdmin;
import com.workplace.global.security.RequirePermission;
import com.workplace.global.security.RequireWebSession;
import com.workplace.user.dto.AgentResponse;
import com.workplace.user.dto.AvatarCrop;
import com.workplace.user.dto.AvatarResponse;
import com.workplace.user.dto.CreateAgentRequest;
import com.workplace.user.dto.RenameAgentRequest;
import com.workplace.user.dto.SetAgentRuntimeRequest;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.service.AvatarService;
import com.workplace.user.service.UserService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Phase 5a — ADMIN 의 AGENT 유저 CRUD. user:write 권한이 필요하다 (ADMIN 만 보유). */
@RestController
@RequestMapping("/api/v1/admin/agents")
@RequiredArgsConstructor
// WP-729: AI 관리는 ADMIN 만 — 「사용자 쓰기」만 받은 구성원이 AI 키를 발급해 그 AI 로 행동하던 길을 막는다.
@RequireAdmin
public class AdminAgentController {

  private final UserService userService;
  private final AgentRemovalService agentRemoval;
  // WP-1222 AI 아바타
  private final AvatarService avatarService;

  /** AGENT 목록. includePersonal=false(기본)면 개인 비서(자동 생성 AGENT)를 제외한다. */
  @GetMapping
  @RequirePermission("user:write")
  public ResponseEntity<List<AgentResponse>> list(
      @RequestParam(name = "includePersonal", defaultValue = "false") boolean includePersonal) {
    return ResponseEntity.ok(userService.listAgents(includePersonal));
  }

  /** AGENT 생성. */
  @PostMapping
  @RequireWebSession
  @RequirePermission("user:write")
  public ResponseEntity<UserResponse> create(
      Authentication auth, @Valid @RequestBody CreateAgentRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(userService.createAgent(callerId, req));
  }

  /** AGENT 이름/식별자 변경. 개인 비서는 거부(403). */
  @PutMapping("/{userId}")
  @RequirePermission("user:write")
  public ResponseEntity<Void> rename(
      Authentication auth, @PathVariable Long userId, @Valid @RequestBody RenameAgentRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    userService.renameAgent(callerId, userId, req);
    return ResponseEntity.noContent().build();
  }

  /**
   * AGENT 삭제(WP-705). 기록이 없으면 완전히 지우고(키도 CASCADE), 기록이 남았거나 다른 워크스페이스에도 속해 있으면 이 워크스페이스에서 사용을 중지한다.
   * 결과({@code DELETED}·{@code DEACTIVATED})를 돌려줘 화면이 알맞은 안내를 띄운다.
   */
  @DeleteMapping("/{userId}")
  @RequirePermission("user:write")
  public ResponseEntity<AgentRemovalResponse> delete(
      Authentication auth, @PathVariable Long userId) {
    Long callerId = (Long) auth.getPrincipal();
    return ResponseEntity.ok(new AgentRemovalResponse(agentRemoval.remove(callerId, userId)));
  }

  /** AGENT 삭제 결과. */
  public record AgentRemovalResponse(AgentRemovalService.Result result) {}

  /**
   * AGENT 실행 방식 변경 (WP-371). INTERNAL=서버 ai-agent 가 실행, EXTERNAL=외부 에이전트가 API 키로 직접 일함. 공통/개인 비서를
   * EXTERNAL 로 바꾸면 409, 사람·없는 유저면 404.
   */
  @PutMapping("/{userId}/runtime")
  @RequirePermission("user:write")
  public ResponseEntity<Void> setRuntime(
      Authentication auth,
      @PathVariable Long userId,
      @Valid @RequestBody SetAgentRuntimeRequest req) {
    Long callerId = (Long) auth.getPrincipal();
    userService.setAgentRuntime(callerId, userId, req.runtime());
    return ResponseEntity.noContent().build();
  }

  /**
   * AI 아바타 바꾸기(WP-1222) — multipart {@code file} + 선택 자를 영역(cropX·cropY·cropSize). 대상이 이 워크스페이스의 AI
   * 가 아니면 404.
   */
  @PutMapping(value = "/{userId}/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @RequirePermission("user:write")
  public ResponseEntity<AvatarResponse> setAvatar(
      @PathVariable Long userId,
      @RequestPart("file") MultipartFile file,
      @RequestParam(value = "cropX", required = false) Integer cropX,
      @RequestParam(value = "cropY", required = false) Integer cropY,
      @RequestParam(value = "cropSize", required = false) Integer cropSize) {
    String url = avatarService.setAgentAvatar(userId, file, new AvatarCrop(cropX, cropY, cropSize));
    return ResponseEntity.ok(new AvatarResponse(url));
  }

  /** AI 아바타를 기본으로 되돌린다(WP-1222). 대상이 이 워크스페이스의 AI 가 아니면 404. */
  @DeleteMapping("/{userId}/avatar")
  @RequirePermission("user:write")
  public ResponseEntity<Void> deleteAvatar(@PathVariable Long userId) {
    avatarService.deleteAgentAvatar(userId);
    return ResponseEntity.noContent().build();
  }
}

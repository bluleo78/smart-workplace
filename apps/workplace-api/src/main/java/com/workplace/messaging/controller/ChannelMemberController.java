package com.workplace.messaging.controller;

import com.workplace.messaging.dto.AddMemberGroupRequest;
import com.workplace.messaging.dto.AddMemberRequest;
import com.workplace.messaging.dto.ChannelMemberGroupResponse;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.UpdateRoleRequest;
import com.workplace.messaging.service.ChannelMemberGroupService;
import com.workplace.messaging.service.ChannelMemberService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 채널 멤버 관리 — 목록/초대/제거/나가기/역할변경, 멤버 부서 목록/추가/제거(WP-1058). */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/messaging/channels/{id}")
public class ChannelMemberController {

  private final ChannelMemberService memberService;
  private final ChannelMemberGroupService memberGroupService;

  /** 멤버 목록. */
  @GetMapping("/members")
  public ResponseEntity<List<ChannelMemberResponse>> members(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    return ResponseEntity.ok(memberService.listMembers(callerId, channelId));
  }

  /** 멤버 추가. */
  @PostMapping("/members")
  public ResponseEntity<Void> add(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody AddMemberRequest req) {
    memberService.add(callerId, channelId, req.userId());
    return ResponseEntity.noContent().build();
  }

  /** 멤버 제거. */
  @DeleteMapping("/members/{userId}")
  public ResponseEntity<Void> remove(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("userId") long targetUserId) {
    memberService.remove(callerId, channelId, targetUserId);
    return ResponseEntity.noContent().build();
  }

  /** 나가기. */
  @PostMapping("/leave")
  public ResponseEntity<Void> leave(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    memberService.leave(callerId, channelId);
    return ResponseEntity.noContent().build();
  }

  /** 역할 변경 / 소유권 이전. */
  @PatchMapping("/members/{userId}")
  public ResponseEntity<Void> updateRole(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("userId") long targetUserId,
      @Valid @RequestBody UpdateRoleRequest req) {
    memberService.updateRole(callerId, channelId, targetUserId, req.role());
    return ResponseEntity.noContent().build();
  }

  /** 멤버 부서 목록(이름순) — 채널을 읽을 수 있는 사람. */
  @GetMapping("/member-groups")
  public ResponseEntity<List<ChannelMemberGroupResponse>> memberGroups(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long channelId) {
    return ResponseEntity.ok(memberGroupService.list(callerId, channelId));
  }

  /** 멤버 부서 추가 — 그 부서와 하위 부서의 활성 사람이 MEMBER 로 들어온다. 201 + 추가된 부서 한 줄. */
  @PostMapping("/member-groups")
  public ResponseEntity<ChannelMemberGroupResponse> addMemberGroup(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @Valid @RequestBody AddMemberGroupRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(memberGroupService.add(callerId, channelId, req.groupId()));
  }

  /** 멤버 부서 제거 — 그 부서로만 들어와 있던 사람이 빠진다. */
  @DeleteMapping("/member-groups/{groupId}")
  public ResponseEntity<Void> removeMemberGroup(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long channelId,
      @PathVariable("groupId") long groupId) {
    memberGroupService.remove(callerId, channelId, groupId);
    return ResponseEntity.noContent().build();
  }
}

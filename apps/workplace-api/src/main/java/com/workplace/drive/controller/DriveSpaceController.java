package com.workplace.drive.controller;

import com.workplace.drive.dto.AddMemberGroupRequest;
import com.workplace.drive.dto.AddMemberRequest;
import com.workplace.drive.dto.ChangeRoleRequest;
import com.workplace.drive.dto.CreateSpaceRequest;
import com.workplace.drive.dto.DriveMemberGroupResponse;
import com.workplace.drive.dto.DriveMemberResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.dto.RenameSpaceRequest;
import com.workplace.drive.service.DriveSpaceMemberGroupService;
import com.workplace.drive.service.DriveSpaceService;
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

/** 드라이브 공간/멤버 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/drive")
public class DriveSpaceController {
  private final DriveSpaceService spaceService;
  private final DriveSpaceMemberGroupService memberGroupService;

  @GetMapping("/spaces")
  public ResponseEntity<List<DriveSpaceResponse>> mySpaces(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(spaceService.listMySpaces(callerId));
  }

  @PostMapping("/spaces")
  public ResponseEntity<DriveSpaceResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateSpaceRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(spaceService.createTeamSpace(callerId, req.name()));
  }

  @GetMapping("/spaces/{id}")
  public ResponseEntity<DriveSpaceResponse> get(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(spaceService.getSpace(callerId, spaceId));
  }

  /** TEAM 공간 이름 변경 — OWNER 전용. */
  @PatchMapping("/spaces/{id}")
  public ResponseEntity<DriveSpaceResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody RenameSpaceRequest req) {
    return ResponseEntity.ok(spaceService.renameTeamSpace(callerId, spaceId, req.name()));
  }

  /** TEAM 공간 즉시 하드삭제 — OWNER 전용. 내용물 통째 삭제. */
  @DeleteMapping("/spaces/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    spaceService.deleteTeamSpace(callerId, spaceId);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/spaces/{id}/members")
  public ResponseEntity<List<DriveMemberResponse>> members(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(spaceService.listMembers(callerId, spaceId));
  }

  @PostMapping("/spaces/{id}/members")
  public ResponseEntity<Void> addMember(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody AddMemberRequest req) {
    spaceService.addMember(callerId, spaceId, req.userId(), req.role());
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @PatchMapping("/spaces/{id}/members/{userId}")
  public ResponseEntity<Void> changeRole(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @PathVariable("userId") long userId,
      @Valid @RequestBody ChangeRoleRequest req) {
    spaceService.changeRole(callerId, spaceId, userId, req.role());
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/spaces/{id}/members/{userId}")
  public ResponseEntity<Void> removeMember(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @PathVariable("userId") long userId) {
    spaceService.removeMember(callerId, spaceId, userId);
    return ResponseEntity.noContent().build();
  }

  // ── 멤버로 둔 조직도 부서(WP-1056) — 권한은 사람 멤버 API 와 같다(조회 멤버, 변경 OWNER). 팀 공간만 ──

  /** 공간 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수). */
  @GetMapping("/spaces/{id}/member-groups")
  public ResponseEntity<List<DriveMemberGroupResponse>> memberGroups(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(memberGroupService.list(callerId, spaceId));
  }

  /** 조직도 부서를 멤버로 더한다 — 이미 있으면 역할을 덮어쓴다(사람 멤버 추가와 같은 업서트). */
  @PostMapping("/spaces/{id}/member-groups")
  public ResponseEntity<DriveMemberGroupResponse> addMemberGroup(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody AddMemberGroupRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(memberGroupService.add(callerId, spaceId, req.groupId(), req.role()));
  }

  /** 멤버 부서의 역할 변경(EDITOR | VIEWER). */
  @PatchMapping("/spaces/{id}/member-groups/{groupId}")
  public ResponseEntity<DriveMemberGroupResponse> changeMemberGroupRole(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @PathVariable("groupId") long groupId,
      @Valid @RequestBody ChangeRoleRequest req) {
    return ResponseEntity.ok(memberGroupService.changeRole(callerId, spaceId, groupId, req.role()));
  }

  /** 멤버 부서 제거. */
  @DeleteMapping("/spaces/{id}/member-groups/{groupId}")
  public ResponseEntity<Void> removeMemberGroup(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @PathVariable("groupId") long groupId) {
    memberGroupService.remove(callerId, spaceId, groupId);
    return ResponseEntity.noContent().build();
  }
}

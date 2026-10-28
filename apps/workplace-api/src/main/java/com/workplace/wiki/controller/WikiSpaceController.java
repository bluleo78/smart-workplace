package com.workplace.wiki.controller;

import com.workplace.wiki.dto.AddMemberGroupRequest;
import com.workplace.wiki.dto.AddMemberRequest;
import com.workplace.wiki.dto.ChangeRoleRequest;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.CreateSpaceRequest;
import com.workplace.wiki.dto.WikiMemberGroupResponse;
import com.workplace.wiki.dto.WikiMemberResponse;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceMemberGroupService;
import com.workplace.wiki.service.WikiSpaceService;
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

/** 위키 공간/멤버 + 공간 내 페이지 트리 API. */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/v1/wiki")
public class WikiSpaceController {
  private final WikiSpaceService spaceService;
  private final WikiPageService pageService;
  private final WikiSpaceMemberGroupService memberGroupService;

  @GetMapping("/spaces")
  public ResponseEntity<List<WikiSpaceResponse>> mySpaces(@AuthenticationPrincipal Long callerId) {
    return ResponseEntity.ok(spaceService.listMySpaces(callerId));
  }

  @PostMapping("/spaces")
  public ResponseEntity<WikiSpaceResponse> create(
      @AuthenticationPrincipal Long callerId, @Valid @RequestBody CreateSpaceRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(spaceService.createTeamSpace(callerId, req.name()));
  }

  @GetMapping("/spaces/{id}")
  public ResponseEntity<WikiSpaceResponse> get(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(spaceService.getSpace(callerId, spaceId));
  }

  /** 팀 스페이스 영구 삭제(WP-580) — OWNER 전용, 개인 스페이스는 거부. */
  @DeleteMapping("/spaces/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    spaceService.deleteTeamSpace(callerId, spaceId);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/spaces/{id}/members")
  public ResponseEntity<List<WikiMemberResponse>> members(
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

  // ── 멤버로 둔 조직도 부서(WP-1052) — 권한은 사람 멤버 API 와 같다(조회 멤버, 변경 OWNER) ──

  /** 스페이스 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수). */
  @GetMapping("/spaces/{id}/member-groups")
  public ResponseEntity<List<WikiMemberGroupResponse>> memberGroups(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(memberGroupService.list(callerId, spaceId));
  }

  /** 조직도 부서를 멤버로 더한다 — 이미 있으면 역할을 덮어쓴다(사람 멤버 추가와 같은 업서트). */
  @PostMapping("/spaces/{id}/member-groups")
  public ResponseEntity<WikiMemberGroupResponse> addMemberGroup(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody AddMemberGroupRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(memberGroupService.add(callerId, spaceId, req.groupId(), req.role()));
  }

  /** 멤버 부서의 역할 변경(EDITOR | VIEWER). */
  @PatchMapping("/spaces/{id}/member-groups/{groupId}")
  public ResponseEntity<WikiMemberGroupResponse> changeMemberGroupRole(
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

  @GetMapping("/spaces/{id}/pages")
  public ResponseEntity<List<WikiPageSummary>> pages(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    return ResponseEntity.ok(pageService.listTree(callerId, spaceId));
  }

  @PostMapping("/spaces/{id}/pages")
  public ResponseEntity<WikiPageDetail> createPage(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody CreatePageRequest req) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(pageService.create(callerId, spaceId, req));
  }
}

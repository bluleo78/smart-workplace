package com.workplace.wiki.controller;

import com.workplace.wiki.dto.AddMemberRequest;
import com.workplace.wiki.dto.ChangeRoleRequest;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.CreateSpaceRequest;
import com.workplace.wiki.dto.WikiMemberResponse;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.service.WikiPageService;
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

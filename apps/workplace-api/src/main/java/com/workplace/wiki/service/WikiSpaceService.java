package com.workplace.wiki.service;

import com.workplace.wiki.dto.WikiMemberResponse;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 위키 공간/멤버. 소유자는 생성 시 OWNER 멤버로 등록되어 권한이 멤버십으로 일원화된다. */
@Service
@RequiredArgsConstructor
public class WikiSpaceService {
  private final WikiSpaceRepository spaces;
  private final WikiSpaceMemberRepository members;
  private final WikiPermissions perms;

  /** 개인 공간 보장(없으면 생성). 멱등. */
  @Transactional
  public WikiSpaceResponse ensurePersonalSpace(long userId) {
    long spaceId =
        spaces
            .findPersonalSpaceId(userId)
            .orElseGet(
                () -> {
                  long id = spaces.insert("PERSONAL", "내 노트", userId);
                  members.add(id, userId, "OWNER");
                  return id;
                });
    return spaces
        .findForUser(spaceId, userId)
        .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
  }

  /** 독립 팀 공간 생성. 생성자가 OWNER. */
  @Transactional
  public WikiSpaceResponse createTeamSpace(long callerId, String name) {
    long id = spaces.insert("TEAM", name, callerId);
    members.add(id, callerId, "OWNER");
    return spaces.findForUser(id, callerId).orElseThrow(() -> new WikiSpaceNotFoundException(id));
  }

  /** 내 공간 목록(개인 자동생성 보장 + 멤버 팀). */
  @Transactional
  public List<WikiSpaceResponse> listMySpaces(long userId) {
    ensurePersonalSpace(userId);
    return spaces.findMySpaces(userId);
  }

  @Transactional(readOnly = true)
  public WikiSpaceResponse getSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return spaces
        .findForUser(spaceId, callerId)
        .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
  }

  @Transactional(readOnly = true)
  public List<WikiMemberResponse> listMembers(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return members.listMembers(spaceId);
  }

  @Transactional
  public void addMember(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.validateRole(role);
    members.add(spaceId, userId, role);
  }

  @Transactional
  public void changeRole(long callerId, long spaceId, long userId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.validateRole(role);
    members.changeRole(spaceId, userId, role);
  }

  @Transactional
  public void removeMember(long callerId, long spaceId, long userId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    members.remove(spaceId, userId);
  }
}

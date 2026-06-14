package com.workplace.wiki.service;

import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 위키 페이지 트리 + 낙관적 동시성 저장. 인가는 페이지의 공간 역할로 해석. */
@Service
@RequiredArgsConstructor
public class WikiPageService {
  private final WikiPageRepository pages;
  private final WikiRevisionRepository revisions;
  private final WikiPermissions perms;

  /** 페이지 생성(말단 position). EDITOR 이상. */
  @Transactional
  public WikiPageDetail create(long callerId, long spaceId, CreatePageRequest req) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    int pos = pages.nextPosition(spaceId, req.parentId());
    long id = pages.insert(spaceId, req.parentId(), req.title(), pos);
    return pages.findDetail(id).orElseThrow(() -> new WikiPageNotFoundException(id));
  }

  /** 공간 페이지 트리(경량). VIEWER 이상. */
  @Transactional(readOnly = true)
  public List<WikiPageSummary> listTree(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return pages.listBySpace(spaceId);
  }

  /** 단건 상세(본문 + version). VIEWER 이상. */
  @Transactional(readOnly = true)
  public WikiPageDetail get(long callerId, long pageId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "VIEWER");
    return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
  }

  /**
   * 낙관적 동시성 저장. snapshot=true 면 직전 버전 상태를 wiki_revision 에 적재(명시 저장/세션 첫 편집). 자동저장은 snapshot=false 로
   * 호출 → 리비전 미적재.
   */
  @Transactional
  public WikiPageDetail save(long callerId, long pageId, SavePageRequest req) {
    WikiPageDetail current =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(current.spaceId(), callerId, "EDITOR");

    if (req.snapshot()) {
      revisions.snapshot(
          pageId, current.version(), current.title(), current.body(), current.updatedBy());
    }

    String title = req.title() != null ? req.title() : current.title();
    int affected = pages.saveIfVersion(pageId, title, req.body(), req.version(), callerId);
    if (affected == 0) {
      throw new WikiConflictException(pageId);
    }
    return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
  }

  /** 트리 이동(parent/position 변경) + 형제 재배열로 타이 제거. EDITOR 이상. */
  @Transactional
  public void move(long callerId, long pageId, MovePageRequest req) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    // 부모 변경을 먼저 반영(같은 부모면 no-op 수준).
    pages.move(pageId, req.parentId(), req.position());
    // 새 부모의 형제들을 현재 순서로 가져와 이동 노드를 목표 인덱스에 삽입 후 0..n 재부여(타이 제거).
    java.util.List<Long> ids = pages.childIdsOrdered(spaceId, req.parentId());
    ids.remove(Long.valueOf(pageId)); // 박싱 remove(Object) — 인덱스 remove 아님
    int idx = Math.max(0, Math.min(req.position(), ids.size()));
    ids.add(idx, pageId);
    for (int i = 0; i < ids.size(); i++) {
      pages.setPosition(ids.get(i), i);
    }
  }

  /** 페이지 삭제(자식 CASCADE). EDITOR 이상. */
  @Transactional
  public void delete(long callerId, long pageId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    pages.delete(pageId);
  }
}

package com.workplace.wiki.service;

import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSearchResult;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiReferenceRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 위키 페이지 트리 + 낙관적 동시성 저장. 인가는 페이지의 공간 역할로 해석. */
@Service
@RequiredArgsConstructor
public class WikiPageService {
  private final WikiPageRepository pages;
  private final WikiRevisionRepository revisions;
  private final WikiPermissions perms;
  private final WikiReferenceRepository references;
  private final WikiReferenceParser refParser;
  private final WikiAttachmentService attachments;
  private final ApplicationEventPublisher publisher;

  /** 페이지 생성(말단 position). EDITOR 이상. */
  @Transactional
  public WikiPageDetail create(long callerId, long spaceId, CreatePageRequest req) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    int pos = pages.nextPosition(spaceId, req.parentId());
    long id = pages.insert(spaceId, req.parentId(), req.title(), pos);
    WikiPageDetail detail =
        pages.findDetail(id).orElseThrow(() -> new WikiPageNotFoundException(id));
    // #724: 생성 사실을 스페이스 멤버에게 SSE 로 알려 열린 노트 화면이 즉시 갱신되도록 한다(AFTER_COMMIT fan-out).
    publisher.publishEvent(
        new WikiPageCreatedEvent(
            spaceId, id, req.parentId(), detail.title(), callerId, Instant.now()));
    return detail;
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
    // body null 이면 현재 본문 유지(title 과 대칭) — null 저장으로 본문·백링크 소실 방지.
    String body = req.body() != null ? req.body() : current.body();
    int affected = pages.saveIfVersion(pageId, title, body, req.version(), callerId);
    if (affected == 0) {
      throw new WikiConflictException(pageId);
    }
    // 본문에서 page/issue 참조를 추출해 백링크 테이블을 교체(diff-replace). 유저 멘션은 적재 안 함.
    // save() 가 @Transactional 이므로 replaceForSource 의 delete+insert 가 원자적으로 묶인다.
    // 추출은 실제 저장한 body 로 수행해야 본문과 백링크가 일관(null→유지 시 기존 백링크 보존).
    references.replaceForSource(pageId, refParser.parse(pageId, body));
    // 본문에 남아 있는 이미지 첨부만 영구화한다(promote-only).
    // 참조가 사라진 것은 회수하지 않는다 — autosave 800ms 디바운스라 잘라내기-붙여넣기·undo 중간 상태가
    // 각각 저장되고, 페이지 간 복사도 원본에서 참조가 빠진 것처럼 보여 실데이터가 삭제된다.
    attachments.promoteReferenced(pageId, body);
    WikiPageDetail saved =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    // #724: 저장 사실을 스페이스 멤버에게 SSE 로 알린다 — 다른 탭/AI 편집이 즉시 반영되도록.
    publisher.publishEvent(
        new WikiPageUpdatedEvent(
            current.spaceId(), pageId, saved.title(), callerId, Instant.now()));
    return saved;
  }

  /**
   * #736 AI 생성 attribution 기록. {@link WikiAiService} 의 스트림 완료(delta 1개 이상 전달된 완료/취소/에러) 지점에서 호출되는
   * 유일한 기록 지점 — PUT 저장 경로에서는 기록하지 않는다(§3, 중복 기록 방지). 권한/버전 체크 없이 컬럼 2개만 갱신하는 {@link
   * WikiPageRepository#recordAiUsage} 를 그대로 위임.
   */
  @Transactional
  public void recordAiUsage(long pageId, WikiAiAction action) {
    pages.recordAiUsage(pageId, action.wire(), Instant.now().atOffset(java.time.ZoneOffset.UTC));
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
    // #724: 트리 이동을 스페이스 멤버에게 알려 사이드바 트리가 재조회되도록 한다.
    publisher.publishEvent(new WikiPageMovedEvent(spaceId, pageId, callerId, Instant.now()));
  }

  /** 페이지 삭제(자식 CASCADE). EDITOR 이상. */
  @Transactional
  public void delete(long callerId, long pageId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    pages.delete(pageId);
    // #724: 삭제를 스페이스 멤버에게 알려 트리·열린 페이지 캐시가 무효화되도록 한다.
    publisher.publishEvent(new WikiPageDeletedEvent(spaceId, pageId, callerId, Instant.now()));
  }

  /**
   * 위키 검색(읽기 그라운딩). 빈 질의는 즉시 빈 목록. spaceId 지정 시 VIEWER 권한 확인 후 해당 스페이스 한정, null 이면 호출자 멤버 스페이스 전체.
   * LIKE 와일드카드(%, _, \)는 이스케이프해 리터럴로 매칭.
   */
  @Transactional(readOnly = true)
  public List<WikiSearchResult> search(long callerId, String q, Long spaceId) {
    if (q == null || q.isBlank()) {
      return List.of();
    }
    if (spaceId != null) {
      perms.requireRole(spaceId, callerId, "VIEWER");
    }
    String pattern = "%" + escapeLike(q.trim()) + "%";
    return pages.search(callerId, spaceId, pattern, 50);
  }

  /** LIKE 특수문자(\, %, _)를 이스케이프해 사용자 입력을 리터럴로 취급한다. */
  private static String escapeLike(String q) {
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
  }
}

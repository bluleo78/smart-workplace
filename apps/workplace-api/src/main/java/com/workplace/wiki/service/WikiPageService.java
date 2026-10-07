package com.workplace.wiki.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSearchResult;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.exception.WikiInvalidMoveException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.CollabApplyResult;
import com.workplace.wiki.outbound.CollabProperties;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageAccessRevokedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 위키 페이지 트리 + 저장. 인가는 페이지의 공간 역할로 해석. 동시 편집 도입 후 본문 저장은 동기화 서버로 위임한다(WP-285, {@link #save}). */
@Service
@RequiredArgsConstructor
public class WikiPageService {
  private final WikiPageRepository pages;
  private final WikiRevisionRepository revisions;
  private final WikiPermissions perms;
  private final WikiBodyEffects bodyEffects;
  private final WikiAttachmentService attachments;
  private final ApplicationEventPublisher publisher;
  private final CollabClient collab;
  private final CollabProperties collabProps;
  // WP-290 표시 이름 조회 — wiki 는 다른 도메인(user) 패키지를 import 하지 않으므로 global 하이드레이터를 쓴다(Task 3 와 동일).
  private final UserMentionHydrator users;
  // save() 는 트랜잭션 경계를 직접 나눈다(위임 중 행 잠금 금지) — TransactionTemplate 용.
  private final PlatformTransactionManager txManager;

  /** 페이지 생성(말단 position). EDITOR 이상. */
  @Transactional
  public WikiPageDetail create(long callerId, long spaceId, CreatePageRequest req) {
    perms.requireRole(spaceId, callerId, "EDITOR");
    // #758: 생성 시점의 parentId 도 검증한다 — 이동만 막으면 "다른 공간 페이지를 부모로" 를 생성으로 그대로 만들 수 있다.
    if (req.parentId() != null) {
      requireParentInSpace(spaceId, req.parentId());
    }
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

  /** 사람(웹) 저장 — {@link #save(long, long, SavePageRequest, boolean)} 의 ai=false. */
  public WikiPageDetail save(long callerId, long pageId, SavePageRequest req) {
    return save(callerId, pageId, req, false);
  }

  /**
   * 노트 저장. 동시 편집 도입(WP-171) 후 규칙:
   *
   * <ul>
   *   <li>제목만(body null): 버전 검사 없이 나중 값 우선(WP-290) — 파생 저장으로 version 이 수 초마다 올라 검사하면 409 가 잦다.
   *   <li>본문 포함 + 동기화 서버 켜짐: 실시간 문서가 원본이므로 DB 를 직접 덮지 않고 동기화 서버에 적용을 위임한다(WP-285). DB 를 덮으면 다음 파생
   *       저장이 그 변경을 지운다. 지금은 mode=replace 라 version 이 현재와 같을 때만 위임하고 다르면 기존처럼 409 — 3-way 병합은
   *       WP-289(운영 배포는 그와 함께).
   *   <li>본문 포함 + 동기화 서버 꺼짐(테스트·비상): 기존 낙관적 저장(version 필수, snapshot 지원).
   * </ul>
   *
   * <p><b>트랜잭션 경계가 load-bearing 이다.</b> 이 메서드는 의도적으로 {@code @Transactional} 이 아니다. 위임 경로에서 동기화 서버는
   * 응답 전에 이 API 의 {@code PUT /internal/wiki/pages/{id}/doc} 로 같은 wiki_page 행을 갱신한다. 제목 저장과 위임을 한
   * 트랜잭션에 두면 제목 UPDATE 의 행 잠금을 쥔 채 그 콜백을 기다려 매 저장이 타임아웃까지 막힌다(구버전 웹·MCP 는 제목과 본문을 늘 함께 보낸다). 그래서 ①
   * 권한 확인·제목 저장을 자기 트랜잭션으로 먼저 커밋하고 ② 트랜잭션 밖에서 위임한 뒤 ③ 읽기 트랜잭션으로 응답을 만든다. 위임이 실패하면 제목은 이미 커밋된 채 남고
   * 본문 저장만 503 으로 실패한다(본문을 조용히 버리지 않는다).
   *
   * @param ai MCP·채팅 비서 등 AI 경로면 true — 동기화 서버가 ✦ 표시·스냅샷 귀속에 쓴다
   */
  public WikiPageDetail save(long callerId, long pageId, SavePageRequest req, boolean ai) {
    boolean delegate = req.body() != null && collabProps.enabled();
    TransactionTemplate tx = new TransactionTemplate(txManager);
    if (!delegate) {
      return tx.execute(s -> saveInTx(loadForEdit(callerId, pageId), callerId, req));
    }

    // 호출자가 트랜잭션을 열어 두었으면 ①이 거기에 합류해 제목 행 잠금이 위임 내내 남는다 — 교착 대신 즉시 실패시킨다.
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("동기화 서버 본문 위임은 트랜잭션 밖에서 호출해야 합니다: page=" + pageId);
    }
    // ① 권한 확인 + 제목 커밋. 작성자 표시 이름도 여기서(트랜잭션 안 — RLS GUC 필요) 구해 둔다.
    String actorName =
        tx.execute(
            s -> {
              WikiPageDetail current = loadForEdit(callerId, pageId);
              // 3-way 병합(WP-289) 전까지의 임시 규칙 — 기존 낙관적 저장과 같은 판정·같은 오류. 낡은 읽기로 만든 본문이 실시간 문서를
              // 통째로 덮지 않게 version 이 현재와 다르면 409, 없으면 400. 제목 커밋·위임 전에 판정해 거절 시 아무것도 남기지 않는다.
              requireCurrentVersion(current, req);
              // AI(MCP·채팅 비서) 덮어쓰기는 편집 세션 간격과 무관하게 직전 본문을 남긴다 — 결과가 틀려도 되돌릴 수 있게. 명시
              // snapshot 요청도 기존 경로처럼 따른다. 동기화 서버가 저장하기 전에 남겨야 덮이기 전 본문이 된다.
              if (ai || req.snapshot()) {
                revisions.snapshot(current);
              }
              saveTitleIfPresent(current, req, callerId);
              return users.summaryOf(callerId).name();
            });

    // ② 트랜잭션 밖에서 위임.
    CollabApplyResult applied =
        collab.applyMarkdown(TenantContext.require(), pageId, req.body(), callerId, actorName, ai);

    // ③ 응답 — version·body 는 동기화 서버가 저장한 값(재조회는 그 사이 다른 파생 저장으로 앞설 수 있다).
    tx.setReadOnly(true);
    return tx.execute(
            s -> pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId)))
        .withBody(applied.body(), applied.version());
  }

  /** 본문 저장의 기준 version 검사 — 없으면 400, 현재와 다르면 409(기존 낙관적 저장과 같은 오류). */
  private static void requireCurrentVersion(WikiPageDetail current, SavePageRequest req) {
    requireVersionPresent(req, current.id());
    if (req.version() != current.version()) {
      throw new WikiConflictException(current.id());
    }
  }

  /** 본문 저장에는 기준 version 이 필요하다 — 없으면 400(위임·기존 낙관적 저장 공통). */
  private static void requireVersionPresent(SavePageRequest req, long pageId) {
    if (req.version() == null) {
      throw new IllegalArgumentException("본문을 저장하려면 version 이 필요합니다: page=" + pageId);
    }
  }

  /** 제목이 있으면 버전 검사 없이 저장하고(나중 값 우선, WP-290) SSE 로 알린다. 트랜잭션 안에서 호출. */
  private void saveTitleIfPresent(WikiPageDetail current, SavePageRequest req, long callerId) {
    if (req.title() != null) {
      pages.saveTitle(current.id(), req.title(), callerId);
      publishUpdated(current.spaceId(), current.id(), req.title(), callerId);
    }
  }

  /** 페이지를 읽고 EDITOR 이상인지 확인한다. 트랜잭션 안에서 호출. */
  private WikiPageDetail loadForEdit(long callerId, long pageId) {
    WikiPageDetail current =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(current.spaceId(), callerId, "EDITOR");
    return current;
  }

  /**
   * 위임하지 않는 저장(트랜잭션 안). 제목만이면 버전 무관 저장, 본문이 있으면 기존 낙관적 저장. snapshot=true 면 직전 상태를 wiki_revision 에
   * 적재(명시 저장/세션 첫 편집).
   */
  private WikiPageDetail saveInTx(WikiPageDetail current, long callerId, SavePageRequest req) {
    long pageId = current.id();
    if (req.body() == null) {
      saveTitleIfPresent(current, req, callerId);
      return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    }
    requireVersionPresent(req, pageId);

    if (req.snapshot()) {
      revisions.snapshot(current);
    }

    String title = req.title() != null ? req.title() : current.title();
    String body = req.body();
    int affected = pages.saveIfVersion(pageId, title, body, req.version(), callerId);
    if (affected == 0) {
      throw new WikiConflictException(pageId);
    }
    // 백링크 교체·첨부 영구화/강등·SSE — 동기화 서버 파생 저장과 같은 후처리(WikiBodyEffects).
    bodyEffects.afterBodySaved(current.spaceId(), pageId, title, body, callerId);
    return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
  }

  /** #724: 저장 사실을 스페이스 멤버에게 SSE 로 알린다(AFTER_COMMIT) — 다른 탭/AI 편집이 즉시 반영되도록. 트랜잭션 안에서 호출. */
  private void publishUpdated(long spaceId, long pageId, String title, long callerId) {
    publisher.publishEvent(
        new WikiPageUpdatedEvent(spaceId, pageId, title, callerId, Instant.now()));
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
    // #758: 사이클 검사와 UPDATE 사이의 check-then-act 간극을 공간 단위 어드바이저리 락으로 닫는다 —
    // 락 없이는 "X 를 Y 밑으로" 와 "Y 를 X 밑으로" 가 동시에 통과해 되돌릴 수 없는 사이클이 남는다.
    pages.lockSpaceTree(spaceId);
    requireMovable(pageId, spaceId, req.parentId());
    // 부모 변경을 먼저 반영(같은 부모면 no-op 수준).
    pages.move(pageId, req.parentId(), req.position());
    // 새 부모의 형제들을 현재 순서로 가져와 이동 노드를 목표 인덱스에 삽입 후 0..n 재부여(타이 제거).
    // requireMovable 이 통과했으므로 (spaceId, req.parentId()) 는 같은 공간에 속한다 — 가드가 없으면 다른 공간의
    // 부모를 지정했을 때 이 쌍이 어긋나 형제 목록이 비고 재배열이 조용히 아무것도 하지 않는다.
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

  /**
   * #758 이동 가드 — 트리를 깨는 parentId 를 사전 거부한다. wiki_page.parent_id 는 self-FK 라 DB 는 자기참조·순환·공간 불일치를 모두
   * 허용하고, 그렇게 만들어진 페이지는 사이드바 트리에서 사라져 사용자가 되돌릴 수 없다.
   *
   * @param spaceId 이동 대상 페이지의 공간(호출자가 이미 조회한 값을 재사용)
   * @param parentId 새 부모. {@code null} 은 "루트로 이동" 이라 정상 경로이므로 검사 대상이 아니다.
   */
  private void requireMovable(long pageId, long spaceId, Long parentId) {
    if (parentId == null) {
      return;
    }
    requireParentInSpace(spaceId, parentId);
    // 새 부모의 조상 체인(자기 자신 포함)에 이동 대상이 있으면 사이클이 된다 — parentId == pageId 도 체인 첫 행이라 여기서 걸린다.
    if (pages.ancestorIdsInclusive(parentId).contains(pageId)) {
      throw new WikiInvalidMoveException("자기 자신이나 자기 하위 페이지를 부모로 지정할 수 없습니다: page=" + pageId);
    }
  }

  /**
   * #758 부모 지정 공통 가드 — 부모가 실제로 존재하고 같은 공간에 속하는지. {@link #create} 와 {@link #move} 가 공유한다(신규 생성은 새 id
   * 라 사이클이 불가능하므로 조상 체인 검사는 필요 없다).
   *
   * <p>생성 경로에도 반드시 걸어야 한다 — 다른 공간의 페이지를 부모로 삼으면 <b>{@code parent_id} 가 ON DELETE CASCADE</b> 라, 나중에
   * 그 부모를 지우는 사람이 자기 공간 밖의 페이지·리비전·첨부를 권한 검사 없이 함께 파괴한다.
   *
   * <p>부모 미존재를 404 가 아니라 400 으로 돌리는 것은 의도적이다 — 404/400 이 갈리면 이 엔드포인트가 "볼 수 없는 공간에 그 id 의 페이지가 있는가"
   * 를 알려주는 존재 오라클이 된다.
   */
  private void requireParentInSpace(long spaceId, long parentId) {
    long parentSpaceId =
        pages
            .findSpaceId(parentId)
            .orElseThrow(() -> new WikiInvalidMoveException("부모 페이지를 찾을 수 없습니다: page=" + parentId));
    if (parentSpaceId != spaceId) {
      throw new WikiInvalidMoveException("다른 공간의 페이지를 부모로 지정할 수 없습니다: page=" + parentId);
    }
  }

  /** 페이지 삭제(자식 CASCADE). EDITOR 이상. */
  @Transactional
  public void delete(long callerId, long pageId) {
    long spaceId = checkDeletable(callerId, pageId);
    // WP-285: 자식은 CASCADE 로 함께 사라지므로 삭제 "전에" 서브트리를 모아 둔다 — 열린 편집 연결 재검증 대상.
    List<Long> removedPageIds = pages.subtreeIdsInclusive(pageId);
    // #757: wiki_page_attachment 는 page_id ON DELETE CASCADE 라 pages.delete() 이후에는 매핑을 조회할
    // 수 없다 — 첨부 회수는 반드시 페이지 삭제 "직전"에 서브트리를 조회해야 한다(순서가 load-bearing).
    attachments.reclaimPageTree(pageId);
    pages.delete(pageId);
    // #724: 삭제를 스페이스 멤버에게 알려 트리·열린 페이지 캐시가 무효화되도록 한다.
    publisher.publishEvent(new WikiPageDeletedEvent(spaceId, pageId, callerId, Instant.now()));
    // 테넌트는 지금 담는다 — 재검증 리스너는 커밋 후 별도 스레드에서 돈다.
    publisher.publishEvent(
        new WikiPageAccessRevokedEvent(
            TenantContext.require(), spaceId, removedPageIds, Instant.now()));
  }

  /** 페이지 삭제 사전검증(#856) — 확인 카드 dry-run 이 {@link #delete} 와 같은 {@link #checkDeletable} 을 쓴다. */
  @Transactional(readOnly = true)
  public void validateDeletable(long callerId, long pageId) {
    checkDeletable(callerId, pageId);
  }

  /** 페이지 삭제 술어 — 페이지 존재 + 공간 EDITOR 이상. 공간 id 를 돌려준다. */
  private long checkDeletable(long callerId, long pageId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    return spaceId;
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

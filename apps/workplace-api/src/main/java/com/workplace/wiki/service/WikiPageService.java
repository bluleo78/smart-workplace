package com.workplace.wiki.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.RevisionReason;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAiAction;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiSearchResult;
import com.workplace.wiki.exception.WikiBaseExpiredException;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.exception.WikiInvalidMoveException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.CollabApplyResult;
import com.workplace.wiki.outbound.CollabClient.MergeBase;
import com.workplace.wiki.outbound.CollabProperties;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageAccessRevokedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageCreatedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageDeletedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageMovedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiPageUpdatedEvent;
import com.workplace.wiki.repository.WikiBodyHistoryRepository;
import com.workplace.wiki.repository.WikiPageDocRepository.RevisionBasis;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 위키 페이지 트리 + 저장. 인가는 페이지의 공간 역할로 해석. 동시 편집 도입 후 본문 저장은 동기화 서버로 위임한다(WP-285, {@link #save}). */
@Service
@RequiredArgsConstructor
@Slf4j
public class WikiPageService {
  private final WikiPageRepository pages;
  private final WikiRevisionRepository revisions;
  // WP-289 AI 병합 기준본 — 읽은 판·쓴 판을 기록한다.
  private final WikiBodyHistoryRepository bodies;
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
    // 생성 응답의 version 으로 곧바로 본문을 저장하는 흐름(create_wiki_page → update_wiki_page)도 기준본이 있게 한다.
    bodies.recordRead(id, detail.version(), detail.body());
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
   * 페이지 상세 조회 + AI 병합 기준본 기록(스펙 §3.3). 기본은 기록한다 — 쿼리를 모르는 구버전 웹(캐시된 PWA)·MCP 가 이 version 으로 본문을 저장할
   * 때 병합 기준이 있어야 409 없이 합쳐진다. 새 웹 에디터는 본문을 REST 로 저장하지 않으므로 {@code recordBase=false}.
   */
  @Transactional
  public WikiPageDetail read(long callerId, long pageId, boolean recordBase) {
    WikiPageDetail detail = get(callerId, pageId);
    if (recordBase) {
      bodies.recordRead(detail.id(), detail.version(), detail.body());
    }
    return detail;
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
   *   <li>본문 포함 + 동기화 서버 켜짐: 실시간 문서가 원본이므로 DB 를 직접 덮지 않고, 요청 version 의 기준본 후보({@link
   *       #resolveBase})로 동기화 서버에 3-way 병합을 맡긴다(WP-289). 기준본이 만료됐고 현재 version 도 아니면 409. 응답 version
   *       에는 병합본과 제출 본문을 함께 기준본으로 남긴다. AI 적용 직전 스냅샷은 동기화 서버의 snapshot 저장이 남긴다.
   *   <li>본문 포함 + 동기화 서버 꺼짐(테스트·비상): 기존 낙관적 저장(version 필수). 리비전은 collab 경로와 같은 시간 규칙.
   * </ul>
   *
   * <p><b>트랜잭션 경계가 load-bearing 이다.</b> 이 메서드는 의도적으로 {@code @Transactional} 이 아니다. 위임 경로에서 동기화 서버는
   * 응답 전에 이 API 의 {@code PUT /internal/wiki/pages/{id}/doc} 로 같은 wiki_page 행을 갱신한다. 제목 저장과 위임을 한
   * 트랜잭션에 두면 제목 UPDATE 의 행 잠금을 쥔 채 그 콜백을 기다려 매 저장이 타임아웃까지 막힌다(구버전 웹·MCP 는 제목과 본문을 늘 함께 보낸다). 그래서 ①
   * 권한 확인·기준본 해석·제목 저장을 자기 트랜잭션으로 먼저 커밋하고 ② 트랜잭션 밖에서 위임한 뒤 ③ 짧은 트랜잭션으로 응답 판의 기준본을 남기고 응답을 만든다. 위임이
   * 실패하면 제목은 이미 커밋된 채 남고 본문 저장만 503 으로 실패한다(본문을 조용히 버리지 않는다).
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
    // ① 권한 확인 + 기준본 해석 + 제목 커밋. 기준본이 없으면(만료) 여기서 409 — 제목 커밋·위임 전이라 아무것도 남기지 않는다.
    //    작성자 표시 이름도 여기서(트랜잭션 안 — RLS GUC 필요) 구해 둔다. AGENT 주체(MCP·비서 계정)면 에이전트 자신의 이름이다.
    Delegation d =
        tx.execute(
            s -> {
              WikiPageDetail current = loadForEdit(callerId, pageId);
              requireVersionPresent(req, pageId);
              MergeBase base = resolveBase(current, req.version());
              saveTitleIfPresent(current, req, callerId);
              return new Delegation(base, users.summaryOf(callerId).name(), current);
            });

    // ② 트랜잭션 밖에서 병합 위임(동기화 서버가 이 API 의 PUT /doc 으로 같은 행을 갱신한다 — 잠금 금지). 실패·타임아웃이면 예외로
    //    끝나 ③의 기준본 기록도 하지 않는다(결과를 모르는 판을 기준으로 남기지 않는다). snapshot 은 AI 적용일 때만(판정 R8) — 동기화
    //    서버의 적용 저장이 직전 판을 리비전으로 남긴다. 사람 저장은 시간 규칙(5분 정적·30분)이 판단하므로 req.snapshot 은 무시한다.
    CollabApplyResult applied =
        collab.applyMarkdown(
            TenantContext.require(), pageId, d.base(), req.body(), callerId, d.actorName(), ai, ai);

    return finishDelegation(tx, pageId, d.current(), req.title(), req.body(), callerId, applied);
  }

  /**
   * 위임 ③ — 동기화 서버 적용이 끝난 뒤 응답 판의 기준본을 남기고 응답 상세를 만든다. 본문 저장 위임과 버전 복원(WP-297, {@link
   * WikiRevisionService#restore})이 공유한다.
   *
   * @param current ①에서 읽은 상세(응답 재조회 실패 시 대체)
   * @param newTitle 이번 요청이 바꾼 제목(없으면 null — 대체 응답에 ①의 제목을 쓴다)
   * @param submittedBody 이번에 제출한 본문 — 응답 판의 제출 본문 기준본 후보
   */
  WikiPageDetail finishDelegation(
      TransactionTemplate tx,
      long pageId,
      WikiPageDetail current,
      String newTitle,
      String submittedBody,
      long callerId,
      CollabApplyResult applied) {
    // ③ 여기부터 본문은 이미 저장됐다 — 무엇이 실패해도 저장 성공(동기화 서버 version)으로 답한다(거짓 500 이면 호출자가 재시도해 중복 적용).
    //    응답 판 기준본 기록은 최선 노력: 자기 트랜잭션으로 시도하고(실패한 SQL 은 트랜잭션을 깨므로 응답 조회와 분리) 실패하면 경고만 남긴다.
    //    persisted=false(적용은 됐지만 동기화 서버의 즉시 저장이 시간 안에 끝나지 않음 — 재시도가 저장한다)도 성공이다. 돌려받은 version 은
    //    적용분이 없는 판이라 이 본문의 기준본으로 남기지 않는다.
    if (!applied.isPersisted()) {
      log.warn("동기화 서버 적용 저장 미완료(적용됨, 재시도 저장 예정): page={} version={}", pageId, applied.version());
    } else {
      try {
        tx.executeWithoutResult(
            s -> bodies.recordApplied(pageId, applied.version(), applied.body(), submittedBody));
      } catch (RuntimeException e) {
        log.warn("기준본 기록 실패(저장은 성공): page={} version={}", pageId, applied.version(), e);
      }
    }
    return appliedDetail(tx, pageId, current, newTitle, callerId, applied);
  }

  /**
   * 위임 저장의 응답 상세 — 재조회에 동기화 서버가 저장한 body·version 을 덮는다. 재조회가 실패하면(DB 일시 장애·그새 삭제) ①에서 읽은 상세에 이번
   * 제목·본문을 얹어 답한다 — 이미 저장된 변경을 500·404 로 보이지 않게.
   */
  private WikiPageDetail appliedDetail(
      TransactionTemplate tx,
      long pageId,
      WikiPageDetail c,
      String newTitle,
      long callerId,
      CollabApplyResult applied) {
    try {
      return tx.execute(
          s ->
              pages
                  .findDetailWithBody(pageId, applied.body(), applied.version())
                  .orElseThrow(() -> new WikiPageNotFoundException(pageId)));
    } catch (RuntimeException e) {
      log.warn("저장 응답 재조회 실패 — ① 상세로 답한다(저장은 성공): page={}", pageId, e);
      return new WikiPageDetail(
          c.id(),
          c.spaceId(),
          c.parentId(),
          newTitle != null ? newTitle : c.title(),
          applied.body(),
          applied.version(),
          callerId,
          OffsetDateTime.now(),
          c.aiLastUsedAt(),
          c.aiLastAction());
    }
  }

  /** 위임 ①의 결과 — 병합 기준본 후보, 적용 주체 표시 이름, ①에서 읽은 상세(응답 재조회 실패 시 대체). */
  private record Delegation(MergeBase base, String actorName, WikiPageDetail current) {}

  /**
   * 요청 version 의 병합 기준본 후보(스펙 §5.1-1).
   *
   * <ol>
   *   <li>기록이 있고 1시간 안이면 그 행(실제 본문 + 있으면 제출 본문). 현재 version 의 기록은 오래돼도 쓴다 — 제출 본문 후보를 잃으면 자기 본문에서
   *       이어 쓰는 구버전 웹의 다음 저장이 남의 수정을 지운다.
   *   <li>기록이 없어도 현재 version 이면 현재 본문이 곧 그 판이다(배포 전에 페이지를 연 구버전 웹).
   *   <li>그 밖 — 409. 무엇을 기준으로 고쳤는지 모르는 본문으로 실시간 문서를 덮지 않는다. 문구는 사유별로 — 현재보다 새 판(잘못된 version), 기록
   *       없음(이 API 로 읽지 않은 판·정리됨), 만료(읽은 지 1시간 초과).
   * </ol>
   */
  private MergeBase resolveBase(WikiPageDetail current, int version) {
    long pageId = current.id();
    boolean isCurrent = version == current.version();
    if (version > current.version()) {
      throw WikiBaseExpiredException.newerThanCurrent(pageId, version, current.version());
    }
    Optional<WikiBodyHistoryRepository.BaseRow> row = bodies.find(pageId, version);
    OffsetDateTime cutoff = OffsetDateTime.now().minus(WikiBodyHistoryRepository.TTL);
    if (row.isPresent() && (isCurrent || row.get().readAt().isAfter(cutoff))) {
      return new MergeBase(row.get().body(), row.get().submittedBody());
    }
    if (isCurrent) {
      return new MergeBase(current.body(), null);
    }
    throw row.isPresent()
        ? WikiBaseExpiredException.expired(pageId, version)
        : WikiBaseExpiredException.notFound(pageId, version);
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
  WikiPageDetail loadForEdit(long callerId, long pageId) {
    WikiPageDetail current =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(current.spaceId(), callerId, "EDITOR");
    return current;
  }

  /**
   * 위임하지 않는 저장(트랜잭션 안). 제목만이면 버전 무관 저장, 본문이 있으면 기존 낙관적 저장. 본문이 바뀌면 동기화 서버 경로와 같은 시간 규칙({@link
   * WikiCollabDocService#timedReason})으로 직전 판을 리비전으로 남긴다 — 기준 시각은 wiki_page.updated_at(이 경로엔
   * wiki_page_doc 이 없다). req.snapshot 은 무시한다(판정 R8).
   */
  WikiPageDetail saveInTx(WikiPageDetail current, long callerId, SavePageRequest req) {
    return saveInTx(current, callerId, req, null);
  }

  /**
   * {@link #saveInTx(WikiPageDetail, long, SavePageRequest)} 에 스냅샷 사유를 강제한다 — 버전 복원(WP-297, {@link
   * WikiRevisionService#restore} 의 꺼진 경로)이 시간 규칙과 무관하게 직전 판을 RESTORE 로 남길 때.
   *
   * @param forcedReason 시간 규칙 대신 쓸 스냅샷 사유, null 이면 시간 규칙
   */
  WikiPageDetail saveInTx(
      WikiPageDetail current, long callerId, SavePageRequest req, RevisionReason forcedReason) {
    long pageId = current.id();
    if (req.body() == null) {
      // 제목만 — 기준본을 남기지 않는다(제목 저장마다 본문 전체 사본을 쓰지 않게). 응답 version 이 현재인 동안은 현재 본문이 곧 기준이다.
      saveTitleIfPresent(current, req, callerId);
      return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    }
    requireVersionPresent(req, pageId);

    snapshotIfDue(current, req.body(), forcedReason);

    String title = req.title() != null ? req.title() : current.title();
    String body = req.body();
    int affected = pages.saveIfVersion(pageId, title, body, req.version(), callerId);
    if (affected == 0) {
      throw new WikiConflictException(pageId);
    }
    // 백링크 교체·첨부 영구화/강등·SSE — 동기화 서버 파생 저장과 같은 후처리(WikiBodyEffects).
    bodyEffects.afterBodySaved(current.spaceId(), pageId, title, body, callerId);
    return detailRecordingBase(pageId);
  }

  /**
   * 동기화 서버가 꺼진 경로의 스냅샷 — 강제 사유(복원)가 있으면 그것, 없으면 시간 규칙. 본문이 그대로거나 비었으면(판정 R6) 남기지 않는다. 누적 편집자를 따로
   * 기록하지 않는 경로라 그 판의 편집자는 직전 수정자 하나, 본문이 바뀐 시각은 wiki_page.updated_at 이다.
   *
   * <p>한계: wiki_page.updated_at 은 제목만 바꾸는 저장도 갱신하므로, 이 경로에선 제목 저장이 정적 간격의 기준 시각을 리셋한다(collab 경로의
   * body_changed_at 과 다름). 동기화 서버가 꺼진 테스트·비상 경로 전용이라 감수한다.
   *
   * <p>한계: 이 경로의 AI(MCP) 본문 저장도 시간 규칙만 따른다 — AI 사유 리비전(✦)과 AI 귀속을 남기지 않는다(AI 스냅샷은 동기화 서버 경로 전용).
   */
  private void snapshotIfDue(WikiPageDetail current, String newBody, RevisionReason forcedReason) {
    if (newBody.equals(current.body()) || current.body().isBlank()) {
      return;
    }
    RevisionReason reason =
        forcedReason != null
            ? forcedReason
            : WikiCollabDocService.timedReason(
                OffsetDateTime.now(),
                current.updatedAt(),
                () -> revisions.latestCreatedAt(current.id()));
    if (reason != null) {
      revisions.snapshot(
          current, reason, RevisionBasis.editorsOf(current.updatedBy()), null, current.updatedAt());
    }
  }

  /** 응답으로 돌려줄 상세를 읽고 그 판을 기준본으로 남긴다(기존 낙관적 본문 저장 — 응답 version 으로 이어 저장할 수 있게). */
  private WikiPageDetail detailRecordingBase(long pageId) {
    WikiPageDetail detail =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    bodies.recordRead(detail.id(), detail.version(), detail.body());
    return detail;
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

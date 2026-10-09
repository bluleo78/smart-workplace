package com.workplace.wiki.service;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.RevisionReason;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiRevisionDetail;
import com.workplace.wiki.dto.WikiRevisionItem;
import com.workplace.wiki.dto.WikiRevisionItem.Person;
import com.workplace.wiki.dto.WikiRevisionListResponse;
import com.workplace.wiki.exception.CollabBodyRejectedException;
import com.workplace.wiki.exception.WikiRevisionNotFoundException;
import com.workplace.wiki.outbound.CollabClient;
import com.workplace.wiki.outbound.CollabClient.CollabApplyResult;
import com.workplace.wiki.outbound.CollabProperties;
import com.workplace.wiki.repository.WikiPageDocRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import com.workplace.wiki.repository.WikiRevisionRepository.RevisionRow;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 버전 기록 조회·복원(WP-297, 스펙 §6). 스냅샷 적재 자체는 저장 경로(동기화 서버 store·{@link WikiPageService} 의 꺼진 경로)가
 * 하고, 여기서는 그 행을 보여 주고 원하는 판으로 본문을 되돌린다. 복원은 본문만 — 제목은 그대로 둔다(판정 R5).
 */
@Service
@RequiredArgsConstructor
public class WikiRevisionService {
  /** 목록 상한(판정 R9) — 30분 주기 규칙상 충분해 페이지네이션은 두지 않는다. */
  static final int LIST_LIMIT = 200;

  private final WikiRevisionRepository revisions;
  private final WikiPageDocRepository docs;
  private final WikiPageService pageService;
  private final CollabClient collab;
  private final CollabProperties collabProps;
  // 표시 이름 조회 — wiki 는 user 도메인 패키지를 import 하지 않으므로 global 일괄 조회를 쓴다(N+1 방지).
  private final UserMentionHydrator users;
  // restore() 는 위임 저장처럼 트랜잭션 경계를 직접 나눈다 — TransactionTemplate 용.
  private final PlatformTransactionManager txManager;

  /** 버전 기록 목록 — 현재 판 + 저장된 판 최신순. VIEWER 이상(비멤버·없는 페이지 404). */
  @Transactional(readOnly = true)
  public WikiRevisionListResponse list(long callerId, long pageId) {
    // 권한(VIEWER)을 판 조회보다 먼저 — 비멤버는 판 유무와 무관하게 404.
    WikiPageDetail page = pageService.get(callerId, pageId);
    List<RevisionRow> rows = revisions.list(pageId, LIST_LIMIT);
    // 현재 판: 마지막 스냅샷 이후 편집자(없으면 직전 수정자)와 마지막 본문 변경 시각(동기화 서버 저장 전이면 updated_at).
    WikiPageDocRepository.RevisionBasis basis = docs.revisionBasis(pageId);
    List<Long> currentEditors = basis.editorsOr(page.updatedBy());
    OffsetDateTime currentEditedAt = basis.editedAtOr(page.updatedAt());

    // 이름은 목록 전체에서 등장하는 사용자를 한 번에 해석한다.
    Set<Long> ids = new LinkedHashSet<>(currentEditors);
    for (RevisionRow r : rows) {
      ids.addAll(r.editorIds());
      if (r.aiActorId() != null) {
        ids.add(r.aiActorId());
      }
    }
    Map<Long, Person> people = resolvePeople(ids);
    List<WikiRevisionItem> items = rows.stream().map(r -> toItem(r, people)).toList();
    return new WikiRevisionListResponse(
        new WikiRevisionListResponse.Current(
            page.version(), currentEditedAt, personsOf(currentEditors, people)),
        items);
  }

  /** 버전 기록 단건(본문 포함). VIEWER 이상. 없는 판 404. */
  @Transactional(readOnly = true)
  public WikiRevisionDetail get(long callerId, long pageId, int version) {
    pageService.get(callerId, pageId);
    RevisionRow r = findRevision(pageId, version);
    Map<Long, Person> people =
        resolvePeople(
            Stream.concat(r.editorIds().stream(), Stream.ofNullable(r.aiActorId())).toList());
    return WikiRevisionDetail.of(toItem(r, people), r.body());
  }

  /** 리비전 행 → 목록 항목(편집자·✦ 귀속을 표시 사용자로). 목록·단건이 공유한다. */
  private static WikiRevisionItem toItem(RevisionRow r, Map<Long, Person> people) {
    return new WikiRevisionItem(
        r.version(),
        r.title(),
        r.editedAt(),
        r.createdAt(),
        r.reason(),
        personsOf(r.editorIds(), people),
        personOf(r.aiActorId(), people));
  }

  /**
   * 그 판의 본문으로 복원한다. EDITOR 이상. 없는 판 404. 응답은 본문 저장(PUT)과 같은 페이지 상세.
   *
   * <ul>
   *   <li>동기화 서버 켜짐: 실시간 문서가 원본이므로 {@link CollabClient#replaceMarkdown} 으로 위임한다. 동기화 서버가 미저장 입력을 먼저
   *       저장한 뒤 복원 본문을 RESTORE 사유로 저장하므로, 복원 직전 판 스냅샷·백링크·첨부·SSE 는 그 저장 경로({@link
   *       WikiCollabDocService#store})가 맡는다 — 여기서 스냅샷을 또 남기면 미저장 입력이 빠진 판이 잘못 남는다.
   *   <li>동기화 서버 꺼짐(테스트·비상): 한 트랜잭션에서 {@link WikiPageService#saveInTx} 에 RESTORE 사유를 실어 본문을 저장한다 —
   *       현재 판 스냅샷·후처리는 그 저장 경로가 맡는다.
   * </ul>
   *
   * <p>트랜잭션 경계는 {@link WikiPageService#save} 위임과 같은 이유로 load-bearing 이다 — 동기화 서버가 응답 전에 이 API 의 PUT
   * /doc 으로 같은 행을 갱신하므로 위임 동안 트랜잭션(행 잠금)을 쥐지 않는다.
   */
  public WikiPageDetail restore(long callerId, long pageId, int version) {
    TransactionTemplate tx = new TransactionTemplate(txManager);
    if (!collabProps.enabled()) {
      return tx.execute(s -> restoreInTx(callerId, pageId, version));
    }
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("동기화 서버 복원 위임은 트랜잭션 밖에서 호출해야 합니다: page=" + pageId);
    }
    // ① 권한(EDITOR)·대상 판·작성자 이름 — RLS GUC 가 필요한 조회라 트랜잭션 안에서.
    Restoring r =
        tx.execute(
            s -> {
              WikiPageDetail current = pageService.loadForEdit(callerId, pageId);
              RevisionRow rev = findRestorable(pageId, version);
              return new Restoring(current, rev.body(), users.summaryOf(callerId).name());
            });
    // ② 트랜잭션 밖에서 위임. 실패하면 예외 그대로(503 등) — 아무것도 기록하지 않는다.
    CollabApplyResult applied =
        collab.replaceMarkdown(TenantContext.require(), pageId, r.body(), callerId, r.actorName());
    // ③ 본문 저장 위임과 같은 마무리(응답 판 기준본 최선 노력 기록 + 상세 재조회).
    return pageService.finishDelegation(tx, pageId, r.current(), null, r.body(), callerId, applied);
  }

  /** 동기화 서버 위임 복원 ①의 결과. */
  private record Restoring(WikiPageDetail current, String body, String actorName) {}

  /**
   * 동기화 서버가 꺼진 복원(트랜잭션 안). 본문이 이미 같으면 저장하지 않는다(version 을 올리지 않게). 현재 판 스냅샷은 saveInTx 가 시간 규칙 대신
   * RESTORE 사유로 남긴다(현재 본문이 비었으면 남기지 않는다 — 판정 R6).
   */
  private WikiPageDetail restoreInTx(long callerId, long pageId, int version) {
    WikiPageDetail current = pageService.loadForEdit(callerId, pageId);
    RevisionRow rev = findRestorable(pageId, version);
    if (rev.body().equals(current.body())) {
      return current;
    }
    return pageService.saveInTx(
        current,
        callerId,
        new SavePageRequest(null, rev.body(), current.version(), false),
        RevisionReason.RESTORE);
  }

  /**
   * 복원 대상 판 — 없으면 404, 본문이 비었으면(WP-297 이전 옛 행) 400. 빈 본문 복원은 노트를 비우는 것이라 받지 않는다: 동기화 서버도 빈 본문 적용을
   * 거부(empty_body)하므로 켜짐·꺼짐 경로가 같은 400 으로 답하도록 위임 전에 막는다.
   */
  private RevisionRow findRestorable(long pageId, int version) {
    RevisionRow rev = findRevision(pageId, version);
    if (rev.body().isBlank()) {
      throw new CollabBodyRejectedException("본문이 비어 있는 버전은 복원할 수 없습니다.", null);
    }
    return rev;
  }

  /** 페이지의 그 version 리비전(본문 포함). 없으면 404. */
  private RevisionRow findRevision(long pageId, int version) {
    return revisions
        .find(pageId, version)
        .orElseThrow(() -> new WikiRevisionNotFoundException(pageId, version));
  }

  /** 사용자 id → 표시 사용자. 한 번의 조회로 해석하고, 사라진 사용자는 빠진다. 이름이 비었으면 username 으로 대체. */
  private Map<Long, Person> resolvePeople(Collection<Long> ids) {
    return users.asMentionResponses(List.copyOf(ids)).stream()
        .collect(
            Collectors.toMap(
                MentionResponse::id,
                m -> new Person(m.id(), m.name() != null ? m.name() : m.username()),
                (a, b) -> a));
  }

  /** id 목록 → 표시 사용자 목록(순서 유지). 해석되지 않은(삭제된) 사용자는 뺀다. */
  private static List<Person> personsOf(List<Long> ids, Map<Long, Person> people) {
    return ids.stream().map(people::get).filter(Objects::nonNull).toList();
  }

  /** 단일 id → 표시 사용자. null 이거나 해석되지 않으면 null. */
  private static Person personOf(Long id, Map<Long, Person> people) {
    return id == null ? null : people.get(id);
  }
}

package com.workplace.wiki.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.CollabAccessResponse;
import com.workplace.wiki.dto.CollabDocResponse;
import com.workplace.wiki.dto.RevisionReason;
import com.workplace.wiki.dto.StoreCollabDocRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageDocRepository;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 동기화 서버용 문서 상태 서비스(WP-286) — Yjs 상태(원본)와 파생 마크다운 body 를 한 트랜잭션에 저장한다.
 *
 * <p>저장 후처리(백링크·첨부 정리·SSE)는 {@link WikiPageService#save} 와 같은 {@link WikiBodyEffects} 를 쓴다 — collab
 * 경로라고 백링크나 첨부 수명주기가 어긋나면 안 되기 때문이다. load/store 의 호출자는 내부 토큰·테넌트 컨텍스트를 이미 설정한 내부 컨트롤러뿐이다(사용자 권한 판정은
 * 연결 시 {@link #access} 에서 끝남).
 */
@Service
@RequiredArgsConstructor
public class WikiCollabDocService {
  /**
   * 정적 간격(WP-297, 스펙 §6.1) — 마지막 본문 저장 뒤 이만큼 조용했다가 다시 저장되면 새 편집 묶음의 시작으로 보고 바뀌기 직전 판을 남긴다. 동기화 서버의
   * 저장 디바운스(2초·최대 10초)라 저장 시각 ≈ 편집 시각이다.
   */
  public static final Duration QUIET_GAP = Duration.ofMinutes(5);

  /** 주기 간격 — 쉬지 않는 긴 편집 중에도 마지막 리비전 뒤 이만큼 지나면 중간 판을 남긴다(한 번에 너무 많은 변경이 한 판으로 묶이지 않게). */
  public static final Duration PERIODIC_GAP = Duration.ofMinutes(30);

  private final WikiPageRepository pages;
  private final WikiRevisionRepository revisions;
  private final WikiPageDocRepository docs;
  private final WikiBodyEffects bodyEffects;
  private final WikiPermissions perms;
  // 표시 이름 조회 — 도메인 간 직접 의존 금지 규칙상 user 모듈 리포지토리 대신 global 공용 조회를 쓴다.
  private final UserMentionHydrator users;

  /** 문서 로드 — 저장된 Yjs 상태가 없으면(미이전 페이지) state·bodyVersion 없이 body 만 돌려 동기화 서버가 body 로 문서를 만든다. */
  @Transactional(readOnly = true)
  public CollabDocResponse load(long pageId) {
    WikiPageDetail page =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    return docs.find(pageId)
        .map(
            d ->
                new CollabDocResponse(
                    Base64.getEncoder().encodeToString(d.state()),
                    page.body(),
                    page.version(),
                    d.bodyVersion()))
        .orElseGet(() -> new CollabDocResponse(null, page.body(), page.version(), null));
  }

  /**
   * 문서 저장 — 버전 검사 없이 body 를 파생 갱신(version+1)하고 그 version 을 body_version 으로 상태와 함께 기록한다. body 가 없으면
   * 상태만 저장하고({@link #storeStateOnly}), body 가 현재와 같으면 상태만 현재 version 으로 기록한다.
   *
   * @return 갱신 후 wiki_page.version(본문이 바뀌지 않았으면 현재 version 그대로)
   */
  @Transactional
  public int store(long pageId, StoreCollabDocRequest req) {
    WikiPageDetail current =
        pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    byte[] state = Base64.getDecoder().decode(req.state());
    if (req.stateOnly()) {
      return storeStateOnly(pageId, current, req.bodyVersion(), state);
    }
    if (req.body().equals(current.body())) {
      // 본문이 그대로인 파생 저장(서식 왕복·쳤다 지움 등) — 상태만 기록한다. version·updated_*·백링크·첨부·SSE 를 건드리면
      // 열어 두기만 해도 version 이 올라 낙관적 잠금·요약 낡음 표시·최근 수정 순서가 흔들린다. 상태는 현재 body 와 일치하므로
      // body_version 은 현재 version.
      docs.upsert(pageId, state, current.version());
      return current.version();
    }
    // 버전 기록 스냅샷(스펙 §6.1, 판정 R1): AI·복원 적용은 항상, 사람 편집은 5분 넘게 조용했다가 다시 시작될 때와 연속 편집 30분마다.
    // 스냅샷은 "바뀌기 직전" 판 — 그 판을 만든 편집자(마지막 스냅샷 이후 누적)를 함께 남기고 누적을 이번 저장 편집자로 다시 시작한다.
    OffsetDateTime now = OffsetDateTime.now();
    WikiPageDocRepository.RevisionBasis basis = docs.revisionBasis(pageId);
    RevisionReason reason =
        req.snapshot()
            ? (req.snapshotReason() != null
                ? RevisionReason.valueOf(req.snapshotReason())
                : RevisionReason.AI)
            : timedReason(now, basis.bodyChangedAt(), () -> revisions.latestCreatedAt(pageId));
    List<Long> pending = basis.pendingEditorIds();
    // 빈 본문(막 만든 노트)은 복원할 게 없어 남기지 않는다(판정 R6).
    if (reason != null && !current.body().isBlank()) {
      Long aiActor = reason == RevisionReason.AI ? aiActorOf(req) : null;
      // 같은 version 행이 이미 있어 적재가 무시됐으면 누적 편집자를 비우지 않는다(그 편집자들이 어느 판에도 남지 않게 되므로).
      if (revisions.snapshot(
          current,
          reason,
          basis.editorsOr(current.updatedBy()),
          aiActor,
          basis.editedAtOr(current.updatedAt()))) {
        pending = List.of();
      }
    }
    // 편집자 없이 저장되는 경우(서버 내부 적용)는 updated_by 를 건드리지 않아 직전 수정자를 유지한다.
    // 갓 생성된 페이지는 updated_by 자체가 NULL 이라 long 으로 언박싱하면 NPE — null 을 그대로 전달한다.
    Long editorId = lastEditor(req.editorIds());
    int version = pages.saveDerivedBody(pageId, req.body(), editorId);
    docs.upsertBodyChanged(pageId, state, version, now, union(pending, req.editorIds()));
    // WikiPageService.save 와 같은 후처리(백링크·첨부·SSE). actorId 는 이번 편집자, 없으면 직전 수정자(그마저 없으면 null).
    bodyEffects.afterBodySaved(
        current.spaceId(),
        pageId,
        current.title(),
        req.body(),
        editorId != null ? editorId : current.updatedBy());
    return version;
  }

  /**
   * 상태만 저장 — 편집 없이 저장된 body 로 만든 상태(최초 이관·body 앞섬 반영)를 기록한다.
   * wiki_page(body·version·updated_*)·백링크·첨부·SSE 는 건드리지 않는다: 재직렬화 body 는 원문과 다를 수 있어(원문 HTML
   * 제거·체크리스트 이스케이프 등) 열기만 해도 본문이 손실되고, version 이 오르면 최근 수정 순서와 캐시된 클라이언트의 낙관적 잠금(#611)이 흔들린다.
   *
   * <p>body_version 은 상태를 만든 body 의 version(요청값)으로 두되 현재 version 을 넘지 않는다. 로드 뒤 collab 밖에서 body 가
   * 바뀌었으면 더 낮게 남아 다음 로드가 stale 로 보고 최신 body 를 반영한다(현재 version 으로 덮으면 그 바깥 변경이 다음 파생 저장에 덮인다).
   */
  private int storeStateOnly(
      long pageId, WikiPageDetail current, int requestedBodyVersion, byte[] state) {
    int bodyVersion = Math.min(requestedBodyVersion, current.version());
    docs.upsert(pageId, state, bodyVersion);
    return current.version();
  }

  /**
   * 연결 시 권한 판정 — VIEWER 이상이 아니면 기존 예외(비멤버·페이지 없음 404, 역할 미달 403)로 거부된다.
   *
   * @param tokenExp 호출자 JWT 의 exp(epoch 초). JWT 인증이 아니면 null — 컨트롤러가 요청 헤더에서 해석해 넘긴다
   */
  @Transactional(readOnly = true)
  public CollabAccessResponse access(long callerId, long pageId, Long tokenExp) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    String role = perms.requireRole(spaceId, callerId, "VIEWER");
    return new CollabAccessResponse(
        pageId,
        spaceId,
        TenantContext.require(),
        callerId,
        users.summaryOf(callerId).name(),
        role,
        tokenExp);
  }

  /**
   * 시간 규칙의 스냅샷 사유(스펙 §6.1) — collab 저장과 동기화 서버가 꺼진 저장 경로({@link WikiPageService})가 같은 규칙을 쓰도록 공유한다.
   *
   * <ol>
   *   <li>기준 시각이 없거나 {@link #QUIET_GAP} 이상 조용했으면 SESSION — 기준 시각이 없는 기존 페이지는 이관 직후 첫 저장에서 1회 남는다.
   *   <li>아니면(이어지는 편집) 마지막 리비전이 {@link #PERIODIC_GAP} 이상 지났으면 PERIODIC. 리비전이 아직 없으면 PERIODIC 도 아니다
   *       — 막 만든 노트(빈 본문이라 첫 저장 스냅샷을 건너뜀)의 둘째 저장이 몇 초 만에 거의 빈 판을 남기지 않게. 첫 판은 다음 SESSION 이 남긴다.
   *   <li>그 밖은 null(남기지 않음).
   * </ol>
   *
   * @param lastBodyChange 마지막 본문 변경 시각(collab: wiki_page_doc.body_changed_at, 꺼진 경로:
   *     wiki_page.updated_at). null 허용
   * @param latestRevision 마지막 리비전 적재 시각 — SESSION 이 아닐 때만 조회한다(저장마다 쿼리하지 않게)
   */
  static RevisionReason timedReason(
      OffsetDateTime now,
      OffsetDateTime lastBodyChange,
      Supplier<Optional<OffsetDateTime>> latestRevision) {
    if (lastBodyChange == null || !lastBodyChange.plus(QUIET_GAP).isAfter(now)) {
      return RevisionReason.SESSION;
    }
    boolean periodicDue =
        latestRevision.get().map(t -> !t.plus(PERIODIC_GAP).isAfter(now)).orElse(false);
    return periodicDue ? RevisionReason.PERIODIC : null;
  }

  /** AI 적용 스냅샷의 ✦ 귀속 — 동기화 서버가 실어 보낸 요청자, 없으면(구버전 동기화 서버, 판정 R7) 저장 편집자의 마지막 값. */
  private static Long aiActorOf(StoreCollabDocRequest req) {
    return req.aiActorId() != null ? req.aiActorId() : lastEditor(req.editorIds());
  }

  /** 누적 편집자에 이번 저장 편집자를 덧붙인다 — 처음 등장 순, 중복 없음. */
  private static List<Long> union(List<Long> pending, List<Long> editorIds) {
    LinkedHashSet<Long> all = new LinkedHashSet<>(pending);
    if (editorIds != null) {
      editorIds.stream().filter(Objects::nonNull).forEach(all::add);
    }
    return List.copyOf(all);
  }

  /** 편집자 목록의 마지막 값(가장 최근 편집자). 비었으면 null. */
  private static Long lastEditor(List<Long> editorIds) {
    return editorIds == null || editorIds.isEmpty() ? null : editorIds.getLast();
  }
}

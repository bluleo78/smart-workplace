package com.workplace.wiki.service;

import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.tenant.TenantContext;
import com.workplace.wiki.dto.CollabAccessResponse;
import com.workplace.wiki.dto.CollabDocResponse;
import com.workplace.wiki.dto.StoreCollabDocRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageDocRepository;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
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
   * 리비전 편집 세션 간격 — 마지막 리비전이 이보다 오래됐으면 다음 본문 변경을 새 편집 세션의 첫 저장으로 보고 직전 본문을 리비전으로 남긴다. 동시 편집 전에는 웹이
   * "에디터를 연 뒤 첫 저장"에 snapshot=true 를 실어 보냈지만(시간 간격 없음), 이제 본문은 동기화 서버가 2초마다 파생 저장하므로 서버가 시간 간격으로 대신
   * 판정한다. 동시 편집용 스냅샷 정책(WP-297) 전까지의 임시 규칙.
   */
  public static final Duration REVISION_SESSION_GAP = Duration.ofMinutes(10);

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
    // AI 적용 저장은 항상 직전 판을 남긴다(되돌리기 대비). 그 밖은 편집 세션 간격 규칙(WP-297 전 임시).
    if (req.snapshot()) {
      revisions.snapshot(current);
    } else {
      snapshotIfNewSession(current);
    }
    // 편집자 없이 저장되는 경우(서버 내부 적용)는 updated_by 를 건드리지 않아 직전 수정자를 유지한다.
    // 갓 생성된 페이지는 updated_by 자체가 NULL 이라 long 으로 언박싱하면 NPE — null 을 그대로 전달한다.
    Long editorId = lastEditor(req.editorIds());
    int version = pages.saveDerivedBody(pageId, req.body(), editorId);
    docs.upsert(pageId, state, version);
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
   * 본문이 바뀌기 직전 — 마지막 리비전이 없거나 {@link #REVISION_SESSION_GAP} 보다 오래됐으면 지금(바뀌기 전) 상태를 리비전으로 남긴다. 같은
   * version 이 이미 있으면 저장소가 무시한다(AI 덮어쓰기 전 스냅샷과 겹칠 때).
   */
  private void snapshotIfNewSession(WikiPageDetail current) {
    OffsetDateTime cutoff = OffsetDateTime.now().minus(REVISION_SESSION_GAP);
    boolean recent =
        revisions.latestCreatedAt(current.id()).filter(t -> t.isAfter(cutoff)).isPresent();
    if (!recent) {
      revisions.snapshot(current);
    }
  }

  /** 편집자 목록의 마지막 값(가장 최근 편집자). 비었으면 null. */
  private static Long lastEditor(List<Long> editorIds) {
    return editorIds == null || editorIds.isEmpty() ? null : editorIds.getLast();
  }
}

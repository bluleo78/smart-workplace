package com.workplace.wiki.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.MembershipGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import com.workplace.user.repository.UserRepository;
import com.workplace.wiki.dto.WikiPageShareRequest;
import com.workplace.wiki.dto.WikiPageShareResponse;
import com.workplace.wiki.dto.WikiPageShareStateResponse;
import com.workplace.wiki.dto.WikiShareEventResponse;
import com.workplace.wiki.dto.WikiShareListItemResponse;
import com.workplace.wiki.dto.WikiSharePerson;
import com.workplace.wiki.exception.WikiExternalShareDisabledException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.exception.WikiShareNotFoundException;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiShareAccessChangedEvent;
import com.workplace.wiki.outbound.WikiShareNotifyEvents.WikiSharedWithPeopleEvent;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.PolicyLock;
import com.workplace.wiki.repository.WikiShareRepository.ShareDetail;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.JSONB;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 페이지 공유 설정(WP-579) — 공유 창의 만들기·바꾸기·재발급·해제·기록. 모두 그 페이지 스페이스의 EDITOR 이상만 한다(공유 토큰 헤더는 받지 않는다 —
 * 공유로 들어온 사람은 공유를 바꾸지 못한다). 보기 권한만 있는 멤버가 편집 링크의 토큰을 읽어 스스로 편집 권한을 얻지 못하게, 설정 조회도 EDITOR 이상이다.
 *
 * <p>바꿀 때마다 두 갈래로 남긴다(설계 「기록·감사」): 공유 창의 「공유 기록」(wiki_page_share_event, 해제 뒤에도 남음)과 관리자 감사
 * 로그({@link WikiShareAudit}). 접근이 줄어드는 변경(대상 축소·권한 축소·하위 포함 끔·사람 제외·만료 앞당김·재발급·해제)은 {@link
 * WikiShareAccessChangedEvent} 를 한 번 발행해, 커밋 뒤 동기화 서버가 공유로 열린 편집 화면을 다시 판정하게 한다. 여러 공유를 함께 해제하는
 * 경로(관리자 일괄 해제·정책 끔·공유한 사람이 떠남)는 {@link #revokeAll} 로 모아 이벤트도 한 번 낸다.
 */
@Service
@RequiredArgsConstructor
public class WikiShareService {
  /** 공유 기록 조회 상한 — 공유 창의 펼침 목록은 최근 기록만 보인다. */
  private static final int EVENT_LIMIT = 200;

  private static final Set<String> AUDIENCES = Set.of("WORKSPACE", "PEOPLE", "PUBLIC");
  private static final Set<String> PERMISSIONS = Set.of("VIEW", "EDIT");

  /** 대상이 넓은 순서 — 숫자가 작아지면 「범위 축소」. */
  private static final Map<String, Integer> AUDIENCE_RANK =
      Map.of("PEOPLE", 1, "WORKSPACE", 2, "PUBLIC", 3);

  /** 기록 문구의 대상·권한 이름(웹 공유 창과 같은 말). */
  private static final Map<String, String> AUDIENCE_LABEL =
      Map.of("WORKSPACE", "워크스페이스 전체", "PEOPLE", "지정한 사람", "PUBLIC", "외부 공개");

  private static final Map<String, String> PERMISSION_LABEL = Map.of("VIEW", "보기", "EDIT", "편집");

  /** 「…(으)로 바꿨습니다」의 조사까지 붙인 이름 — 받침에 따라 로/으로가 갈린다. */
  private static final Map<String, String> AUDIENCE_TO =
      Map.of("WORKSPACE", "워크스페이스 전체로", "PEOPLE", "지정한 사람으로", "PUBLIC", "외부 공개로");

  private static final Map<String, String> PERMISSION_TO = Map.of("VIEW", "보기로", "EDIT", "편집으로");

  private final WikiShareRepository shares;
  private final WikiPageRepository pages;
  // 기록 문구의 사람 이름(사용자 id → 표시 이름).
  private final UserRepository users;
  private final WikiPermissions perms;
  private final WikiSpaceRepository spaces;
  private final MembershipGuard membershipGuard;
  private final WikiShareAudit audit;
  private final ApplicationEventPublisher publisher;
  private final ObjectMapper objectMapper;

  /** 공유 창 상태 — 이 페이지 공유, 외부 공유 허용, 상위 공유 포함 여부, 대기 중 접근 요청. EDITOR 이상. */
  @Transactional(readOnly = true)
  public WikiPageShareStateResponse state(long callerId, long pageId) {
    requireEditor(callerId, pageId);
    ShareDetail share = shares.findByPage(pageId).orElse(null);
    return new WikiPageShareStateResponse(
        share == null ? null : toResponse(share),
        shares.isExternalShareEnabled(TenantContext.require(), PolicyLock.NONE),
        shares.findNearestIncludingAncestor(pageId).orElse(null),
        share == null ? List.of() : shares.listPendingRequests(pageId));
  }

  /**
   * 공유 만들기·바꾸기(PUT) — 없으면 만들고(새 토큰), 있으면 설정과 지정한 사람을 요청대로 덮어쓴다(토큰 유지).
   *
   * @throws IllegalArgumentException 잘못된 대상·권한, 외부 공개 편집, 지난 만료, 워크스페이스 구성원이 아닌 사람 지정(400)
   * @throws WikiExternalShareDisabledException 관리자가 외부 공유를 꺼 두었는데 외부 공개로 요청(409)
   */
  @Transactional
  public WikiPageShareResponse save(long callerId, long pageId, WikiPageShareRequest req) {
    long spaceId = lockEditor(callerId, pageId);
    Settings next = validate(req);
    // 외부 공개로 만들거나 바꿀 때는 정책을 잠가 읽는다 — 관리자가 끄는 중이면 그 커밋을 기다려 꺼진 값을 보고 거절된다.
    if ("PUBLIC".equals(next.audience())
        && !shares.isExternalShareEnabled(TenantContext.require(), PolicyLock.SHARE)) {
      throw new WikiExternalShareDisabledException();
    }

    ShareDetail before = shares.findByPageForUpdate(pageId).orElse(null);
    requireFutureExpiry(before, next);
    if (before == null
        && shares.insertIfAbsent(
            pageId,
            spaceId,
            CapabilityTokens.generate("wsh_"),
            next.audience(),
            next.permission(),
            next.includeChildren(),
            next.expiresAt(),
            callerId)) {
      recordCreated(callerId, pageId, spaceId, next);
      ShareDetail created = shares.findByPage(pageId).orElseThrow();
      if ("PEOPLE".equals(next.audience())) {
        changePeople(
            callerId,
            created,
            next.permission(),
            List.of(),
            next.userIds(),
            next.notification(),
            false);
      }
      return toResponse(created);
    }
    if (before == null) {
      // 같은 페이지를 동시에 처음 켠 요청이 먼저 만들었다 — 그 행을 잠가 읽고 바꾸기로 이어 간다.
      before = shares.findByPageForUpdate(pageId).orElseThrow();
      requireFutureExpiry(before, next);
    }
    return update(callerId, before, next);
  }

  /** 링크 다시 만들기 — 새 토큰. 이전 링크와 그 링크로 열린 화면은 커밋 즉시 막힌다. EDITOR 이상. */
  @Transactional
  public WikiPageShareResponse regenerate(long callerId, long pageId) {
    lockEditor(callerId, pageId);
    ShareDetail share =
        shares.findByPageForUpdate(pageId).orElseThrow(WikiShareNotFoundException::new);
    List<Long> covered = coveredPages(share);
    shares.updateToken(share.id(), CapabilityTokens.generate("wsh_"));
    event(callerId, pageId, "REGENERATED", "링크를 다시 만들었습니다");
    audit.log(
        WikiShareAudit.REGENERATED,
        pageId,
        share.spaceId(),
        metadata(share.audience(), share.permission()));
    publishAccessChanged(covered);
    return toResponse(shares.findByPage(pageId).orElseThrow());
  }

  /** 공유 해제 — 공유 행을 지운다(기록은 남는다). 이미 없으면 아무것도 하지 않는다(멱등). EDITOR 이상. */
  @Transactional
  public void revoke(long callerId, long pageId) {
    requireEditor(callerId, pageId);
    ShareDetail share = shares.findByPageForUpdate(pageId).orElse(null);
    if (share == null) {
      return;
    }
    revokeAll(callerId, List.of(share), "REVOKED", "공유를 해제했습니다", "USER");
  }

  /**
   * 공유 여러 건을 해제하고 재검증 이벤트를 한 번 낸다 — 사용자 해제·관리자 일괄 해제·정책 끔·공유한 사람이 떠남이 함께 쓴다. 이벤트의 페이지는 지운 공유들이 덮던
   * 페이지의 합집합이다(스페이스를 가로질러도 한 번 — 재검증은 페이지로만 연결을 찾는다). 공유 행은 호출자가 잠가 읽어 넘긴다(해제 경로가 모두 같은 page_id 순으로
   * 잠가 교착하지 않게). 비었으면 아무것도 하지 않는다.
   *
   * @param actorId 공유 기록의 행위자(null = 시스템) — 감사 로그의 행위자(요청 사용자)와 같은 사람이어야 한다
   * @return 해제한 공유 수
   */
  int revokeAll(
      Long actorId, List<ShareDetail> targets, String eventType, String eventText, String reason) {
    if (targets.isEmpty()) {
      return 0;
    }
    Set<Long> covered = new LinkedHashSet<>();
    for (ShareDetail share : targets) {
      covered.addAll(revokeShare(actorId, share, eventType, eventText, reason));
    }
    publishAccessChanged(List.copyOf(covered));
    return targets.size();
  }

  /**
   * 공유 한 건을 지운다 — {@link #revokeAll} 의 한 건(대기 중 접근 요청 정리·공유 기록·감사가 어느 해제 경로든 같다). 재검증 이벤트는
   * revokeAll 이 모아서 낸다.
   *
   * @param actorId 공유 기록의 행위자(null = 시스템) — 감사 로그의 행위자(요청 사용자)와 같은 사람이어야 한다
   * @param eventType 공유 기록 종류(REVOKED | REVOKED_BY_ADMIN | REVOKED_BY_POLICY |
   *     REVOKED_BY_MEMBERSHIP)
   * @param reason 감사 metadata reason(USER | ADMIN | POLICY | MEMBERSHIP)
   * @return 지우기 전에 이 공유가 덮던 페이지 — 재검증 대상
   */
  private List<Long> revokeShare(
      Long actorId, ShareDetail share, String eventType, String eventText, String reason) {
    // 지우기 전에 덮던 페이지를 모은다 — 재검증 대상.
    List<Long> covered = coveredPages(share);
    shares.delete(share.id());
    // 대기 중 접근 요청도 함께 지운다 — 다시 공유했을 때 옛 요청이 되살아나지 않게.
    shares.deletePendingRequests(share.pageId());
    event(actorId, share.pageId(), eventType, eventText);
    auditRevoked(share, reason);
    return covered;
  }

  /**
   * 감사 WIKI_SHARE_REVOKED 한 건(설계 「기록·감사」: spaceId·audience·permission·reason). 페이지·스페이스 삭제로 공유 행이
   * CASCADE 로 사라질 때는 공유 기록(페이지에 매달려 함께 지워짐) 없이 이것만 남긴다.
   */
  void auditRevoked(ShareDetail share, String reason) {
    Map<String, Object> extra = metadata(share.audience(), share.permission());
    extra.put("reason", reason);
    audit.log(WikiShareAudit.REVOKED, share.pageId(), share.spaceId(), extra);
  }

  /** 공유 기록(최신순 200건). 해제된 공유의 기록도 보인다. EDITOR 이상. */
  @Transactional(readOnly = true)
  public List<WikiShareEventResponse> events(long callerId, long pageId) {
    requireEditor(callerId, pageId);
    return shares.listEvents(pageId, EVENT_LIMIT);
  }

  /**
   * 스페이스의 공유 중인 페이지 목록 — VIEWER 이상. 토큰은 EDITOR 이상에게만 준다(보기 권한만 있는 멤버가 편집 링크 토큰을 읽어 스스로 편집 권한을 얻지
   * 못하게 — 공유 창 설정 조회를 EDITOR 이상으로 둔 것과 같은 이유).
   */
  @Transactional(readOnly = true)
  public List<WikiShareListItemResponse> listBySpace(long callerId, long spaceId) {
    String role = perms.requireRole(spaceId, callerId, "VIEWER");
    List<WikiShareListItemResponse> items = shares.listBySpace(spaceId);
    if (WikiPermissions.atLeast(role, "EDITOR")) {
      return items;
    }
    return items.stream().map(WikiShareListItemResponse::withoutToken).toList();
  }

  /** 내가 만든 공유(스페이스를 가로질러) — 내가 만든 링크라 토큰을 함께 준다. */
  @Transactional(readOnly = true)
  public List<WikiShareListItemResponse> listMine(long callerId) {
    return shares.listByCreator(callerId);
  }

  // ── 바꾸기 ──────────────────────────────────────────────────────────────

  /** 기존 공유를 요청대로 바꾼다 — 바뀐 설정마다 기록 한 줄, 감사는 한 건(changed), 사람 차이는 따로. 접근이 줄면 재검증 이벤트 한 번. */
  private WikiPageShareResponse update(long callerId, ShareDetail before, Settings next) {
    long pageId = before.pageId();
    Map<String, Object> changed = new LinkedHashMap<>();
    List<String> lines = new ArrayList<>();
    if (!before.audience().equals(next.audience())) {
      changed.put("audience", Arrays.asList(before.audience(), next.audience()));
      lines.add("열 수 있는 사람을 " + AUDIENCE_TO.get(next.audience()) + " 바꿨습니다");
    }
    if (!before.permission().equals(next.permission())) {
      changed.put("permission", Arrays.asList(before.permission(), next.permission()));
      lines.add("권한을 " + PERMISSION_TO.get(next.permission()) + " 바꿨습니다");
    }
    if (before.includeChildren() != next.includeChildren()) {
      changed.put(
          "includeChildren", Arrays.asList(before.includeChildren(), next.includeChildren()));
      lines.add(next.includeChildren() ? "하위 페이지 포함을 켰습니다" : "하위 페이지 포함을 껐습니다");
    }
    if (!sameInstant(before.expiresAt(), next.expiresAt())) {
      changed.put("expiresAt", Arrays.asList(iso(before.expiresAt()), iso(next.expiresAt())));
      lines.add(
          next.expiresAt() == null
              ? "만료를 없앴습니다"
              : before.expiresAt() == null ? "만료를 정했습니다" : "만료를 바꿨습니다");
    }
    if (!changed.isEmpty()) {
      shares.updateSettings(
          before.id(),
          next.audience(),
          next.permission(),
          next.includeChildren(),
          next.expiresAt());
      lines.forEach(line -> event(callerId, pageId, "UPDATED", line));
      Map<String, Object> extra = metadata(next.audience(), next.permission());
      extra.put("changed", changed);
      if ("PUBLIC".equals(next.audience()) && !"PUBLIC".equals(before.audience())) {
        extra.put("external", true);
      }
      audit.log(WikiShareAudit.UPDATED, pageId, before.spaceId(), extra);
    }

    boolean peopleRemoved;
    if ("PEOPLE".equals(next.audience())) {
      peopleRemoved =
          changePeople(
              callerId,
              before,
              next.permission(),
              shares.listPeopleIds(before.id()),
              next.userIds(),
              next.notification(),
              false);
    } else {
      // 지정한 사람만이 아니게 되면 목록은 뜻이 없어진다 — 대상 변경 기록이 이미 남았으므로 따로 기록하지 않고 비운다.
      shares.removePeople(before.id(), null);
      // 대기 중 접근 요청도 뜻을 잃는다 — 해제(revokeShare)와 같은 정리로 지워, 다시 지정한 사람으로 돌렸을 때 옛 요청이 되살아나지 않게.
      shares.deletePendingRequests(pageId);
      peopleRemoved = false;
    }

    if (narrows(before, next) || peopleRemoved) {
      // 재검증 대상은 바뀌기 전 공유가 덮던 페이지 — 바꾸는 동안 트리는 그대로라(공유 행만 바뀐다) 필요할 때 여기서 구해도 같다.
      publishAccessChanged(coveredPages(before));
    }
    return toResponse(shares.findByPage(pageId).orElseThrow());
  }

  /**
   * 지정한 사람(PEOPLE) 공유의 사람을 current 에서 desired 로 맞춘다 — 호출자가 PEOPLE 공유일 때만 부른다. 추가·제외를 각각 기록 한 줄로,
   * 감사는 한 건(added·removed·viaRequest)으로 남긴다. 새로 추가하는 사람은 이 워크스페이스의 ACTIVE 구성원이어야 한다(다른 테넌트 사용자의 이름이
   * 응답에 실리지 않게).
   *
   * <p>설정 저장({@code viaRequest=false})에서 「알림 보내기」를 켰고(notification 이 있음) 새로 추가된 사람이 있으면 그 사람들에게만
   * {@link WikiSharedWithPeopleEvent} 를 낸다. 접근 요청 승인은 요청자에게 가는 승인 알림이 따로 있어 내지 않는다.
   *
   * @param permission 감사 metadata 의 권한(바뀐 뒤 값)
   * @param current 지금 지정한 사람 id
   * @param desired 맞출 지정한 사람 id
   * @param notification 추가된 사람에게 보낼 알림(null 이면 보내지 않음)
   * @return 제외된 사람이 있는지 — 그 사람이 열어 둔 화면을 닫아야 한다
   */
  private boolean changePeople(
      long callerId,
      ShareDetail share,
      String permission,
      List<Long> current,
      List<Long> desired,
      WikiPageShareRequest.Notify notification,
      boolean viaRequest) {
    List<Long> added = desired.stream().filter(id -> !current.contains(id)).toList();
    List<Long> removed = current.stream().filter(id -> !desired.contains(id)).toList();
    if (added.isEmpty() && removed.isEmpty()) {
      return false;
    }
    if (!membershipGuard.foreignUserIds(added).isEmpty()) {
      throw new IllegalArgumentException("이 워크스페이스 구성원만 지정할 수 있습니다");
    }
    shares.addPeople(share.id(), added, callerId);
    shares.removePeople(share.id(), removed);
    Map<Long, String> names = users.findNamesByIds(concat(added, removed));
    if (!added.isEmpty()) {
      event(callerId, share.pageId(), "PEOPLE_ADDED", namesText(added, names) + " 님을 추가했습니다");
    }
    if (!removed.isEmpty()) {
      event(callerId, share.pageId(), "PEOPLE_REMOVED", namesText(removed, names) + " 님을 제외했습니다");
    }
    Map<String, Object> extra = metadata("PEOPLE", permission);
    extra.put("added", added);
    extra.put("removed", removed);
    extra.put("viaRequest", viaRequest);
    audit.log(WikiShareAudit.PEOPLE_CHANGED, share.pageId(), share.spaceId(), extra);
    if (!viaRequest && notification != null && !added.isEmpty()) {
      String message = notification.message();
      publisher.publishEvent(
          new WikiSharedWithPeopleEvent(
              TenantContext.require(),
              share.pageId(),
              callerId,
              added,
              message == null || message.isBlank() ? null : message));
    }
    return !removed.isEmpty();
  }

  /**
   * 접근 요청 승인 — 요청자를 지정한 사람에 더한다(설정 저장과 같은 사람 차이 경로: 기록 PEOPLE_ADDED, 감사 WIKI_SHARE_PEOPLE_CHANGED
   * {@code viaRequest=true}). 지정한 사람 공유인지는 호출자({@code WikiShareAccessRequestService#approve})가 먼저
   * 확인한다. 공유 행은 호출자가 잠가 읽어 넘긴다.
   */
  void addRequester(long approverId, ShareDetail share, long requesterId) {
    List<Long> current = shares.listPeopleIds(share.id());
    if (current.contains(requesterId)) {
      return;
    }
    changePeople(
        approverId,
        share,
        share.permission(),
        current,
        concat(current, List.of(requesterId)),
        null,
        true);
  }

  /** 처음 만든 공유의 기록·감사. 외부 공개로 만들면 감사 metadata 에 external=true(감사 로그 화면에서 눈에 띄게). */
  private void recordCreated(long callerId, long pageId, long spaceId, Settings s) {
    String summary =
        AUDIENCE_LABEL.get(s.audience())
            + " · "
            + PERMISSION_LABEL.get(s.permission())
            + (s.includeChildren() ? " · 하위 페이지 포함" : "");
    event(callerId, pageId, "CREATED", "링크를 만들었습니다(" + summary + ")");
    Map<String, Object> extra = metadata(s.audience(), s.permission());
    extra.put("includeChildren", s.includeChildren());
    extra.put("expiresAt", iso(s.expiresAt()));
    if ("PUBLIC".equals(s.audience())) {
      extra.put("external", true);
    }
    audit.log(WikiShareAudit.CREATED, pageId, spaceId, extra);
  }

  /**
   * 접근이 줄어드는 변경인지 — 대상이 좁아짐(외부 → 워크스페이스 → 지정한 사람), 편집 → 보기, 하위 포함 끔, 만료를 새로 정하거나 앞당김. 사람 제외는 {@link
   * #changePeople} 이 따로 알린다.
   */
  private static boolean narrows(ShareDetail before, Settings next) {
    return AUDIENCE_RANK.get(next.audience()) < AUDIENCE_RANK.get(before.audience())
        || ("EDIT".equals(before.permission()) && "VIEW".equals(next.permission()))
        || (before.includeChildren() && !next.includeChildren())
        || (next.expiresAt() != null
            && (before.expiresAt() == null || next.expiresAt().isBefore(before.expiresAt())));
  }

  // ── 공용 ────────────────────────────────────────────────────────────────

  /** 공유 변경 권한 — 페이지 스페이스의 EDITOR 이상(비멤버는 404). 스페이스 id 를 돌려준다. */
  long requireEditor(long callerId, long pageId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    perms.requireRole(spaceId, callerId, "EDITOR");
    return spaceId;
  }

  /**
   * 공유를 만들거나 넓히는 변경(저장·재발급·접근 승인)의 권한 판정 — {@link #requireEditor} 와 같은 규칙을 잠금과 함께 본다. 잠금 순서는 공간
   * 행(KEY SHARE) → 호출자 멤버 행(FOR SHARE) → (외부 정책) → 공유 행(FOR UPDATE)이고, 역할 판정은 멤버 행을 잠근 <b>뒤</b> 읽은
   * 값으로 한다:
   *
   * <ul>
   *   <li>강등·제거와의 경합 — 커밋 전 강등이 있으면 그 커밋을 기다려 바뀐 역할로 판정한다(잠그기 전에 읽으면 옛 역할로 통과해 강등이 정리하지 못한 공유가
   *       남는다). 역할 변경(멤버 행 → 공유 행, {@code WikiSpaceService#changeRole})과 같은 순서라 교착이 없다.
   *   <li>스페이스 삭제와의 경합 — 삭제(공간 FOR UPDATE → 공유 → 페이지)와 첫 저장(공유 INSERT 의 FK 가 뒤늦게 공간 KEY SHARE)이 서로
   *       기다리던 교착을 공간 잠금을 맨 앞에 둬 없앤다.
   * </ul>
   *
   * @return 페이지의 스페이스 id
   */
  long lockEditor(long callerId, long pageId) {
    long spaceId =
        pages.findSpaceId(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
    spaces.lockForKeyShare(spaceId);
    perms.requireRoleLocked(spaceId, callerId, "EDITOR");
    return spaceId;
  }

  /**
   * 요청 검증 — 대상·권한 값, 외부 공개는 보기만. 지정한 사람은 PEOPLE 일 때만 의미가 있다(중복 제거). 만료는 {@link
   * #requireFutureExpiry}.
   */
  private static Settings validate(WikiPageShareRequest req) {
    // null 을 먼저 거른다 — 불변 Set(Set.of)의 contains(null) 은 NPE 를 던져 400 이 아닌 500 이 된다.
    if (req == null || req.audience() == null || !AUDIENCES.contains(req.audience())) {
      throw new IllegalArgumentException("열 수 있는 사람이 올바르지 않습니다");
    }
    if (req.permission() == null || !PERMISSIONS.contains(req.permission())) {
      throw new IllegalArgumentException("권한이 올바르지 않습니다");
    }
    if ("PUBLIC".equals(req.audience()) && !"VIEW".equals(req.permission())) {
      throw new IllegalArgumentException("외부 공개 링크는 보기만 할 수 있습니다");
    }
    List<Long> userIds =
        "PEOPLE".equals(req.audience()) && req.userIds() != null
            ? List.copyOf(
                new LinkedHashSet<>(req.userIds().stream().filter(Objects::nonNull).toList()))
            : List.of();
    return new Settings(
        req.audience(),
        req.permission(),
        req.includeChildren(),
        req.expiresAt(),
        userIds,
        req.notification());
  }

  /**
   * 새로 정하거나 바꾸는 만료는 지금 이후여야 한다(400). 이미 저장된 만료를 그대로 보내는 것은 지났어도 받는다 — 공유 창은 바꾸지 않은 설정까지 늘 함께 보내므로,
   * 만료된 공유의 권한·사람만 고치려는 요청까지 막지 않게.
   */
  private static void requireFutureExpiry(ShareDetail before, Settings next) {
    if (next.expiresAt() == null
        || (before != null && sameInstant(before.expiresAt(), next.expiresAt()))) {
      return;
    }
    if (!next.expiresAt().isAfter(OffsetDateTime.now())) {
      throw new IllegalArgumentException("만료 시각은 지금 이후여야 합니다");
    }
  }

  /** 공유가 덮는 페이지 — 하위 포함이면 지금 서브트리 전체, 아니면 그 페이지 하나. 바꾸기·지우기 전에 부른다. */
  private List<Long> coveredPages(ShareDetail share) {
    return share.includeChildren()
        ? pages.subtreeIdsInclusive(share.pageId())
        : List.of(share.pageId());
  }

  /** 공유 접근이 줄었다 — 커밋 뒤 이 페이지들의 공유 연결을 다시 판정하게 한다. */
  void publishAccessChanged(List<Long> pageIds) {
    // 테넌트는 지금 담는다 — 재검증 리스너는 커밋 뒤 다른 스레드에서 돈다.
    publisher.publishEvent(new WikiShareAccessChangedEvent(TenantContext.require(), pageIds));
  }

  private void event(Long actorId, long pageId, String type, String text) {
    shares.insertEvent(pageId, actorId, type, detail(text));
  }

  /** 기록 문구의 사람 이름 — 없는 사용자면 id 를 글자로(기록 문구가 비지 않게). 접근 요청 서비스도 쓴다. */
  String nameOf(long userId) {
    return users.findNamesByIds(List.of(userId)).getOrDefault(userId, String.valueOf(userId));
  }

  /** 공유 기록 detail — {@code {"text": 화면 문구}}. 접근 요청 서비스도 같은 모양으로 기록한다. */
  JSONB detail(String text) {
    return detail(Map.of("text", text));
  }

  /** 공유 기록 detail — text 외 값을 더 싣는다(이동 기록의 옮긴 페이지 제목 등). 웹은 text 만 보인다. */
  JSONB detail(Map<String, Object> fields) {
    try {
      return JSONB.jsonb(objectMapper.writeValueAsString(fields));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("공유 기록 문구를 직렬화하지 못했습니다", e);
    }
  }

  /** 감사 metadata 의 공통값(설계: 언제나 audience·permission) — 바꾸기는 바뀐 뒤 값. 액션별 값을 더할 수 있게 변경 가능한 맵. */
  private static Map<String, Object> metadata(String audience, String permission) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("audience", audience);
    m.put("permission", permission);
    return m;
  }

  private WikiPageShareResponse toResponse(ShareDetail s) {
    return new WikiPageShareResponse(
        s.pageId(),
        s.token(),
        s.audience(),
        s.permission(),
        s.includeChildren(),
        "PEOPLE".equals(s.audience()) ? shares.listPeople(s.id()) : List.of(),
        new WikiSharePerson(s.createdBy(), s.createdByName()),
        s.createdAt(),
        s.updatedAt(),
        s.expiresAt(),
        s.lastAccessedAt(),
        s.viewCount());
  }

  private static String namesText(List<Long> ids, Map<Long, String> names) {
    return ids.stream()
        .map(id -> names.getOrDefault(id, String.valueOf(id)))
        .collect(Collectors.joining(", "));
  }

  private static List<Long> concat(List<Long> a, List<Long> b) {
    List<Long> out = new ArrayList<>(a);
    out.addAll(b);
    return out;
  }

  private static boolean sameInstant(OffsetDateTime a, OffsetDateTime b) {
    return a == null ? b == null : b != null && a.toInstant().equals(b.toInstant());
  }

  private static String iso(OffsetDateTime t) {
    return t == null ? null : t.toInstant().toString();
  }

  /** 검증을 마친 요청 설정 — notification 은 사람을 추가할 때 보낼 알림(null 이면 보내지 않음). */
  private record Settings(
      String audience,
      String permission,
      boolean includeChildren,
      OffsetDateTime expiresAt,
      List<Long> userIds,
      WikiPageShareRequest.Notify notification) {}
}

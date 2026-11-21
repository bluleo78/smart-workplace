package com.workplace.contacts.service;

import com.workplace.contacts.dto.ContactFacets;
import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.FavoriteRequest;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.dto.UpdateExternalContactRequest;
import com.workplace.contacts.exception.ContactDuplicateWarningException;
import com.workplace.contacts.exception.ContactForbiddenException;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.outbound.ContactChangeNotifier;
import com.workplace.contacts.repository.ContactCursorCodec;
import com.workplace.contacts.repository.ContactRepository;
import com.workplace.contacts.repository.FavoriteRepository;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.PermissionChecker;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.UnicodeNames;
import com.workplace.user.outbound.AgentDeleted;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 통합 연락처 조회 유스케이스. limit+1 로 hasMore 판정, 마지막 표시행으로 nextCursor 생성. */
@Service
@RequiredArgsConstructor
public class ContactService {
  private static final int DEFAULT_LIMIT = 30;
  private static final int MAX_LIMIT = 100;

  private final ContactRepository repo;
  private final PermissionChecker permissionChecker;
  private final FavoriteRepository favoriteRepo;
  private final ContactChangeNotifier notifier;

  /** 통합 목록/검색. favorite=true 면 즐겨찾기 항목만. type 기본 ALL. */
  @Transactional(readOnly = true)
  public ContactPage list(
      long callerId,
      String search,
      String type,
      boolean favorite,
      String organization,
      String title,
      String cursor,
      int limit) {
    int safeLimit = Math.min(limit <= 0 ? DEFAULT_LIMIT : limit, MAX_LIMIT);
    String safeType = type == null ? "ALL" : type;
    // 조직·직책 고급 필터는 외부 전용 — 하나라도 활성이면 EXTERNAL 로 강제(멤버 직책 누수 방지)
    boolean advanced =
        (organization != null && !organization.isBlank()) || (title != null && !title.isBlank());
    if (advanced) {
      safeType = "EXTERNAL";
    }
    ContactCursorCodec.Decoded decoded = ContactCursorCodec.decode(cursor);

    List<ContactSummary> rows =
        repo.findPage(
            TenantContext.require(),
            callerId,
            // 검색어 NFC 정규화(WP-554) — 맥 붙여넣기 등 NFD(자모 분리) 한글이 완성형 저장값과 맞지 않던 것을 맞춘다(UnicodeNames 참조).
            UnicodeNames.toNfc(search),
            safeType,
            favorite,
            organization,
            title,
            decoded,
            safeLimit + 1);

    boolean hasMore = rows.size() > safeLimit;
    List<ContactSummary> page = hasMore ? rows.subList(0, safeLimit) : rows;
    String nextCursor = null;
    if (hasMore) {
      ContactSummary last = page.get(page.size() - 1);
      nextCursor = ContactCursorCodec.encode(last.name(), last.type(), last.id());
    }
    return new ContactPage(page, nextCursor, hasMore);
  }

  /** 외부 연락처 조직·직책 distinct 목록(고급 필터 드롭다운). 가시 범위만. */
  @Transactional(readOnly = true)
  public ContactFacets facets(long callerId) {
    return repo.distinctExternalFacets(callerId);
  }

  /** 멤버 상세. 미존재(또는 AGENT)면 404. */
  @Transactional(readOnly = true)
  public MemberDetail getMember(long callerId, long userId) {
    return repo.findMember(TenantContext.require(), callerId, userId)
        .orElseThrow(() -> new ContactNotFoundException("MEMBER", userId));
  }

  /** 외부 상세. 미존재 또는 PERSONAL 타인 접근이면 404. editable 은 owner||ADMIN. */
  @Transactional(readOnly = true)
  public ExternalContactDetail getExternal(long callerId, long id) {
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    return repo.findExternal(callerId, admin, id)
        .orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
  }

  /**
   * 외부 연락처 생성 — owner=caller. (contact:write 권한은 컨트롤러 인터셉터가 강제.)
   *
   * <p>force=false 이고 동일 이름+이메일이 가시 범위(SHARED 전체+본인 PERSONAL)에 이미 있으면 409 소프트 경고를 던진다(#790). 사용자가
   * 확인 다이얼로그에서 강행하면 force=true 로 재요청 — 그대로 저장한다(동명이인·조직 공유 이메일 허용, 하드 차단 아님).
   *
   * <p>판정 전 잠금으로 같은 테넌트·이름·이메일의 동시 요청을 줄 세운다(WP-1952). force 여도 잠그는 이유: 강행 요청이 커밋 전이면 뒤따르는 비강행 요청이
   * 그 행을 못 보고 통과하므로, 강행 쪽도 같은 잠금을 쥐고 저장해야 한다.
   */
  @Transactional
  public ExternalContactDetail create(long callerId, ExternalContactRequest req, boolean force) {
    repo.lockDuplicateKey(TenantContext.require(), req.name(), req.email());
    if (!force && repo.existsDuplicate(callerId, req.name(), req.email(), null)) {
      throw new ContactDuplicateWarningException(req.name());
    }
    long id = repo.insert(callerId, req);
    notifier.contactChanged(
        ResourceChangedEvent.OP_CREATED, id, callerId, isShared(req.visibility()), callerId);
    return getExternal(callerId, id);
  }

  /**
   * 외부 연락처 부분 수정(#839). owner||ADMIN 만; 아니면 PERSONAL→404 / SHARED→403.
   *
   * <p>생략(null) 필드는 현재 값을 유지하고, 빈 문자열은 비운다(저장 시 null 정규화). 현재 행과 병합한 전체 값으로 저장한다.
   *
   * <p>행 잠금으로 같은 연락처에 대한 동시 수정끼리 직렬화한다 — 읽기·병합·쓰기 경합으로 앞 요청 변경이 덮이던 것(WP-1951). 권한 판정을 통과한 뒤에 잠가,
   * 나중 요청은 앞 요청 커밋을 기다렸다가 최신 행 위에서 병합·중복 판정을 한다. 서로 다른 연락처를 동시에 같은 이름+이메일로 만들거나 고치는 경합은 이 잠금이 막지
   * 않는다(WP-1952 범위).
   *
   * <p>create 와 동일한 소프트 중복 경고 규칙(자기 자신은 제외) — 판정은 **병합 후** 이름+이메일로 한다. 요청 원문으로 판정하면 전화번호만 고치는
   * 요청(name=null)이 중복 검사를 건너뛰거나, 이메일만 바꿔 기존 연락처와 겹치는 경우를 놓친다.
   *
   * <p>판정 전 잠금으로 동시 요청을 줄 세운다. 강행(force)이어도 잠그는 이유는 create 와 같다(WP-1952).
   */
  @Transactional
  public ExternalContactDetail update(
      long callerId, long id, UpdateExternalContactRequest req, boolean force) {
    // ADMIN 여부는 권한 판정과 현재 행 조회에 모두 쓰이므로 한 번만 계산한다.
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    // 권한 판정 통과 뒤 행을 잠가 이후 읽기·병합·쓰기가 다른 수정과 겹치지 않게 한다. 반환값은 잠근 뒤의 값이다.
    var before = requireWritableLocked(callerId, id, admin);
    // 쓰기 권한 판정 통과 = owner 또는 ADMIN 이므로 현재 행은 반드시 보인다.
    ExternalContactDetail cur =
        repo.findExternal(callerId, admin, id)
            .orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
    ExternalContactRequest merged =
        new ExternalContactRequest(
            keep(req.name(), cur.name()),
            keep(req.email(), cur.email()),
            keep(req.phone(), cur.phone()),
            keep(req.organization(), cur.organization()),
            keep(req.title(), cur.title()),
            keep(req.notes(), cur.notes()),
            keep(req.visibility(), cur.visibility()));
    repo.lockDuplicateKey(TenantContext.require(), merged.name(), merged.email());
    if (!force && repo.existsDuplicate(callerId, merged.name(), merged.email(), id)) {
      throw new ContactDuplicateWarningException(merged.name());
    }
    repo.update(id, merged);
    // 공유→개인 전환도 다른 구성원 목록에서 사라져야 하므로 변경 전·후 중 하나라도 SHARED 면 테넌트 전체에 알린다.
    notifier.contactChanged(
        ResourceChangedEvent.OP_UPDATED,
        id,
        before.ownerId(),
        isShared(before.visibility()) || isShared(merged.visibility()),
        callerId);
    return getExternal(callerId, id);
  }

  /** 부분 수정 병합 — 요청값이 null(생략)이면 현재 값을 유지한다. 빈 문자열은 그대로 두어 저장 시 null 로 비워진다. */
  private static String keep(String requested, String current) {
    return requested != null ? requested : current;
  }

  /**
   * 외부 연락처 삭제. update 와 동일한 권한 규칙·같은 행 잠금 — 겹친 수정(PERSONAL→SHARED)이 커밋된 뒤의 visibility 로 알림 범위를 정해야
   * 다른 구성원에게 삭제가 전파된다(WP-1951).
   */
  @Transactional
  public void delete(long callerId, long id) {
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    var ov = requireWritableLocked(callerId, id, admin);
    repo.delete(id);
    notifier.contactChanged(
        ResourceChangedEvent.OP_DELETED, id, ov.ownerId(), isShared(ov.visibility()), callerId);
  }

  /**
   * 외부 연락처 삭제 사전검증(#842) — delete 와 같은 술어(쓰기 권한)를 쓰기 없이 수행한다. 확인카드 승인 전에 존재·권한 실패를 드러낸다.
   *
   * @throws ContactNotFoundException 미존재 또는 PERSONAL 비-owner(존재 은닉)
   * @throws ContactForbiddenException SHARED 비-owner·비-admin
   */
  @Transactional(readOnly = true)
  public void validateDeletable(long callerId, long id) {
    requireWritable(callerId, id);
  }

  /** 즐겨찾기 추가 — 타깃 존재·가시성 검증 후 멱등 add. 비가시/미존재 타깃은 404(임의 ID 즐겨찾기 차단). */
  @Transactional
  public void addFavorite(long callerId, FavoriteRequest req) {
    // 외부 연락처는 먼저 행을 공유 잠금한다 — 동시에 지워지면 이 즐겨찾기가 가리킬 데 없이 남는다(WP-820). 지운 쪽이 먼저 커밋했으면 아래 가시성
    // 확인이 404 로 끝난다.
    if ("EXTERNAL".equals(req.targetType())) repo.lockExternal(req.targetId());
    requireVisibleTarget(callerId, req.targetType(), req.targetId());
    favoriteRepo.add(callerId, req.targetType(), req.targetId());
    notifier.favoriteChanged(ResourceChangedEvent.OP_UPDATED, callerId);
  }

  /**
   * 에이전트 삭제 직전(같은 트랜잭션, 동기) — 그 에이전트가 만든 외부 연락처는 사용자 행 삭제의 owner_id CASCADE 로 사라지므로 {@link #delete}
   * 의 참조 정리를 거치지 않는다. 그 연락처를 가리키는 즐겨찾기·그룹 멤버 행을 먼저 지운다(WP-820). 삭제가 막혀 사용 중지로 바뀌면(WP-705) 이 정리도 함께
   * 되돌려진다.
   */
  @EventListener
  public void onAgentDeleted(AgentDeleted e) {
    TenantContext.runAs(e.tenantId(), () -> repo.deleteExternalRefsOwnedBy(e.userId()));
  }

  /** 즐겨찾기 해제 — 멱등(부재여도 정상). */
  @Transactional
  public void removeFavorite(long callerId, FavoriteRequest req) {
    favoriteRepo.remove(callerId, req.targetType(), req.targetId());
    notifier.favoriteChanged(ResourceChangedEvent.OP_UPDATED, callerId);
  }

  /** 즐겨찾기 타깃이 호출자에게 보이는지 검증. MEMBER=현재 테넌트 활성 멤버, EXTERNAL=가시(SHARED|owner|ADMIN). 아니면 404. */
  private void requireVisibleTarget(long callerId, String targetType, long targetId) {
    boolean visible;
    if ("MEMBER".equals(targetType)) {
      visible = repo.findMember(TenantContext.require(), callerId, targetId).isPresent();
    } else {
      boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
      visible = repo.findExternal(callerId, admin, targetId).isPresent();
    }
    if (!visible) {
      throw new ContactNotFoundException(targetType, targetId);
    }
  }

  /**
   * 쓰기 권한 판정 — 읽기 격리와 일치: 미존재→404, PERSONAL & 비-owner & 비-admin→404(존재 은닉), SHARED & 비-owner &
   * 비-admin→403. 행 잠금 없음(사전검증·잠금 전 1차 판정용).
   */
  private ContactRepository.OwnerVisibility requireWritable(long callerId, long id) {
    return judgeWritable(
        callerId,
        id,
        permissionChecker.userHasRole(callerId, "ADMIN"),
        repo.findOwnerVisibility(id));
  }

  /**
   * 권한 판정 뒤에 행을 잠그는 2단계 판정(WP-1951). 먼저 잠금 없이 판정해 쓰기 권한 없는 호출자는 잠금을 잡거나 기다리지 않고 404/403 으로 즉시
   * 끝낸다(PERSONAL 존재 은닉·타이밍 노출 방지). 통과하면 잠금 조회로 다시 읽어 같은 판정을 한 번 더 한다 — 잠금 대기 중 소유자·visibility 가
   * 바뀌었거나 삭제됐을 수 있다(삭제됐으면 404). 반환값은 잠근 뒤의 값이다.
   */
  private ContactRepository.OwnerVisibility requireWritableLocked(
      long callerId, long id, boolean admin) {
    judgeWritable(callerId, id, admin, repo.findOwnerVisibility(id));
    return judgeWritable(callerId, id, admin, repo.lockOwnerVisibility(id));
  }

  /** 조회 결과로 쓰기 권한을 판정한다(미존재 404 · 존재 은닉 404 · 403). */
  private static ContactRepository.OwnerVisibility judgeWritable(
      long callerId, long id, boolean admin, Optional<ContactRepository.OwnerVisibility> found) {
    var ov = found.orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
    if (ov.ownerId() == callerId || admin) return ov;
    if ("PERSONAL".equals(ov.visibility())) {
      throw new ContactNotFoundException("EXTERNAL", id); // 존재 은닉
    }
    throw new ContactForbiddenException(id, callerId);
  }

  private static boolean isShared(String visibility) {
    return "SHARED".equals(visibility);
  }
}

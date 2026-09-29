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
import com.workplace.contacts.repository.ContactCursorCodec;
import com.workplace.contacts.repository.ContactRepository;
import com.workplace.contacts.repository.FavoriteRepository;
import com.workplace.global.security.PermissionChecker;
import com.workplace.global.tenant.TenantContext;
import java.util.List;
import lombok.RequiredArgsConstructor;
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
            search,
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
   */
  @Transactional
  public ExternalContactDetail create(long callerId, ExternalContactRequest req, boolean force) {
    if (!force && repo.existsDuplicate(callerId, req.name(), req.email(), null)) {
      throw new ContactDuplicateWarningException(req.name());
    }
    long id = repo.insert(callerId, req);
    return getExternal(callerId, id);
  }

  /**
   * 외부 연락처 부분 수정(#839). owner||ADMIN 만; 아니면 PERSONAL→404 / SHARED→403.
   *
   * <p>생략(null) 필드는 현재 값을 유지하고, 빈 문자열은 비운다(저장 시 null 정규화). 현재 행과 병합한 전체 값으로 저장한다.
   *
   * <p>create 와 동일한 소프트 중복 경고 규칙(자기 자신은 제외) — 판정은 **병합 후** 이름+이메일로 한다. 요청 원문으로 판정하면 전화번호만 고치는
   * 요청(name=null)이 중복 검사를 건너뛰거나, 이메일만 바꿔 기존 연락처와 겹치는 경우를 놓친다.
   */
  @Transactional
  public ExternalContactDetail update(
      long callerId, long id, UpdateExternalContactRequest req, boolean force) {
    // ADMIN 여부는 권한 판정과 현재 행 조회에 모두 쓰이므로 한 번만 계산한다.
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    requireWritable(callerId, id, admin);
    // requireWritable 통과 = owner 또는 ADMIN 이므로 현재 행은 반드시 보인다.
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
    if (!force && repo.existsDuplicate(callerId, merged.name(), merged.email(), id)) {
      throw new ContactDuplicateWarningException(merged.name());
    }
    repo.update(id, merged);
    return getExternal(callerId, id);
  }

  /** 부분 수정 병합 — 요청값이 null(생략)이면 현재 값을 유지한다. 빈 문자열은 그대로 두어 저장 시 null 로 비워진다. */
  private static String keep(String requested, String current) {
    return requested != null ? requested : current;
  }

  /** 외부 연락처 삭제. update 와 동일한 권한 규칙. */
  @Transactional
  public void delete(long callerId, long id) {
    validateDeletable(callerId, id);
    repo.delete(id);
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
    requireVisibleTarget(callerId, req.targetType(), req.targetId());
    favoriteRepo.add(callerId, req.targetType(), req.targetId());
  }

  /** 즐겨찾기 해제 — 멱등(부재여도 정상). */
  @Transactional
  public void removeFavorite(long callerId, FavoriteRequest req) {
    favoriteRepo.remove(callerId, req.targetType(), req.targetId());
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
   * 비-admin→403.
   */
  private void requireWritable(long callerId, long id) {
    requireWritable(callerId, id, permissionChecker.userHasRole(callerId, "ADMIN"));
  }

  /** ADMIN 여부를 이미 계산한 호출부(update)용 — 역할 조회를 중복하지 않는다. */
  private void requireWritable(long callerId, long id, boolean admin) {
    var ov =
        repo.findOwnerVisibility(id)
            .orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
    if (ov.ownerId() == callerId) return;
    if (admin) return;
    if ("PERSONAL".equals(ov.visibility())) {
      throw new ContactNotFoundException("EXTERNAL", id); // 존재 은닉
    }
    throw new ContactForbiddenException(id, callerId);
  }
}

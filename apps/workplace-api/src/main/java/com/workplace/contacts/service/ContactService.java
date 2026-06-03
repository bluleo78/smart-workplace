package com.workplace.contacts.service;

import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.ExternalContactRequest;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.exception.ContactForbiddenException;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.repository.ContactCursorCodec;
import com.workplace.contacts.repository.ContactRepository;
import com.workplace.global.security.PermissionChecker;
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

  /** 통합 목록/검색. type 기본 ALL. cursor 디코드 실패 시 첫 페이지로 폴백(codec 이 null 반환). */
  @Transactional(readOnly = true)
  public ContactPage list(long callerId, String search, String type, String cursor, int limit) {
    int safeLimit = Math.min(limit <= 0 ? DEFAULT_LIMIT : limit, MAX_LIMIT);
    String safeType = type == null ? "ALL" : type;
    ContactCursorCodec.Decoded decoded = ContactCursorCodec.decode(cursor);

    List<ContactSummary> rows = repo.findPage(callerId, search, safeType, decoded, safeLimit + 1);

    boolean hasMore = rows.size() > safeLimit;
    List<ContactSummary> page = hasMore ? rows.subList(0, safeLimit) : rows;
    String nextCursor = null;
    if (hasMore) {
      ContactSummary last = page.get(page.size() - 1);
      nextCursor = ContactCursorCodec.encode(last.name(), last.type(), last.id());
    }
    return new ContactPage(page, nextCursor, hasMore);
  }

  /** 멤버 상세. 미존재(또는 AGENT)면 404. */
  @Transactional(readOnly = true)
  public MemberDetail getMember(long userId) {
    return repo.findMember(userId)
        .orElseThrow(() -> new ContactNotFoundException("MEMBER", userId));
  }

  /** 외부 상세. 미존재 또는 PERSONAL 타인 접근이면 404. editable 은 owner||ADMIN. */
  @Transactional(readOnly = true)
  public ExternalContactDetail getExternal(long callerId, long id) {
    boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
    return repo.findExternal(callerId, admin, id)
        .orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
  }

  /** 외부 연락처 생성 — owner=caller. (contact:write 권한은 컨트롤러 인터셉터가 강제.) */
  @Transactional
  public ExternalContactDetail create(long callerId, ExternalContactRequest req) {
    long id = repo.insert(callerId, req);
    return getExternal(callerId, id);
  }

  /** 외부 연락처 전체 교체. owner||ADMIN 만; 아니면 PERSONAL→404 / SHARED→403. */
  @Transactional
  public ExternalContactDetail update(long callerId, long id, ExternalContactRequest req) {
    requireWritable(callerId, id);
    repo.update(id, req);
    return getExternal(callerId, id);
  }

  /** 외부 연락처 삭제. update 와 동일한 권한 규칙. */
  @Transactional
  public void delete(long callerId, long id) {
    requireWritable(callerId, id);
    repo.delete(id);
  }

  /**
   * 쓰기 권한 판정 — 읽기 격리와 일치: 미존재→404, PERSONAL & 비-owner & 비-admin→404(존재 은닉), SHARED & 비-owner &
   * 비-admin→403.
   */
  private void requireWritable(long callerId, long id) {
    var ov =
        repo.findOwnerVisibility(id)
            .orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
    if (ov.ownerId() == callerId) return;
    if (permissionChecker.userHasRole(callerId, "ADMIN")) return;
    if ("PERSONAL".equals(ov.visibility())) {
      throw new ContactNotFoundException("EXTERNAL", id); // 존재 은닉
    }
    throw new ContactForbiddenException(id, callerId);
  }
}

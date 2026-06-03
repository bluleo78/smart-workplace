package com.workplace.contacts.service;

import com.workplace.contacts.dto.ContactPage;
import com.workplace.contacts.dto.ContactSummary;
import com.workplace.contacts.dto.ExternalContactDetail;
import com.workplace.contacts.dto.MemberDetail;
import com.workplace.contacts.exception.ContactNotFoundException;
import com.workplace.contacts.repository.ContactCursorCodec;
import com.workplace.contacts.repository.ContactRepository;
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

  /** 외부 상세. 미존재 또는 PERSONAL 타인 접근이면 404(존재 은닉). */
  @Transactional(readOnly = true)
  public ExternalContactDetail getExternal(long callerId, long id) {
    return repo.findExternal(callerId, id)
        .orElseThrow(() -> new ContactNotFoundException("EXTERNAL", id));
  }
}

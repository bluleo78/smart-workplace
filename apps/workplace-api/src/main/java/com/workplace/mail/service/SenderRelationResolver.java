package com.workplace.mail.service;

import com.workplace.mail.dto.SenderRelation;
import com.workplace.mail.dto.UserMailProfile;
import com.workplace.mail.repository.MailPeopleRepository;
import com.workplace.mail.repository.MailPeopleRepository.ContactMatch;
import com.workplace.mail.repository.MailPeopleRepository.MemberMatch;
import com.workplace.mail.util.MailAddresses;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 보낸 사람과의 관계 판정(WP-150). 순서: 나 자신(내 주소 집합) → 사내 구성원(+같은 조직·즐겨찾기) → 외부 연락처(+즐겨찾기) → 알 수 없는 외부. 메일
 * 도메인으로 사내 여부를 추정하지 않는다. 호출자 트랜잭션(RLS GUC) 안에서 부르며, 조회 실패는 예외로 던진다 — {@link PersonalContextLoader}
 * 가 이 블록만 뺀다.
 */
@Component
@RequiredArgsConstructor
public class SenderRelationResolver {

  /** contact_favorite.target_type — 사내 구성원(user.id). */
  static final String MEMBER = "MEMBER";

  /** contact_favorite.target_type — 외부 연락처(contact_entry.id). */
  static final String EXTERNAL = "EXTERNAL";

  private final MailPeopleRepository peopleRepo;

  /** fromAddress 의 관계. 주소가 비면 알 수 없음. */
  public SenderRelation resolve(UserMailProfile me, String fromAddress) {
    String address = MailAddresses.normalize(fromAddress);
    if (address == null || address.isEmpty()) {
      return SenderRelation.unknown();
    }
    if (me.addressSet().contains(address)) {
      return SenderRelation.self();
    }
    long tenantId = peopleRepo.currentTenantId();
    Optional<MemberMatch> member = peopleRepo.findMemberByAddress(tenantId, address, me.userId());
    if (member.isPresent()) {
      MemberMatch m = member.get();
      return SenderRelation.member(
          m.name(),
          m.title(),
          peopleRepo.listCommonSharedGroupNames(me.userId(), m.userId()),
          peopleRepo.isFavorite(me.userId(), MEMBER, m.userId()));
    }
    Optional<ContactMatch> contact = peopleRepo.findVisibleContactByEmail(me.userId(), address);
    if (contact.isPresent()) {
      ContactMatch c = contact.get();
      return SenderRelation.contact(
          c.name(),
          c.title(),
          c.organization(),
          peopleRepo.isFavorite(me.userId(), EXTERNAL, c.id()));
    }
    return SenderRelation.unknown();
  }
}

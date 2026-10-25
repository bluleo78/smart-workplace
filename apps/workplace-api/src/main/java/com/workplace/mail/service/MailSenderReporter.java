package com.workplace.mail.service;

import com.workplace.issue.exception.InvalidReporterException;
import com.workplace.mail.dto.MailIssueDraft.CandidateProject;
import com.workplace.mail.dto.MailIssueDraft.DraftSender;
import com.workplace.mail.repository.EmailMessageRepository.AiContext;
import com.workplace.mail.repository.MailPeopleRepository;
import com.workplace.mail.repository.MailPeopleRepository.MemberMatch;
import com.workplace.mail.util.MailAddresses;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 메일→이슈 보고자 「보낸 사람」 판정(WP-954). 보낸 사람 주소를 이 워크스페이스의 활성 사람 구성원으로 찾고(나 제외 — 내가 보낸 메일이면 「나」와 같다), 후보
 * 프로젝트마다 고를 수 있는지(그 프로젝트를 볼 수 있음)와 기본으로 고를지(멤버이거나 OPEN)를 정한다.
 *
 * <p>주소는 메일에 저장된 발신 주소만 쓴다 — 클라이언트가 보낸 사용자 id 를 믿지 않는다. 모두 트랜잭션 안(RLS GUC)에서 부른다.
 */
@Component
@RequiredArgsConstructor
class MailSenderReporter {

  private final MailPeopleRepository peopleRepo;
  private final ProjectAccessGuard accessGuard;
  private final ProjectMemberRepository memberRepository;

  /** 보낸 사람이 이 워크스페이스의 활성 사람 구성원이면 그 사람(나 제외). */
  Optional<MemberMatch> member(long callerId, AiContext ctx) {
    String from = MailAddresses.normalize(ctx.fromAddress());
    if (from == null || from.isEmpty()) return Optional.empty();
    return peopleRepo.findMemberByAddress(peopleRepo.currentTenantId(), from, callerId);
  }

  /** 초안에 싣는 보낸 사람 요약. */
  DraftSender sender(AiContext ctx, Optional<MemberMatch> member) {
    return new DraftSender(
        ctx.fromAddress(),
        member.map(MemberMatch::name).orElse(null),
        member.isPresent(),
        selfSent(ctx));
  }

  /** 내 메일 계정 주소로 보낸 메일인지 — 그러면 「보낸 사람」은 곧 「나」다. */
  boolean selfSent(AiContext ctx) {
    String from = MailAddresses.normalize(ctx.fromAddress());
    return from != null && from.equals(MailAddresses.normalize(ctx.selfAddress()));
  }

  /** 후보 프로젝트 하나 — 보낸 사람을 보고자로 고를 수 있는지·기본으로 고를지. */
  CandidateProject candidate(ProjectResponse p, Optional<MemberMatch> member) {
    if (member.isEmpty()) return new CandidateProject(p.key(), p.name(), false, false);
    long senderId = member.get().userId();
    boolean selectable = accessGuard.canRead(p.id(), senderId);
    boolean isDefault =
        selectable
            && ("OPEN".equals(p.type()) || memberRepository.find(p.id(), senderId).isPresent());
    return new CandidateProject(p.key(), p.name(), selectable, isDefault);
  }

  /** 승격 때 「보낸 사람」을 고른 경우의 보고자 id — 구성원이 아니면 400. 프로젝트를 볼 수 있는지는 보고자 바꾸기가 다시 확인한다. */
  long requireSenderId(long callerId, AiContext ctx) {
    return member(callerId, ctx)
        .map(MemberMatch::userId)
        .orElseThrow(() -> new InvalidReporterException("보낸 사람이 워크스페이스 구성원이 아니라 보고자로 지정할 수 없습니다"));
  }
}

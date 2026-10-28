package com.workplace.chat.service;

import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.project.outbound.ProjectChangeNotifier;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 프로젝트에서 멤버가 빠지면 그 프로젝트 이슈 대화의 멤버에서도 뺀다(WP-475). 접근 판정은 {@link ChatThreadAccess} 가 프로젝트 권한으로 하지만,
 * 실시간 알림(SSE)과 첨부 모아보기는 스레드 멤버 명단을 그대로 쓰므로 명단도 정리해야 제거된 사람에게 새 대화가 흘러가지 않는다. 멤버 제거가 쓰기 트랜잭션 안에서 내는
 * ResourceChangedEvent(project-member/deleted)를 같은 트랜잭션에서 받는다(@EventListener — 롤백되면 함께 롤백).
 *
 * <p>WP-1057 — 직접 멤버 행이 빠져도 멤버로 둔 조직도 부서로 여전히 프로젝트 멤버인 사람은 대화 명단에 남긴다(멤버 판정은 실효 멤버십).
 */
@Component
@RequiredArgsConstructor
public class ChatProjectMemberRemovalCleanup {

  private final ChatThreadMemberRepository memberRepo;
  private final IssueStakeholderLookup lookup;

  /** project-member/deleted 만 거른다. scopeId 가 프로젝트 id, ids 가 제거된 사용자 id 다. */
  @EventListener
  public void onResourceChanged(ResourceChangedEvent e) {
    if (ProjectChangeNotifier.RESOURCE_PROJECT_MEMBER.equals(e.resource())
        && ResourceChangedEvent.OP_DELETED.equals(e.op())) {
      e.ids().stream()
          .filter(userId -> !lookup.isProjectMember(e.scopeId(), userId))
          .forEach(userId -> memberRepo.deleteFromProjectThreads(e.scopeId(), userId));
    }
  }
}

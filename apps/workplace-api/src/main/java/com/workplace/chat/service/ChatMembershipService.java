package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.outbound.ChatThreadChangeNotifier;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.project.exception.ProjectAccessDeniedException;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** chat thread 수동 멤버 추가/제거. 모두 caller 가 thread 멤버여야 한다. */
@Service
@RequiredArgsConstructor
public class ChatMembershipService {

  private final ChatThreadMemberRepository memberRepo;
  private final ChatThreadContextResolver contextResolver;
  private final IssueStakeholderLookup lookup;
  private final ChatThreadChangeNotifier notifier;

  /** caller 가 thread 멤버여야 add 가능. target 은 프로젝트 멤버여야 add 가능. add-only auto 정책의 수동 보강. */
  @Transactional
  public void add(long callerId, long threadId, long targetUserId) {
    if (!memberRepo.isMember(threadId, callerId))
      throw new ChatThreadNotMemberException(threadId, callerId);
    var ctx = contextResolver.resolve(threadId);
    long projectId = ctx.projectId();
    if (!lookup.isProjectMember(projectId, targetUserId))
      throw new ProjectAccessDeniedException("프로젝트 멤버가 아닌 사용자는 대화에 추가할 수 없습니다");
    memberRepo.insertIgnoreConflict(threadId, List.of(targetUserId));
    notifier.membersChanged(
        projectId, ctx.projectKey(), issueNumber(ctx), threadId, callerId, Set.of());
  }

  /** 본인 leave. row 자체 제거. */
  @Transactional
  public void leave(long callerId, long threadId) {
    // 컨텍스트는 삭제 전에 확보 — 나간 본인은 커밋 후 명단에서 빠지므로 extra 로 넘긴다.
    var ctx = contextResolver.resolve(threadId);
    memberRepo.delete(threadId, callerId);
    if (ctx == null) return; // 존재하지 않는 스레드 — 기존처럼 조용한 no-op
    notifier.membersChanged(
        ctx.projectId(), ctx.projectKey(), issueNumber(ctx), threadId, callerId, Set.of(callerId));
  }

  /** issueKey("WP-12") 의 마지막 '-' 뒤 숫자 = 이슈 번호. */
  private static int issueNumber(ChatThreadContextResolver.Context ctx) {
    String key = ctx.issueKey();
    return Integer.parseInt(key.substring(key.lastIndexOf('-') + 1));
  }
}

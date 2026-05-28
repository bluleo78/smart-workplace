package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.project.exception.ProjectAccessDeniedException;
import java.util.List;
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

  /** caller 가 thread 멤버여야 add 가능. target 은 프로젝트 멤버여야 add 가능. add-only auto 정책의 수동 보강. */
  @Transactional
  public void add(long callerId, long threadId, long targetUserId) {
    if (!memberRepo.isMember(threadId, callerId))
      throw new ChatThreadNotMemberException(threadId, callerId);
    long projectId = contextResolver.resolve(threadId).projectId();
    if (!lookup.isProjectMember(projectId, targetUserId))
      throw new ProjectAccessDeniedException("target is not a project member");
    memberRepo.insertIgnoreConflict(threadId, List.of(targetUserId));
  }

  /** 본인 leave. row 자체 제거. */
  @Transactional
  public void leave(long callerId, long threadId) {
    memberRepo.delete(threadId, callerId);
  }
}

package com.workplace.chat.service;

import com.workplace.chat.dto.ChatMemberResponse;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.chat.dto.ChatThreadResponse;
import com.workplace.chat.repository.ChatMessageRepository;
import com.workplace.chat.repository.ChatMessageRepository.MentionResolver;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.chat.repository.IssueStakeholderLookup.IssueRow;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.project.exception.ProjectAccessDeniedException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** chat thread 의 lazy 생성 + initial 멤버 채움. caller 가 프로젝트 멤버여야 접근 가능. */
@Service
@RequiredArgsConstructor
public class ChatThreadService {

  private static final int RECENT_LIMIT = 20;

  private final ChatThreadRepository threadRepo;
  private final ChatThreadMemberRepository memberRepo;
  private final ChatMessageRepository messageRepo;
  private final IssueStakeholderLookup lookup;
  private final ChatUserHydrator hydrator;
  private final UserMentionHydrator userMentionHydrator;

  /** 이슈에 연결된 thread 를 반환. 없으면 생성 + initial 멤버(reporter/assignees/watchers) 채움. */
  @Transactional
  public ChatThreadResponse getOrCreate(long callerId, String projectKey, int issueNumber) {
    IssueRow issue =
        lookup
            .findIssue(projectKey, issueNumber)
            .orElseThrow(() -> new IllegalArgumentException("issue not found"));
    // OPEN 프로젝트는 테넌트 전원 스레드 조회 허용. 메시지 작성은 ChatMessageService.ensureMember 가
    // 스레드 멤버(reporter/assignee/watcher 시드)로 별도 강제하므로 조회 개방이 작성 개방을 뜻하지 않는다.
    if (!lookup.isProjectMember(issue.projectId(), callerId)
        && !lookup.isOpenProject(issue.projectId())) {
      throw new ProjectAccessDeniedException("not a project member");
    }
    long threadId =
        threadRepo.findIdByIssueId(issue.id()).orElseGet(() -> createWithInitialMembers(issue));

    List<ChatMemberResponse> members = memberRepo.findMembers(threadId);
    MentionResolver resolver = userMentionHydrator::asMentionResponses;
    List<ChatMessageResponse> recent = messageRepo.findRecent(threadId, RECENT_LIMIT, resolver);
    var threadRow = threadRepo.findByIssueId(issue.id()).orElseThrow();
    return new ChatThreadResponse(threadId, issue.id(), threadRow.archivedAt(), members, recent);
  }

  /** thread row + 초기 멤버 INSERT. ON CONFLICT DO NOTHING 으로 race-safe. */
  private long createWithInitialMembers(IssueRow issue) {
    long threadId = threadRepo.insertIfAbsent(issue.id());
    memberRepo.insertIgnoreConflict(threadId, lookup.findInitialStakeholders(issue));
    return threadId;
  }
}

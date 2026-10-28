package com.workplace.support;

import com.workplace.audit.controller.AuditLogController;
import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.controller.AuthController;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.auth.service.AuthService;
import com.workplace.auth.web.RefreshTokenCookies;
import com.workplace.calendar.controller.CalendarController;
import com.workplace.calendar.controller.CalendarEventController;
import com.workplace.calendar.controller.CalendarTagController;
import com.workplace.calendar.controller.CalendarTagFeedController;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.calendar.service.CalendarService;
import com.workplace.calendar.service.CalendarTagFeedService;
import com.workplace.calendar.service.CalendarTagService;
import com.workplace.chat.controller.ChatMessageAttachmentController;
import com.workplace.chat.controller.ChatMessageController;
import com.workplace.chat.controller.ChatThreadMemberController;
import com.workplace.chat.controller.IssueChatController;
import com.workplace.chat.service.ChatMembershipService;
import com.workplace.chat.service.ChatMessageAttachmentService;
import com.workplace.chat.service.ChatMessageService;
import com.workplace.chat.service.ChatThreadService;
import com.workplace.contacts.controller.ContactController;
import com.workplace.contacts.service.ContactService;
import com.workplace.drive.controller.DriveBulkController;
import com.workplace.drive.controller.DriveFileController;
import com.workplace.drive.controller.DriveFolderController;
import com.workplace.drive.controller.DriveQuotaController;
import com.workplace.drive.controller.DriveSearchController;
import com.workplace.drive.controller.DriveShareLinkController;
import com.workplace.drive.controller.DriveTrashController;
import com.workplace.drive.controller.PublicDriveShareController;
import com.workplace.drive.service.DriveBulkService;
import com.workplace.drive.service.DriveFileService;
import com.workplace.drive.service.DriveFolderService;
import com.workplace.drive.service.DriveQuotaService;
import com.workplace.drive.service.DriveSearchService;
import com.workplace.drive.service.DriveShareLinkService;
import com.workplace.drive.service.DriveTrashService;
import com.workplace.drive.service.DriveZipService;
import com.workplace.file.controller.FileUploadController;
import com.workplace.file.service.FileUploadService;
import com.workplace.fileai.service.AttachmentViewService;
import com.workplace.filepreview.service.FilePreviewService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.realtime.EventStreamController;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.security.UserTokenAuthenticationFilter;
import com.workplace.home.controller.HomeChatController;
import com.workplace.home.controller.HomeSessionController;
import com.workplace.home.service.HomeChatService;
import com.workplace.home.service.HomeConversationSearchService;
import com.workplace.home.service.HomeSessionService;
import com.workplace.issue.controller.IssueBodyImageController;
import com.workplace.issue.controller.IssueCommentController;
import com.workplace.issue.controller.IssueCommentReactionController;
import com.workplace.issue.controller.IssueController;
import com.workplace.issue.controller.IssueFieldValueController;
import com.workplace.issue.outbound.IssueAiSummaryService;
import com.workplace.issue.service.IssueAiClassifyService;
import com.workplace.issue.service.IssueBodyImageService;
import com.workplace.issue.service.IssueCommentReactionService;
import com.workplace.issue.service.IssueCommentService;
import com.workplace.issue.service.IssueFieldValueService;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.issue.service.IssueService;
import com.workplace.mail.controller.EmailAccountController;
import com.workplace.mail.controller.MailAiController;
import com.workplace.mail.controller.MailComposeController;
import com.workplace.mail.controller.MailDraftCoachingController;
import com.workplace.mail.controller.MailExceptionHandler;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.mail.service.MailAiService;
import com.workplace.mail.service.MailComposeAttachmentService;
import com.workplace.mail.service.MailComposeService;
import com.workplace.mail.service.MailIssueService;
import com.workplace.mail.service.MailRecentRecipientService;
import com.workplace.messaging.controller.ChannelController;
import com.workplace.messaging.controller.ChannelMemberController;
import com.workplace.messaging.controller.DmController;
import com.workplace.messaging.controller.MessageController;
import com.workplace.messaging.controller.ReactionController;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.messaging.service.MessageService;
import com.workplace.messaging.service.ReactionService;
import com.workplace.notify.controller.NotificationController;
import com.workplace.notify.service.NotificationService;
import com.workplace.permission.controller.PermissionController;
import com.workplace.permission.service.PermissionService;
import com.workplace.project.controller.ProjectController;
import com.workplace.project.controller.ProjectMemberController;
import com.workplace.project.service.ProjectService;
import com.workplace.role.controller.RoleController;
import com.workplace.role.service.RoleService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.controller.UserController;
import com.workplace.user.controller.UserGroupController;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.UserGroupService;
import com.workplace.user.service.UserService;
import com.workplace.wiki.controller.WikiPageController;
import com.workplace.wiki.service.WikiCollabDocService;
import com.workplace.wiki.service.WikiHydrationService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiRevisionService;
import com.workplace.wiki.service.WikiShareAccess;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 컨트롤러 슬라이스 테스트(MockMvc)가 함께 쓰는 기반(WP-1028).
 *
 * <p>컨트롤러마다 {@code @WebMvcTest(X.class)} 와 목 조합을 따로 달면 그 조합마다 Spring 컨텍스트를 새로 띄운다(슬라이스 46개 → 기동
 * 46회). 시험하는 컨트롤러를 모두 한 슬라이스에 올리고 그 컨트롤러들이 쓰는 서비스·인증 빈을 한 벌의 목으로 바꿔, 한 컨텍스트를 함께 쓴다. 목은 테스트마다 초기화되므로
 * 공유해도 서로 새지 않는다. 쓰는 목은 {@code @Autowired} 로 받는다.
 *
 * <p>새 컨트롤러 슬라이스 테스트는 이 기반을 상속하고, 컨트롤러는 {@code controllers} 에, 그 컨트롤러가 쓰는 빈은 {@code types} 에 더한다 —
 * 클래스에 {@code @WebMvcTest}·{@code @MockitoBean} 을 따로 달면 컨텍스트가 다시 갈린다.
 */
@WebMvcTest(
    controllers = {
      AuditLogController.class,
      AuthController.class,
      CalendarController.class,
      CalendarEventController.class,
      CalendarTagController.class,
      CalendarTagFeedController.class,
      ChannelController.class,
      ChannelMemberController.class,
      ChatMessageAttachmentController.class,
      ChatMessageController.class,
      ChatThreadMemberController.class,
      ContactController.class,
      DmController.class,
      DriveBulkController.class,
      DriveFileController.class,
      DriveFolderController.class,
      DriveQuotaController.class,
      DriveSearchController.class,
      DriveShareLinkController.class,
      DriveTrashController.class,
      EmailAccountController.class,
      EventStreamController.class,
      FileUploadController.class,
      HomeChatController.class,
      HomeSessionController.class,
      IssueBodyImageController.class,
      IssueChatController.class,
      IssueCommentController.class,
      IssueCommentReactionController.class,
      IssueController.class,
      IssueFieldValueController.class,
      MailAiController.class,
      MailComposeController.class,
      MailDraftCoachingController.class,
      MessageController.class,
      NotificationController.class,
      PermissionController.class,
      ProjectController.class,
      ProjectMemberController.class,
      PublicDriveShareController.class,
      ReactionController.class,
      RoleController.class,
      UserController.class,
      UserGroupController.class,
      WikiPageController.class
    })
@Import({
  AlwaysActiveTenantStatusChecker.class,
  ApiKeyAuthenticationFilter.class,
  JwtAuthenticationFilter.class,
  MailExceptionHandler.class,
  RefreshTokenCookies.class,
  SecurityConfig.class,
  UserTokenAuthenticationFilter.class
})
@MockitoBean(
    types = {
      AgentApiKeyRepository.class,
      AttachmentViewService.class,
      AuditLogService.class,
      AuthService.class,
      CalendarEventService.class,
      CalendarService.class,
      CalendarTagFeedService.class,
      CalendarTagService.class,
      ChannelMemberService.class,
      ChannelService.class,
      ChatMembershipService.class,
      ChatMessageAttachmentService.class,
      ChatMessageService.class,
      ChatThreadService.class,
      ContactService.class,
      DmService.class,
      DriveBulkService.class,
      DriveFileService.class,
      DriveFolderService.class,
      DriveQuotaService.class,
      DriveSearchService.class,
      DriveShareLinkService.class,
      DriveTrashService.class,
      DriveZipService.class,
      EmailAccountService.class,
      FilePreviewService.class,
      FileUploadService.class,
      HomeChatService.class,
      HomeConversationSearchService.class,
      HomeSessionService.class,
      IssueAiClassifyService.class,
      IssueAiSummaryService.class,
      IssueBodyImageService.class,
      IssueCommentReactionService.class,
      IssueCommentService.class,
      IssueFieldValueService.class,
      IssueSearchService.class,
      IssueService.class,
      JwtProperties.class,
      JwtTokenProvider.class,
      MailAiService.class,
      MailComposeAttachmentService.class,
      MailComposeService.class,
      MailIssueService.class,
      MailRecentRecipientService.class,
      MembershipRepository.class,
      MessageService.class,
      NotificationService.class,
      PermissionService.class,
      ProjectService.class,
      ReactionService.class,
      RoleService.class,
      SseRegistry.class,
      UserApiTokenRepository.class,
      UserGroupService.class,
      UserRepository.class,
      UserService.class,
      WikiCollabDocService.class,
      WikiHydrationService.class,
      WikiPageService.class,
      WikiRevisionService.class,
      WikiShareAccess.class
    })
public abstract class WebMvcSliceTestBase {}

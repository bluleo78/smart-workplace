package com.workplace.issue.workflow.domain;

/**
 * 프로젝트의 지금 활성 실효 구성원 한 명(실행 판정용).
 *
 * <p>왜: 실행 판정은 사람을 id 로 다루지만 역할 구성원은 게시본에 username 으로 남아 있다. 서비스가 DB 구성원을 이 꼴로 옮겨 넘기면 판정은 DB 없이 둘을
 * 잇는다({@link RunRoleMembers}).
 *
 * @param id 사용자 id
 * @param username 저장된 정확한 로그인 이름
 */
public record ActiveMember(long id, String username) {}

import { FolderX } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { ResourceErrorState } from '@/components/layout/ResourceErrorState';

/**
 * 프로젝트를 불러올 수 없을 때(없음·접근 권한 없음)의 전체 화면 — 프로젝트 목록·이슈 상세와 같은 문구(WP-480).
 * 설정·사이클·타임라인을 URL 로 직접 열었을 때 API 가 403 인데도 빈 관리 화면(삭제·추가 버튼, 틀린 「아직 없습니다」)을 그리던 것을 막는다.
 */
export function ProjectUnavailableState() {
  const navigate = useNavigate();
  return (
    <ResourceErrorState
      icon={FolderX}
      title="프로젝트를 불러올 수 없습니다"
      description="요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다."
      actionLabel="프로젝트 목록으로"
      onAction={() => navigate('/projects')}
    />
  );
}

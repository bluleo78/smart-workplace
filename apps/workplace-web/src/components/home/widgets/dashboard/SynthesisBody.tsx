// 대시보드 그리드 위젯 어댑터 — SynthesisLayer(카운트 스트립+지금 신경 쓸 일)를 registry Component
// 시그니처({ count? })에 맞춰 감싼다. count 는 이 위젯에 의미 없어 무시한다.
// previewData 는 SynthesisLayer 가 그대로 받아 6개 하위 훅 전부를 enabled:false 로 끄고
// 목데이터로 렌더한다(위젯 추가 모달 프리뷰 전용, #브레인스토밍 2026-07-03).
import { SynthesisLayer, type SynthesisPreviewData } from '../../synthesis/SynthesisLayer'

export default function SynthesisBody({ previewData }: { count?: number; previewData?: SynthesisPreviewData }) {
  return <SynthesisLayer previewData={previewData} />
}

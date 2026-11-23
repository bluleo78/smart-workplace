import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import { WorkflowYamlEditor } from './WorkflowYamlEditor'

it('workflowYamlEditor_showsLineNumbers_andHighlightsProblemLines', () => {
  render(<WorkflowYamlEditor
    yaml={'name: 테스트\n\nnodes: {}'}
    problems={[{ severity: 'ERROR', code: 'NODES', message: '노드를 확인하세요.', line: 3, column: 1, nodeKey: null }]}
    textareaRef={null}
    onChange={() => {}}
    readOnly={false}
  />)
  const gutter = screen.getByTestId('workflow-yaml-gutter')
  expect(within(gutter).getByText('1')).toBeVisible()
  expect(within(gutter).getByText('2')).toBeVisible()
  expect(within(gutter).getByText('3')).toBeVisible()
  expect(screen.getByTestId('workflow-yaml-line-3')).toHaveClass('decoration-wavy')
  const editor = screen.getByRole('textbox', { name: '워크플로우 YAML' })
  fireEvent.scroll(editor, { target: { scrollTop: 24 } })
  expect(gutter.scrollTop).toBe(24)
})

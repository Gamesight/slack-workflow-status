import {
  DEFAULT_CONTEXT,
  DEFAULT_INPUTS,
  FakeJob,
  FakeWorkflowRun
} from './fixtures'

type AnyPayload = Record<string, unknown>

export interface MockState {
  inputs: Record<string, string>
  workflowRun: FakeWorkflowRun | null
  jobs: FakeJob[]
  context: typeof DEFAULT_CONTEXT
  setFailedCalls: string[]
  setSecretCalls: string[]
  errorCalls: unknown[]
  slackPayloads: AnyPayload[]
  webhookUrls: string[]
  listJobsCalls: AnyPayload[]
  getWorkflowRunCalls: AnyPayload[]
  sendShouldReject: Error | null
}

export const state: MockState = createEmptyState()

function createEmptyState(): MockState {
  return {
    inputs: {...DEFAULT_INPUTS},
    workflowRun: null,
    jobs: [],
    context: {...DEFAULT_CONTEXT},
    setFailedCalls: [],
    setSecretCalls: [],
    errorCalls: [],
    slackPayloads: [],
    webhookUrls: [],
    listJobsCalls: [],
    getWorkflowRunCalls: [],
    sendShouldReject: null
  }
}

export function resetState(): void {
  const fresh = createEmptyState()
  Object.assign(state, fresh)
}

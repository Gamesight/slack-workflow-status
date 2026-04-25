import {DEFAULT_CONTEXT, DEFAULT_INPUTS, FakeJob, FakeWorkflowRun} from './fixtures'

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
  botTokens: string[]
  webClientOptions: AnyPayload[]
  apiCalls: string[]
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
    // Force a fresh payload object — `DEFAULT_CONTEXT.payload` would alias
    // across resets, so a test mutating `state.context.payload` would leak
    // into later tests.
    context: {...DEFAULT_CONTEXT, payload: {}},
    setFailedCalls: [],
    setSecretCalls: [],
    errorCalls: [],
    slackPayloads: [],
    webhookUrls: [],
    botTokens: [],
    webClientOptions: [],
    apiCalls: [],
    listJobsCalls: [],
    getWorkflowRunCalls: [],
    sendShouldReject: null
  }
}

export function resetState(): void {
  Object.assign(state, createEmptyState())
}

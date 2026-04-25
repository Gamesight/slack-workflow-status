import {beforeEach, describe, expect, it} from 'vitest'

import {handleError, main} from '../src/main'
import {makeJob, makeWorkflowRun} from './fixtures'
import {resetState, state} from './state'

describe('handleError', () => {
  beforeEach(() => {
    resetState()
  })

  it('forwards the error message to core.setFailed', () => {
    handleError(new Error('something blew up'))
    expect(state.setFailedCalls).toEqual(['something blew up'])
  })

  it('falls back to "Unhandled Error:" when err has no message', () => {
    // Cast through unknown to simulate a messageless thrown value
    handleError(undefined as unknown as Error)
    expect(state.setFailedCalls).toHaveLength(1)
    expect(state.setFailedCalls[0]).toMatch(/^Unhandled Error:/)
  })
})

describe('main() error paths', () => {
  beforeEach(() => {
    resetState()
    state.workflowRun = makeWorkflowRun()
    state.jobs = [makeJob({conclusion: 'success'})]
  })

  it('reports Slack send failures via core.setFailed without rethrowing', async () => {
    state.sendShouldReject = new Error('slack 500')

    await expect(main()).resolves.toBeUndefined()

    expect(state.setFailedCalls).toEqual(['slack 500'])
    expect(state.slackPayloads).toEqual([])
  })
})

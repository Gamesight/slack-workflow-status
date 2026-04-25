// Strip env-var fallbacks before tests run so the host shell can't leak in.
delete process.env.SLACK_BOT_TOKEN

jest.mock('@actions/core', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {state} = require('./state')
  return {
    getInput: (name: string): string => {
      const value = state.inputs[name]
      return value === undefined ? '' : value
    },
    setSecret: (v: string): void => {
      state.setSecretCalls.push(v)
    },
    setFailed: (msg: string): void => {
      state.setFailedCalls.push(msg)
    },
    error: (e: unknown): void => {
      state.errorCalls.push(e)
    }
  }
})

jest.mock('@actions/github', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {state} = require('./state')
  return {
    get context() {
      return state.context
    },
    getOctokit: () => ({
      rest: {
        actions: {
          getWorkflowRun: async (params: Record<string, unknown>) => {
            state.getWorkflowRunCalls.push(params)
            return {data: state.workflowRun}
          },
          listJobsForWorkflowRun: async (params: Record<string, unknown>) => {
            state.listJobsCalls.push(params)
            return {data: {jobs: state.jobs}}
          }
        }
      }
    })
  }
})

jest.mock('@slack/webhook', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {state} = require('./state')
  class IncomingWebhook {
    constructor(url: string) {
      state.webhookUrls.push(url)
    }
    async send(payload: Record<string, unknown>): Promise<void> {
      if (state.sendShouldReject) {
        throw state.sendShouldReject
      }
      state.slackPayloads.push(payload)
    }
  }
  return {IncomingWebhook}
})

jest.mock('@slack/web-api', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {state} = require('./state')
  class WebClient {
    constructor(token: string, options?: Record<string, unknown>) {
      state.botTokens.push(token)
      state.webClientOptions.push(options ?? {})
    }
    async apiCall(
      method: string,
      payload: Record<string, unknown>
    ): Promise<{ok: boolean}> {
      if (state.sendShouldReject) {
        throw state.sendShouldReject
      }
      state.apiCalls.push(method)
      state.slackPayloads.push(payload)
      return {ok: true}
    }
  }
  return {
    WebClient,
    retryPolicies: {
      fiveRetriesInFiveMinutes: {retries: 5, __sentinel: 'five-in-five'}
    }
  }
})

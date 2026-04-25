import {beforeEach, describe, expect, it} from 'vitest'

import {main} from '../src/main'
import {makeJob, makePullRequest, makeWorkflowRun} from './fixtures'
import {resetState, state} from './state'

interface SlackAttachment {
  color: string
  text: string
  fields: Array<{title: string; short: boolean; value: string}>
  footer: string
  footer_icon: string
  mrkdwn_in: string[]
}

function payload(): {
  attachments: SlackAttachment[]
  username?: string
  channel?: string
  icon_emoji?: string
  icon_url?: string
} {
  expect(state.slackPayloads).toHaveLength(1)
  return state.slackPayloads[0] as unknown as ReturnType<typeof payload>
}

function attachment(): SlackAttachment {
  return payload().attachments[0]
}

describe('main()', () => {
  beforeEach(() => {
    resetState()
    state.workflowRun = makeWorkflowRun()
  })

  it('reports success when all jobs succeed', async () => {
    state.jobs = [makeJob({name: 'build', conclusion: 'success'})]

    await main()

    const a = attachment()
    expect(a.color).toBe('good')
    expect(a.text).toMatch(/^Success:/)
    expect(a.fields).toHaveLength(1)
    expect(a.fields[0].value).toContain('✓')
    expect(a.fields[0].value).toContain('build')
  })

  it('treats skipped jobs as success', async () => {
    state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'deploy', conclusion: 'skipped'})]

    await main()

    const a = attachment()
    expect(a.color).toBe('good')
    expect(a.text).toMatch(/^Success:/)
    const skipped = a.fields.find(f => f.value.includes('deploy'))
    expect(skipped?.value).toContain('⃠')
  })

  it('reports failure when any job fails', async () => {
    state.workflowRun = makeWorkflowRun({conclusion: 'failure'})
    state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'test', conclusion: 'failure'})]

    await main()

    const a = attachment()
    expect(a.color).toBe('danger')
    expect(a.text).toMatch(/^Failed:/)
    const failed = a.fields.find(f => f.value.includes('test'))
    expect(failed?.value).toContain('✗')
  })

  it('reports Success when continue-on-error job fails but workflow conclusion is success (#21)', async () => {
    // continue-on-error: true on an experimental shard means a job can have
    // conclusion: 'failure' while the workflow's overall conclusion is
    // 'success'. The notification should follow the workflow's conclusion.
    state.workflowRun = makeWorkflowRun({conclusion: 'success'})
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'experimental-shard', conclusion: 'failure'})
    ]

    await main()

    const a = attachment()
    expect(a.color).toBe('good')
    expect(a.text).toMatch(/^Success:/)
    // The failing experimental job is still rendered with its own ✗ icon.
    const exp = a.fields.find(f => f.value.includes('experimental-shard'))
    expect(exp?.value).toContain('✗')
  })

  it('reports Failed when workflow conclusion is timed_out', async () => {
    state.workflowRun = makeWorkflowRun({conclusion: 'timed_out'})
    state.jobs = [makeJob({name: 'long-job', conclusion: 'failure'})]

    await main()

    expect(attachment().color).toBe('danger')
    expect(attachment().text).toMatch(/^Failed:/)
  })

  it('reports Success when workflow conclusion is neutral', async () => {
    state.workflowRun = makeWorkflowRun({conclusion: 'neutral'})
    state.jobs = [makeJob({name: 'check', conclusion: 'neutral'})]

    await main()

    expect(attachment().color).toBe('good')
    expect(attachment().text).toMatch(/^Success:/)
  })

  it('reports Failed when failure and cancelled coexist (matrix fail-fast, #58)', async () => {
    // Reproduces the historical case where workflow_run.conclusion lied as
    // 'cancelled' even though one shard genuinely failed before fail-fast
    // cancelled the rest. The defensive scan of job conclusions catches this.
    state.workflowRun = makeWorkflowRun({conclusion: 'cancelled'})
    state.jobs = [
      makeJob({name: 'shard-1', conclusion: 'failure'}),
      makeJob({name: 'shard-2', conclusion: 'cancelled'})
    ]

    await main()

    const a = attachment()
    expect(a.color).toBe('danger')
    expect(a.text).toMatch(/^Failed:/)
  })

  it('reports cancelled when any job is cancelled', async () => {
    state.workflowRun = makeWorkflowRun({conclusion: 'cancelled'})
    state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'deploy', conclusion: 'cancelled'})]

    await main()

    const a = attachment()
    expect(a.color).toBe('warning')
    expect(a.text).toMatch(/^Cancelled:/)
    const cancelled = a.fields.find(f => f.value.includes('deploy'))
    expect(cancelled?.value).toContain('⃠')
  })

  it('omits job fields when include_jobs=false', async () => {
    state.inputs.include_jobs = 'false'
    state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'test', conclusion: 'failure'})]

    await main()

    expect(attachment().fields).toEqual([])
  })

  it('omits job fields when include_jobs=on-failure and all succeed', async () => {
    state.inputs.include_jobs = 'on-failure'
    state.jobs = [makeJob({name: 'build', conclusion: 'success'})]

    await main()

    expect(attachment().fields).toEqual([])
  })

  it('includes job fields when include_jobs=on-failure and a job fails', async () => {
    state.inputs.include_jobs = 'on-failure'
    state.workflowRun = makeWorkflowRun({conclusion: 'failure'})
    state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'test', conclusion: 'failure'})]

    await main()

    const fields = attachment().fields
    expect(fields).toHaveLength(2)
  })

  it('filters out non-completed jobs from fields', async () => {
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'in-progress-job', status: 'in_progress'})
    ]

    await main()

    const fields = attachment().fields
    expect(fields).toHaveLength(1)
    expect(fields[0].value).toContain('build')
  })

  it('appends commit message when include_commit_message=true', async () => {
    state.inputs.include_commit_message = 'true'
    state.workflowRun = makeWorkflowRun({
      head_commit: {message: 'my specific commit msg'}
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).toContain('Commit: my specific commit msg')
  })

  it('omits commit message when include_commit_message=false', async () => {
    state.inputs.include_commit_message = 'false'
    state.workflowRun = makeWorkflowRun({
      head_commit: {message: 'should not appear'}
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).not.toContain('should not appear')
    expect(attachment().text).not.toContain('Commit:')
  })

  it('uses pull_request status form when PRs are present', async () => {
    state.workflowRun = makeWorkflowRun({
      pull_requests: [makePullRequest({number: 42})]
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    const text = attachment().text
    expect(text).toContain('`pull_request`')
    expect(text).toContain('#42')
  })

  it('filters PRs from external repositories', async () => {
    state.workflowRun = makeWorkflowRun({
      pull_requests: [
        makePullRequest({
          number: 99,
          base: {
            ref: 'main',
            sha: 'x',
            repo: {
              id: 2,
              url: 'https://api.github.com/repos/other/repo',
              name: 'repo'
            }
          }
        })
      ]
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    const text = attachment().text
    expect(text).not.toContain('#99')
    expect(text).not.toContain('`pull_request`')
    expect(text).toContain('`push`')
  })

  it('includes optional slack fields when set', async () => {
    state.inputs.channel = '#releases'
    state.inputs.name = 'WorkflowBot'
    state.inputs.icon_emoji = ':rocket:'
    state.inputs.icon_url = 'https://example.com/icon.png'
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    const p = payload()
    expect(p.channel).toBe('#releases')
    expect(p.username).toBe('WorkflowBot')
    expect(p.icon_emoji).toBe(':rocket:')
    expect(p.icon_url).toBe('https://example.com/icon.png')
  })

  it('omits optional slack fields when unset', async () => {
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    const p = payload()
    expect(p).not.toHaveProperty('channel')
    expect(p).not.toHaveProperty('username')
    expect(p).not.toHaveProperty('icon_emoji')
    expect(p).not.toHaveProperty('icon_url')
  })

  it('forwards jobs_to_fetch as per_page', async () => {
    state.inputs.jobs_to_fetch = '75'
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(state.listJobsCalls).toHaveLength(1)
    expect(state.listJobsCalls[0]).toMatchObject({per_page: 75})
  })

  it('hyperlinks the workflow name to its history filtered by branch (#59)', async () => {
    state.workflowRun = makeWorkflowRun({
      path: '.github/workflows/release.yml',
      head_branch: 'feature/foo bar'
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).toContain(
      '<https://github.com/owner/repo/actions/workflows/release.yml?query=branch%3Afeature%2Ffoo%20bar|CI>'
    )
  })

  it('appends extra_text to the message body when set', async () => {
    state.inputs.extra_text = 'Deploy: https://example.com/release/42 cc <!channel>'
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).toContain('Deploy: https://example.com/release/42 cc <!channel>')
  })

  it('omits extra_text when unset', async () => {
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    const lines = attachment().text.split('\n')
    expect(lines).toHaveLength(2)
  })

  it('places extra_text after the commit message when both are set', async () => {
    state.inputs.include_commit_message = 'true'
    state.inputs.extra_text = 'extra context line'
    state.workflowRun = makeWorkflowRun({
      head_commit: {message: 'fix: a bug'}
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    const text = attachment().text
    expect(text.indexOf('Commit: fix: a bug')).toBeLessThan(text.indexOf('extra context line'))
  })

  it('falls back to plain workflow name when path is missing', async () => {
    state.workflowRun = makeWorkflowRun({path: ''})
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).toMatch(/Workflow: CI /)
    expect(attachment().text).not.toContain('actions/workflows/')
  })

  describe('hide_job_statuses', () => {
    it('hides skipped jobs while keeping success/failure visible (#55)', async () => {
      state.inputs.hide_job_statuses = 'skipped'
      state.jobs = [
        makeJob({name: 'changes', conclusion: 'success'}),
        makeJob({name: 'build', conclusion: 'success'}),
        makeJob({name: 'deploy', conclusion: 'skipped'})
      ]

      await main()

      const fields = attachment().fields
      expect(fields).toHaveLength(2)
      expect(fields.map(f => f.value).join('\n')).not.toMatch(/deploy/)
    })

    it('hides multiple statuses', async () => {
      state.inputs.hide_job_statuses = 'skipped,cancelled'
      state.jobs = [
        makeJob({name: 'build', conclusion: 'success'}),
        makeJob({name: 'lint', conclusion: 'skipped'}),
        makeJob({name: 'test', conclusion: 'failure'}),
        makeJob({name: 'deploy', conclusion: 'cancelled'})
      ]

      await main()

      const fields = attachment().fields
      const text = fields.map(f => f.value).join('\n')
      expect(fields).toHaveLength(2)
      expect(text).toMatch(/build/)
      expect(text).toMatch(/test/)
      expect(text).not.toMatch(/lint/)
      expect(text).not.toMatch(/deploy/)
    })

    it('tolerates whitespace around status names', async () => {
      state.inputs.hide_job_statuses = ' skipped , cancelled '
      state.jobs = [
        makeJob({name: 'build', conclusion: 'success'}),
        makeJob({name: 'lint', conclusion: 'skipped'}),
        makeJob({name: 'deploy', conclusion: 'cancelled'})
      ]

      await main()

      expect(attachment().fields).toHaveLength(1)
    })

    it('still reports overall workflow color/text from real result', async () => {
      state.workflowRun = makeWorkflowRun({conclusion: 'failure'})
      state.inputs.hide_job_statuses = 'failure'
      state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'test', conclusion: 'failure'})]

      await main()

      const a = attachment()
      expect(a.color).toBe('danger')
      expect(a.text).toMatch(/^Failed:/)
      expect(a.fields).toHaveLength(1)
      expect(a.fields[0].value).toMatch(/build/)
    })

    it('shows every completed job by default (no input)', async () => {
      state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'lint', conclusion: 'skipped'})]

      await main()

      expect(attachment().fields).toHaveLength(2)
    })

    it('composes with include_jobs=on-failure: section omitted on success', async () => {
      state.inputs.include_jobs = 'on-failure'
      state.inputs.hide_job_statuses = 'skipped'
      state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'lint', conclusion: 'skipped'})]

      await main()

      expect(attachment().fields).toEqual([])
    })

    it('composes with include_jobs=on-failure: filter applied on failure', async () => {
      state.workflowRun = makeWorkflowRun({conclusion: 'failure'})
      state.inputs.include_jobs = 'on-failure'
      state.inputs.hide_job_statuses = 'skipped'
      state.jobs = [
        makeJob({name: 'build', conclusion: 'success'}),
        makeJob({name: 'lint', conclusion: 'skipped'}),
        makeJob({name: 'test', conclusion: 'failure'})
      ]

      await main()

      const fields = attachment().fields
      const text = fields.map(f => f.value).join('\n')
      expect(fields).toHaveLength(2)
      expect(text).toMatch(/build/)
      expect(text).toMatch(/test/)
      expect(text).not.toMatch(/lint/)
    })
  })

  describe('workflow_run mode', () => {
    it('reports on the upstream run id, event, and workflow name', async () => {
      state.inputs.workflow_run = 'true'
      state.context.eventName = 'workflow_run'
      state.context.workflow = 'Notify'
      state.context.runId = 999
      state.context.payload = {
        workflow_run: {id: 1234567, name: 'Upstream CI', event: 'pull_request'}
      }
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(state.getWorkflowRunCalls).toHaveLength(1)
      expect(state.getWorkflowRunCalls[0]).toMatchObject({run_id: 1234567})
      expect(state.listJobsCalls[0]).toMatchObject({run_id: 1234567})
      const text = attachment().text
      expect(text).toContain('`pull_request`')
      expect(text).toMatch(/Workflow: <[^|]+\|Upstream CI>/)
      expect(text).not.toContain('|Notify>')
    })

    it('uses context.runId when workflow_run input is false (default)', async () => {
      state.context.runId = 42
      state.context.payload = {
        workflow_run: {id: 9999, name: 'Other', event: 'push'}
      }
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(state.getWorkflowRunCalls[0]).toMatchObject({run_id: 42})
      expect(state.listJobsCalls[0]).toMatchObject({run_id: 42})
      expect(attachment().text).toMatch(/Workflow: <[^|]+\|CI>/)
    })

    it('throws when workflow_run is true but payload.workflow_run is absent', async () => {
      state.inputs.workflow_run = 'true'
      state.context.payload = {}
      state.jobs = [makeJob({conclusion: 'success'})]

      await expect(main()).rejects.toThrow(/workflow_run input is true/)
    })
  })

  it('marks the github_token and webhook_url as secrets', async () => {
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(state.setSecretCalls).toContain('ghp_faketoken')
    expect(state.setSecretCalls).toContain('https://hooks.slack.example/T/B/xyz')
  })

  describe('bot token mode (#40)', () => {
    function useBotToken(token = 'xoxb-test-token'): void {
      // Drop the default webhook so the validator picks the bot-token branch.
      state.inputs.slack_webhook_url = ''
      state.inputs.slack_bot_token = token
      state.inputs.channel = '#release'
    }

    it('posts via chat.postMessage with the same attachment shape', async () => {
      useBotToken()
      state.jobs = [makeJob({name: 'build', conclusion: 'success'})]

      await main()

      expect(state.botTokens).toEqual(['xoxb-test-token'])
      expect(state.apiCalls).toEqual(['chat.postMessage'])
      const p = state.slackPayloads[0] as {
        channel: string
        text: string
        attachments: SlackAttachment[]
      }
      expect(p.channel).toBe('#release')
      // chat.postMessage requires top-level text for notifications/a11y.
      expect(p.text).toMatch(/^Success:/)
      expect(p.attachments).toHaveLength(1)
      expect(p.attachments[0].color).toBe('good')
      expect(p.attachments[0].fields).toHaveLength(1)
      expect(p.attachments[0].fields[0].value).toContain('build')
    })

    it('forwards channel, username, icon_emoji, icon_url', async () => {
      useBotToken()
      state.inputs.channel = '#deploys'
      state.inputs.name = 'WorkflowBot'
      state.inputs.icon_emoji = ':rocket:'
      state.inputs.icon_url = 'https://example.com/icon.png'
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      const p = state.slackPayloads[0] as {
        channel: string
        username: string
        icon_emoji: string
        icon_url: string
      }
      expect(p.channel).toBe('#deploys')
      expect(p.username).toBe('WorkflowBot')
      expect(p.icon_emoji).toBe(':rocket:')
      expect(p.icon_url).toBe('https://example.com/icon.png')
    })

    it('accepts a user ID as channel for DMs', async () => {
      useBotToken()
      state.inputs.channel = 'U01ABCDEF'
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      const p = state.slackPayloads[0] as {channel: string}
      expect(p.channel).toBe('U01ABCDEF')
    })

    it('configures the WebClient with the five-in-five retry policy', async () => {
      useBotToken()
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(state.webClientOptions[0]).toMatchObject({
        retryConfig: {__sentinel: 'five-in-five'}
      })
    })

    it('marks the bot token as a secret', async () => {
      useBotToken('xoxb-secret-1')
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(state.setSecretCalls).toContain('xoxb-secret-1')
    })

    it('reads SLACK_BOT_TOKEN from env when input is empty', async () => {
      state.inputs.slack_webhook_url = ''
      state.inputs.slack_bot_token = ''
      state.inputs.channel = '#release'
      process.env.SLACK_BOT_TOKEN = 'xoxb-from-env'
      state.jobs = [makeJob({conclusion: 'success'})]

      try {
        await main()
        expect(state.botTokens).toEqual(['xoxb-from-env'])
      } finally {
        delete process.env.SLACK_BOT_TOKEN
      }
    })

    it('does not invoke the webhook path', async () => {
      useBotToken()
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(state.webhookUrls).toEqual([])
    })

    it('throws when both slack_bot_token and slack_webhook_url are set', async () => {
      state.inputs.slack_bot_token = 'xoxb-test'
      // slack_webhook_url retains its default value.
      state.inputs.channel = '#x'
      state.jobs = [makeJob({conclusion: 'success'})]

      await expect(main()).rejects.toThrow(/not both/)
    })

    it('throws when neither slack_bot_token nor slack_webhook_url is set', async () => {
      state.inputs.slack_webhook_url = ''
      state.inputs.slack_bot_token = ''
      state.jobs = [makeJob({conclusion: 'success'})]

      await expect(main()).rejects.toThrow(/Either slack_bot_token or slack_webhook_url is required/)
    })

    it('throws when slack_bot_token is set but channel is empty', async () => {
      state.inputs.slack_webhook_url = ''
      state.inputs.slack_bot_token = 'xoxb-test'
      state.inputs.channel = ''
      state.jobs = [makeJob({conclusion: 'success'})]

      await expect(main()).rejects.toThrow(/channel is required when slack_bot_token is used/)
    })
  })

  describe('in-flight workflow (notify-job-in-same-workflow pattern)', () => {
    // When this action runs as a job inside the same workflow it's reporting
    // on, the workflow itself isn't complete yet — `conclusion` is null.
    // We must roll up the state from completed jobs instead of treating
    // null as failure.

    it('reports Success when conclusion is null and all completed jobs succeeded', async () => {
      state.workflowRun = makeWorkflowRun({conclusion: null})
      state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'deploy', conclusion: 'success'})]

      await main()

      const a = attachment()
      expect(a.color).toBe('good')
      expect(a.text).toMatch(/^Success:/)
    })

    it('reports Failed when conclusion is null and any job failed', async () => {
      state.workflowRun = makeWorkflowRun({conclusion: null})
      state.jobs = [makeJob({name: 'build', conclusion: 'success'}), makeJob({name: 'deploy', conclusion: 'failure'})]

      await main()

      const a = attachment()
      expect(a.color).toBe('danger')
      expect(a.text).toMatch(/^Failed:/)
    })
  })

  describe('workflow duration on re-runs', () => {
    it('uses run_started_at (current attempt) rather than created_at', async () => {
      // Original creation hours ago, but this attempt started 5m ago.
      state.workflowRun = makeWorkflowRun({
        created_at: '2026-01-01T00:00:00Z',
        run_started_at: '2026-01-01T03:55:00Z',
        updated_at: '2026-01-01T04:00:00Z'
      })
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(attachment().text).toMatch(/completed in `5m 0s`/)
    })

    it('falls back to created_at when run_started_at is absent', async () => {
      state.workflowRun = makeWorkflowRun({
        created_at: '2026-01-01T00:00:00Z',
        run_started_at: undefined,
        updated_at: '2026-01-01T00:02:00Z'
      })
      state.jobs = [makeJob({conclusion: 'success'})]

      await main()

      expect(attachment().text).toMatch(/completed in `2m 0s`/)
    })
  })
})

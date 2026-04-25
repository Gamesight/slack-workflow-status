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
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'deploy', conclusion: 'skipped'}),
    ]

    await main()

    const a = attachment()
    expect(a.color).toBe('good')
    expect(a.text).toMatch(/^Success:/)
    const skipped = a.fields.find(f => f.value.includes('deploy'))
    expect(skipped?.value).toContain('⃠')
  })

  it('reports failure when any job fails', async () => {
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'test', conclusion: 'failure'}),
    ]

    await main()

    const a = attachment()
    expect(a.color).toBe('danger')
    expect(a.text).toMatch(/^Failed:/)
    const failed = a.fields.find(f => f.value.includes('test'))
    expect(failed?.value).toContain('✗')
  })

  it('reports cancelled when any job is cancelled', async () => {
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'deploy', conclusion: 'cancelled'}),
    ]

    await main()

    const a = attachment()
    expect(a.color).toBe('warning')
    expect(a.text).toMatch(/^Cancelled:/)
    const cancelled = a.fields.find(f => f.value.includes('deploy'))
    expect(cancelled?.value).toContain('⃠')
  })

  it('omits job fields when include_jobs=false', async () => {
    state.inputs.include_jobs = 'false'
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'test', conclusion: 'failure'}),
    ]

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
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'test', conclusion: 'failure'}),
    ]

    await main()

    const fields = attachment().fields
    expect(fields).toHaveLength(2)
  })

  it('filters out non-completed jobs from fields', async () => {
    state.jobs = [
      makeJob({name: 'build', conclusion: 'success'}),
      makeJob({name: 'in-progress-job', status: 'in_progress'}),
    ]

    await main()

    const fields = attachment().fields
    expect(fields).toHaveLength(1)
    expect(fields[0].value).toContain('build')
  })

  it('appends commit message when include_commit_message=true', async () => {
    state.inputs.include_commit_message = 'true'
    state.workflowRun = makeWorkflowRun({
      head_commit: {message: 'my specific commit msg'},
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).toContain('Commit: my specific commit msg')
  })

  it('omits commit message when include_commit_message=false', async () => {
    state.inputs.include_commit_message = 'false'
    state.workflowRun = makeWorkflowRun({
      head_commit: {message: 'should not appear'},
    })
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(attachment().text).not.toContain('should not appear')
    expect(attachment().text).not.toContain('Commit:')
  })

  it('uses pull_request status form when PRs are present', async () => {
    state.workflowRun = makeWorkflowRun({
      pull_requests: [makePullRequest({number: 42})],
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
              name: 'repo',
            },
          },
        }),
      ],
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

  it('marks the github_token and webhook_url as secrets', async () => {
    state.jobs = [makeJob({conclusion: 'success'})]

    await main()

    expect(state.setSecretCalls).toContain('ghp_faketoken')
    expect(state.setSecretCalls).toContain('https://hooks.slack.example/T/B/xyz')
  })
})

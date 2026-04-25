export interface FakeJob {
  status: string
  conclusion: string
  name: string
  html_url: string
  started_at: string
  completed_at: string
}

export function makeJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    status: 'completed',
    conclusion: 'success',
    name: 'build',
    html_url: 'https://github.com/owner/repo/actions/runs/1/jobs/10',
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:30Z',
    ...overrides
  }
}

interface FakePullRequest {
  url: string
  id: number
  number: number
  head: {
    ref: string
    sha: string
    repo: {id: number; url: string; name: string}
  }
  base: {
    ref: string
    sha: string
    repo: {id: number; url: string; name: string}
  }
}

const SAME_REPO_URL = 'https://api.github.com/repos/owner/repo'

export function makePullRequest(overrides: Partial<FakePullRequest> = {}): FakePullRequest {
  return {
    url: `${SAME_REPO_URL}/pulls/42`,
    id: 1001,
    number: 42,
    head: {
      ref: 'feature-branch',
      sha: 'abc123',
      repo: {id: 1, url: SAME_REPO_URL, name: 'repo'}
    },
    base: {
      ref: 'main',
      sha: 'def456',
      repo: {id: 1, url: SAME_REPO_URL, name: 'repo'}
    },
    ...overrides
  }
}

export interface FakeWorkflowRun {
  created_at: string
  updated_at: string
  html_url: string
  run_number: number
  head_branch: string
  path: string
  conclusion: string | null
  repository: {html_url: string; full_name: string; url: string}
  head_commit: {message: string}
  pull_requests: FakePullRequest[]
}

export function makeWorkflowRun(overrides: Partial<FakeWorkflowRun> = {}): FakeWorkflowRun {
  return {
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:05:00Z',
    html_url: 'https://github.com/owner/repo/actions/runs/1',
    run_number: 7,
    head_branch: 'main',
    path: '.github/workflows/ci.yml',
    conclusion: 'success',
    repository: {
      html_url: 'https://github.com/owner/repo',
      full_name: 'owner/repo',
      url: SAME_REPO_URL
    },
    head_commit: {message: 'commit message here'},
    pull_requests: [],
    ...overrides
  }
}

export const DEFAULT_INPUTS: Record<string, string> = {
  slack_webhook_url: 'https://hooks.slack.example/T/B/xyz',
  slack_bot_token: '',
  repo_token: 'ghp_faketoken',
  jobs_to_fetch: '30',
  include_jobs: 'true',
  hide_job_statuses: '',
  include_commit_message: 'false',
  extra_text: '',
  channel: '',
  name: '',
  icon_url: '',
  icon_emoji: ''
}

interface FakeWorkflowRunPayload {
  id: number
  name?: string
  event?: string
}

interface FakeContext {
  repo: {owner: string; repo: string}
  runId: number
  actor: string
  eventName: string
  workflow: string
  payload: {workflow_run?: FakeWorkflowRunPayload}
}

export const DEFAULT_CONTEXT: FakeContext = {
  repo: {owner: 'owner', repo: 'repo'},
  runId: 1,
  actor: 'octocat',
  eventName: 'push',
  workflow: 'CI',
  payload: {}
}

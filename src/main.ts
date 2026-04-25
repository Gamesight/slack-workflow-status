/******************************************************************************\
 * Main entrypoint for GitHib Action. Fetches information regarding the       *
 * currently running Workflow and it's Jobs. Sends individual job status and  *
 * workflow status as a formatted notification to the Slack Webhhok URL set   *
 * in the environment variables.                                              *
 *                                                                            *
 * Org: Gamesight <https://gamesight.io>                                      *
 * Author: Anthony Kinson <anthony@gamesight.io>                              *
 * Repository: https://github.com/Gamesight/slack-workflow-status             *
 * License: MIT                                                               *
 * Copyright (c) 2020 Gamesight, Inc                                          *
\******************************************************************************/

import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'
import {IncomingWebhook} from '@slack/webhook'
import {MessageAttachment} from '@slack/types'

// HACK: https://github.com/octokit/types.ts/issues/205
interface PullRequest {
  url: string
  id: number
  number: number
  head: {
    ref: string
    sha: string
    repo: {
      id: number
      url: string
      name: string
    }
  }
  base: {
    ref: string
    sha: string
    repo: {
      id: number
      url: string
      name: string
    }
  }
}

type IncludeJobs = 'true' | 'false' | 'on-failure'
type SlackMessageAttachementFields = MessageAttachment['fields']

if (require.main === module) {
  process.on('unhandledRejection', handleError)
  main().catch(handleError) // eslint-disable-line github/no-then
}

// Action entrypoint
export async function main(): Promise<void> {
  // Collect Action Inputs
  const webhook_url = core.getInput('slack_webhook_url', {
    required: true
  })
  const github_token = core.getInput('repo_token', {required: true})
  const jobs_to_fetch = core.getInput('jobs_to_fetch', {required: true})
  const include_jobs = core.getInput('include_jobs', {
    required: true
  }) as IncludeJobs
  const hide_job_statuses = core
    .getInput('hide_job_statuses')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  const include_commit_message =
    core.getInput('include_commit_message', {
      required: true
    }) === 'true'
  const slack_channel = core.getInput('channel')
  const slack_name = core.getInput('name')
  const slack_icon = core.getInput('icon_url')
  const slack_emoji = core.getInput('icon_emoji') // https://www.webfx.com/tools/emoji-cheat-sheet/
  const from_workflow_run = core.getInput('workflow_run') === 'true'
  // Force as secret, forces *** when trying to print or log values
  core.setSecret(github_token)
  core.setSecret(webhook_url)
  // Auth github with octokit module
  const octokit = getOctokit(github_token)

  // When triggered by the `workflow_run` event, report on the upstream
  // workflow that fired this notification workflow rather than the current run.
  const upstream_run = from_workflow_run
    ? (context.payload.workflow_run as
        | {id: number; name?: string; event?: string}
        | undefined)
    : undefined
  if (from_workflow_run && !upstream_run) {
    throw new Error(
      'workflow_run input is true but context.payload.workflow_run is missing. ' +
        'This action must be triggered by the `workflow_run` event when workflow_run is enabled.'
    )
  }
  const run_id = upstream_run ? upstream_run.id : context.runId

  // Fetch workflow run data
  const {data: workflow_run} = await octokit.rest.actions.getWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id
  })

  // Fetch workflow job information
  const {data: jobs_response} =
    await octokit.rest.actions.listJobsForWorkflowRun({
      owner: context.repo.owner,
      repo: context.repo.repo,
      run_id,
      per_page: parseInt(jobs_to_fetch, 10)
    })

  const completed_jobs = jobs_response.jobs.filter(
    job => job.status === 'completed'
  )

  // Configure slack attachment styling
  let workflow_color // can be good, danger, warning or a HEX colour (#00FF00)
  let workflow_msg

  let job_fields: SlackMessageAttachementFields

  if (
    completed_jobs.every(job =>
      ['success', 'skipped'].includes(job.conclusion ?? '')
    )
  ) {
    workflow_color = 'good'
    workflow_msg = 'Success:'
    if (include_jobs === 'on-failure') {
      job_fields = []
    }
  } else if (
    completed_jobs.some(
      job => !['success', 'skipped', 'cancelled'].includes(job.conclusion ?? '')
    )
  ) {
    // Any conclusion outside success/skipped/cancelled (failure, timed_out,
    // action_required, neutral, stale, ...) wins over a sibling cancellation:
    // matrix fail-fast cancels still-running jobs but the workflow really did
    // fail. Issue #58.
    workflow_color = 'danger'
    workflow_msg = 'Failed:'
  } else {
    workflow_color = 'warning'
    workflow_msg = 'Cancelled:'
    if (include_jobs === 'on-failure') {
      job_fields = []
    }
  }

  if (include_jobs === 'false') {
    job_fields = []
  }

  // Apply optional per-job denylist (e.g. hide_job_statuses: 'skipped').
  // The workflow color/message above still reflects the real overall result.
  const displayed_jobs =
    hide_job_statuses.length > 0
      ? completed_jobs.filter(
          job => !hide_job_statuses.includes(job.conclusion ?? '')
        )
      : completed_jobs

  // Build Job Data Fields
  job_fields ??= displayed_jobs.map(job => {
    let job_status_icon

    switch (job.conclusion) {
      case 'success':
        job_status_icon = '✓'
        break
      case 'cancelled':
      case 'skipped':
        job_status_icon = '⃠'
        break
      default:
        // case 'failure'
        job_status_icon = '✗'
    }

    const job_duration = compute_duration({
      start: new Date(job.started_at),
      end: new Date(job.completed_at ?? job.started_at)
    })

    return {
      title: '', // FIXME: it's required in slack type, we should workaround that somehow
      short: true,
      value: `${job_status_icon} <${job.html_url}|${job.name}> (${job_duration})`
    }
  })

  // Payload Formatting Shortcuts
  const workflow_duration = compute_duration({
    start: new Date(workflow_run.created_at),
    end: new Date(workflow_run.updated_at)
  })
  const repo_url = `<${workflow_run.repository.html_url}|*${workflow_run.repository.full_name}*>`
  const branch_url = `<${workflow_run.repository.html_url}/tree/${workflow_run.head_branch}|*${workflow_run.head_branch}*>`
  const workflow_run_url = `<${workflow_run.html_url}|#${workflow_run.run_number}>`
  const event_name = upstream_run?.event ?? context.eventName
  const workflow_name = upstream_run?.name ?? context.workflow
  // Hyperlink the workflow name to its history page filtered by branch.
  // workflow_run.path is `.github/workflows/<file>`; the canonical UI URL
  // uses `actions/workflows/<file>`. Falls back to plain text if path missing.
  const workflow_file = workflow_run.path?.split('/').pop()
  const workflow_name_link = workflow_file
    ? `<${workflow_run.repository.html_url}/actions/workflows/${workflow_file}?query=branch%3A${encodeURIComponent(workflow_run.head_branch ?? '')}|${workflow_name}>`
    : workflow_name
  // Example: Success: AnthonyKinson's `push` on `master` for pull_request
  let status_string = `${workflow_msg} ${context.actor}'s \`${event_name}\` on \`${branch_url}\``
  // Example: Workflow: My Workflow #14 completed in `1m 30s`
  const details_string = `Workflow: ${workflow_name_link} ${workflow_run_url} completed in \`${workflow_duration}\``

  // Build Pull Request string if required
  const pull_requests = (workflow_run.pull_requests as PullRequest[])
    .filter(
      pull_request => pull_request.base.repo.url === workflow_run.repository.url // exclude PRs from external repositories
    )
    .map(
      pull_request =>
        `<${workflow_run.repository.html_url}/pull/${pull_request.number}|#${pull_request.number}> from \`${pull_request.head.ref}\` to \`${pull_request.base.ref}\``
    )
    .join(', ')

  if (pull_requests !== '') {
    status_string = `${workflow_msg} ${context.actor}'s \`pull_request\` ${pull_requests}`
  }

  const commit_message = `Commit: ${workflow_run.head_commit?.message ?? ''}`

  // We're using old style attachments rather than the new blocks because:
  // - Blocks don't allow colour indicators on messages
  // - Block are limited to 10 fields. >10 jobs in a workflow results in payload failure

  // Build our notification attachment
  const slack_attachment = {
    mrkdwn_in: ['text' as const],
    color: workflow_color,
    text: [status_string, details_string]
      .concat(include_commit_message ? [commit_message] : [])
      .join('\n'),
    footer: repo_url,
    footer_icon: 'https://github.githubassets.com/favicon.ico',
    fields: job_fields
  }
  // Build our notification payload
  const slack_payload_body = {
    attachments: [slack_attachment],
    ...(slack_name && {username: slack_name}),
    ...(slack_channel && {channel: slack_channel}),
    ...(slack_emoji && {icon_emoji: slack_emoji}),
    ...(slack_icon && {icon_url: slack_icon})
  }

  const slack_webhook = new IncomingWebhook(webhook_url)

  try {
    await slack_webhook.send(slack_payload_body)
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    }
  }
}

// Converts start and end dates into a duration string
export function compute_duration({
  start,
  end
}: {
  start: Date
  end: Date
}): string {
  // FIXME: https://github.com/microsoft/TypeScript/issues/2361
  const duration = end.valueOf() - start.valueOf()
  let delta = duration / 1000
  const days = Math.floor(delta / 86400)
  delta -= days * 86400
  const hours = Math.floor(delta / 3600) % 24
  delta -= hours * 3600
  const minutes = Math.floor(delta / 60) % 60
  delta -= minutes * 60
  const seconds = Math.floor(delta % 60)
  // Format duration sections
  const format_duration = (
    value: number,
    text: string,
    hide_on_zero: boolean
  ): string => (value <= 0 && hide_on_zero ? '' : `${value}${text} `)

  return (
    format_duration(days, 'd', true) +
    format_duration(hours, 'h', true) +
    format_duration(minutes, 'm', true) +
    format_duration(seconds, 's', false).trim()
  )
}

export function handleError(err: Error): void {
  core.error(err)
  if (err && err.message) {
    core.setFailed(err.message)
  } else {
    core.setFailed(`Unhandled Error: ${err}`)
  }
}

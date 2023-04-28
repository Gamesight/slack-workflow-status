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

process.on('unhandledRejection', handleError)
main().catch(handleError) // eslint-disable-line github/no-then

// Action entrypoint
async function main(): Promise<void> {
  // Collect Action Inputs
  const webhook_url = core.getInput('slack_webhook_url', {
    required: true
  })
  const github_token = core.getInput('repo_token', {required: true})
  const include_jobs = core.getInput('include_jobs', {
    required: true
  }) as IncludeJobs
  const display_only_failed =
    core.getInput('display_only_failed', {
      required: true
    }) === 'true'
  const include_commit_message =
    core.getInput('include_commit_message', {
      required: true
    }) === 'true'
  const slack_channel = core.getInput('channel')
  const slack_name = core.getInput('name')
  const slack_icon = core.getInput('icon_url')
  const slack_emoji = core.getInput('icon_emoji') // https://www.webfx.com/tools/emoji-cheat-sheet/
  // Force as secret, forces *** when trying to print or log values
  core.setSecret(github_token)
  core.setSecret(webhook_url)
  // Auth github with octokit module
  const octokit = getOctokit(github_token)
  // Fetch workflow run data
  const {data: workflow_run} = await octokit.actions.getWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: context.runId
  })

  // Fetch workflow job information
  const {data: jobs_response} = await octokit.actions.listJobsForWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: context.runId,
    per_page: 100
  })

  const completed_jobs = jobs_response.jobs.filter(
    job => job.status === 'completed'
  )

  // Configure slack attachment styling
  let workflow_color // can be good, danger, warning or a HEX colour (#00FF00)
  let workflow_msg

  let job_fields: SlackMessageAttachementFields

  if (
    completed_jobs.every(job => ['success', 'skipped'].includes(job.conclusion))
  ) {
    workflow_color = 'good'
    workflow_msg = 'Success:'
    if (include_jobs === 'on-failure') {
      job_fields = []
    }
  } else if (completed_jobs.some(job => job.conclusion === 'cancelled')) {
    workflow_color = 'warning'
    workflow_msg = 'Cancelled:'
    if (include_jobs === 'on-failure') {
      job_fields = []
    }
  } else {
    // (jobs_response.jobs.some(job => job.conclusion === 'failure')
    workflow_color = 'danger'
    workflow_msg = 'Failed:'
  }

  if (include_jobs === 'false') {
    job_fields = []
  }

  // Build Job Data Fields
  let jobs_list

  if (display_only_failed) {
    jobs_list = completed_jobs.filter(
      job => job.conclusion === 'failure' || job.conclusion === 'cancelled'
    )
  } else {
    jobs_list = completed_jobs
  }

  job_fields ??= jobs_list.map(job => {
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
      end: new Date(job.completed_at)
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
  // Example: Success: AnthonyKinson's `push` on `master` for pull_request
  let status_string = `${workflow_msg} ${context.actor}'s \`${context.eventName}\` on \`${branch_url}\``
  // Example: Workflow: My Workflow #14 completed in `1m 30s`
  const details_string = `Workflow: ${context.workflow} ${workflow_run_url} completed in \`${workflow_duration}\``

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

  const commit_message = `Commit: ${workflow_run.head_commit.message}`

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
function compute_duration({start, end}: {start: Date; end: Date}): string {
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

function handleError(err: Error): void {
  core.error(err)
  if (err && err.message) {
    core.setFailed(err.message)
  } else {
    core.setFailed(`Unhandled Error: ${err}`)
  }
}

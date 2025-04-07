/* eslint-disable @typescript-eslint/no-explicit-any */
import { computeDuration } from '../utils/computeDuration'
import { MessageAttachment } from '@slack/types'
import * as core from '@actions/core'

export function buildJobSummary({
  completedJobs,
  includeJobStatuses,
  includeJobDurations
}: {
  completedJobs: {
    conclusion: string
    name: string
    html_url: string
    started_at: string
    completed_at: string
  }[]
  includeJobStatuses: 'true' | 'false' | 'on-failure'
  includeJobDurations: boolean
}): {
  workflowColor: string
  jobFields: SlackMessageAttachmentFields
} {
  let jobFields: SlackMessageAttachmentFields = []

  const allJobsSuccessful = completedJobs.every((job) =>
    ['success', 'skipped'].includes(job.conclusion)
  )
  const someJobsCancelled = completedJobs.some(
    (job) => job.conclusion === 'cancelled'
  )
  const someJobsFailed = completedJobs.some((job) =>
    job.conclusion.includes('fail')
  )

  core.info(`includeJobStatuses: ${includeJobStatuses}`)
  // core.info(`completedJobs: ${JSON.stringify(completedJobs, null, 2)}`) // Pretty print JSON
  core.info(`allJobsSuccessful: ${allJobsSuccessful}`)
  core.info(`someJobsCancelled: ${someJobsCancelled}`)
  core.info(`someJobsFailed: ${someJobsFailed}`)

  // Determine workflow color
  const workflowColor = allJobsSuccessful
    ? 'good'
    : someJobsCancelled
    ? 'warning'
    : '#FF0000' // red (failure)

  // If 'false', don't report jobs at all
  if (includeJobStatuses === 'false') {
    return { workflowColor, jobFields: [] }
  }

  // If 'on-failure' and no failures, don't report jobs
  if (includeJobStatuses === 'on-failure' && !someJobsFailed) {
    return { workflowColor, jobFields: [] }
  }

  // Build jobFields only if necessary
  jobFields = completedJobs.map((job) => {
    const jobStatusIcon =
      job.conclusion === 'success'
        ? '✓'
        : ['cancelled', 'skipped'].includes(job.conclusion)
        ? '⃠'
        : '✗'

    const jobDuration = includeJobDurations
      ? ` (${computeDuration({
          start: new Date(job.started_at),
          end: new Date(job.completed_at)
        })})`
      : ''

    return {
      title: '', // Slack requires this field but it can be empty
      short: true,
      value: `${jobStatusIcon} <${job.html_url}|${job.name}>${jobDuration}`
    }
  })

  return { workflowColor, jobFields }
}

/**
 * Build a Slack message for a completed job
 * @param param
 * @returns
 */
export function buildJobSummaryMessage({
  workflowRun,
  completedJobs,
  includeJobStatuses,
  includeJobDurations,
  actor,
  branchUrl,
  workflowRunUrl,
  repoUrl,
  commitMessage
}: {
  workflowRun: {
    name: string
    created_at: string
    updated_at: string
    pull_requests: []
    repository: { html_url: string; url: string }
  }
  completedJobs: any[]
  includeJobStatuses: 'true' | 'false' | 'on-failure'
  includeJobDurations: boolean
  actor: string
  branchUrl: string
  workflowRunUrl: string
  repoUrl: string
  commitMessage?: string
}): {
  text: string
  attachments: any[]
} {
  const { workflowColor, jobFields } = buildJobSummary({
    completedJobs,
    includeJobStatuses,
    includeJobDurations
  })

  const workflowDuration = computeDuration({
    start: new Date(workflowRun.created_at),
    end: new Date(workflowRun.updated_at)
  })

  let statusString = `${actor}'s \`${workflowRun.name}\` on \`${branchUrl}\``
  const detailsString = `${workflowRun.name} ${workflowRunUrl} completed in \`${workflowDuration}\``

  // Build Pull Request string if required
  const pull_requests = (workflowRun.pull_requests as PullRequest[])
    .filter(
      (pull_request) =>
        pull_request.base.repo.url === workflowRun.repository.url // exclude PRs from external repositories
    )
    .map(
      (pull_request) =>
        `<${workflowRun.repository.html_url}/pull/${pull_request.number}|#${pull_request.number}> from \`${pull_request.head.ref}\` to \`${pull_request.base.ref}\``
    )
    .join(', ')

  if (pull_requests !== '') {
    statusString = `${actor}'s \`pull_request\` ${pull_requests}`
  }

  return {
    text: statusString,
    attachments: [
      {
        text: detailsString,
        color: workflowColor,
        footer: commitMessage
          ? `*${repoUrl}* | commit: ${commitMessage}`
          : repoUrl,
        fields: jobFields
      }
    ]
  }
}

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

type SlackMessageAttachmentFields = MessageAttachment['fields']

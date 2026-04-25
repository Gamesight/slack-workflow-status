/**
 * Builds the Slack message and sends it via Incoming Webhook or the Web
 * API, depending on which credential was supplied.
 */

import * as core from '@actions/core'
import {IncomingWebhook} from '@slack/webhook'
import {MessageAttachment} from '@slack/types'
import {WebClient, retryPolicies} from '@slack/web-api'

import type {ActionInputs} from './inputs.js'
import {
  computeDuration,
  jobIcon,
  type JobsList,
  type UpstreamRun,
  type WorkflowRun,
  type WorkflowStatus
} from './format.js'

type SlackFields = NonNullable<MessageAttachment['fields']>

/** The subset of `@actions/github`'s `context` that the message uses. */
interface MessageContext {
  actor: string
  eventName: string
  workflow: string
}

interface BuildArgs {
  inputs: ActionInputs
  status: WorkflowStatus
  workflow_run: WorkflowRun
  completed_jobs: JobsList
  upstream_run: UpstreamRun | undefined
  context: MessageContext
}

/** Renders a Slack mrkdwn link, optionally with bold link text. */
const link = (href: string | null | undefined, text: string, bold = false): string =>
  `<${href}|${bold ? `*${text}*` : text}>`

/**
 * Builds the Slack attachment from workflow data and inputs, then sends it
 * via the configured transport. Send failures are reported via
 * `core.setFailed` rather than thrown.
 */
export async function sendSlackMessage(args: BuildArgs): Promise<void> {
  const {headline, attachment} = buildMessage(args)
  await deliver(args.inputs, headline, attachment)
}

function buildMessage(args: BuildArgs): {
  headline: string
  attachment: MessageAttachment
} {
  const {inputs, status, workflow_run, completed_jobs, upstream_run, context} = args

  const suppressJobFields =
    inputs.include_jobs === 'false' || (inputs.include_jobs === 'on-failure' && status.outcome !== 'failure')

  const job_fields = suppressJobFields ? [] : buildJobFields(completed_jobs, inputs.hide_job_statuses)

  const {headline, details, commit} = composeMessageText({
    workflow_run,
    upstream_run,
    context,
    verb: status.verb
  })

  // We're using old-style attachments rather than blocks because:
  // - Blocks don't allow colour indicators on messages
  // - Blocks are limited to 10 fields. >10 jobs in a workflow results in payload failure
  const attachment: MessageAttachment = {
    mrkdwn_in: ['text' as const],
    color: status.color,
    text: [headline, details]
      .concat(inputs.include_commit_message ? [commit] : [])
      .concat(inputs.extra_text ? [inputs.extra_text] : [])
      .join('\n'),
    footer: link(workflow_run.repository.html_url, workflow_run.repository.full_name, true),
    footer_icon: 'https://github.githubassets.com/favicon.ico',
    fields: job_fields
  }

  return {headline, attachment}
}

async function deliver(inputs: ActionInputs, headline: string, attachment: MessageAttachment): Promise<void> {
  try {
    if (inputs.bot_token) {
      const client = new WebClient(inputs.bot_token, {
        retryConfig: retryPolicies.fiveRetriesInFiveMinutes
      })
      // chat.postMessage's strict union types (icon_emoji vs icon_url are
      // mutually-exclusive `never`-guarded branches) reject our conditional
      // spread even when valid. slackapi's action routes through `apiCall`
      // for the same reason. `text` is required for notifications/screen
      // readers (webhooks don't require it).
      await client.apiCall('chat.postMessage', {
        channel: inputs.slack_channel,
        text: headline,
        attachments: [attachment],
        ...senderOverrides(inputs)
      })
    } else {
      const webhook = new IncomingWebhook(inputs.webhook_url)
      await webhook.send({
        attachments: [attachment],
        ...(inputs.slack_channel && {channel: inputs.slack_channel}),
        ...senderOverrides(inputs)
      })
    }
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    }
  }
}

function senderOverrides(inputs: ActionInputs): {
  username?: string
  icon_emoji?: string
  icon_url?: string
} {
  return {
    ...(inputs.slack_name && {username: inputs.slack_name}),
    ...(inputs.slack_emoji && {icon_emoji: inputs.slack_emoji}),
    ...(inputs.slack_icon && {icon_url: inputs.slack_icon})
  }
}

/**
 * Maps each completed job to a Slack `{title, short, value}` field with the
 * status icon, a link to the job, and its duration. Applies the optional
 * `hide_job_statuses` denylist; the workflow color/verb upstream still
 * reflects the real overall result regardless of this filter.
 */
function buildJobFields(completed_jobs: JobsList, hide_job_statuses: string[]): SlackFields {
  const displayed_jobs =
    hide_job_statuses.length > 0
      ? completed_jobs.filter(job => !hide_job_statuses.includes(job.conclusion ?? ''))
      : completed_jobs

  return displayed_jobs.map(job => {
    const job_duration = computeDuration({
      start: new Date(job.started_at),
      end: new Date(job.completed_at ?? job.started_at)
    })

    return {
      title: '', // @slack/types requires `title`; '' renders as a fieldless row.
      short: true,
      value: `${jobIcon(job.conclusion)} ${link(job.html_url, job.name)} (${job_duration})`
    }
  })
}

/**
 * Composes the three text lines of the message: `headline` (verb + actor +
 * event/branch, overridden with PR list when applicable), `details`
 * (workflow name + run number + duration, with the name hyperlinked to its
 * branch-filtered history), and `commit`.
 */
function composeMessageText(args: {
  workflow_run: WorkflowRun
  upstream_run: UpstreamRun | undefined
  context: MessageContext
  verb: string
}): {headline: string; details: string; commit: string} {
  const {workflow_run, upstream_run, context, verb} = args
  const repo_url = workflow_run.repository.html_url
  const branch = workflow_run.head_branch ?? ''

  const branch_link = link(`${repo_url}/tree/${branch}`, branch, true)
  const run_link = link(workflow_run.html_url, `#${workflow_run.run_number}`)
  const event_name = upstream_run?.event ?? context.eventName
  const workflow_name = upstream_run?.name ?? context.workflow

  // Hyperlink the workflow name to its history page filtered by branch.
  // workflow_run.path is `.github/workflows/<file>`; the canonical UI URL
  // uses `actions/workflows/<file>`. Falls back to plain text if path missing.
  const workflow_file = workflow_run.path?.split('/').pop()
  const workflow_link = workflow_file
    ? link(`${repo_url}/actions/workflows/${workflow_file}?query=branch%3A${encodeURIComponent(branch)}`, workflow_name)
    : workflow_name

  // PR list overrides the default headline when the run has associated PRs.
  const pull_requests = (workflow_run.pull_requests ?? [])
    .filter(pr => pr.base.repo.url === workflow_run.repository.url) // exclude PRs from external repos
    .map(
      pr => `${link(`${repo_url}/pull/${pr.number}`, `#${pr.number}`)} from \`${pr.head.ref}\` to \`${pr.base.ref}\``
    )
    .join(', ')

  // Example without PRs: Success: AnthonyKinson's `push` on `master`
  // Example with PRs:    Success: AnthonyKinson's `pull_request` <#42 from feature to main>
  const headline = pull_requests
    ? `${verb} ${context.actor}'s \`pull_request\` ${pull_requests}`
    : `${verb} ${context.actor}'s \`${event_name}\` on \`${branch_link}\``

  // Example: Workflow: My Workflow #14 completed in `1m 30s`
  const workflow_duration = computeDuration({
    start: new Date(workflow_run.created_at),
    end: new Date(workflow_run.updated_at)
  })
  const details = `Workflow: ${workflow_link} ${run_link} completed in \`${workflow_duration}\``

  const commit = `Commit: ${workflow_run.head_commit?.message ?? ''}`

  return {headline, details, commit}
}

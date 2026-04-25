/**
 * Reads and validates the action's configuration.
 */

import * as core from '@actions/core'

export type IncludeJobs = 'true' | 'false' | 'on-failure'

export interface ActionInputs {
  webhook_url: string
  bot_token: string
  github_token: string
  jobs_to_fetch: string
  include_jobs: IncludeJobs
  hide_job_statuses: string[]
  include_commit_message: boolean
  slack_channel: string
  slack_name: string
  slack_icon: string
  slack_emoji: string
  extra_text: string
  from_workflow_run: boolean
}

/**
 * Reads, validates, and returns the action's inputs as a typed object.
 * Throws if the auth inputs are invalid (none, both, or bot-token without
 * channel). Calls `core.setSecret` on every token before returning.
 */
export function collectInputs(): ActionInputs {
  const inputs: ActionInputs = {
    webhook_url: core.getInput('slack_webhook_url'),
    bot_token: core.getInput('slack_bot_token') || process.env.SLACK_BOT_TOKEN || '',
    github_token: core.getInput('repo_token', {required: true}),
    jobs_to_fetch: core.getInput('jobs_to_fetch', {required: true}),
    include_jobs: core.getInput('include_jobs', {required: true}) as IncludeJobs,
    hide_job_statuses: core
      .getInput('hide_job_statuses')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0),
    include_commit_message: core.getInput('include_commit_message', {required: true}) === 'true',
    slack_channel: core.getInput('channel'),
    slack_name: core.getInput('name'),
    slack_icon: core.getInput('icon_url'),
    slack_emoji: core.getInput('icon_emoji'),
    extra_text: core.getInput('extra_text'),
    from_workflow_run: core.getInput('workflow_run') === 'true'
  }
  validateAuth(inputs)
  markSecrets(inputs)
  return inputs
}

function validateAuth(inputs: ActionInputs): void {
  if (inputs.webhook_url && inputs.bot_token) {
    throw new Error('Either slack_bot_token or slack_webhook_url is required — not both.')
  }
  if (!inputs.webhook_url && !inputs.bot_token) {
    throw new Error('Either slack_bot_token or slack_webhook_url is required.')
  }
  if (inputs.bot_token && !inputs.slack_channel) {
    throw new Error('channel is required when slack_bot_token is used.')
  }
}

function markSecrets(inputs: ActionInputs): void {
  core.setSecret(inputs.github_token)
  if (inputs.webhook_url) core.setSecret(inputs.webhook_url)
  if (inputs.bot_token) core.setSecret(inputs.bot_token)
}

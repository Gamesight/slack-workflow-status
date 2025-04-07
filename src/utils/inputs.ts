import * as core from '@actions/core'

export interface ActionInputs {
  githubToken: string
  slackToken: string
  slackChannel: string
  notifyOn: string
  includeJobStatuses: 'true' | 'false' | 'on-failure'
  includeCommitMessage: boolean
  includeJobDurations: boolean
  filterJobs?: string[]
  commentJunitFailures: boolean
  commentJunitFlakes: boolean
  customTitle?: string
  emojiJunitFailures: string
  emojiJunitFlakes: string
  jobsToFetch: number
}

export function getActionInputs(): ActionInputs {
  return {
    githubToken: core.getInput('gh_repo_token', { required: true }),
    slackToken: core.getInput('slack_token', { required: true }),
    slackChannel: core.getInput('slack_channel', { required: true }),
    notifyOn: core.getInput('notify_on', { required: false }) || 'always',
    includeJobStatuses: core.getInput('msg_include_job_statuses', {
      required: true
    }) as 'true' | 'false' | 'on-failure',
    includeJobDurations:
      core
        .getInput('msg_include_job_durations', { required: false })
        ?.toLowerCase() !== 'false',
    filterJobs: core
      .getInput('msg_job_filter', { required: false })
      ?.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    includeCommitMessage:
      core.getInput('msg_include_commit', { required: true }) === 'true',
    customTitle: core.getInput('msg_custom_title', {
      required: false
    }),
    commentJunitFailures:
      core.getInput('comment_junit_failures', { required: false }) === 'true',
    commentJunitFlakes:
      core.getInput('comment_junit_flakes', { required: false }) === 'true',
    emojiJunitFailures:
      core.getInput('emoji_junit_failure', { required: false }) || ':x:',
    emojiJunitFlakes:
      core.getInput('emoji_junit_flake', { required: false }) || ':warning:',
    jobsToFetch: parseInt(
      core.getInput('jobs_to_fetch', { required: true }),
      30
    )
  }
}

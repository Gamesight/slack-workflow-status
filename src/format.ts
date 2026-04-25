/**
 * Decides whether a workflow run was a success, failure, or cancellation.
 * Continue-on-error jobs are forgiven; matrix fail-fast cancellations
 * caused by a sibling failure are not.
 */

import type {RestEndpointMethodTypes} from '@octokit/plugin-rest-endpoint-methods'

export type WorkflowRun = RestEndpointMethodTypes['actions']['getWorkflowRun']['response']['data']

export type JobsList = RestEndpointMethodTypes['actions']['listJobsForWorkflowRun']['response']['data']['jobs']

export interface UpstreamRun {
  id: number
  name?: string
  event?: string
}

export interface WorkflowStatus {
  color: 'good' | 'danger' | 'warning'
  verb: string
  outcome: 'success' | 'cancelled' | 'failure'
}

/**
 * Decides the workflow's overall outcome and corresponding color/verb from
 * its conclusion.
 *
 * Trusts `workflow_run.conclusion` as the source of truth — it correctly
 * accounts for `continue-on-error: true` jobs (issue #21). Falls back to
 * scanning job conclusions when the API reports `cancelled` but a job
 * actually failed: matrix fail-fast cancels still-running siblings, and the
 * workflow conclusion historically lied as `cancelled` in that case (#58).
 */
export function determineWorkflowStatus(workflow_run: WorkflowRun, completed_jobs: JobsList): WorkflowStatus {
  const any_job_failed = completed_jobs.some(job => !['success', 'skipped', 'cancelled'].includes(job.conclusion ?? ''))

  switch (workflow_run.conclusion) {
    case 'success':
    case 'skipped':
    case 'neutral':
      return {color: 'good', verb: 'Success:', outcome: 'success'}
    case 'cancelled':
      if (any_job_failed) {
        return {color: 'danger', verb: 'Failed:', outcome: 'failure'}
      }
      return {color: 'warning', verb: 'Cancelled:', outcome: 'cancelled'}
    default:
      // failure, timed_out, action_required, stale, null, or any new
      // conclusion type GitHub adds.
      return {color: 'danger', verb: 'Failed:', outcome: 'failure'}
  }
}

/**
 * Maps a job conclusion to its display icon: ✓ for success, ⃠ for
 * cancelled/skipped, ✗ for failure (and any other unknown value).
 */
export function jobIcon(conclusion: string | null): '✓' | '⃠' | '✗' {
  switch (conclusion) {
    case 'success':
      return '✓'
    case 'cancelled':
    case 'skipped':
      return '⃠'
    default:
      // case 'failure'
      return '✗'
  }
}

/**
 * Formats the elapsed time between two dates as a compact human-readable
 * string, e.g. `1d 2h 3m 4s`. Leading zero units are omitted; seconds are
 * always shown.
 */
export function computeDuration({start, end}: {start: Date; end: Date}): string {
  const duration = end.getTime() - start.getTime()
  let delta = duration / 1000
  const days = Math.floor(delta / 86400)
  delta -= days * 86400
  const hours = Math.floor(delta / 3600) % 24
  delta -= hours * 3600
  const minutes = Math.floor(delta / 60) % 60
  delta -= minutes * 60
  const seconds = Math.floor(delta % 60)

  const formatDuration = (value: number, text: string, hide_on_zero: boolean): string =>
    value <= 0 && hide_on_zero ? '' : `${value}${text} `

  return (
    formatDuration(days, 'd', true) +
    formatDuration(hours, 'h', true) +
    formatDuration(minutes, 'm', true) +
    formatDuration(seconds, 's', false).trim()
  )
}

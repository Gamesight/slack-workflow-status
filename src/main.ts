/**
 * Entry point. Coordinates the four modules: gather config, fetch the
 * workflow data, decide what to report, send the message.
 */

import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'

import {collectInputs} from './inputs.js'
import {determineWorkflowStatus, type JobsList, type UpstreamRun, type WorkflowRun} from './format.js'
import {sendSlackMessage} from './slack.js'

/**
 * Runs the action end-to-end: collect inputs, fetch the workflow run and
 * jobs, decide the display status, send the Slack message. Throws on
 * misconfiguration; send-time failures are reported via `core.setFailed`
 * inside `sendSlackMessage`.
 */
export async function main(): Promise<void> {
  const inputs = collectInputs()
  const {run_id, upstream_run} = resolveRunContext(inputs.from_workflow_run)
  const {workflow_run, completed_jobs} = await fetchWorkflowData(inputs.github_token, run_id, inputs.jobs_to_fetch)
  const status = determineWorkflowStatus(workflow_run, completed_jobs)
  await sendSlackMessage({
    inputs,
    status,
    workflow_run,
    completed_jobs,
    upstream_run,
    context
  })
}

/**
 * When triggered by the `workflow_run` event, report on the upstream
 * workflow that fired this notification rather than the current run.
 */
function resolveRunContext(from_workflow_run: boolean): {
  run_id: number
  upstream_run: UpstreamRun | undefined
} {
  const upstream_run = from_workflow_run ? (context.payload.workflow_run as UpstreamRun | undefined) : undefined
  if (from_workflow_run && !upstream_run) {
    throw new Error(
      'workflow_run input is true but context.payload.workflow_run is missing. ' +
        'This action must be triggered by the `workflow_run` event when workflow_run is enabled.'
    )
  }
  return {
    run_id: upstream_run ? upstream_run.id : context.runId,
    upstream_run
  }
}

async function fetchWorkflowData(
  token: string,
  run_id: number,
  jobs_to_fetch: string
): Promise<{workflow_run: WorkflowRun; completed_jobs: JobsList}> {
  const octokit = getOctokit(token)
  const {data: workflow_run} = await octokit.rest.actions.getWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id
  })
  const {data: jobs_response} = await octokit.rest.actions.listJobsForWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id,
    per_page: parseInt(jobs_to_fetch, 10)
  })
  const completed_jobs: JobsList = jobs_response.jobs.filter((j: JobsList[number]) => j.status === 'completed')
  return {workflow_run, completed_jobs}
}

/**
 * Top-level error handler for unhandled rejections and thrown errors out of
 * `main()`. Logs the error and marks the action run as failed.
 * Accepts `unknown` because Node's `unhandledRejection` event passes the
 * raw rejection value, which may not be an `Error`.
 */
export function handleError(err: unknown): void {
  if (err instanceof Error) {
    core.error(err)
    core.setFailed(err.message || `Unhandled Error: ${err}`)
  } else {
    core.setFailed(`Unhandled Error: ${err}`)
  }
}

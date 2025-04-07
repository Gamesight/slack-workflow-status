import * as core from '@actions/core'
import { getOctokit } from '@actions/github'

export async function analyzeJobs({
  githubToken,
  workflowRun,
  notifyOn,
  jobsToFetch,
  filterJobs
}: {
  githubToken: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workflowRun: any
  notifyOn: string
  jobsToFetch: number
  filterJobs?: string[]
}): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completedJobs: any[]
  //   hasFailures: boolean
  shouldNotify: boolean
}> {
  const octokit = getOctokit(githubToken)
  const { data: jobsResponse } = await octokit.actions.listJobsForWorkflowRun({
    owner: workflowRun.repository.owner.login,
    repo: workflowRun.repository.name,
    run_id: workflowRun.id,
    per_page: jobsToFetch
  })

  console.log('filterJobs -->', filterJobs)
  const completedJobs = jobsResponse.jobs
    .filter((job) => job.status === 'completed')
    .filter((job) => !filterJobs || filterJobs.includes(job.name))

  const hasFailures = completedJobs.some(
    (job) => !['success', 'skipped'].includes(job.conclusion)
  )

  console.log('completedJobs -->', completedJobs)
  console.log('notifyOn -->', notifyOn)
  console.log('hasFailures -->', hasFailures)

  const shouldNotify =
    notifyOn === 'always' || (notifyOn.includes('fail') && hasFailures)

  if (shouldNotify) {
    const reason =
      notifyOn === 'always'
        ? '"notifyOn" is set to "always"'
        : 'At least one job failed'
    core.info(`Sending notification: ${reason}`)
  }

  return { completedJobs, shouldNotify }
}

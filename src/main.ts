/* eslint-disable no-console */
/******************************************************************************\
 * Main entrypoint for GitHib Action. Fetches information regarding the       *
 * currently running Workflow and its Jobs. Sends individual job status and   *
 * workflow status as a formatted notification to the Slack Webhhok URL set   *
 * in the environment variables.                                              *
 *                                                                            *
 * Original Author: Anthony Kinson <anthony@gamesight.io>                     *
 * Original Repository: https://github.com/Gamesight/slack-workflow-status    *
 *                                                                            *
 * Forked and Modified by: Marie Idleman [https://github.com/midleman]        *
 * Current Repository: [https://github.com/midleman/slack-workflow-status]    *
 *                                                                            *
 * License: MIT                                                               *
 * Copyright (c) 2020 Gamesight, Inc                                          *
 * Copyright (c) 2025 Marie Idleman                                           *
\******************************************************************************/

import * as core from '@actions/core'
import { fetchWorkflowArtifacts } from './github/fetchArtifacts'
import { handleError } from './utils/handleError'
import { buildTestSummaryThread } from './slack/buildTestSummaryThread'
import { getActionInputs } from './utils/inputs'
import { sendSlackMessage } from './slack/sendSlackMessage'
import { buildJobSummaryMessage } from './slack/buildJobSummaryMessage'
import { analyzeJobs } from './utils/analyzeJobs'

process.on('unhandledRejection', handleError)

async function main(): Promise<void> {
  try {
    const inputs = getActionInputs()

    const {
      githubToken,
      slackToken,
      slackChannel,
      notifyOn,
      jobsToFetch,
      includeJobStatuses,
      includeJobDurations,
      includeCommitMessage,
      commentJunitFailures,
      commentJunitFlakes,
      emojiJunitFailures,
      emojiJunitFlakes,
      customTitle,
      filterJobs
    } = inputs

    // Exit early if notifyOn is set to "never"
    if (notifyOn === 'never') {
      core.info(
        'No notification sent: "notifyOn" is set to "never". Exiting early.'
      )
      return
    }

    // Force as secret, forces *** when trying to print or log values
    core.setSecret(githubToken)
    core.setSecret(slackToken)

    // Fetch workflow run data and job information
    const { workflowRun, jobs } = await fetchWorkflowArtifacts(
      githubToken,
      notifyOn
    )

    const { completedJobs, shouldNotify } = await analyzeJobs({
      githubToken,
      workflowRun,
      notifyOn,
      jobsToFetch,
      filterJobs
    })

    if (!shouldNotify) {
      core.info(
        'No notification sent: All jobs passed and "notifyOn" is set to "fail-only".'
      )
      return
    }

    // Build and send initial message with job summary
    const jobSummaryMessage = buildJobSummaryMessage({
      workflowRun,
      completedJobs,
      includeJobStatuses,
      includeJobDurations,
      actor: workflowRun.actor.login,
      branchUrl: `<${workflowRun.repository.html_url}/tree/${workflowRun.head_branch}|${workflowRun.head_branch}>`,
      workflowRunUrl: `<${workflowRun.html_url}|#${workflowRun.run_number}>`,
      repoUrl: `<${workflowRun.repository.html_url}|${workflowRun.repository.name}>`,
      commitMessage:
        includeCommitMessage && workflowRun.head_commit?.message?.split('\n')[0]
    })

    // Send initial message and capture thread timestamp
    const initialMessage = await sendSlackMessage({
      slackToken,
      channel: slackChannel,
      message: customTitle || jobSummaryMessage.text,
      attachments: jobSummaryMessage.attachments
    })
    const threadTs = initialMessage.ts

    // Build test summary thread content
    if (commentJunitFailures || commentJunitFlakes) {
      const { failedTests, flakyTests, reportUrls } = jobs
      const testSummaryThread = buildTestSummaryThread({
        failedTests,
        flakyTests,
        reportUrls,
        commentFailures: commentJunitFailures,
        commentFlakes: commentJunitFlakes,
        commentJunitFailuresEmoji: emojiJunitFailures,
        commentJunitFlakesEmoji: emojiJunitFlakes
      })

      // Comment on the initial message with the test summary
      if (testSummaryThread) {
        await sendSlackMessage({
          slackToken,
          channel: slackChannel,
          message: testSummaryThread,
          threadTs
        })
      }
    }
  } catch (err) {
    handleError(err as Error)
  }
}

main()

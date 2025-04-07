# Slack Workflow Status

This action posts workflow status notifications into your Slack channel. The notification includes details such as the Actor, Event, Branch, Workflow Name, Status, and Run Durations.

🚀 **[NEW]** This action now supports uploading and referencing Playwright artifacts (e.g., JUnit test results and report URLs) to provide detailed context about your workflow's execution in the comment thread of the workflow status notification.

<img src="./docs/images/comment-full.png" title="Comment with Thread" width="500">

## Key Features

- Posts workflow status to slack using Slack API (not webhook).
- Includes individual job statuses and durations (optional).
- Includes Playwright (Junit) test result summaries with failure and flake details in comment thread. (optional)
- Includes a report URL for Playwright-based jobs in comment thread. (optional)

## Action Inputs

`midleman/slack-workflow-status@master`

| Name                             | Required  | Default         | Description |
|----------------------------------|-----------|-----------------|-------------|
| **gh_repo_token**                | Yes       | -               | GitHub token for authentication, defaults to `${{secrets.GITHUB_TOKEN}}`. |
| **slack_token**                  | Yes       | -               | Slack token for posting notifications. |
| **slack_channel**                | No        | -               | Slack channel to send notifications. |
| **notify_on**                    | No        | `always`        | Controls when notifications are sent: `always`, `fail-only`, `never`. |
| **include_job_statuses**         | No        | `true`          | Includes job statuses in notifications. Use `false` to exclude or `on-failure` for failures only. |
| **include_job_durations**        | No        | `true`          | When `true`, includes job run times in the Slack notification. Requires: include_job_statuses. |
| **filter_jobs**                  | No        | -               | Comma-separated list of jobs to include in the message. Requires: include_job_statuses. |
| **include_commit_msg**           | No        | `true`          | When `true`, includes the head commit message in the notification. |
| **custom_title**                 | No        | -               | Override the default slack message title with your own. |
| **comment_junit_failures**       | No        | `false`         | When `true`, includes JUnit test failures in the Slack notification comment thread. |
| **comment_junit_flakes**         | No        | `false`         | When `true`, includes JUnit test flakes in the Slack notification comment thread. |
| **emoji_junit_failure**          | No        | `:x:`           | Emoji used for JUnit test failures. |
| **emoji_junit_flake**            | No        | `:warning:`     | Emoji used for JUnit test flakes. |
| **jobs_to_fetch**                | No        | `30`            | Sets the number of jobs to fetch for workflows with a large number of jobs. |

## Composite Action Inputs

`midleman/slack-workflow-status/.github/actions/upload-artifacts@master`

Usage of this composite action is optional and only needed if reporting playwright test results in thread of original slack message.

| Name                       | Required  | Default         | Description |
|----------------------------|-----------|-----------------|-------------|
| **junit_path**             | No        | -               | Path to the JUnit test results. Needed in order to add test result details in comment thread. |
| **report_url**             | No        | -               | The report URL to save and upload as an artifact. This will be hyperlinked in the comment thread. |

## Usage

To use this action properly, you should create a new `job` at the end of your workflow that `needs` all other jobs in the workflow. This ensures that this action is only run once all jobs in your workflow are complete.

This action requires `read` permission of `actions` scope. You should assign a job level `actions` permission if workflow level `actions` permission is set `none`.

See example workflow [here](https://github.com/midleman/slack-workflow-status/tree/master/.github/workflows/action.yml).

```yaml
name: Workflow Example
on:
  push:
    branches: [ main ]

jobs:
  job-1:
  # implement job 1 here

  job-2:
  # implement job 2 here

  job-3-playwright:
    container:
      image: mcr.microsoft.com/playwright:v1.50.0-noble
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npx playwright test

    # use this composite action to upload playwright artifacts. these will be used
    # downstream to comment in a thread on the initial workflow summary slack message.
    - name: Save and Upload Artifacts for Slack Notification
      uses: midleman/slack-workflow-status/.github/actions/upload-artifacts@master
      if: ${{ !cancelled() }}
      with:
        job_name: ${{ github.job }}
        junit_path: 'test-results/junit.xml'
        report_url: 'http://www.my-url.html'

  slack-notifications:
    if: always()
    name: Post Workflow Notifications
    needs: 
      - job-1
      - job-2
      - job-3-playwright
    runs-on: ubuntu-latest

    steps:
    # sends the workflow summary slack message. and depending on configuration, it can
    # also comment in a thread with the playwright test results and report hyperlink.
      - name: Post Workflow Status to Slack
        uses: midleman/slack-workflow-status@v2.2.1
        with:
          gh_repo_token: ${{ secrets.GITHUB_TOKEN }}
          slack_token: ${{ secrets.SLACK_TOKEN }}
          channel: '#test-results'
          include_junit_failures_in_comment: true
          include_junit_flakes_in_comment: true
```

## Light and Dark Theme

<img src="./docs/images/light-dark-theme.png" title="Example Light Dark Themes" width="500">
import * as core from '@actions/core'
import {context, GitHub} from '@actions/github'
import * as request from 'request-promise-native'


interface SlackPayloadBody {
    channel?: string,
    username?: string,
    attachments: SlackAttachment[]
}

interface SlackAttachment {
  mrkdwn_in: [string]
  color: string
  text: string
  footer: string
  footer_icon: string
  fields: SlackAttachmentFields[]
}

interface SlackAttachmentFields {
  short: boolean
  value: string
}

process.on('unhandledRejection', handleError)
main().catch(handleError)

async function main(){
  // Collect action inputs
  const webhook_url: string = core.getInput('slack_webhook_url', { required: true })
  const github_token: string = core.getInput('repo_token', { required: true })
  core.setSecret(github_token)
  core.setSecret(webhook_url)
  const run_id: number = Number(process.env.GITHUB_RUN_ID)
  const workflow_name: string = process.env.GITHUB_WORKFLOW as string
  const include_jobs: string = core.getInput('include_jobs', { required: true })
  const actor: string = process.env.GITHUB_ACTOR as string
  const event: string = process.env.GITHUB_EVENT_NAME as string
  const ref: string = process.env.GITHUB_REF as string
  const branch: string = ref.substr(ref.lastIndexOf('/') + 1)
  const slack_channel: string = core.getInput('channel')
  const slack_name: string = core.getInput('name')
  const options: {[key: string]: any} = {}
  const github = new GitHub(github_token, options)
  // Fetch workflow run data
  const workflow_run = await github.actions.getWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: run_id
  })
  const jobs_response = await github.request(workflow_run.data.jobs_url)
  // Setup PR String
  let pull_requests = ""
  for(let pull_request of workflow_run.data.pull_requests){
    pull_requests += ",<"+ pull_request.url + "|#" + pull_request.number + ">"
  }
  if(pull_requests != ""){
    pull_requests = "for " + pull_requests.substr(1) + " "
  }

  // Build Slack Payload
  let job_fields: SlackAttachmentFields[] = []
  let workflow_success = true
  let workflow_failure = false
  let job_status_icon = "\u2713"

  for(let job of jobs_response.data.jobs){
    // Ignore the job that is running this action.
    if(job.status != "completed"){
      continue
    }
    // Setup some slack content for job status
    if(job.conclusion == "success"){
      job_status_icon = "\u2713" // CHECK MARK
    }
    // If a job fails do concluide "success" then the workflow isn't successful
    // we assume it was cancelled unless...
    if(job.conclusion != "success"){
      workflow_success = false
      job_status_icon = "\u20e0" // COMBINING ENCLOSING CIRCLE BACKSLASH
    }
    // ...the job conclusion is failure, we mark as failed and set the icon
    if(job.conclusion == "failure") {
      workflow_failure = true
      job_status_icon = "\u2717" // BALLOT X
    }
    // Create a new field for this job
    job_fields.push({
      short: true,
      value: job_status_icon + " <" + job.html_url + "|" + job.name + "> (" + job_duration(new Date(job.started_at), new Date(job.completed_at)) + ")"
    })
  }

  // Configure slack attachment styling
  let workflow_color: string = ""
  let workflow_msg: string = ""

  if(workflow_success){
    workflow_color = "good" // can be replaced with HEX values
    workflow_msg = "Success:"
  }else if(workflow_failure){
    workflow_color = "danger"
    workflow_msg = "Failed:"
  }else{
    workflow_color = "warning"
    workflow_msg = "Cancelled: "
  }

  // create our slack payload
  // We're using old style attachments rather than the new blocks because we don't
  // get the notification color highlighting with blocks.
  const slack_attachment: SlackAttachment = {
    mrkdwn_in: ["text"],
    color: workflow_color,
    text: workflow_msg+" "+actor+"'s "+event+" on "+branch+" "+pull_requests+"\nWorkflow: "+workflow_name+" <"+workflow_run.data.html_url+"|#"+workflow_run.data.run_number+"> completed in "+job_duration(new Date(workflow_run.data.created_at), new Date(workflow_run.data.updated_at)),
    footer: "<https://github.com/" + workflow_run.data.repository.full_name + "|*"+ workflow_run.data.repository.full_name +"*>",
    footer_icon: "https://github.githubassets.com/favicon.ico",
    fields: (include_jobs == 'true') ? job_fields : []
  }

  const slack_payload_body: SlackPayloadBody = {
    attachments: [slack_attachment]
  }

  // Add some overrides
  if(slack_name != ""){
    slack_payload_body.username = slack_name
  }
  if(slack_channel != ""){
    slack_payload_body.channel = slack_channel
  }

  const request_options = {
    uri: webhook_url,
    method: 'POST',
    body: slack_payload_body,
    json: true
  }
  // await request(request_options)
  request(request_options).catch(err => {
    core.setFailed(err)
  })
}

// Converts start and end dates into a duration string
const job_duration = function(start: any, end: any){
  const duration = end - start
  let delta = duration / 1000
  let days = Math.floor(delta / 86400)
  delta -= days * 86400
  let hours = Math.floor(delta / 3600) % 24
  delta -= hours * 3600
  let minutes = Math.floor(delta / 60) % 60
  delta -= minutes * 60
  let seconds = Math.floor(delta % 60)
  // Format duration sections
  const format_duration = function(value: number, text: string, hide_on_zero: boolean): string {
    return (value <= 0 && hide_on_zero) ? "" : value + text
  }
  return format_duration(days, "d", true) + format_duration(hours, "h", true) + format_duration(minutes, "m", true) + format_duration(seconds, "s", false)
}

function handleError(err: any){
  console.error(err)
  if(err && err.message){
    core.setFailed(err.message)
  }else{
    core.setFailed(`Unhandled Error: ${err}`)
  }
}

import { readFileSync, writeFileSync } from 'node:fs'

const [rollout, finalResponse] = process.argv.slice(2)
if (!rollout) throw new Error('Usage: node scripts/export-ai-log.mjs <rollout.jsonl> [final-response.md]')

const destination = new URL('../docs/ai-log.md', import.meta.url)
const previous = readFileSync(destination, 'utf8')
const heading = /^## (?:Current session|Session transcript)\s*$/m.exec(previous)
if (!heading) throw new Error('The AI log is missing its session heading.')
const preamble = previous.slice(0, heading.index).trimEnd()
const records = []
let messages = 0
let tools = 0

function userText(content) {
  const parts = content.flatMap(part => {
    if (part.type === 'input_image') return ['\n\n[Image attachment referenced in this message]\n\n']
    if (part.type !== 'input_text' || part.text.startsWith('<environment_context>') || part.text.startsWith('context: renderer=')) return []
    if (part.text.startsWith('<send_user_message_question_reply>')) {
      const json = part.text.replace(/<\/?send_user_message_question_reply>/g, '').trim()
      try { return JSON.parse(json).map(reply => reply.answer) } catch { return [part.text] }
    }
    return [part.text]
  })
  return parts.join('').trim()
}

function commandPurpose(command) {
  const kinds = [
    [/git (?:status|log|diff|ls-remote)/, 'Git inspection'],
    [/git (?:add|commit|push)/, 'Git update'],
    [/docker compose.*(?:up|build)/s, 'Compose build/start'],
    [/docker compose.*(?:ps|logs|config)/s, 'Compose inspection'],
    [/smoke\.mjs/, 'smoke tests'],
    [/go(?:\.exe)?\s+(?:test|vet)|\$go test|\$go vet/, 'Go checks'],
    [/playwright|test:e2e/, 'browser checks'],
    [/npm(?:\.cmd)? (?:run|install|ci|audit)/, 'frontend build or dependency checks'],
    [/Get-Content|ReadAllText|\brg\b/, 'file inspection'],
    [/WriteAllText|Set-Content|Add-Content|Copy-Item/, 'file update'],
    [/Invoke-RestMethod|Invoke-WebRequest|curl/, 'HTTP verification'],
  ]
  const matches = kinds.filter(([pattern]) => pattern.test(command)).map(([, label]) => label)
  return matches.length ? matches.join(', ') : 'Shell command'
}

function toolSummary(item) {
  switch (item.type) {
    case 'CommandExecution':
      return commandPurpose(item.command ?? '') + (item.exit_code == null ? ' — ' + (item.status ?? 'result recorded') : ' — exit ' + item.exit_code)
    case 'McpToolCall':
      return [item.server, item.tool].filter(Boolean).join(' / ') + ' — ' + (item.status ?? 'result recorded')
    case 'FileChange':
      return 'Workspace file changes — ' + (item.status ?? 'result recorded')
    case 'Extension':
      return 'External tool — ' + (item.kind ?? 'result recorded')
    default:
      return null
  }
}

const lines = readFileSync(rollout, 'utf8').split(/\r?\n/)
for (const [index, line] of lines.entries()) {
  if (!line.trim()) continue
  let entry
  try { entry = JSON.parse(line) } catch (error) {
    if (index >= lines.length - 2) break // The live log may still be writing its last line.
    throw error
  }
  const event = entry.payload
  if (!event) continue
  if (entry.type === 'response_item' && event.type === 'message') {
    if (event.role === 'user') {
      const message = userText(event.content)
      if (message) { records.push('### User\n\n' + message); messages++ }
    } else if (event.role === 'assistant' && ['commentary', 'final_answer'].includes(event.phase)) {
      const message = event.content.filter(part => part.type === 'output_text').map(part => part.text).join('').trim()
      if (message) { records.push('### Assistant · ' + (event.phase === 'commentary' ? 'progress' : 'response') + '\n\n' + message); messages++ }
    }
  }
  if (entry.type === 'response_item' && event.type === 'function_call' &&
      ['request_user_input_async', 'send_message_to_user_async'].includes(event.name)) {
    const args = JSON.parse(event.arguments)
    const message = args.message ?? args.questions.map(question =>
      [question.title, ...(question.options ?? []).map(option => '- ' + option)].join('\n')
    ).join('\n\n')
    records.push('### Assistant · message\n\n' + message)
    messages++
  }
  if (entry.type === 'event_msg' && event.type === 'item_completed' && event.item) {
    const summary = toolSummary(event.item)
    if (summary) { records.push('**Tool summary** · ' + summary); tools++ }
  }
}

if (!messages) throw new Error('No visible conversation messages found. Existing log was preserved.')
if (finalResponse) {
  records.push('**Tool summary** · Exported the visible transcript and tool summaries from the session record.')
  tools++
  records.push('### Assistant · response\n\n' + readFileSync(finalResponse, 'utf8').trim())
  messages++
}
const note = 'User and assistant messages are reproduced in order. Images are referenced inline. Tool events are summarized without raw outputs, and internal runtime messages are omitted.'
writeFileSync(destination, preamble + '\n\n## Session transcript\n\n' + note + '\n\n' + records.join('\n\n').replace(/[ \t]+$/gm, '') + '\n')
console.log('Exported ' + messages + ' messages and ' + tools + ' tool summaries.')

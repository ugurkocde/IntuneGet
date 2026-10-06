// Test-only CLI fixture: never invokes a model or touches production.
import { writeFileSync } from 'node:fs';
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-thread' }));
if (prompt === 'complete') {
  writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], 'Verified fixture completion.');
  console.log(JSON.stringify({ type: 'turn.completed' }));
}

import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function repairCompletion(exitCode, signal, turnCompleted, finalText) {
  if (signal) return 'terminated';
  if (exitCode !== 0) return 'failed';
  if (!turnCompleted || !finalText?.trim()) return 'incomplete';
  return 'completed';
}

export async function runRepair(root, workspace, codexJs, wrapperPid) {
  const prompt = readFileSync(join(root, 'repair-request.md'), 'utf8');
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const stdoutFile = join(root, 'logs', `repair-${stamp}.jsonl`);
  const stderrFile = join(root, 'logs', `repair-${stamp}.stderr.log`);
  const lastMessageFile = join(root, 'logs', `repair-${stamp}.final.md`);
  const statePath = join(root, 'repair-run.json');
  const state = { status: 'starting', wrapperPid: Number(wrapperPid), agentPid: null,
    startedAtUtc: new Date().toISOString(), lastEventAtUtc: null, finishedAtUtc: null,
    exitCode: null, signal: null, threadId: null, turnCompleted: false, stdoutFile, stderrFile, lastMessageFile };
  const save = () => {
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8');
    renameSync(temporary, statePath);
  };
  save();
  const output = createWriteStream(stdoutFile);
  const errors = createWriteStream(stderrFile);
  let pending = '';
  let lastSave = 0;
  try {
    const child = spawn(process.execPath, [codexJs, 'exec', '--approve-for-me', '--skip-git-repo-check',
      '--ephemeral', '--json', '--output-last-message', lastMessageFile,
      '--cd', workspace, '--color', 'never', '-'],
    { cwd: workspace, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    state.agentPid = child.pid;
    state.status = 'running';
    save();
    child.stdout.on('data', chunk => {
      output.write(chunk);
      pending += chunk.toString('utf8');
      for (;;) {
        const index = pending.indexOf('\n');
        if (index < 0) break;
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        try {
          const event = JSON.parse(line);
          state.lastEventAtUtc = new Date().toISOString();
          if (event.type === 'thread.started') state.threadId = event.thread_id;
          if (event.type === 'turn.completed') state.turnCompleted = true;
          if (event.type === 'turn.failed') state.turnCompleted = false;
        } catch { /* Preserve raw output, but do not count it as an agent heartbeat. */ }
      }
      // Bound partial-line memory even if a child emits malformed output.
      if (pending.length > 4 * 1024 * 1024) pending = '';
      if (Date.now() - lastSave > 5000) { save(); lastSave = Date.now(); }
    });
    child.stderr.on('data', chunk => errors.write(chunk));
    const completed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    child.stdin.on('error', () => {}); // Early CLI exit is reported by close/error.
    child.stdin.end(prompt);
    const { code, signal } = await completed;
    const finalText = existsSync(lastMessageFile) ? readFileSync(lastMessageFile, 'utf8') : '';
    state.status = repairCompletion(code, signal, state.turnCompleted, finalText);
    state.exitCode = state.status === 'completed' ? 0 : (code || 1);
    state.signal = signal;
  } catch (error) {
    state.status = 'launcher_error';
    state.exitCode = 1;
    errors.write(String(error.message));
  } finally {
    await Promise.all([new Promise(r => output.end(r)), new Promise(r => errors.end(r))]);
    state.finishedAtUtc = new Date().toISOString();
    save();
  }
  return state.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRepair(...process.argv.slice(2)).then(code => { process.exitCode = code; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

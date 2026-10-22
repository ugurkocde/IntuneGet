import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Keep Git authentication out of process arguments and persistent Git config.
export function createCuratedGitRunner({ environment = process.env, spawn = spawnSync } = {}) {
  const token = environment.GH_TOKEN;
  if (typeof token !== 'string' || !token || /\s/.test(token)) throw new Error('Git authentication is unavailable.');
  const env = {
    ...environment,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const key of Object.keys(env)) {
    if (/^GIT_TRACE/i.test(key) || key.toUpperCase() === 'GIT_CURL_VERBOSE' || ['GH_TOKEN', 'GITHUB_TOKEN'].includes(key.toUpperCase())) delete env[key];
  }
  return (...args) => {
    const result = spawn('git', args, { encoding: 'utf8', env });
    // Git diagnostics can contain authentication material; do not echo them.
    if (result.status !== 0) throw new Error('Git command failed.');
    return result.stdout.trim();
  };
}

// Disarm the old head before replacing it. Never leave GitHub responsible for
// merging a later head that has not received its own final patch review.
export async function prepareCuratedPublication({ gh, repo, branch, title, details, headSha, push, spawn = spawnSync, wait = delay }) {
  if (!/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Invalid publication head SHA.');
  const read = number => gh(['api', `repos/${repo}/pulls/${number}`]);
  const disarm = async pr => {
    const current = await read(pr.number);
    if (current.state !== 'open') throw new Error('Publication PR is no longer open.');
    if (current.auto_merge) {
      const result = spawn('gh', ['pr', 'merge', String(pr.number), '--repo', repo, '--disable-auto'], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error('Disabling publication auto merge failed.');
    }
    const verified = await read(pr.number);
    if (verified.state !== 'open' || verified.auto_merge !== null) throw new Error('Publication auto merge state is unverified.');
    return verified;
  };
  const matches = await gh(['api', `repos/${repo}/pulls?head=${repo.split('/')[0]}:${branch}&state=open&per_page=100`]);
  if (!Array.isArray(matches)) throw new Error('Publication PR lookup returned an invalid response.');
  // Do not filter by base here: that would hide a PR sharing this branch with
  // an unexpected target and leave its merge state unchecked before the push.
  if (matches.some(match => match.base?.ref !== 'main')) throw new Error('Publication PR has an unexpected base.');
  if (matches.length > 1) throw new Error('Multiple publication PRs match the branch.');
  let pr = matches[0];
  const priorHead = pr ? (await disarm(pr)).head?.sha : null;
  await push();
  const body = `${details}\n\nHead: \`${headSha}\`. Merge requires independent review of this exact revision and passing required checks.`;
  if (pr) await gh(['api', '-X', 'PATCH', `repos/${repo}/pulls/${pr.number}`, '--input', '-'], { input: JSON.stringify({ title, body }) });
  else pr = await gh(['api', '-X', 'POST', `repos/${repo}/pulls`, '--input', '-'], { input: JSON.stringify({ title, body, head: branch, base: 'main' }) });
  pr = await disarm(pr);
  // GitHub may briefly report the previous head after a push. Retry only that
  // readback; closed PRs and armed or missing merge state still fail at once.
  // GitHub may still report the previous PR head after a successful push.
  // Wait only for that known revision; an unrelated head is never accepted.
  const readbackDelays = [2000, 4000, 8000, 15000, 15000, 15000, 15000, 15000, 15000, 15000];
  for (let attempt = 0; attempt <= readbackDelays.length; attempt++) {
    if (pr.state !== 'open' || pr.auto_merge !== null) throw new Error('Publication auto merge state is unverified.');
    if (pr.head?.sha === headSha) return { number: pr.number, url: pr.html_url, headSha };
    if (!priorHead || pr.head?.sha !== priorHead) throw new Error('Publication PR head moved to an unexpected revision.');
    if (attempt === readbackDelays.length) break;
    await wait(readbackDelays[attempt]);
    pr = await read(pr.number);
  }
  throw new Error('Publication PR head does not match the prepared revision.');
}

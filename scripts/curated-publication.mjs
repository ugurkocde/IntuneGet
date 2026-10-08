import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

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
  let pr = (await gh(['api', `repos/${repo}/pulls?head=${repo.split('/')[0]}:${branch}&state=open`]) || [])[0];
  if (pr) await disarm(pr);
  await push();
  const body = `${details}\n\nHead: \`${headSha}\`. Merge requires independent review of this exact revision and passing required checks.`;
  if (pr) await gh(['api', '-X', 'PATCH', `repos/${repo}/pulls/${pr.number}`, '--input', '-'], { input: JSON.stringify({ title, body }) });
  else pr = await gh(['api', '-X', 'POST', `repos/${repo}/pulls`, '--input', '-'], { input: JSON.stringify({ title, body, head: branch, base: 'main' }) });
  pr = await disarm(pr);
  // GitHub may briefly report the previous head after a push. Retry only that
  // readback; closed PRs and armed or missing merge state still fail at once.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (pr.state !== 'open' || pr.auto_merge !== null) throw new Error('Publication auto merge state is unverified.');
    if (pr.head?.sha === headSha) return { number: pr.number, url: pr.html_url, headSha };
    if (attempt === 4) break;
    await wait(2000);
    pr = await read(pr.number);
  }
  throw new Error('Publication PR head does not match the prepared revision.');
}

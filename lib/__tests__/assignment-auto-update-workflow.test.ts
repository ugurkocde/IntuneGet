import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
function project(assignments: unknown[]) {
  const workflow = parse(readFileSync('.github/workflows-reference/package-intunewin.yml','utf8'));
  const steps = Object.values(workflow.jobs).flatMap((job: unknown) => (job as {steps?: {name?:string;run?:string}[]}).steps ?? []);
  const source = steps.find(step => step.name === 'Apply assignments')!.run!;
  const begin = source.indexOf('if ($hasExplicitAssignments) {');
  const end = source.indexOf('} elseif ($carryOver -and $hasSourceApp)', begin);
  expect(begin).toBeGreaterThan(-1); expect(end).toBeGreaterThan(begin);
  const input = Buffer.from(JSON.stringify(assignments)).toString('base64');
  const script = '$assignmentsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + input + '"))\n$hasExplicitAssignments=$true\n$graphAssignments=@()\n' + source.slice(begin,end) + '}\nConvertTo-Json -Depth 12 -InputObject @($graphAssignments)';
  const result = spawnSync('pwsh',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,REQUIREMENT_RULES:'[]'}});
  expect(result.status,result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
describe('hosted assignment conversion',()=>{
  it('emits opt in only for an actual boolean on an Available include assignment',()=>{
    const rows=project([
      {type:'allUsers',intent:'available',autoUpdateSupersededApps:true},
      {type:'allUsers',intent:'available',autoUpdateSupersededApps:'true'},
      {type:'allUsers',intent:'available'},
      {type:'allDevices',intent:'required',autoUpdateSupersededApps:true},
      {type:'exclusionGroup',groupId:'fake-group',intent:'available',autoUpdateSupersededApps:true},
    ]);
    expect(rows[0].settings.autoUpdateSettings).toEqual({'@odata.type':'#microsoft.graph.win32LobAppAutoUpdateSettings',autoUpdateSupersededAppsState:'enabled'});
    expect(rows[1].settings).not.toHaveProperty('autoUpdateSettings');
    expect(rows[2].settings).not.toHaveProperty('autoUpdateSettings');
    expect(rows[3].settings).not.toHaveProperty('autoUpdateSettings');
    expect(rows[4]).not.toHaveProperty('settings');
  });
});

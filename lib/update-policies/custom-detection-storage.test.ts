import { describe, expect, it, vi } from 'vitest';
import { buildDeploymentConfigFromAdapter, buildDeploymentConfigForApp } from './build-deployment-config';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { DatabaseAdapter } from '@/lib/db/types';

describe('fixed custom detection storage parity', () => {
  it('round trips exact rules and their flag through both deployment config builders', async () => {
    const rules = [{type:'registry',keyPath:'HKEY_LOCAL_MACHINE\\Vendor',valueName:'Version',detectionType:'version',operator:'equal',detectionValue:'1.2.3'}];
    const job = {display_name:'Vendor App',publisher:'Vendor',architecture:'x64',installer_type:'exe',install_command:'app.exe /S',uninstall_command:'app.exe /X',install_scope:'machine',detection_rules:rules,package_config:{psadtConfig:{...DEFAULT_PSADT_CONFIG,customDetection:true,detectionRules:rules}}};
    const history = {id:'history',packaging_job_id:'job'};
    const db = {uploadHistory:{getLatest:vi.fn().mockResolvedValue(history)},jobs:{getById:vi.fn().mockResolvedValue(job)}} as unknown as DatabaseAdapter;
    const hosted = {from:(table:string) => {const chain:{select?:unknown;eq?:unknown;order?:unknown;limit?:unknown;maybeSingle?:unknown}={};for(const method of ['select','eq','order','limit'])chain[method as 'select']=()=>chain;chain.maybeSingle=async()=>({data:table==='upload_history'?history:job,error:null});return chain;}};
    const args = {userId:'fixture-user',tenantId:'fixture-tenant',wingetId:'Vendor.App',latestVersion:'1.2.3'};
    const local = await buildDeploymentConfigFromAdapter(db,args);
    const remote = await buildDeploymentConfigForApp(hosted as never,args);
    expect(remote).toEqual(local);
    expect(local).toMatchObject({status:'ok',deploymentConfig:{detectionRules:rules,psadtConfig:{customDetection:true,detectionRules:rules}}});
  });
});

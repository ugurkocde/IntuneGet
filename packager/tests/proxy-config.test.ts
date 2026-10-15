import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type PackagerConfig } from '../src/config.js';
import { GraphClient } from '../src/graph-client.js';
import { ProxyRouting } from '../src/proxy-routing.js';
import { ProxyMsalNetwork } from '../src/proxy-msal.js';

const { settings } = vi.hoisted(() => ({settings:[] as Array<{system?:{networkClient?:unknown},auth?:unknown}>}));
vi.mock('@azure/msal-node', async importOriginal => ({...await importOriginal<typeof import('@azure/msal-node')>(),ConfidentialClientApplication:class {constructor(options:typeof settings[number]) {settings.push(options);}}}));
vi.mock('@azure/identity',()=>({ManagedIdentityCredential:class {}}));
vi.mock('../src/logger.js',()=>({createLogger:()=>({info:vi.fn(),debug:vi.fn(),warn:vi.fn(),error:vi.fn()})}));
const temporary:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();settings.length=0;temporary.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true}));});
function configuration(proxy?: ProxyRouting): PackagerConfig {
  return {packagerId:'fixture',mode:'api',api:{url:'https://api.invalid',key:'synthetic-key'},supabase:{url:'',serviceRoleKey:''},azure:{clientId:'00000000-0000-0000-0000-000000000001',clientSecret:'synthetic-secret',useManagedIdentity:false},polling:{interval:5000,staleJobTimeout:300000},paths:{work:tmpdir(),tools:tmpdir()},proxy};
}
describe('proxy configuration boundaries',()=>{
  it('loads the routing snapshot after dotenv and preserves the authentication inputs',()=>{
    const directory=mkdtempSync(join(tmpdir(),'intuneget-proxy-config-'));temporary.push(directory);
    vi.spyOn(process,'cwd').mockReturnValue(directory);
    for(const name of ['HTTP_PROXY','http_proxy','HTTPS_PROXY','https_proxy','NO_PROXY','no_proxy','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])vi.stubEnv(name,'');
    vi.stubEnv('INTUNEGET_API_URL','https://api.invalid');vi.stubEnv('PACKAGER_API_KEY','synthetic-key');vi.stubEnv('PACKAGER_ID','fixture');vi.stubEnv('AZURE_CLIENT_ID','00000000-0000-0000-0000-000000000001');vi.stubEnv('AZURE_CLIENT_SECRET','synthetic-secret');vi.stubEnv('AZURE_AUTH_MODE','');
    // An unset value lets dotenv load the isolated fixture rather than host state.
    vi.stubEnv('HTTPS_PROXY',undefined);
    writeFileSync(join(directory,'.env'),'HTTPS_PROXY=http://proxy.invalid:3128\n');
    const config=loadConfig();expect(config.proxy?.enabled).toBe(true);
    new GraphClient(config,'synthetic-tenant');
    expect(settings[0].system?.networkClient).toBeInstanceOf(ProxyMsalNetwork);
    expect(settings[0].auth).toEqual({clientId:config.azure.clientId,clientSecret:'synthetic-secret',authority:'https://login.microsoftonline.com/synthetic-tenant'});
    config.proxy?.close();
  });
  it('keeps the default MSAL client without a proxy or when its authority is bypassed',()=>{
    new GraphClient(configuration(),'synthetic-tenant');expect(settings[0].system).toBeUndefined();
    const proxy=new ProxyRouting({HTTPS_PROXY:'http://proxy.invalid',NO_PROXY:'login.microsoftonline.com'});
    new GraphClient(configuration(proxy),'synthetic-tenant');expect(settings[1].system).toBeUndefined();proxy.close();
  });
  it('leaves managed identity on the existing credential path',()=>{
    const config=configuration(new ProxyRouting({HTTPS_PROXY:'http://proxy.invalid'}));config.azure.useManagedIdentity=true;
    new GraphClient(config,'synthetic-tenant');expect(settings).toHaveLength(0);config.proxy?.close();
  });
});

import { describe,it,expect,vi,afterEach } from 'vitest';
import { fetchUpdateInventory,mapUpdateApps,withinUpdateScanBudget,UpdateScanUnavailable } from './update-scan';
const fetchWithRetryMock=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/intune/graph-client',()=>({fetchWithRetry:fetchWithRetryMock}));
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
describe('bounded update inventory scan',()=>{
  it('reads every page of a large inventory and never returns a partial scan',async()=>{
    const pages=Array.from({length:12},(_,page)=>Array.from({length:100},(_,i)=>({id:page+'-'+i})));
    let page=0;
    fetchWithRetryMock.mockImplementation(async()=>Response.json({value:pages[page],...(++page<pages.length?{'@odata.nextLink':'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?$skip='+page}: {})}));
    const result=await fetchUpdateInventory('token',Date.now()+45_000);
    expect(result).toHaveLength(1200);
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(12);
    expect(fetchWithRetryMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('rejects a cycle and an untrusted pagination target without forwarding credentials',async()=>{
    fetchWithRetryMock.mockResolvedValue(Response.json({value:[], '@odata.nextLink':'https://other.example/mobileApps'}));
    await expect(fetchUpdateInventory('token',Date.now()+45_000)).rejects.toBeInstanceOf(UpdateScanUnavailable);
    expect(fetchWithRetryMock).toHaveBeenCalledTimes(1);
  });
  it('fails on throttling rather than treating missing pages as an empty inventory',async()=>{
    fetchWithRetryMock.mockResolvedValue(new Response('',{status:429}));
    await expect(fetchUpdateInventory('token',Date.now()+45_000)).rejects.toBeInstanceOf(UpdateScanUnavailable);
  });
  it('returns before a stalled read exceeds the scan deadline',async()=>{
    vi.useFakeTimers();
    const result=withinUpdateScanBudget(new Promise(()=>{}),Date.now()+45_000);
    const check=expect(result).rejects.toBeInstanceOf(UpdateScanUnavailable);
    await vi.advanceTimersByTimeAsync(45_000);await check;
  });
  it('bounds matching to ten reads and preserves input order',async()=>{
    let active=0,max=0;
    const input=Array.from({length:1200},(_,i)=>i);
    const result=await mapUpdateApps(input,async i=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return i;},Date.now()+45_000);
    expect(max).toBe(10);expect(result).toEqual(input);
  });
});


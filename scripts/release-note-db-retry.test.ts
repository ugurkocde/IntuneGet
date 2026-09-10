import {it,expect,vi} from 'vitest';
import {withDatabaseRetry} from './release-note-db-retry.mjs';
it('retries statement timeout then returns the successful result',async()=>{
 const op=vi.fn().mockResolvedValueOnce({error:{code:'57014'},status:500}).mockResolvedValueOnce({data:[{id:1}],error:null,status:200});
 const sleep=vi.fn();
 expect(await withDatabaseRetry(op,{sleep})).toMatchObject({data:[{id:1}]});
 expect(op).toHaveBeenCalledTimes(2); expect(sleep).toHaveBeenCalledWith(1000);
});
it('bounds retries and rejects permanent permission errors immediately',async()=>{
 const op=vi.fn().mockResolvedValue({error:{code:'57014'},status:500}); const sleep=vi.fn();
 await expect(withDatabaseRetry(op,{sleep})).rejects.toThrow('57014'); expect(op).toHaveBeenCalledTimes(3);
 const denied=vi.fn().mockResolvedValue({error:{code:'42501'},status:403});
 await expect(withDatabaseRetry(denied,{sleep})).rejects.toThrow('42501'); expect(denied).toHaveBeenCalledTimes(1);
});

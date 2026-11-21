import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReleaseHistoryResult } from './release-history';
const state = vi.hoisted(() => ({result:null as ReleaseHistoryResult|null}));
vi.mock('@/lib/catalog', () => ({getCatalogSource:()=>({getReleaseHistory:async()=>state.result,countReleaseHistory:async()=>0})}));
vi.mock('./release-history-cache', () => ({createHistoryLoader:(load:unknown)=>load}));
vi.mock('next/cache',()=>({unstable_cache:(load:unknown)=>load}));
vi.mock('gt-next/server',()=>({getGT:async()=>(text:string)=>text}));
vi.mock('gt-next',()=>({T:({children}:{children:ReactNode})=>createElement(Fragment,null,children),Var:({children}:{children:ReactNode})=>createElement(Fragment,null,children)}));
vi.mock('@/components/landing/Header',()=>({Header:()=>null}));
vi.mock('@/components/landing/sections/Footer',()=>({Footer:()=>null}));
vi.mock('@/components/landing/ReleaseFeedDialog',()=>({ReleaseFeedDialog:()=>null}));
vi.mock('@/components/AppIcon',()=>({AppIcon:()=>null}));
import Page from '../../app/(marketing)/apps/releases/page';
afterEach(()=>{state.result=null;});
it('renders the retained history notice and preserves unavailable scan details',async()=>{
  state.result={loadedAt:Date.parse('2026-11-21T02:00:00Z'),refreshFailedAt:Date.parse('2026-11-21T02:05:00Z'),rows:[{winget_id:'Fixture.App',name:'Fixture',publisher:null,version:'1',previous_version:null,detected_at:'2026-11-21T01:00:00Z',release_date:null,detailsUnavailable:true}],total:1,apps:1,firstTracked:1,months:['2026-11'],coverageStart:null,sync:null};
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
  expect(html).toContain('A refresh failed and will be retried.');
  expect(html).toContain('2026-11-21T02:00:00.000Z');
  expect(html).toContain('Scan details temporarily unavailable');
});
it('does not show a failed refresh notice for a newly loaded result',async()=>{
  state.result={loadedAt:Date.now(),rows:[],total:0,apps:0,firstTracked:0,months:[],coverageStart:null,sync:null};
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
  expect(html).not.toContain('A refresh failed and will be retried.');
});

import { expect, it } from 'vitest';
import { cachedAccount, createMsalTestDouble } from './msal-test-double';

it('rejects account APIs until initialize has actually resolved', async () => {
  const msal = createMsalTestDouble();
  const lookups = [() => msal.instance.getActiveAccount(), () => msal.instance.getAllAccounts(), () => msal.instance.setActiveAccount(cachedAccount)];
  for (const lookup of lookups) expect(lookup).toThrow(expect.objectContaining({ errorCode: 'uninitialized_public_client_application' }));
  const pending = msal.instance.initialize();
  msal.finishInitialization();
  for (const lookup of lookups) expect(lookup).toThrow(expect.objectContaining({ errorCode: 'uninitialized_public_client_application' }));
  await pending;
  expect(msal.instance.getActiveAccount()).toBe(cachedAccount);
  expect(msal.instance.getAllAccounts()).toEqual([cachedAccount]);
  expect(() => msal.instance.setActiveAccount(null)).not.toThrow();
  expect(msal.instance.getActiveAccount()).toBeNull();
});

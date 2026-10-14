import { describe, expect, it } from 'vitest';
import { customAppVersionInput, parseCustomAppDefinition } from '../custom-app-definitions';

const definition = { displayName: 'Fixture', publisher: 'Publisher', installerType: 'msi', architecture: 'x64', installScope: 'machine' };
describe('custom app static metadata', () => {
  it('trims fields and requires fresh deployment evidence', () => {
    const saved = parseCustomAppDefinition({ ...definition, displayName: ' Fixture ' });
    expect(customAppVersionInput(saved)).toEqual({ ...definition, version: '', installerUrl: '', sha256: '' });
  });
  it.each(['installerUrl', 'version', 'sha256', 'user_id', '__proto__'])('rejects unknown or deployment field %s', field => {
    const value = JSON.parse(JSON.stringify(definition).slice(0, -1) + `,"${field}":"untrusted"}`);
    expect(() => parseCustomAppDefinition(value)).toThrow();
  });
  it.each([{ installerType: 'script' }, { architecture: 'any' }, { installScope: 'all' }, { iconUrl: 'http://example.test/icon.png' }, { publisher: '' }, { displayName: 'a'.repeat(2049) }, { installerType: 'exe' }, { description: [] }])('rejects invalid metadata %j', patch => {
    expect(() => parseCustomAppDefinition({ ...definition, ...patch })).toThrow();
  });
  it.each(['bad\u0000name', 'bad\uD800name'])('rejects text PostgreSQL JSON cannot store', displayName => {
    expect(() => parseCustomAppDefinition({ ...definition, displayName })).toThrow();
  });
});

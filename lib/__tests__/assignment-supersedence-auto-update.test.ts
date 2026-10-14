import { describe, expect, it } from 'vitest';
import { convertToGraphAssignments } from '@/lib/intune-api';
import { parsePackageAssignments } from '@/lib/update-policies/build-deployment-config';
import { IntuneUploader } from '@/packager/src/intune-uploader';
import type { PackageAssignment } from '@/types/upload';
import type { PackagerConfig } from '@/packager/src/config';
import type { PackagingJob } from '@/packager/src/job-poller';
const enabled = { '@odata.type': '#microsoft.graph.win32LobAppAutoUpdateSettings', autoUpdateSupersededAppsState: 'enabled' };
type Uploader = { extractExplicitAssignments(job: PackagingJob): PackageAssignment[]; toGraphAssignments(a: PackageAssignment[]): ReturnType<typeof convertToGraphAssignments> };
const uploader = new IntuneUploader({} as PackagerConfig) as unknown as Uploader;
describe('explicit supersedence assignment auto update', () => {
  for (const [name, convert] of [['web', convertToGraphAssignments], ['local packager', (a: PackageAssignment[]) => uploader.toGraphAssignments(uploader.extractExplicitAssignments({package_config: {assignments: a}} as PackagingJob))]] as const) {
    it(name + ' leaves legacy settings unchanged', () => {
      expect(convert([{type:'allUsers',intent:'available'}])[0].settings).toEqual({'@odata.type':'#microsoft.graph.win32LobAppAssignmentSettings',notifications:'showAll',deliveryOptimizationPriority:'notConfigured'});
    });
    it.each(['allUsers','allDevices','group'] as const)(name + ' enables only an opted in Available %s assignment', type => {
      const a = {type,intent:'available',groupId:'fake-group',autoUpdateSupersededApps:true} as PackageAssignment;
      expect(convert([a])[0].settings?.autoUpdateSettings).toEqual(enabled);
    });
    it.each(['required','uninstall','updateOnly'] as const)(name + ' ignores opt in for %s', intent => {
      expect(convert([{type:'allUsers',intent,autoUpdateSupersededApps:true} as PackageAssignment])[0].settings).not.toHaveProperty('autoUpdateSettings');
    });
    it(name + ' leaves exclusions without settings', () => {
      expect(convert([{type:'exclusionGroup',intent:'available',groupId:'fake-group',autoUpdateSupersededApps:true} as PackageAssignment])[0]).not.toHaveProperty('settings');
    });
    it.each([false,'true',1,{}])(name + ' never enables an invalid opt in %j', value => {
      expect(convert([{type:'allUsers',intent:'available',autoUpdateSupersededApps:value} as unknown as PackageAssignment])[0].settings).not.toHaveProperty('autoUpdateSettings');
    });
  }
  it('retains an explicit choice in saved update configuration', () => {
    expect(parsePackageAssignments({assignments:[{type:'allUsers',intent:'available',autoUpdateSupersededApps:true}]})).toEqual([{type:'allUsers',intent:'available',autoUpdateSupersededApps:true}]);
  });
  it.each(['true',1,{}])('drops invalid saved option %j', value => {
    expect(parsePackageAssignments({assignments:[{type:'allUsers',intent:'available',autoUpdateSupersededApps:value}]})[0]).not.toHaveProperty('autoUpdateSupersededApps');
  });
});

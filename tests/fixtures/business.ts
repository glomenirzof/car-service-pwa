// Test fixtures for SQL/integration tests. Deliberately generic names: real
// demo businesses live only in tenants/*/business.json and supabase/seed.sql.
import {businessConfigSchema, type BusinessConfigInput} from '../../supabase/functions/_shared/core/tenant-config.ts';

const allWeek = [['09:00', '21:00']] as [string, string][];

export function fixtureConfig(overrides: Partial<BusinessConfigInput> = {}) {
  const base: BusinessConfigInput = {
    schemaVersion: 1,
    slug: 'alpha',
    name: 'Alpha Test Studio',
    shortName: 'Alpha',
    tagline: 'Test studio',
    timezone: 'Europe/Moscow',
    contacts: {phone: '+70000000001', address: 'Test street 1', city: 'Testgrad'},
    brand: {accent: '#33AAFF', logo: 'images/logo.svg', icon: 'images/icon.png', hero: 'images/hero.jpg'},
    booking: {slotStepMinutes: 30, minLeadMinutes: 60, horizonDays: 30, clientChangeUntilHours: 12, reminderMinutesBefore: [1440, 120]},
    workingHours: {mon: allWeek, tue: allWeek, wed: allWeek, thu: allWeek, fri: allWeek, sat: allWeek, sun: allWeek},
    exceptions: [],
    resources: [
      {key: 'box-a', name: 'Box A', kind: 'box', capabilities: ['wash']},
      {key: 'box-b', name: 'Box B', kind: 'box', capabilities: ['wash']},
      {key: 'bay-c', name: 'Bay C', kind: 'bay', capabilities: ['coating']},
    ],
    services: [
      {key: 'wash', name: 'Wash', category: 'Wash', durationMinutes: 60, bufferMinutes: 15, capability: 'wash', price: {amount: 2000, from: false}},
      {key: 'coating', name: 'Coating', category: 'Protect', durationMinutes: 2880, bufferMinutes: 60, completion: 'multi_day', capability: 'coating', price: {amount: 45000, from: true}},
    ],
  };
  return businessConfigSchema.parse({...base, ...overrides});
}

// Shapes returned by the Edge Functions (see app.* SQL functions).
export type Money = {amount: number; isFrom: boolean; currency?: string};

export type Service = {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string;
  durationMinutes: number;
  completion: 'same_day' | 'multi_day';
  price: Money;
  imagePath: string | null;
  popular: boolean;
};

export type MediaItem = {id: string; kind: 'hero' | 'gallery'; source: 'config' | 'owner'; path: string; alt: string; width: number | null; height: number | null};

export type TenantProfile = {
  tagline: string;
  description: string;
  contacts: {phone: string; address: string; city: string; mapUrl?: string; telegram?: string; email?: string};
  brand: {accent: string; background: string; logo: string; hero: string};
  booking: {slotStepMinutes: number; minLeadMinutes: number; horizonDays: number; clientChangeUntilHours: number; reminderMinutesBefore: number[]};
  ai: {enabled: boolean; assistantName: string; greeting: string};
  legal: {companyName?: string; privacyNote?: string};
};

export type PublicTenant = {
  slug: string;
  name: string;
  shortName: string;
  status: 'preview' | 'live';
  timezone: string;
  currency: string;
  profile: TenantProfile;
  services: Service[];
  workingHours: {weekday: number; opens: string; closes: string}[];
  exceptions: {date: string; closed: boolean; intervals: [string, string][]; note: string | null}[];
  media: MediaItem[];
  resourcesCount: number;
};

export type Slot = {startAt: string; time: string; freeResources: number};
export type Availability = {
  timezone: string;
  serviceId: string;
  durationMinutes: number;
  completion: 'same_day' | 'multi_day';
  from: string;
  to: string;
  days: {date: string; slots: Slot[]}[];
};

export type BookingStatus = 'scheduled' | 'arrived' | 'completed' | 'cancelled' | 'no_show';

export type ClientBooking = {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  service: {id: string; name: string; durationMinutes: number};
  resource: {name: string};
  price: Money;
  customerName: string;
  phoneMasked: string;
  car: string | null;
  carPlate: string | null;
  comment: string | null;
  isDemo: boolean;
  rescheduleCount: number;
  version: number;
  changeDeadline: string;
  canChange: boolean;
  tenant: {slug: string; name: string; timezone: string; phone: string; address: string};
};

export type CreateBookingResponse = {booking: ClientBooking; token: string; replayed: boolean};

import type {BookingStatus, MediaItem, Money, TenantProfile} from '@/shared/types';

export type Membership = {tenantId: string; slug: string; name: string; status: 'preview' | 'live' | 'suspended'; timezone: string; currency: string; role: 'owner' | 'staff'};

export type OwnerResource = {id: string; key: string; name: string; kind: string; capabilities: string[]; isActive: boolean; isPaused: boolean};
export type OwnerService = {id: string; key: string; name: string; category: string; durationMinutes: number; bufferMinutes: number; completion: 'same_day' | 'multi_day'; capability: string; price: Money; isActive: boolean; isPaused: boolean};

export type OwnerTenant = {
  tenantId: string;
  slug: string;
  name: string;
  shortName: string;
  status: 'preview' | 'live' | 'suspended';
  timezone: string;
  currency: string;
  profile: TenantProfile;
  configVersion: number;
  publishedAt: string | null;
  resources: OwnerResource[];
  services: OwnerService[];
  workingHours: {weekday: number; opens: string; closes: string}[];
  exceptions: {id: string; date: string; opens: string | null; closes: string | null; note: string | null; source: 'config' | 'owner'}[];
  media: MediaItem[];
};

export type ScheduleBooking = {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  occupiedUntil: string;
  resourceId: string;
  serviceName: string;
  customerName: string;
  phone: string;
  car: string | null;
  carPlate: string | null;
  comment: string | null;
  price: Money;
  finalAmount: number | null;
  paid: number;
  isDemo: boolean;
  source: 'client' | 'owner' | 'demo';
};

export type Schedule = {
  period: {from: string; to: string; timezone: string; startsAt: string; endsAt: string};
  resources: {id: string; name: string; kind: string; isActive: boolean; isPaused: boolean}[];
  bookings: ScheduleBooking[];
  blocks: {id: string; resourceId: string; from: string; to: string; note: string | null}[];
};

export type OwnerBooking = {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  occupiedUntil: string;
  resourceId: string;
  resourceName: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  bufferMinutes: number;
  customerName: string;
  phone: string;
  car: string | null;
  carPlate: string | null;
  comment: string | null;
  price: Money & {currency: string};
  finalAmount: number | null;
  source: 'client' | 'owner' | 'demo';
  isDemo: boolean;
  createdAt: string;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  rescheduleCount: number;
  payments: {id: string; amount: number; method: 'cash' | 'card' | 'transfer' | 'other'; receivedAt: string; note: string | null}[];
  events: {kind: string; actor: string; data: Record<string, unknown>; at: string}[];
  customerHistory: {bookings: number; completed: number};
};

export type Stats = {
  period: {from: string; to: string; timezone: string; startsAt: string; endsAt: string};
  visits: number;
  completedOrders: {count: number; amount: number};
  paymentsReceived: {count: number; amount: number; byMethod: Partial<Record<'cash' | 'card' | 'transfer' | 'other', number>>};
  upcoming: {count: number; expectedAmount: number};
  cancelled: number;
  noShows: number;
  outstanding: {count: number; amount: number};
  byService: {serviceName: string; count: number; amount: number}[];
  byDay: {date: string; visits: number; completedAmount: number; paymentsAmount: number}[];
};

export type SearchResult = {id: string; status: BookingStatus; startAt: string; serviceName: string; customerName: string; phone: string; car: string | null; carPlate: string | null};

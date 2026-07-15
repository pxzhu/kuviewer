export type ResourceCapabilityStatus = 'available' | 'forbidden' | 'unauthorized' | 'missing' | 'unavailable' | 'protected';

export interface ResourceCapability {
  id: string;
  group: string;
  resource: string;
  required: boolean;
  status: ResourceCapabilityStatus;
  reason: string;
}

export interface CapabilityReport {
  source: string;
  checkedAt: string;
  items: ResourceCapability[];
  warning?: string;
}

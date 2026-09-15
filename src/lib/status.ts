import type { DocStatus, Mode, ShipmentStatus, Vehicle } from '../data/types'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand'

export const SHIPMENT_TONE: Record<ShipmentStatus, Tone> = {
  planned: 'neutral', in_transit: 'info', at_hub: 'brand', customs: 'warn',
  out_for_delivery: 'brand', delivered: 'ok', exception: 'bad',
}

export const SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  planned: 'Planned', in_transit: 'In transit', at_hub: 'At hub', customs: 'In customs',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Exception',
}

export const DOC_TONE: Record<DocStatus, Tone> = {
  valid: 'ok', expiring: 'warn', expired: 'bad', mismatch: 'bad', pending: 'neutral',
}

export const VEHICLE_TONE: Record<Vehicle['status'], Tone> = {
  moving: 'ok', idle: 'warn', loading: 'info', maintenance: 'brand', offline: 'neutral',
}

export const MODE_LABEL: Record<Mode, string> = { road: 'Road', rail: 'Rail', sea: 'Sea', air: 'Air' }

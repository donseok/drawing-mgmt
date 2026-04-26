// Types for the admin classes/attributes management UI.
// Mirrors the API response shapes from GET /api/v1/admin/classes
// and GET /api/v1/admin/classes/:id/attributes.

export type DataType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'COMBO';

export interface AttributeItem {
  id: string;
  classId: string;
  code: string;
  label: string;
  dataType: DataType;
  required: boolean;
  defaultValue: string | null;
  comboItems: string[] | null;
  sortOrder: number;
}

export interface ClassItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  attributes: AttributeItem[];
  objectCount: number;
}

// ── Mutation payloads ──────────────────────────────────────────────────────

export interface CreateClassPayload {
  code: string;
  name: string;
  description?: string;
}

export interface UpdateClassPayload {
  name?: string;
  description?: string;
}

export interface CreateAttributePayload {
  code: string;
  label: string;
  dataType: DataType;
  required?: boolean;
  defaultValue?: string;
  comboItems?: string[];
  sortOrder?: number;
}

export interface UpdateAttributePayload {
  label?: string;
  required?: boolean;
  defaultValue?: string;
  comboItems?: string[];
  sortOrder?: number;
}

// ── DataType display config ────────────────────────────────────────────────

export const DATA_TYPE_CONFIG: Record<DataType, { label: string; className: string }> = {
  TEXT: { label: 'TEXT', className: 'bg-blue-100 text-blue-700' },
  NUMBER: { label: 'NUMBER', className: 'bg-green-100 text-green-700' },
  BOOLEAN: { label: 'BOOLEAN', className: 'bg-purple-100 text-purple-700' },
  DATE: { label: 'DATE', className: 'bg-amber-100 text-amber-700' },
  COMBO: { label: 'COMBO', className: 'bg-pink-100 text-pink-700' },
};

export const DATA_TYPES: DataType[] = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'COMBO'];

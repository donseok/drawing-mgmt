// Public surface for the in-house DXF parser. Keep it small — anything not
// re-exported here is internal and may shift between phases.

export { parseDxf } from './parser';
export { aciToRgb, ACI_BY_BLOCK, ACI_BY_LAYER, DEFAULT_FOREGROUND } from './aci-colors';
export type {
  DxfDocument,
  DxfEntity,
  DxfLayerInfo,
  LineEntity,
  CircleEntity,
  ArcEntity,
  PolylineEntity,
  TextEntity,
  HatchEntity,
  V2,
} from './types';

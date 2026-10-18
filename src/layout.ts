export interface PanelLayout { sidebarWidth: number; sourceRatio: number; areaIndex: number; sorterSize: number }
export const DEFAULT_LAYOUT: PanelLayout = { sidebarWidth: 208, sourceRatio: 0.3, areaIndex: 0, sorterSize: 220 };

export function readLayout(value: unknown): PanelLayout {
  const data = value && typeof value === 'object' ? value as Partial<PanelLayout> : {};
  return {
    sidebarWidth: typeof data.sidebarWidth === 'number' && Number.isFinite(data.sidebarWidth) ? Math.max(84, Math.min(520, data.sidebarWidth)) : DEFAULT_LAYOUT.sidebarWidth,
    sourceRatio: typeof data.sourceRatio === 'number' && Number.isFinite(data.sourceRatio) ? Math.max(0.1, Math.min(0.85, data.sourceRatio)) : DEFAULT_LAYOUT.sourceRatio,
    areaIndex: typeof data.areaIndex === 'number' && Number.isSafeInteger(data.areaIndex) && data.areaIndex >= 0 ? data.areaIndex : 0,
    sorterSize: typeof data.sorterSize === 'number' && Number.isFinite(data.sorterSize) ? Math.max(140, Math.min(360, data.sorterSize)) : DEFAULT_LAYOUT.sorterSize,
  };
}

export function sidebarBounds(width: number): { min: number; max: number } {
  const min = Math.min(width < 600 ? 84 : 140, Math.max(0, width * 0.3));
  return { min, max: Math.max(min, Math.min(520, width * 0.5, width - 180)) };
}

export function sourceBounds(height: number): { min: number; max: number } {
  const min = Math.min(120, Math.max(0, height * 0.4));
  return { min, max: Math.max(min, height - Math.min(200, height * 0.5)) };
}

export function clampSize(value: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

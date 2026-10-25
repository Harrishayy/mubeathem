import type { ComponentType } from "react";

export interface PanelMeta {
  title: string;
  /** Default share of the column's height (layout can override). */
  grow?: number;
  /** Default smallest height in px while expanded. */
  minHeight?: number;
  /** Fixed body height on narrow screens, where columns stack (e.g. "60vh"). */
  mobileHeight?: string;
  /** One line for the layout map on the System tab. */
  about?: string;
  /** Capabilities the data source must offer (src/engine/types.ts Cap). Without them the panel isn't shown. */
  needs?: string[];
}

export interface PanelModule {
  meta: PanelMeta;
  default: ComponentType<any>;
}

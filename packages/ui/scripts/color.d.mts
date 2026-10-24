export type RGBA = [number, number, number, number];
export function oklch(L: number, C: number, hDeg: number): [number, number, number];
export function hex(rgb: [number, number, number]): string;
export function parseColor(input: string): RGBA | null;
export function over(fg: RGBA | number[], bg: RGBA | number[]): RGBA;
export function luminance(rgb: RGBA | number[]): number;
export function contrast(a: RGBA | number[], b: RGBA | number[]): number;

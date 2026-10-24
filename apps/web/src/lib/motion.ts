/** The user asked for less motion (smooth scrolling becomes a jump). */
export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

'use client';

// Segment-scoped boundary: a render throw inside the Image workspace must not
// blank the whole (main) area (there was previously no error.tsx here).
export { default } from '@/components/Error';

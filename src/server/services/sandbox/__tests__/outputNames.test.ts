/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { distinctOutputFilenames } from '../outputNames';

describe('distinctOutputFilenames', () => {
  it('puts a duplicate suffix before the extension', () => {
    expect(distinctOutputFilenames(['x.png', 'x.png'])).toEqual(['x.png', 'x_2.png']);
  });

  it('keeps a top-level name and renames the nested file that flattens to it', () => {
    expect(distinctOutputFilenames(['out/x.png', 'a/x.png', 'out_x.png'])).toEqual([
      'out_x_2.png',
      'a_x.png',
      'out_x.png',
    ]);
  });

  it('flattens nested files that share a basename', () => {
    expect(distinctOutputFilenames(['plots/2023/summary.png', 'plots/2024/summary.png'])).toEqual([
      'plots_2023_summary.png',
      'plots_2024_summary.png',
    ]);
  });

  it('leaves different basenames unchanged', () => {
    expect(distinctOutputFilenames(['report.txt', 'out/report.csv'])).toEqual([
      'report.txt',
      'report.csv',
    ]);
  });
});

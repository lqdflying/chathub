import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import { MAX_SKILL_ARCHIVE_BYTES, MAX_SKILL_ARCHIVE_ENTRIES, parseSkillArchive } from './archive';
import { MAX_SKILL_BYTES } from './parser';

const encoder = new TextEncoder();
const skillDocument = `---
name: reviewer
description: Review changes for correctness.
---

Review the supplied changes.
`;

const createArchive = (entries: Record<string, Uint8Array>, name = 'reviewer.skill') => {
  const data = zipSync(entries);
  return new File([data], name, { type: 'application/octet-stream' });
};

describe('parseSkillArchive', () => {
  it('reads the official top-level folder layout and reports skipped resources', async () => {
    const file = createArchive({
      'reviewer/.DS_Store': encoder.encode('metadata'),
      'reviewer/SKILL.md': encoder.encode(skillDocument),
      'reviewer/references/checklist.md': encoder.encode('Checklist'),
      'reviewer/scripts/review.py': encoder.encode('print("review")'),
    });

    await expect(parseSkillArchive(file)).resolves.toEqual({
      bundledResourceCount: 2,
      identifier: 'reviewer',
      instructions: skillDocument,
    });
  });

  it('accepts a root-level SKILL.md', async () => {
    const file = createArchive({ 'SKILL.md': encoder.encode(skillDocument) });

    await expect(parseSkillArchive(file)).resolves.toMatchObject({
      bundledResourceCount: 0,
      identifier: 'reviewer',
    });
  });

  it('rejects files without the .skill extension and oversized archives before reading', async () => {
    const wrongExtension = createArchive(
      { 'SKILL.md': encoder.encode(skillDocument) },
      'skill.zip',
    );
    await expect(parseSkillArchive(wrongExtension)).rejects.toThrow('.skill extension');

    const arrayBuffer = vi.fn();
    const oversized = {
      arrayBuffer,
      name: 'reviewer.skill',
      size: MAX_SKILL_ARCHIVE_BYTES + 1,
    } as File;
    await expect(parseSkillArchive(oversized)).rejects.toThrow('30 MiB');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects invalid archives and archives without exactly one SKILL.md', async () => {
    const invalid = new File([new Uint8Array([1, 2, 3])], 'invalid.skill');
    await expect(parseSkillArchive(invalid)).rejects.toThrow('valid .skill archive');

    const missing = createArchive({ 'reviewer/README.md': encoder.encode('Missing') });
    await expect(parseSkillArchive(missing)).rejects.toThrow('does not contain SKILL.md');

    const multiple = createArchive({
      'SKILL.md': encoder.encode(skillDocument),
      'reviewer/SKILL.md': encoder.encode(skillDocument),
    });
    await expect(parseSkillArchive(multiple)).rejects.toThrow('multiple SKILL.md');
  });

  it('rejects unsafe paths and a folder name that differs from frontmatter', async () => {
    const unsafe = createArchive({
      '../outside.txt': encoder.encode('unsafe'),
      'reviewer/SKILL.md': encoder.encode(skillDocument),
    });
    await expect(parseSkillArchive(unsafe)).rejects.toThrow('unsafe file path');

    const mismatch = createArchive({ 'other/SKILL.md': encoder.encode(skillDocument) });
    await expect(parseSkillArchive(mismatch)).rejects.toThrow(
      'expected "reviewer", received "other"',
    );
  });

  it('rejects invalid UTF-8 and oversized instructions', async () => {
    const invalidUtf8 = createArchive({
      'reviewer/SKILL.md': new Uint8Array([0xff, 0xfe, 0xfd]),
    });
    await expect(parseSkillArchive(invalidUtf8)).rejects.toThrow('valid UTF-8');

    const oversizedDocument = `${skillDocument}${'x'.repeat(MAX_SKILL_BYTES)}`;
    const oversized = createArchive({
      'reviewer/SKILL.md': encoder.encode(oversizedDocument),
    });
    await expect(parseSkillArchive(oversized)).rejects.toThrow('128 KiB');
  });

  it('limits the number of files in an archive', async () => {
    const entries: Record<string, Uint8Array> = {
      'reviewer/SKILL.md': encoder.encode(skillDocument),
    };
    for (let index = 0; index < MAX_SKILL_ARCHIVE_ENTRIES; index += 1) {
      entries[`reviewer/references/${index}.md`] = new Uint8Array();
    }

    await expect(parseSkillArchive(createArchive(entries))).rejects.toThrow(
      `${MAX_SKILL_ARCHIVE_ENTRIES} files`,
    );
  });
});

import { unzip } from 'fflate';

import { MAX_SKILL_BYTES, parseSkill } from './parser';

export const MAX_SKILL_ARCHIVE_BYTES = 30 * 1024 * 1024;
export const MAX_SKILL_ARCHIVE_ENTRIES = 1024;

export interface ParsedSkillArchive {
  bundledResourceCount: number;
  identifier: string;
  instructions: string;
}

interface ArchiveEntry {
  name: string;
  originalSize: number;
}

const isMetadataEntry = (path: string) => {
  const parts = path.split('/');
  return parts[0] === '__MACOSX' || parts.at(-1) === '.DS_Store';
};

const isSafeArchivePath = (path: string) => {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;

  const parts = path.split('/');
  return parts.every((part) => part !== '..' && part !== '');
};

const isSkillDocumentPath = (path: string) => {
  const parts = path.split('/');
  return (
    (parts.length === 1 && parts[0] === 'SKILL.md') ||
    (parts.length === 2 && parts[1] === 'SKILL.md')
  );
};

const unzipSkillDocument = async (data: Uint8Array) => {
  const skillEntries: ArchiveEntry[] = [];
  let bundledResourceCount = 0;
  let entryCount = 0;
  let hasUnsafePath = false;
  let hasOversizedInstructions = false;

  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      data,
      {
        filter: (entry) => {
          const path = entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name;
          if (!isSafeArchivePath(path)) {
            hasUnsafePath = true;
            return false;
          }
          if (entry.name.endsWith('/')) return false;

          entryCount += 1;
          if (entryCount > MAX_SKILL_ARCHIVE_ENTRIES) return false;
          if (isMetadataEntry(entry.name)) return false;

          if (!isSkillDocumentPath(entry.name)) {
            bundledResourceCount += 1;
            return false;
          }

          skillEntries.push({ name: entry.name, originalSize: entry.originalSize });
          if (entry.originalSize > MAX_SKILL_BYTES) {
            hasOversizedInstructions = true;
            return false;
          }
          return true;
        },
      },
      (error, unzipped) => {
        if (error) reject(new Error('The selected file is not a valid .skill archive'));
        else resolve(unzipped);
      },
    );
  });

  if (entryCount > MAX_SKILL_ARCHIVE_ENTRIES) {
    throw new Error(`Skill archive cannot contain more than ${MAX_SKILL_ARCHIVE_ENTRIES} files`);
  }
  if (hasUnsafePath) throw new Error('Skill archive contains an unsafe file path');
  if (hasOversizedInstructions) throw new Error('Skill instructions exceed the 128 KiB limit');
  if (skillEntries.length === 0) throw new Error('Skill archive does not contain SKILL.md');
  if (skillEntries.length > 1) throw new Error('Skill archive contains multiple SKILL.md files');

  const [skillEntry] = skillEntries;
  const instructionsBytes = files[skillEntry.name];
  if (!instructionsBytes) throw new Error('Skill archive could not extract SKILL.md');

  let instructions: string;
  try {
    instructions = new TextDecoder('utf8', { fatal: true }).decode(instructionsBytes);
  } catch {
    throw new Error('SKILL.md must be valid UTF-8 text');
  }

  return { bundledResourceCount, instructions, path: skillEntry.name };
};

export const parseSkillArchive = async (file: File): Promise<ParsedSkillArchive> => {
  if (!file.name.toLowerCase().endsWith('.skill')) {
    throw new Error('Select a file with the .skill extension');
  }
  if (file.name.length > 255) throw new Error('Skill filename must be at most 255 characters');
  if (file.size > MAX_SKILL_ARCHIVE_BYTES) {
    throw new Error('Skill archive exceeds the 30 MiB limit');
  }

  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('Unable to read the selected skill file');
  }

  const archive = await unzipSkillDocument(data);
  const parsed = parseSkill(archive.instructions);
  const [folder] = archive.path.split('/');
  if (archive.path.includes('/') && folder !== parsed.name) {
    throw new Error(`Skill folder name mismatch: expected "${parsed.name}", received "${folder}"`);
  }

  return {
    bundledResourceCount: archive.bundledResourceCount,
    identifier: parsed.name,
    instructions: archive.instructions,
  };
};

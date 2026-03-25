# Picbed (Image Hosting) Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Tools section to the left sidebar with a Picbed tool that lets users upload images (paste/drag/click) and get a shareable S3 URL back.

**Architecture:** New `picbed_images` DB table (separate from chat `files` table) stores upload records per user. A tRPC router handles CRUD. The UI lives at `/tools/picbed` under a new Tools nav entry. Upload reuses `uploadService.uploadFileToS3` directly — no model/vision coupling.

**Tech Stack:** Drizzle ORM (PostgreSQL), tRPC lambda router, Next.js App Router, Zustand, `antd-style` createStyles, `@lobehub/ui`, React

**Constraints:**

- No local PostgreSQL — migration SQL is written manually, not generated
- No snapshot file — document that `db:generate` needs a DB when next migration is needed
- Server mode only for public URLs (client mode uploads go to IndexedDB, URLs not shareable)

---

## Task 1: DB Schema — `picbed_images` table

**Files:**

- Create: `packages/database/src/schemas/picbed.ts`
- Modify: `packages/database/src/schemas/index.ts`
- Modify: `packages/database/src/utils/idGenerator.ts`

**Step 1: Add `picbedImages` prefix to idGenerator**

In `packages/database/src/utils/idGenerator.ts`, add one line to the `prefixes` object:

```ts
const prefixes = {
  // ... existing entries ...
  picbedImages: 'pbi',
  // ... rest ...
} as const;
```

**Step 2: Create the schema file**

Create `packages/database/src/schemas/picbed.ts`:

```ts
/* eslint-disable sort-keys-fix/sort-keys-fix */
import { index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

export const picbedImages = pgTable(
  'picbed_images',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('picbedImages'))
      .primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    url: text('url').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    fileType: varchar('file_type', { length: 255 }).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    userIdIdx: index('picbed_images_user_id_idx').on(table.userId),
  }),
);

export type NewPicbedImage = typeof picbedImages.$inferInsert;
export type PicbedImageItem = typeof picbedImages.$inferSelect;
```

**Step 3: Export from schema index**

In `packages/database/src/schemas/index.ts`, add at the end:

```ts
export * from './picbed';
```

**Step 4: Commit**

```bash
git add packages/database/src/schemas/picbed.ts packages/database/src/schemas/index.ts packages/database/src/utils/idGenerator.ts
git commit -m "feat(db): add picbed_images schema"
```

---

## Task 2: DB Migration — manual SQL

**Files:**

- Create: `packages/database/migrations/0041_add_picbed_images.sql`
- Modify: `packages/database/migrations/meta/_journal.json`

**Step 1: Create the migration SQL file**

Create `packages/database/migrations/0041_add_picbed_images.sql`:

```sql
CREATE TABLE IF NOT EXISTS "picbed_images" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"file_type" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "picbed_images" ADD CONSTRAINT "picbed_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "picbed_images_user_id_idx" ON "picbed_images" USING btree ("user_id");
```

**Step 2: Add entry to `_journal.json`**

In `packages/database/migrations/meta/_journal.json`, append to the `entries` array (before the closing `]`):

```json
{
  "breakpoints": true,
  "idx": 41,
  "tag": "0041_add_picbed_images",
  "version": "7",
  "when": 1741622400000
}
```

**Step 3: Commit**

```bash
git add packages/database/migrations/0041_add_picbed_images.sql packages/database/migrations/meta/_journal.json
git commit -m "feat(db): add picbed_images migration"
```

---

## Task 3: DB Model — `PicbedModel`

**Files:**

- Create: `packages/database/src/models/picbed.ts`

**Step 1: Create the model**

Create `packages/database/src/models/picbed.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';

import { NewPicbedImage, PicbedImageItem, picbedImages } from '../schemas';
import { LobeChatDatabase } from '../type';

export class PicbedModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewPicbedImage, 'id' | 'userId'>) => {
    const [result] = await this.db
      .insert(picbedImages)
      .values({ ...params, userId: this.userId })
      .returning();
    return result;
  };

  query = async () => {
    return this.db.query.picbedImages.findMany({
      orderBy: [desc(picbedImages.createdAt)],
      where: eq(picbedImages.userId, this.userId),
    });
  };

  delete = async (id: string) => {
    return this.db
      .delete(picbedImages)
      .where(and(eq(picbedImages.id, id), eq(picbedImages.userId, this.userId)));
  };
}
```

**Step 2: Commit**

```bash
git add packages/database/src/models/picbed.ts
git commit -m "feat(db): add PicbedModel"
```

---

## Task 4: Drizzle relations — register `picbedImages`

**Files:**

- Modify: `packages/database/src/schemas/relations.ts`

**Step 1: Check current relations**

Read `packages/database/src/schemas/relations.ts` to see the pattern.

**Step 2: Add picbedImages relation to users**

Add to the `usersRelations` (or wherever user-owned tables are registered):

```ts
import { picbedImages } from './picbed';

// inside usersRelations:
picbedImages: many(picbedImages),
```

And add the picbed side:

```ts
export const picbedImagesRelations = relations(picbedImages, ({ one }) => ({
  user: one(users, {
    fields: [picbedImages.userId],
    references: [users.id],
  }),
}));
```

**Step 3: Commit**

```bash
git add packages/database/src/schemas/relations.ts
git commit -m "feat(db): add picbed relations"
```

---

## Task 5: tRPC Router — `picbedRouter`

**Files:**

- Create: `src/server/routers/lambda/picbed.ts`
- Modify: `src/server/routers/lambda/index.ts`

**Step 1: Create router**

Create `src/server/routers/lambda/picbed.ts`:

```ts
import { z } from 'zod';

import { PicbedModel } from '@/database/models/picbed';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

const picbedProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: { picbedModel: new PicbedModel(ctx.serverDB, ctx.userId) },
  });
});

export const picbedRouter = router({
  create: picbedProcedure
    .input(
      z.object({
        fileType: z.string(),
        name: z.string(),
        size: z.number(),
        url: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.picbedModel.create(input);
    }),

  delete: picbedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    return ctx.picbedModel.delete(input.id);
  }),

  list: picbedProcedure.query(async ({ ctx }) => {
    return ctx.picbedModel.query();
  }),
});
```

**Step 2: Register in lambda index**

In `src/server/routers/lambda/index.ts`:

- Add import: `import { picbedRouter } from './picbed';`
- Add to `lambdaRouter`: `picbed: picbedRouter,`

**Step 3: Commit**

```bash
git add src/server/routers/lambda/picbed.ts src/server/routers/lambda/index.ts
git commit -m "feat(api): add picbed tRPC router"
```

---

## Task 6: Client Service — `picbedService`

**Files:**

- Create: `src/services/picbed.ts`

**Step 1: Create the service**

Create `src/services/picbed.ts`:

```ts
import { lambdaClient } from '@/libs/trpc/client';
import { uploadService } from '@/services/upload';

export interface PicbedUploadResult {
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

class PicbedService {
  uploadImage = async (file: File): Promise<PicbedUploadResult> => {
    const { data: metadata, success } = await uploadService.uploadFileToS3(file, {
      skipCheckFileType: true,
    });

    if (!success) throw new Error('Upload failed');

    const record = await lambdaClient.picbed.create.mutate({
      fileType: file.type,
      name: file.name,
      size: file.size,
      url: metadata.path,
    });

    return {
      fileType: record.fileType,
      id: record.id,
      name: record.name,
      size: record.size,
      url: metadata.path,
    };
  };

  list = async () => {
    return lambdaClient.picbed.list.query();
  };

  delete = async (id: string) => {
    return lambdaClient.picbed.delete.mutate({ id });
  };
}

export const picbedService = new PicbedService();
```

**Step 2: Commit**

```bash
git add src/services/picbed.ts
git commit -m "feat: add picbed client service"
```

---

## Task 7: i18n — add translation keys

**Files:**

- Modify: `src/locales/default/common.ts`
- Create: `src/locales/default/tools.ts`

**Step 1: Add `tab.tools` to common.ts**

In `src/locales/default/common.ts`, find the `tab:` section and add:

```ts
tab: {
  // ... existing entries ...
  tools: 'Tools',
},
```

**Step 2: Create tools.ts**

Create `src/locales/default/tools.ts`:

```ts
export default {
  picbed: {
    copy: 'Copy URL',
    copied: 'Copied!',
    delete: 'Delete',
    deleteConfirm: 'Delete this image?',
    dragTip: 'Drag & drop or paste image here',
    empty: 'No images uploaded yet',
    title: 'Picbed',
    upload: 'Click or paste to upload',
    uploadSuccess: 'Upload successful',
    uploadFailed: 'Upload failed',
  },
  title: 'Tools',
};
```

**Step 3: Register in locales index**

Check `src/locales/default/index.ts` — add `tools` export if not auto-collected.

**Step 4: Commit**

```bash
git add src/locales/default/common.ts src/locales/default/tools.ts
git commit -m "feat(i18n): add tools and picbed translation keys"
```

---

## Task 8: Left Sidebar — add Tools nav icon

**Files:**

- Modify: `src/store/global/initialState.ts`
- Modify: `src/app/[variants]/(main)/_layout/Desktop/SideBar/TopActions.tsx`

**Step 1: Add `Tools` to `SidebarTabKey` enum**

In `src/store/global/initialState.ts`, in the `SidebarTabKey` enum:

```ts
export enum SidebarTabKey {
  Chat = 'chat',
  Discover = 'discover',
  Files = 'files',
  Image = 'image',
  Me = 'me',
  Setting = 'settings',
  Tools = 'tools', // add this
}
```

**Step 2: Add Tools icon to TopActions**

In `src/app/[variants]/(main)/_layout/Desktop/SideBar/TopActions.tsx`:

- Add import: `import { Compass, FolderClosed, MessageSquare, Palette, Wrench } from 'lucide-react';`
- Add `isToolsActive` derived state: `const isToolsActive = tab === SidebarTabKey.Tools;`
- Add the icon link after the Image block and before Discover:

```tsx
<Link aria-label={t('tab.tools')} href={'/tools'}>
  <ActionIcon
    active={isToolsActive}
    icon={Wrench}
    size={ICON_SIZE}
    title={t('tab.tools')}
    tooltipProps={{ placement: 'right' }}
  />
</Link>
```

**Step 3: Commit**

```bash
git add src/store/global/initialState.ts src/app/[variants]/\(main\)/_layout/Desktop/SideBar/TopActions.tsx
git commit -m "feat: add Tools nav icon to left sidebar"
```

---

## Task 9: Route — `/tools` layout and page

**Files:**

- Create: `src/app/[variants]/(main)/tools/layout.tsx`
- Create: `src/app/[variants]/(main)/tools/page.tsx`
- Create: `src/app/[variants]/(main)/tools/_layout/Desktop/index.tsx`
- Create: `src/app/[variants]/(main)/tools/_layout/Desktop/Container.tsx`
- Create: `src/app/[variants]/(main)/tools/_layout/type.ts`

**Step 1: Layout type**

Create `src/app/[variants]/(main)/tools/_layout/type.ts`:

```ts
import { ReactNode } from 'react';

export interface LayoutProps {
  children: ReactNode;
}
```

**Step 2: Desktop container**

Create `src/app/[variants]/(main)/tools/_layout/Desktop/Container.tsx`:

```tsx
'use client';

import { useTheme } from 'antd-style';
import { PropsWithChildren, memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

const Container = memo<PropsWithChildren>(({ children }) => {
  const theme = useTheme();

  return (
    <Center
      flex={1}
      style={{
        background: theme.colorBgContainerSecondary,
        overflowX: 'hidden',
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      <Flexbox gap={16} height={'100%'} padding={24} style={{ maxWidth: 860 }} width={'100%'}>
        {children}
      </Flexbox>
    </Center>
  );
});

export default Container;
```

**Step 3: Desktop layout**

Create `src/app/[variants]/(main)/tools/_layout/Desktop/index.tsx`:

```tsx
import { Flexbox } from 'react-layout-kit';

import { LayoutProps } from '../type';
import Container from './Container';

const Layout = ({ children }: LayoutProps) => {
  return (
    <Flexbox
      height={'100%'}
      horizontal
      style={{ maxWidth: '100%', overflow: 'hidden', position: 'relative' }}
      width={'100%'}
    >
      <Container>{children}</Container>
    </Flexbox>
  );
};

Layout.displayName = 'DesktopToolsLayout';

export default Layout;
```

**Step 4: Route layout.tsx**

Create `src/app/[variants]/(main)/tools/layout.tsx`:

```tsx
import ServerLayout from '@/components/server/ServerLayout';

import Desktop from './_layout/Desktop';
import { LayoutProps } from './_layout/type';

// Mobile falls back to Desktop for now
const ToolsLayout = ServerLayout<LayoutProps>({ Desktop, Mobile: Desktop });

ToolsLayout.displayName = 'ToolsLayout';

export default ToolsLayout;
```

**Step 5: Route page.tsx (redirect to picbed)**

Create `src/app/[variants]/(main)/tools/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

const ToolsPage = () => {
  redirect('/tools/picbed');
};

export default ToolsPage;
```

**Step 6: Commit**

```bash
git add src/app/[variants]/\(main\)/tools/
git commit -m "feat: add Tools route layout and redirect"
```

---

## Task 10: Picbed UI — upload hook

**Files:**

- Create: `src/app/[variants]/(main)/tools/picbed/features/PicbedWorkspace/usePicbedUpload.ts`

This is a simpler version of `useDragUpload` — no model/vision coupling.

**Step 1: Create the hook**

Create `src/app/[variants]/(main)/tools/picbed/features/PicbedWorkspace/usePicbedUpload.ts`:

```ts
import { App } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PicbedUploadResult, picbedService } from '@/services/picbed';

const getFilesFromDataTransferItems = async (items: DataTransferItem[]): Promise<File[]> => {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && file.type.startsWith('image/')) files.push(file);
    }
  }
  return files;
};

export const usePicbedUpload = () => {
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      const results: PicbedUploadResult[] = [];
      try {
        for (const file of files) {
          const result = await picbedService.uploadImage(file);
          results.push(result);
        }
        message.success(t('picbed.uploadSuccess'));
        return results;
      } catch {
        message.error(t('picbed.uploadFailed'));
      } finally {
        setUploading(false);
      }
    },
    [message, t],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const files = await getFilesFromDataTransferItems(items);
      if (files.length > 0) uploadFiles(files);
    },
    [uploadFiles],
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (!e.dataTransfer?.items) return;
      const items = Array.from(e.dataTransfer.items);
      const files = await getFilesFromDataTransferItems(items);
      uploadFiles(files);
    },
    [uploadFiles],
  );

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => e.preventDefault();
    const handleDragEnter = () => setIsDragging(true);
    const handleDragLeave = () => setIsDragging(false);

    window.addEventListener('paste', handlePaste);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handlePaste, handleDrop]);

  return { isDragging, uploadFiles, uploading };
};
```

**Step 2: Commit**

```bash
git add src/app/[variants]/\(main\)/tools/picbed/features/PicbedWorkspace/usePicbedUpload.ts
git commit -m "feat: add picbed upload hook"
```

---

## Task 11: Picbed UI — ImageCard component

**Files:**

- Create: `src/app/[variants]/(main)/tools/picbed/features/PicbedWorkspace/ImageCard.tsx`

**Step 1: Create ImageCard**

Create `src/app/[variants]/(main)/tools/picbed/features/PicbedWorkspace/ImageCard.tsx`:

```tsx
'use client';

import { ActionIcon } from '@lobehub/ui';
import { App, Input, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { Check, Copy, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => ({
  card: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    overflow: hidden;
    background: ${token.colorBgContainer};
  `,
  image: css`
    width: 100%;
    height: 160px;
    object-fit: cover;
    display: block;
  `,
  footer: css`
    padding: 8px 12px;
    gap: 8px;
  `,
  urlInput: css`
    flex: 1;
    font-size: 12px;
  `,
}));

interface ImageCardProps {
  id: string;
  name: string;
  url: string;
  onDelete: (id: string) => void;
}

const ImageCard = memo<ImageCardProps>(({ id, name, url, onDelete }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    message.success(t('picbed.copied'));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Flexbox className={styles.card}>
      <img alt={name} className={styles.image} src={url} />
      <Flexbox align={'center'} className={styles.footer} horizontal>
        <Input className={styles.urlInput} readOnly size={'small'} value={url} />
        <Tooltip title={t('picbed.copy')}>
          <ActionIcon
            icon={copied ? Check : Copy}
            onClick={handleCopy}
            size={{ blockSize: 28, size: 14 }}
          />
        </Tooltip>
        <Tooltip title={t('picbed.delete')}>
          <ActionIcon
            icon={Trash2}
            onClick={() => onDelete(id)}
            size={{ blockSize: 28, size: 14 }}
          />
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
});

export default ImageCard;
```

**Step 2: Commit**

```bash
git add src/app/[variants]/\(main\)/tools/picbed/features/PicbedWorkspace/ImageCard.tsx
git commit -m "feat: add picbed ImageCard component"
```

---

## Task 12: Picbed UI — main PicbedWorkspace

**Files:**

- Create: `src/app/[variants]/(main)/tools/picbed/features/PicbedWorkspace/index.tsx`

**Step 1: Create main workspace**

Create `src/app/[variants]/(main)/tools/picbed/features/PicbedWorkspace/index.tsx`:

```tsx
'use client';

import { Icon } from '@lobehub/ui';
import { App, Button, Empty, Spin, Typography, Upload } from 'antd';
import { createStyles } from 'antd-style';
import { ImageUp } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { picbedService } from '@/services/picbed';

import ImageCard from './ImageCard';
import { usePicbedUpload } from './usePicbedUpload';

const useStyles = createStyles(({ css, token }) => ({
  dropZone: css`
    border: 2px dashed ${token.colorBorder};
    border-radius: ${token.borderRadiusLG}px;
    padding: 40px 24px;
    text-align: center;
    cursor: pointer;
    transition:
      border-color 0.2s,
      background 0.2s;

    &:hover,
    &.dragging {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  `,
  title: css`
    margin-bottom: 16px !important;
  `,
}));

interface ImageRecord {
  createdAt: Date;
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

const PicbedWorkspace = memo(() => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const { isDragging, uploadFiles, uploading } = usePicbedUpload();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadImages = useCallback(async () => {
    try {
      const list = await picbedService.list();
      setImages(list as ImageRecord[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const handleUpload = async (files: File[]) => {
    const results = await uploadFiles(files);
    if (results) loadImages();
  };

  const handleDelete = async (id: string) => {
    await picbedService.delete(id);
    setImages((prev) => prev.filter((img) => img.id !== id));
    message.success(t('picbed.delete'));
  };

  const handleFileSelect = (file: File) => {
    handleUpload([file]);
    return false; // prevent antd auto upload
  };

  return (
    <Flexbox gap={24}>
      <Typography.Title className={styles.title} level={4}>
        {t('picbed.title')}
      </Typography.Title>

      <Upload.Dragger
        accept={'image/*'}
        beforeUpload={handleFileSelect}
        className={cx(styles.dropZone, isDragging && 'dragging')}
        showUploadList={false}
      >
        <Spin spinning={uploading}>
          <Flexbox align={'center'} gap={8}>
            <Icon icon={ImageUp} size={32} />
            <Typography.Text type={'secondary'}>{t('picbed.upload')}</Typography.Text>
            <Typography.Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('picbed.dragTip')}
            </Typography.Text>
          </Flexbox>
        </Spin>
      </Upload.Dragger>

      {loading ? (
        <Flexbox align={'center'} justify={'center'} padding={40}>
          <Spin />
        </Flexbox>
      ) : images.length === 0 ? (
        <Empty description={t('picbed.empty')} />
      ) : (
        <div className={styles.grid}>
          {images.map((img) => (
            <ImageCard
              id={img.id}
              key={img.id}
              name={img.name}
              onDelete={handleDelete}
              url={img.url}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

export default PicbedWorkspace;
```

**Step 2: Commit**

```bash
git add src/app/[variants]/\(main\)/tools/picbed/features/PicbedWorkspace/
git commit -m "feat: add PicbedWorkspace component"
```

---

## Task 13: Picbed route page

**Files:**

- Create: `src/app/[variants]/(main)/tools/picbed/page.tsx`

**Step 1: Create picbed page**

Create `src/app/[variants]/(main)/tools/picbed/page.tsx`:

```tsx
import { Suspense } from 'react';

import PicbedWorkspace from './features/PicbedWorkspace';

const PicbedPage = () => {
  return (
    <Suspense>
      <PicbedWorkspace />
    </Suspense>
  );
};

PicbedPage.displayName = 'PicbedPage';

export default PicbedPage;
```

**Step 2: Commit**

```bash
git add src/app/[variants]/\(main\)/tools/picbed/page.tsx
git commit -m "feat: add picbed page route"
```

---

## Task 14: Type-check

Run type checking across the whole project:

```bash
bun run type-check
```

Fix any type errors before proceeding. Common issues:

- `PicbedModel` import path in router (uses `@/database/models/picbed` alias)
- tRPC client type inference — check `lambdaClient.picbed` is visible
- `usePicbedUpload` return type mismatch

---

## Task 15: Final commit and push + tag

```bash
git push origin HEAD:main
git tag -d v1.15.5 2> /dev/null
git push origin :refs/tags/v1.15.5 2> /dev/null
true
git tag v1.15.5 && git push origin v1.15.5
```

This triggers the Docker build.

---

## Notes

- **No snapshot file** created for migration 41 — if a future developer needs to run `db:generate`, they must first run `db:push` against a live DB to sync, or manually create the snapshot. Document this in the migration file header comment.
- **Client mode**: URLs from `uploadService` in client mode are `client-s3://hash` — not public. The Picbed URL display will show this. A future improvement could detect client mode and warn the user.
- **S3 public URL**: `metadata.path` is the S3 key/path. The full public URL is constructed by the frontend using `S3_PUBLIC_DOMAIN` env. If the existing chat module already resolves this, check how `fileUrl` is built in `src/store/file/slices/upload/action.ts` and apply the same logic in `picbedService`.

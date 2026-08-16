export type DallEImageQuality = 'standard' | 'hd';
export type DallEImageStyle = 'vivid' | 'natural';
export type DallEImageSize = '1792x1024' | '1024x1024' | '1024x1792';

export interface DallEImageItem {
  imageId?: string;
  previewUrl?: string;
  prompt: string;
  // Legacy DALL·E-only fields — optional now that the Image tool derives its
  // parameters from the configured image model. Kept so previously-stored
  // messages still type-check.
  quality?: DallEImageQuality;
  size?: DallEImageSize;
  style?: DallEImageStyle;
  /**
   * The async generation task backing this item. Persisted the moment the
   * task is created so a reload/navigation can resume or adopt the finished
   * result instead of orphaning it (and so Retry never re-bills a generation
   * that actually succeeded server-side).
   */
  taskId?: string;
}

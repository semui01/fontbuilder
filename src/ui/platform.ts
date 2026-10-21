import { downloadBlob } from './dom';

/*
 * Where the app runs. Normally it is an ordinary web page. It can also run as
 * a published claude.ai Artifact, where the viewer blocks direct downloads and
 * print dialogs; files are offered through the viewer's `downloads`
 * capability instead, which accepts only some file types.
 */

interface DownloadsCapability {
  save(request: { filename: string; data: Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}

interface ArtifactHost {
  use(name: 'downloads'): Promise<DownloadsCapability | null>;
}

const host = (window as unknown as { claude?: Partial<ArtifactHost> }).claude;

/** True inside a claude.ai Artifact viewer. */
export const inArtifact = typeof host?.use === 'function';

/** File types the Artifact viewer lets a page save. */
const ARTIFACT_EXTENSIONS = new Set(
  'gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip'.split(' '),
);

// Ask for the capability right away so it is ready by the time someone clicks.
const downloads: Promise<DownloadsCapability | null> = inArtifact
  ? (host as ArtifactHost).use('downloads').catch(() => null)
  : Promise.resolve(null);

export const canPrint = !inArtifact;

/** Whether `saveFile` can hand over a file with this extension as it is. */
export function canSaveExtension(ext: string): boolean {
  return !inArtifact || ARTIFACT_EXTENSIONS.has(ext.toLowerCase());
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable' | 'failed';

/** Offers a file to the person. In an Artifact they confirm it first and may decline. */
export async function saveFile(data: Blob, filename: string): Promise<SaveOutcome> {
  if (!inArtifact) {
    downloadBlob(data, filename);
    return 'saved';
  }
  const capability = await downloads;
  if (!capability) return 'unavailable';
  try {
    await capability.save({ filename, data });
    return 'saved';
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'declined') return 'declined';
    if (code === 'rate_limited') return 'failed';
    return code === 'bad_request' || code === 'too_large' ? 'failed' : 'unavailable';
  }
}

/** A short message for a save that didn't happen; empty when it did. */
export function describeOutcome(outcome: SaveOutcome): string {
  switch (outcome) {
    case 'saved':
      return '';
    case 'declined':
      return 'Download cancelled.';
    case 'unavailable':
      return "This view can't save files. Try opening the page in a web browser.";
    default:
      return "The download didn't go through. Wait a moment and try again.";
  }
}

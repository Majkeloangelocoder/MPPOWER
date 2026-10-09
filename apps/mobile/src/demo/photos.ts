import type { PhotoPose } from '@mp-power/core';
import { addPhoto } from './server';

/** Zamiennik src/lib/photos.ts w trybie demo: zdjęcie zostaje w przeglądarce, nic nie jest wysyłane. */
export async function uploadProgressPhoto(pose: PhotoPose, uri: string): Promise<void> {
  addPhoto(pose, uri);
}

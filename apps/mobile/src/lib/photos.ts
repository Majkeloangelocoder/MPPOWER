import type { PhotoPose } from '@mp-power/core';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';

/**
 * Zdjęcie sylwetki: plik do prywatnego kubełka body-photos (<user_id>/<uuid>.jpg), metadane do progress_photos.
 * Oba zapisy przechodzą przez RLS i wymagają zgody 'body_images' (zapisywanej wcześniej przez API profilu).
 */
export async function uploadProgressPhoto(pose: PhotoPose, uri: string, mimeType = 'image/jpeg'): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId: string | undefined = data.session?.user.id;
  if (!userId) throw new Error('Zaloguj się ponownie.');
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/${Crypto.randomUUID()}.${ext}`;
  const body = await (await fetch(uri)).arrayBuffer();
  const upload = await supabase.storage.from('body-photos').upload(path, body, { contentType: mimeType });
  if (upload.error) throw upload.error;
  const insert = await supabase.from('progress_photos').insert({ user_id: userId, pose, storage_path: path });
  if (insert.error) throw insert.error;
}

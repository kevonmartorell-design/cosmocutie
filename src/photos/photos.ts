import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { FULL, THUMB, base64ToBytes, resizeTarget } from './resize-policy';

const BUCKET = 'formula-photos';

/**
 * Compression targets and the resize decision live in `resize-policy.ts` —
 * they are pure arithmetic and are tested there, without the native modules.
 *
 * The short version: resize on the DEVICE before upload, so it saves the
 * client's bandwidth as well as our storage and the full-resolution original
 * never leaves their phone. PLAN.md asks for this decided before the storage
 * bill arrives rather than after.
 */

export type Stage = Database['public']['Enums']['photo_stage'];

export type Photo = {
  id: string;
  stage: Stage;
  storage_path: string;
  thumbnail_path: string | null;
  consented_to_publish: boolean;
  captured_at: string | null;
  /** Signed, short-lived. Storage is private; there is no public URL. */
  url: string | null;
  thumbUrl: string | null;
};

export type PickResult =
  | { status: 'picked'; uri: string; width: number; height: number }
  | { status: 'cancelled' }
  | { status: 'denied'; message: string };

/**
 * Camera or library, with the permission ask handled.
 *
 * Permission is requested at the moment of use rather than at launch: asking
 * for a stylist's camera before they have any reason to give it is how you get
 * a "no" that is then permanent.
 */
export async function pickPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) {
    return {
      status: 'denied',
      message:
        source === 'camera'
          ? 'Camera access is off. Turn it on in Settings to photograph results.'
          : 'Photo access is off. Turn it on in Settings to attach existing photos.',
    };
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // No in-picker editing: cropping a colour result can cut out the very part
    // the stylist needs to reproduce later.
    allowsEditing: false,
    quality: 1, // Compress deliberately below, not here.
    exif: false, // EXIF carries GPS. A client's location is not ours to store.
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.length) return { status: 'cancelled' };
  const asset = result.assets[0];
  // Source dimensions come back with the asset and are needed downstream: the
  // resize has to know which edge is the long one, and whether the image is
  // already small enough to leave alone.
  return { status: 'picked', uri: asset.uri, width: asset.width, height: asset.height };
}

/** Resize per the policy, then hand back bytes ready to upload. */
async function resize(
  uri: string,
  source: { width: number; height: number },
  spec: { maxEdge: number; quality: number },
) {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);

  const target = resizeTarget(source, spec.maxEdge);
  if (target) context.resize(target);

  const image = await context.renderAsync();
  const out = await image.saveAsync({
    compress: spec.quality,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });

  return {
    bytes: base64ToBytes(out.base64 ?? ''),
    width: out.width,
    height: out.height,
  };
}

export type UploadResult = { status: 'saved'; photoId: string } | { status: 'error'; message: string };

/**
 * Compress, upload, and record — in that order, and the order matters.
 *
 * The object and the database row live in different subsystems and nothing
 * makes them agree by itself. Uploading first means a failed `record` leaves an
 * orphaned file, which is wasted bytes; recording first would leave a row
 * pointing at a file that does not exist, which is a broken gallery. Wasted
 * bytes are the better failure, and the orphan is cleaned up below.
 */
export async function uploadPhoto(
  appointmentId: string,
  tenantId: string,
  stage: Stage,
  picked: { uri: string; width: number; height: number },
  formulaId?: string,
): Promise<UploadResult> {
  try {
    const [full, thumb] = await Promise.all([
      resize(picked.uri, picked, FULL),
      resize(picked.uri, picked, THUMB),
    ]);

    // The path shape is enforced on the database side too — a row may not point
    // outside its own tenant folder, so these must match.
    const base = `${tenantId}/${appointmentId}`;
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullPath = `${base}/${stage}-${stamp}.jpg`;
    const thumbPath = `${base}/${stage}-${stamp}-thumb.jpg`;

    const up = await supabase.storage
      .from(BUCKET)
      .upload(fullPath, full.bytes, { contentType: 'image/jpeg', upsert: false });
    if (up.error) return { status: 'error', message: up.error.message };

    const upThumb = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath, thumb.bytes, { contentType: 'image/jpeg', upsert: false });
    if (upThumb.error) {
      await supabase.storage.from(BUCKET).remove([fullPath]);
      return { status: 'error', message: upThumb.error.message };
    }

    const { data, error } = await supabase.rpc('record_formula_photo', {
      p_appointment_id: appointmentId,
      p_storage_path: fullPath,
      p_stage: stage,
      p_thumbnail_path: thumbPath,
      p_width: full.width,
      p_height: full.height,
      p_bytes: full.bytes.byteLength,
      p_formula_id: formulaId,
    });

    if (error) {
      // Nothing references these now, so they are pure waste. Remove them
      // rather than leaving the bucket to accumulate files no screen can show.
      await supabase.storage.from(BUCKET).remove([fullPath, thumbPath]);
      return { status: 'error', message: error.message };
    }

    return { status: 'saved', photoId: data as string };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : 'Could not save that photo.' };
  }
}

/**
 * The gallery for one appointment.
 *
 * URLs are signed and short-lived because the bucket is private. There is no
 * public URL to fall back on, deliberately: these are photographs of an
 * identifiable person attached to a named appointment.
 */
export async function listPhotos(appointmentId: string): Promise<Photo[]> {
  const { data, error } = await supabase
    .from('formula_photos')
    .select('id, stage, storage_path, thumbnail_path, consented_to_publish, captured_at')
    .eq('appointment_id', appointmentId)
    .order('captured_at', { ascending: true });

  if (error || !data?.length) return [];

  const paths = data.flatMap((p) => [p.storage_path, p.thumbnail_path].filter(Boolean) as string[]);
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
  const urlFor = (path: string | null) =>
    (path && signed?.find((s) => s.path === path)?.signedUrl) || null;

  return data.map((p) => ({
    ...p,
    url: urlFor(p.storage_path),
    thumbUrl: urlFor(p.thumbnail_path) ?? urlFor(p.storage_path),
  }));
}

/** Both objects and the row. A half-deleted photo is worse than either. */
export async function deletePhoto(photo: Pick<Photo, 'id' | 'storage_path' | 'thumbnail_path'>) {
  const paths = [photo.storage_path, photo.thumbnail_path].filter(Boolean) as string[];
  await supabase.storage.from(BUCKET).remove(paths);
  await supabase.from('formula_photos').delete().eq('id', photo.id);
}

/**
 * Publish consent, per photo.
 *
 * Goes through the RPC rather than a direct update so the boolean and its
 * timestamps cannot drift apart, and so a revocation is always stamped.
 */
export async function setPublishConsent(photoId: string, consented: boolean) {
  return supabase.rpc('set_photo_publish_consent', {
    p_photo_id: photoId,
    p_consented: consented,
  });
}

import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CCButton } from '@/components/cc-button';
import { CCModal } from '@/components/cc-modal';
import { GlassCard } from '@/components/glass-card';
import { alpha, radius, spacing, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

import {
  deletePhoto,
  listPhotos,
  pickPhoto,
  setPublishConsent,
  uploadPhoto,
  type Photo,
  type Stage,
} from './photos';

const STAGES: { key: Stage; label: string }[] = [
  { key: 'before', label: 'Before' },
  { key: 'processing', label: 'Processing' },
  { key: 'after', label: 'After' },
];

/**
 * Before / processing / after gallery for one appointment.
 *
 * Photos attach to the APPOINTMENT, not the client, for the same reason
 * formulas do: a child's colour history must not mix into the guardian's
 * record, and "last time" returning the wrong person's result is unsafe on a
 * chemical service.
 */
export function PhotoGallery({
  appointmentId,
  tenantId,
}: {
  appointmentId: string;
  tenantId: string;
}) {
  const { theme } = useTheme();
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [stage, setStage] = useState<Stage>('before');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Photo | null>(null);

  const load = useCallback(async () => {
    setPhotos(await listPhotos(appointmentId));
  }, [appointmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (source: 'camera' | 'library') => {
    setError(null);
    const picked = await pickPhoto(source);
    if (picked.status === 'denied') return setError(picked.message);
    if (picked.status !== 'picked') return;

    setBusy(true);
    const result = await uploadPhoto(appointmentId, tenantId, stage, picked);
    setBusy(false);
    if (result.status === 'error') return setError(result.message);
    await load();
  };

  const toggleConsent = async (photo: Photo) => {
    const next = !photo.consented_to_publish;
    // Optimistic: the toggle should feel instant, and a failure re-reads below.
    setPhotos((ps) => ps?.map((p) => (p.id === photo.id ? { ...p, consented_to_publish: next } : p)) ?? null);
    setOpen((p) => (p && p.id === photo.id ? { ...p, consented_to_publish: next } : p));
    const { error: err } = await setPublishConsent(photo.id, next);
    if (err) {
      setError(err.message);
      await load();
    }
  };

  const remove = async (photo: Photo) => {
    setOpen(null);
    setBusy(true);
    await deletePhoto(photo);
    setBusy(false);
    await load();
  };

  const shown = (photos ?? []).filter((p) => p.stage === stage);

  return (
    <>
      <Text style={[typography.label, { color: theme.textMuted }]}>PHOTOS</Text>
      <GlassCard rounded="xl">
        <View style={styles.card}>
          {/* Which stage the next photo belongs to. */}
          <View style={styles.stages}>
            {STAGES.map((s) => {
              const active = s.key === stage;
              const count = (photos ?? []).filter((p) => p.stage === s.key).length;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => setStage(s.key)}
                  style={[
                    styles.stage,
                    {
                      backgroundColor: active ? alpha(theme.primary, 0.18) : theme.glass.fallbackSurface,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}>
                  <Text style={[typography.caption, { color: active ? theme.primary : theme.textMuted }]}>
                    {s.label}
                    {count > 0 ? ` · ${count}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {photos === null ? (
            <ActivityIndicator color={theme.primary} />
          ) : shown.length === 0 ? (
            <Text style={[typography.caption, { color: theme.textMuted }]}>
              No {stage} photos yet.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {shown.map((p) => (
                <Pressable key={p.id} onPress={() => setOpen(p)}>
                  <Image
                    source={{ uri: p.thumbUrl ?? undefined }}
                    style={styles.thumb}
                    contentFit="cover"
                    transition={150}
                  />
                  {p.consented_to_publish ? (
                    <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                      <Text style={[typography.caption, { color: '#fff', fontSize: 10 }]}>shared</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <CCButton
              label={busy ? 'Saving…' : 'Take photo'}
              variant="primary"
              disabled={busy}
              onPress={() => add('camera')}
            />
            <CCButton
              label="Choose"
              variant="secondary"
              disabled={busy}
              onPress={() => add('library')}
            />
          </View>

          <Text style={[typography.caption, { color: theme.textMuted }]}>
            Photos stay private to your chair. Nobody else at the salon can see them.
          </Text>

          {error ? <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text> : null}
        </View>
      </GlassCard>

      {/* One photo, full size, with the two things you can do to it. */}
      <CCModal visible={open !== null} title="Photo" onDismiss={() => setOpen(null)}>
        {open ? (
          <View style={styles.card}>
            <Image source={{ uri: open.url ?? undefined }} style={styles.full} contentFit="contain" />

            <Text style={[typography.caption, { color: theme.textMuted }]}>
              {open.consented_to_publish
                ? 'Your client agreed this can be shared publicly. Tap to withdraw.'
                : 'Private to this record. Only share it if your client has said yes.'}
            </Text>
            <CCButton
              label={open.consented_to_publish ? 'Withdraw sharing consent' : 'Client agreed to share'}
              variant={open.consented_to_publish ? 'secondary' : 'primary'}
              fullWidth
              onPress={() => toggleConsent(open)}
            />
            <CCButton
              label="Delete photo"
              variant="danger"
              fullWidth
              onPress={() => remove(open)}
            />
            <CCButton label="Close" variant="ghost" fullWidth onPress={() => setOpen(null)} />
          </View>
        ) : null}
      </CCModal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  stages: { flexDirection: 'row', gap: spacing.sm },
  stage: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  badge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  full: { width: '100%', height: 320, borderRadius: radius.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
});

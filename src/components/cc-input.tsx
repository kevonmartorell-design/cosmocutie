import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { alpha, radius, spacing, typography } from '@/constants/theme';
import { useTheme } from '@/theme/theme-provider';

type CCInputProps = TextInputProps & {
  label?: string;
  /** Error text. Presence of this also drives the error styling. */
  error?: string;
  hint?: string;
};

export function CCInput({ label, error, hint, style, onFocus, onBlur, ...rest }: CCInputProps) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? theme.danger
    : focused
      ? theme.primary
      : theme.border;

  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text style={[typography.label, { color: theme.textMuted }]}>{label}</Text>
      ) : null}

      <TextInput
        style={[
          typography.body,
          styles.input,
          {
            color: theme.text,
            backgroundColor: alpha(theme.name === 'dark' ? '#000000' : '#FFFFFF', 0.35),
            borderColor,
            // Focus ring rather than a jarring colour swap.
            borderWidth: focused || error ? 2 : 1,
          },
          style,
        ]}
        placeholderTextColor={theme.textMuted}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />

      {error ? (
        <Text style={[typography.caption, { color: theme.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[typography.caption, { color: theme.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs + 2,
  },
  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    minHeight: 48,
  },
});

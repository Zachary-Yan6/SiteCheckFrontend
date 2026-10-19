import { Pressable, StyleSheet, Text } from 'react-native';

/** Rounded filter button used by the manager screens. */
export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected && styles.chipSelected, disabled && !selected && styles.chipDisabled]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: '#bdbdbd', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipSelected: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 14, color: '#424242' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
});

import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, NetworkError } from '@/api/client';
import { useAuth } from '@/auth/authStore';

/** Same limits as the backend's RegisterRequest, checked here so the user gets a clear message. */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const register = useAuth((state) => state.register);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    const problem = validate(fullName, email, password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(email.trim(), password, fullName.trim());
      // No navigation needed: the root layout's guards switch to the home screen.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const canSubmit = fullName.trim() !== '' && email.trim() !== '' && password !== '' && confirm !== '' && !busy;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>
            New accounts are inspectors. Your manager adds you to your sites.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={fullName}
            onChangeText={setFullName}
            autoComplete="name"
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            placeholder={`Password (at least ${MIN_PASSWORD} characters)`}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
            editable={!busy}
            onSubmitEditing={canSubmit ? onSubmit : undefined}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create account</Text>}
          </Pressable>

          <Link href="/login" replace style={styles.link}>
            Already have an account? Log in
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function validate(fullName: string, email: string, password: string, confirm: string): string | null {
  if (fullName.trim().length > 100) return 'Name must be 100 characters or fewer.';
  if (!EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email address.';
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `Password must be ${MAX_PASSWORD} characters or fewer.`;
  if (password !== confirm) return "Passwords don't match.";
  return null;
}

function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'No connection. Creating an account needs signal - try again where you have coverage.';
  if (e instanceof ApiError && e.status === 409) return 'An account with this email already exists. Try logging in.';
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 15, color: '#555', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: '#c62828' },
  button: {
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#1565c0', fontSize: 15, textAlign: 'center', marginTop: 8 },
});

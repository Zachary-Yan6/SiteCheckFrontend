import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, NetworkError } from '@/api/client';
import { useAuth } from '@/auth/authStore';

export default function LoginScreen() {
  const login = useAuth((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      // No navigation needed: the root layout's guards switch to the home screen.
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const canSubmit = email.trim() !== '' && password !== '' && !busy;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>SiteCheck</Text>
        <Text style={styles.subtitle}>Log in once with signal - after that, inspections work offline.</Text>

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
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          editable={!busy}
          onSubmitEditing={canSubmit ? onSubmit : undefined}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={!canSubmit}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log in</Text>}
        </Pressable>

        <Link href="/register" replace style={styles.link}>
          No account? Create one
        </Link>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'No connection. Logging in needs signal - try again where you have coverage.';
  if (e instanceof ApiError && e.status === 401) return 'Wrong email or password.';
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
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

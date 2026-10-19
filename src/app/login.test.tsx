import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, NetworkError } from '@/api/client';
import { useAuth } from '@/auth/authStore';

import LoginScreen from './login';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/db/cacheRepository', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));

const initialAuth = useAuth.getState();
const login = jest.fn<(email: string, password: string) => Promise<void>>();

async function fillIn(email: string, password: string) {
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('Password'), password);
}

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ ...initialAuth, status: 'signedOut', login }, true);
    login.mockResolvedValue();
  });

  it('logs in with the trimmed email once both fields are filled', async () => {
    await render(<LoginScreen />);
    expect(screen.getByText('Log in')).toBeDisabled();

    await fillIn('  aoife.murphy@sitecheck.demo ', 'Password123!');
    await fireEvent.press(screen.getByText('Log in'));

    expect(login).toHaveBeenCalledWith('aoife.murphy@sitecheck.demo', 'Password123!');
  });

  it('can submit from the keyboard', async () => {
    await render(<LoginScreen />);
    await fillIn('aoife.murphy@sitecheck.demo', 'Password123!');
    await fireEvent(screen.getByPlaceholderText('Password'), 'submitEditing');
    expect(login).toHaveBeenCalled();
  });

  it.each([
    [new NetworkError(), 'No connection. Logging in needs signal - try again where you have coverage.'],
    [new ApiError(401, 'Bad credentials'), 'Wrong email or password.'],
    [new ApiError(500, 'Database unavailable'), 'Database unavailable'],
    [new Error('boom'), 'Something went wrong. Please try again.'],
  ])('explains a failed login (%p)', async (error, message) => {
    login.mockRejectedValueOnce(error);
    await render(<LoginScreen />);
    await fillIn('aoife.murphy@sitecheck.demo', 'wrong');

    await fireEvent.press(screen.getByText('Log in'));

    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.getByText('Log in')).toBeEnabled(); // can try again
  });

  it('links to sign-up', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByText('No account? Create one'));
    expect(router.replace).toHaveBeenCalledWith('/register');
  });
});

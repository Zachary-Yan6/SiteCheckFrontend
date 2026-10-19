import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ApiError, NetworkError } from '@/api/client';
import { useAuth } from '@/auth/authStore';

import RegisterScreen from './register';

jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
jest.mock('@/notifications/pushNotifications', () => ({}));
jest.mock('@/db/cacheRepository', () => ({}));
jest.mock('@/sync/syncStore', () => ({}));

const initialAuth = useAuth.getState();
const register = jest.fn<(email: string, password: string, fullName: string) => Promise<void>>();

interface Form {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

async function fillIn({ name = 'New Person', email = 'new@sitecheck.demo', password = 'Password123!', confirm }: Form = {}) {
  await fireEvent.changeText(screen.getByPlaceholderText('Full name'), name);
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('Password (at least 8 characters)'), password);
  await fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), confirm ?? password);
}

/** The title says "Create account" too; the button comes after it. */
const createAccount = () => fireEvent.press(screen.getAllByText('Create account').at(-1)!);

describe('RegisterScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuth.setState({ ...initialAuth, status: 'signedOut', register }, true);
    register.mockResolvedValue();
  });

  it('creates the account with trimmed name and email', async () => {
    await render(<RegisterScreen />);
    await fillIn({ name: ' New Person ', email: ' new@sitecheck.demo ' });

    await fireEvent(screen.getByPlaceholderText('Confirm password'), 'submitEditing');

    expect(register).toHaveBeenCalledWith('new@sitecheck.demo', 'Password123!', 'New Person');
  });

  it.each([
    [{ name: 'x'.repeat(101) }, 'Name must be 100 characters or fewer.'],
    [{ email: 'not-an-email' }, 'Enter a valid email address.'],
    [{ password: 'short' }, 'Password must be at least 8 characters.'],
    [{ password: 'x'.repeat(73) }, 'Password must be 72 characters or fewer.'],
    [{ confirm: 'Password123?' }, "Passwords don't match."],
  ])('checks the input before sending it (%p)', async (input, message) => {
    await render(<RegisterScreen />);
    await fillIn(input);

    await createAccount();

    expect(screen.getByText(message)).toBeOnTheScreen();
    expect(register).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(409, 'taken'), 'An account with this email already exists. Try logging in.'],
    [new NetworkError(), 'No connection. Creating an account needs signal - try again where you have coverage.'],
    [new ApiError(400, 'Email must be a well-formed email address'), 'Email must be a well-formed email address'],
    [new Error('boom'), 'Something went wrong. Please try again.'],
  ])('explains a failed sign-up (%p)', async (error, message) => {
    register.mockRejectedValueOnce(error);
    await render(<RegisterScreen />);
    await fillIn();

    await createAccount();

    expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it('links back to login', async () => {
    await render(<RegisterScreen />);
    await fireEvent.press(screen.getByText('Already have an account? Log in'));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });
});

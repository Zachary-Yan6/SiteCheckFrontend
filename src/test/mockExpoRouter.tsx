/**
 * Test stand-in for expo-router, so a screen can be rendered on its own:
 *   jest.mock('expo-router', () => require('@/test/mockExpoRouter'));
 *
 * - `router` methods are jest.fn()s, so tests can check where a screen navigates to.
 * - `setSearchParams()` sets what `useLocalSearchParams()` returns, like opening /site/3.
 * - `useFocusEffect` runs like a useEffect: the screen counts as focused while mounted.
 * - `<Stack.Screen name=...>` renders its name as text, so the root layout test can see which
 *   screens a `<Stack.Protected guard>` lets through.
 */
import { jest } from '@jest/globals';
import { useEffect, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

export const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
};

let searchParams: Record<string, string> = {};

export function setSearchParams(params: Record<string, string>): void {
  searchParams = params;
}

export function useLocalSearchParams<T>(): T {
  return searchParams as T;
}

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(effect, [effect]);
}

/** Stand-in for `<Link>`: a pressable text that calls router.push / router.replace. */
export function Link({ href, replace, asChild, children }: {
  href: string;
  replace?: boolean;
  asChild?: boolean;
  children: ReactNode;
}) {
  const go = () => (replace ? router.replace(href) : router.push(href));
  if (asChild) return <Pressable onPress={go}>{children}</Pressable>;
  return <Text role="link" onPress={go}>{children}</Text>;
}

function StackScreen({ name, options }: { name?: string; options?: { headerRight?: () => ReactNode } }) {
  // A screen's own <Stack.Screen options> has no name; render its header button so tests can press it.
  if (!name) return <>{options?.headerRight?.()}</>;
  return <Text>{`screen:${name}`}</Text>;
}

function StackProtected({ guard, children }: { guard: boolean; children: ReactNode }) {
  return guard ? <>{children}</> : null;
}

export function Stack({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
Stack.Screen = StackScreen;
Stack.Protected = StackProtected;

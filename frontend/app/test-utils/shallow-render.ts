// A small shallow renderer for vitest's node environment, which has no DOM.
// A test swaps React's hooks for `fakeHooks`:
//
//   vi.mock('react', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('react')>()),
//     ...(await import('@/app/test-utils/shallow-render')).fakeHooks,
//   }));
//
// then calls a component through mount() and inspects the elements it returns.
// State updates apply on the next render(), effects run after each render, and
// child components are not rendered (mount one to render it as well).
// This module must not import React at runtime: the mock above loads it.
import type { ReactElement, ReactNode } from 'react';

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | void };
type Props = Record<string, unknown> & { children?: ReactNode };
export type TestElement = ReactElement<Props>;

let slots: Slot[] | null = null;
let cursor = 0;
let effects: (() => void)[] = [];

function nextSlot(): Slot {
  if (!slots) throw new Error('A hook ran outside mount().render()');
  slots[cursor] ??= {};
  return slots[cursor++];
}

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
  return !previous || !next || previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}

export const fakeHooks = {
  useState<T>(initial: T | (() => T)) {
    const slot = nextSlot();
    if (!('value' in slot)) slot.value = typeof initial === 'function' ? (initial as () => T)() : initial;
    const setState = (next: T | ((previous: T) => T)) => {
      slot.value = typeof next === 'function' ? (next as (previous: T) => T)(slot.value as T) : next;
    };
    return [slot.value as T, setState] as const;
  },
  useRef<T>(initial: T) {
    const slot = nextSlot();
    if (!('value' in slot)) slot.value = { current: initial };
    return slot.value as { current: T };
  },
  useMemo<T>(factory: () => T, deps?: readonly unknown[]) {
    const slot = nextSlot();
    if (depsChanged(slot.deps, deps)) {
      slot.value = factory();
      slot.deps = deps;
    }
    return slot.value as T;
  },
  useId() {
    const slot = nextSlot();
    if (!('value' in slot)) slot.value = `r${cursor}`;
    return slot.value as string;
  },
  useEffect(effect: () => (() => void) | void, deps?: readonly unknown[]) {
    const slot = nextSlot();
    if (!depsChanged(slot.deps, deps)) return;
    slot.deps = deps;
    effects.push(() => {
      if (typeof slot.cleanup === 'function') slot.cleanup();
      slot.cleanup = effect();
    });
  },
};

export function mount<P>(component: (props: P) => ReactNode, props: P) {
  const own: Slot[] = [];
  return {
    render(): ReactNode {
      const outer = { slots, cursor, effects };
      slots = own;
      cursor = 0;
      effects = [];
      try {
        const tree = component(props);
        for (const run of effects) run();
        return tree;
      } finally {
        ({ slots, cursor, effects } = outer);
      }
    },
  };
}

function isElement(value: unknown): value is TestElement {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

export function findAll(node: ReactNode, match: (element: TestElement) => boolean): TestElement[] {
  const found: TestElement[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isElement(value)) {
      if (match(value)) found.push(value);
      visit(value.props.children);
    }
  };
  visit(node);
  return found;
}

export function find(node: ReactNode, match: (element: TestElement) => boolean): TestElement {
  const [first] = findAll(node, match);
  if (!first) throw new Error('No element matched');
  return first;
}

/** The text a subtree would show, ignoring the markup around it. */
export function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isElement(node) ? textOf(node.props.children) : '';
}

/** The component a function-typed element renders, e.g. a file-local child component. */
export function componentNamed(name: string) {
  return (element: TestElement) => typeof element.type === 'function' && element.type.name === name;
}

// Named radio groups for the test DOM (components/ui/test-dom). After a
// change, React restores a controlled radio group by finding its other inputs
// from the top of the tree, the document, with
// querySelectorAll('input[name="…"][type="radio"]'). The test DOM's document
// has no querySelectorAll, so a test that clicks a radio with a name calls
// supportRadioGroups() first.
import { descendants, type FakeElement, type FakeNode } from '@/app/components/ui/test-dom';

const RADIO_GROUP = /^input\[name="((?:[^"\\]|\\.)*)"\]\[type="radio"\]$/;

type Queryable = { querySelectorAll?: (selector: string) => FakeElement[] };

export function supportRadioGroups() {
  const root = document as unknown as Queryable & FakeNode;
  if (root.querySelectorAll) return;
  root.querySelectorAll = (selector: string) => {
    const match = RADIO_GROUP.exec(selector);
    if (!match) throw new Error(`The test DOM's document does not support the selector "${selector}"`);
    const name = match[1].replace(/\\(.)/g, '$1');
    // React sets an input's name as a property, not an attribute.
    const nameOf = (element: FakeElement) => (element as FakeElement & { name?: string }).name ?? element.getAttribute('name');
    return descendants(root).filter((element) => element.tagName === 'INPUT' && element.type === 'radio' && nameOf(element) === name);
  };
}

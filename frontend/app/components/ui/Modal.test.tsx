import { cleanup, click, descendants, fire, getByName, render, settle, textOf, type FakeElement } from './test-dom';
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import Modal from './Modal';

afterEach(cleanup);

/** A list item whose Delete control disappears once its deletion is confirmed. */
function DeletableItem() {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <div>
      {deleted ? <p id="deleted-notice" tabIndex={-1}>Item deleted.</p> : <button type="button" onClick={() => setOpen(true)}>Delete item</button>}
      <Modal open={open} title="Delete item?" onClose={() => setOpen(false)} returnFocus={() => document.getElementById('deleted-notice')}>
        <button type="button" onClick={() => { setDeleted(true); setOpen(false); }}>Delete</button>
        <button type="button" onClick={() => setOpen(false)}>Keep item</button>
      </Modal>
    </div>
  );
}

/** Saves from its dialog, which stays busy until `saved` settles and then closes. */
function SavingItem({ saved }: { saved: Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Edit item</button>
      <Modal open={open} title="Edit item" busy={busy} onClose={() => setOpen(false)}>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void saved.then(() => { setBusy(false); setOpen(false); }); }}>Save</button>
      </Modal>
    </div>
  );
}

/** Asks before it drops unsaved changes, as the service editor does. */
function UnsavedItem() {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Edit item</button>
      <Modal open={open} title="Edit item" onClose={() => setAsking(true)}>
        {asking ? <p>Discard unsaved changes?</p> : null}
        <button type="button" onClick={() => setOpen(false)}>Discard changes</button>
      </Modal>
    </div>
  );
}

/** A confirm dialog whose Keep button stays enabled while it saves, as the settings pause dialog's did. */
function ConfirmItem({ saved }: { saved: Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Pause item</button>
      <Modal open={open} title="Pause item?" busy={busy} onClose={() => setOpen(false)}>
        <button type="button" onClick={() => setOpen(false)}>Keep item live</button>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void saved.then(() => { setBusy(false); setOpen(false); }); }}>Pause</button>
      </Modal>
    </div>
  );
}

/** Make showModal() do what Chrome's does: focus the first control and scroll to the top. */
function likeChrome(dialog: FakeElement, first: () => FakeElement) {
  const show = dialog.showModal.bind(dialog);
  dialog.showModal = () => { show(); first().focus(); dialog.scrollTop = 0; };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function openDialog(view: FakeElement, name = 'Delete item') {
  const opener = getByName(view, 'button', name);
  opener.focus();
  await click(opener);
  return opener;
}

const dialogOf = (view: FakeElement) => descendants(view).find((element) => element.tagName === 'DIALOG') as FakeElement;
const focused = () => document.activeElement as unknown as FakeElement;

/**
 * What Chrome does on a second Escape with no click in between: a cancel
 * event the page cannot cancel, then it closes the dialog itself. React
 * renders what the cancel changed before the close.
 */
async function closeNatively(dialog: FakeElement) {
  await act(async () => { fire(dialog, 'cancel', { bubbles: false, cancelable: false }); });
  await act(async () => { dialog.close(); fire(dialog, 'close', { bubbles: false }); });
  await settle();
}

describe('Modal focus on close', () => {
  it('returns focus to the control that opened it', async () => {
    const view = await render(<DeletableItem />);
    const opener = await openDialog(view);
    const keep = getByName(view, 'button', 'Keep item');
    keep.focus();
    await click(keep);

    expect(focused()).toBe(opener);
  });

  it('moves focus to returnFocus when the confirmed action removed the opener', async () => {
    const view = await render(<DeletableItem />);
    const opener = await openDialog(view);
    const confirm = getByName(view, 'button', 'Delete');
    confirm.focus();
    await click(confirm);

    expect(opener.isConnected).toBe(false);
    expect(focused().id).toBe('deleted-notice');
  });

  it('returns focus to the opener from the page body', async () => {
    const saved = deferred<void>();
    const view = await render(<SavingItem saved={saved.promise} />);
    const opener = await openDialog(view, 'Edit item');
    const save = getByName(view, 'button', 'Save');
    save.focus();
    await click(save);
    // Chrome drops focus to the body when the focused button is disabled.
    save.blur();

    await act(async () => saved.resolve());
    await settle();
    expect(focused()).toBe(opener);
  });

  it('leaves focus on another element the person moved to', async () => {
    const saved = deferred<void>();
    const view = await render(<><input aria-label="Search" /><SavingItem saved={saved.promise} /></>);
    await openDialog(view, 'Edit item');
    await click(getByName(view, 'button', 'Save'));
    // Say a second dialog opened on top, or the browser closed this one.
    const search = getByName(view, 'input', 'Search');
    search.focus();

    await act(async () => saved.resolve());
    await settle();
    expect(dialogOf(view).hasAttribute('open')).toBe(false);
    expect(focused()).toBe(search);
  });
});

describe('Modal closed by the browser', () => {
  it('shows a busy dialog again, so it stays up until the save ends', async () => {
    const saved = deferred<void>();
    const view = await render(<SavingItem saved={saved.promise} />);
    await openDialog(view, 'Edit item');
    await click(getByName(view, 'button', 'Save'));

    await closeNatively(dialogOf(view));
    expect(dialogOf(view).hasAttribute('open')).toBe(true);
    expect(getByName(view, 'button', 'Save').hasAttribute('disabled')).toBe(true);

    await act(async () => saved.resolve());
    await settle();
    expect(dialogOf(view).hasAttribute('open')).toBe(false);
  });

  it('shows the dialog again when the page keeps it open, say to ask about unsaved changes', async () => {
    const view = await render(<UnsavedItem />);
    await openDialog(view, 'Edit item');

    await closeNatively(dialogOf(view));
    expect(dialogOf(view).hasAttribute('open')).toBe(true);
    expect(textOf(dialogOf(view))).toContain('Discard unsaved changes?');

    await click(getByName(view, 'button', 'Discard changes'));
    expect(dialogOf(view).hasAttribute('open')).toBe(false);
  });

  it('puts focus and scroll back where Escape found them when it shows the dialog again', async () => {
    const view = await render(<UnsavedItem />);
    await openDialog(view, 'Edit item');
    const dialog = dialogOf(view);
    likeChrome(dialog, () => getByName(view, 'button', 'Close Edit item'));
    const discard = getByName(view, 'button', 'Discard changes');
    discard.focus();
    dialog.scrollTop = 347;

    await closeNatively(dialog);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(focused()).toBe(discard);
    expect(dialog.scrollTop).toBe(347);
  });

  it('focuses the dialog itself, not an enabled action, when focus had dropped to the page body', async () => {
    const saved = deferred<void>();
    const view = await render(<ConfirmItem saved={saved.promise} />);
    await openDialog(view, 'Pause item');
    const dialog = dialogOf(view);
    likeChrome(dialog, () => getByName(view, 'button', 'Keep item live'));
    const pause = getByName(view, 'button', 'Pause');
    pause.focus();
    await click(pause);
    // Chrome drops focus to the body when the focused button is disabled.
    pause.blur();

    await closeNatively(dialog);
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(focused()).toBe(dialog);

    await act(async () => saved.resolve());
    await settle();
  });

  it('stays closed once the page has closed it', async () => {
    const view = await render(<DeletableItem />);
    const opener = await openDialog(view);
    getByName(view, 'button', 'Keep item').focus();

    await closeNatively(dialogOf(view));
    expect(dialogOf(view).hasAttribute('open')).toBe(false);
    expect(focused()).toBe(opener);
  });
});

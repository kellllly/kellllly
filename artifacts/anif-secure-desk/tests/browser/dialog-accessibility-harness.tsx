import { createRoot, type Root } from 'react-dom/client';
import { useState } from 'react';
import { Modal } from '../../src/components/kit';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

export function mountDialog(title: string, description?: string) {
  root?.unmount();
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  root.render(
    <Modal title={title} description={description} onClose={() => undefined}>
      <p>Contenu de test.</p>
    </Modal>,
  );
}

type SimulatedVisualViewport = EventTarget & {
  width: number;
  height: number;
  offsetTop: number;
};

let simulatedVisualViewport: SimulatedVisualViewport | undefined;

function ScrollRestoreHarness() {
  const [open, setOpen] = useState(false);
  const close = () => {
    if (simulatedVisualViewport) {
      window.scrollTo(0, 0);
      simulatedVisualViewport.height = window.innerHeight;
      simulatedVisualViewport.dispatchEvent(new Event('resize'));
      simulatedVisualViewport.dispatchEvent(new Event('scroll'));
    }
    setOpen(false);
  };

  return <main style={{ minHeight: '2200px', paddingTop: '650px' }}>
    <div
      data-testid="scroll-region"
      style={{ height: '240px', overflow: 'auto', marginTop: '80px', border: '1px solid' }}
    >
      <div style={{ height: '350px' }} />
      <button data-testid="dialog-opener" onClick={() => setOpen(true)}>Ouvrir</button>
      <div style={{ height: '600px' }} />
    </div>
    {open && <Modal title="Dialogue de test mobile" onClose={close}>
      <input data-testid="dialog-input" autoFocus aria-label="Saisie" />
    </Modal>}
  </main>;
}

export function mountScrollRestoreDialog() {
  root?.unmount();
  container?.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  simulatedVisualViewport = Object.assign(new EventTarget(), {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0,
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: simulatedVisualViewport,
  });

  root.render(<ScrollRestoreHarness />);
}

export function setSimulatedKeyboardOpen(open: boolean) {
  if (!simulatedVisualViewport) throw new Error('Mount the scroll restoration harness first.');
  simulatedVisualViewport.height = open ? Math.max(320, window.innerHeight - 320) : window.innerHeight;
  simulatedVisualViewport.dispatchEvent(new Event('resize'));
  simulatedVisualViewport.dispatchEvent(new Event('scroll'));
}

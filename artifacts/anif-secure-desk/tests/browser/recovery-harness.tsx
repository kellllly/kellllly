import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore } from '../../src/lib/store';
import { SyncRecoveryActions } from '../../src/components/sync-recovery-actions';

function RecoveryPanel() {
  const { store, recovery } = useStore();
  return (
    <main>
      <div data-testid="canonical-ticket-title">{store.tickets[0]?.title}</div>
      <div data-testid="recovery-remote-version">{recovery?.remoteVersion ?? ''}</div>
      <div data-testid="recovered-local-edits">
        {recovery?.localEdits.map((edit) => edit.value).join('\n')}
      </div>
      <SyncRecoveryActions />
    </main>
  );
}

const userId = new URLSearchParams(window.location.search).get('uid') ?? 'missing-user-id';
createRoot(document.getElementById('root')!).render(
  <StoreProvider userId={userId}>
    <RecoveryPanel />
  </StoreProvider>,
);

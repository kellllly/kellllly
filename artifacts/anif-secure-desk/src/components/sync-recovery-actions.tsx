import { useState } from 'react';
import { useStore } from '@/lib/store';
import { choicesForRecoveryVersion, type ConflictChoices } from '@/lib/sync-recovery';

export function SyncRecoveryActions() {
  const { recovery, resumeConflict, acceptRemoteSnapshot } = useStore();
  const [selection, setSelection] = useState<{ version: number; choices: ConflictChoices }>(() => ({
    version: recovery?.remoteVersion ?? 0,
    choices: {},
  }));
  if (!recovery) return null;
  const choices = choicesForRecoveryVersion(recovery.remoteVersion, selection.version, selection.choices);
  const choose = (path: string, side: 'local' | 'remote') => {
    setSelection({ version: recovery.remoteVersion, choices: { ...choices, [path]: side } });
  };
  const complete = recovery.fields.every((field) => choices[field.path]);
  return <div className="space-y-3">
    {recovery.fields.length > 0 && <>
      <p className="font-semibold">Choisissez chaque valeur à conserver.</p>
      {recovery.fields.map((field) => <fieldset key={field.path} disabled={recovery.busy} className="min-w-0 rounded-lg border border-[#d39b90]/70 p-2">
        <legend className="break-words px-1 font-semibold">{field.label}</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {(['local', 'remote'] as const).map((side) => <label key={side} className="min-w-0 cursor-pointer rounded bg-white/40 p-2 dark:bg-black/10">
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name={`sync-${field.path}`} value={side}
                checked={choices[field.path] === side}
                onChange={() => choose(field.path, side)}
                className="focus-ring" />
              {side === 'local' ? 'Ma valeur' : 'Valeur distante'}
            </span>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px]">{field[side]}</pre>
          </label>)}
        </div>
      </fieldset>)}
    </>}
    <p>Les changements indépendants des deux versions seront conservés. Aucun choix n’est enregistré avant votre confirmation.</p>
    {!complete && <p>Choisissez une valeur pour chaque champ avant de confirmer.</p>}
    <div className="flex flex-wrap gap-2 pt-1">
      <button onClick={() => void resumeConflict(choices, recovery.remoteVersion)}
        disabled={recovery.busy || !complete}
        className="focus-ring rounded-lg border border-[#9e655d] bg-white/70 px-3 py-1.5 font-semibold disabled:opacity-60 dark:bg-black/10"
        data-testid="button-resume-sync">
        {recovery.busy ? 'Vérification…' : 'Confirmer et enregistrer la reprise'}
      </button>
      <button onClick={() => void resumeConflict()}
        disabled={recovery.busy}
        className="focus-ring rounded-lg px-3 py-1.5 underline underline-offset-2 disabled:opacity-60"
        data-testid="button-refresh-sync"
        hidden={recovery.fields.length === 0}>
        Réexaminer les conflits
      </button>
      <button onClick={acceptRemoteSnapshot} disabled={recovery.busy}
        className="focus-ring rounded-lg px-3 py-1.5 underline underline-offset-2 disabled:opacity-60"
        data-testid="button-discard-local-sync">
        Abandonner ma modification et continuer avec l’état distant
      </button>
    </div>
  </div>;
}

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { getItsmPeople } from '@workspace/api-client-react';
import { useStore } from '@/lib/store';
import { batches, collectUserIds, labelPeople } from '@/lib/people';
import { displayNameFor } from '@/lib/display-name';

/**
 * `person(text)` shows readable names in place of the Clerk IDs stored as
 * authors, requesters and actors. Until the names arrive (or if the lookup
 * fails) the text is shown unchanged, so nothing disappears.
 */
export function usePeople(extraIds: readonly string[] = []) {
  const { store } = useStore();
  const { user } = useUser();
  const extraKey = extraIds.join(',');
  const ids = useMemo(
    () => [...new Set([...collectUserIds([store.tickets, store.conversations, store.audit, store.kedb]), ...extraIds])].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.tickets, store.conversations, store.audit, store.kedb, extraKey],
  );
  const others = useMemo(() => ids.filter((id) => id !== user?.id), [ids, user?.id]);

  const { data } = useQuery({
    queryKey: ['itsm-people', others],
    enabled: others.length > 0,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async () => (await Promise.all(batches(others).map((chunk) => getItsmPeople({ ids: chunk.join(',') }))))
      .flatMap((page) => page.people),
  });

  const names = useMemo(() => {
    const map = new Map((data ?? []).map((person) => [person.userId, person.name]));
    if (user?.id) map.set(user.id, displayNameFor(user, user.id));
    return map;
  }, [data, user]);

  const person = useCallback((text: string | null | undefined) => labelPeople(text, names), [names]);
  return { person };
}

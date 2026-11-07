import { useUser } from '@clerk/react';
import { useStore } from '@/lib/store';
import { displayNameFor, firstNameFor } from '@/lib/display-name';

/** Readable name of the signed-in account; the Clerk ID stays the identity. */
export function useDisplayName() {
  const { user } = useUser();
  const { store } = useStore();
  return {
    name: displayNameFor(user, store.profile.name),
    firstName: firstNameFor(user, store.profile.name),
  };
}

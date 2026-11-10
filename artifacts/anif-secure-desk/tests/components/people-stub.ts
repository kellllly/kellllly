/** Stand-in for @/hooks/use-people: names are shown as stored (no Clerk lookup). */
export function usePeople() {
  return { person: (text: string | null | undefined) => text ?? '', names: new Map<string, string>() };
}

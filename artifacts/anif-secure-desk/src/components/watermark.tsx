import { useQuery } from '@tanstack/react-query';
import { getItsmSessionMarker } from '@workspace/api-client-react';
import { useNow } from '@/lib/store';
import { watermarkText } from '@/lib/watermark';
import { useWatermarkEnabled } from '@/lib/watermark-preference';

/**
 * Permanent semi-transparent watermark (cahier des charges, prévention des fuites):
 * account, network address and time to the second, to help attribute a photo of
 * the screen. It cannot prevent such a photo.
 */
export function Watermark({ name }: { name: string }) {
  const now = useNow(1000);
  const enabled = useWatermarkEnabled();
  const marker = useQuery({
    queryKey: ['itsm-session-marker'],
    queryFn: ({ signal }) => getItsmSessionMarker({ signal }),
    staleTime: 5 * 60_000,
    retry: false,
    enabled,
  });
  if (!enabled || !marker.data) return null;
  const text = watermarkText(name, marker.data.accountId, marker.data.ip, now);
  return <div aria-hidden="true" data-testid="watermark" className="pointer-events-none fixed inset-0 z-[70] select-none overflow-hidden print:block">
    <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-24 gap-y-20 opacity-[0.07] dark:opacity-[0.09]">
      {Array.from({ length: 60 }, (_, i) => <span key={i} className="whitespace-nowrap text-[13px] font-semibold text-foreground">{text}</span>)}
    </div>
  </div>;
}

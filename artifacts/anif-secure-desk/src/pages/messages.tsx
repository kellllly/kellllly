import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getItsmContacts, getItsmUserDirectory, getItsmWorkspaceVersion, deleteItsmMessage, editItsmMessage, postItsmTemporaryMessage } from '@workspace/api-client-react';
import { canEditMessage } from '@/lib/message-revision';
import { isClosedChannel, TEMPORARY_DURATIONS } from '@/lib/temporary-channel';
import { channelAccreditation, directPeer } from '@/lib/protected-channel';
import { checkAttachment, describeFile, formatSize, type AttachmentDescription } from '@/lib/attachments';
import { findSensitiveData } from '@/lib/sensitive-data';
import { SupportAssistant } from '@/components/support-assistant';
import { captureEnvironment, formatEnvironment, type RuntimeEnvironment } from '@/lib/runtime-environment';
import { Link, useLocation, useSearch } from 'wouter';
import { AlertTriangle, ArrowRight, Eye, EyeOff, Headphones, LockKeyhole, Paperclip, Plus, Send, TicketPlus, Timer, X } from 'lucide-react';
import { MESSAGE_TTL_OPTIONS, isExpiredMessage, remainingLabel } from '@/lib/ephemeral';
import { formatWAT } from '@/lib/itsm';
import { useNow, useStore } from '@/lib/store';
import { LEVEL_LABEL, isOpen, messageTime, nextTicketId, nowIso, priorityTone, statusTone, ticketSla, uid, unreadOf, withTicketEvent } from '@/lib/domain';
import { createIncidentFromMessage, filterSupportMessages, isConvertibleSupportMessage } from '@/lib/message-conversion';
import type { Conversation, Level, Message, SupportMessageFilter, Ticket } from '@/lib/types';
import { Avatar, Badge, Button, Field, Modal, PageIntro, SearchBox, Warning, inputCls, textareaCls } from '@/components/kit';
import { PriorityPreview, SlaBar } from '@/components/ticket-parts';
import { usePeople } from '@/hooks/use-people';

export default function MessagesPage() { const { person } = usePeople();
  const titleOf = (c: Conversation, me: string) => { const peer = directPeer(c, me); return peer ? `Échange bilatéral · ${person(peer)}` : c.title; };
  const { store, setStore, log, resync } = useStore();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [active, setActive] = useState(store.conversations[0]?.id || '');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Toutes');
  const [creating, setCreating] = useState(false);
  const [converting, setConverting] = useState<{ message: Message; conversation: Conversation } | null>(null);
  const [focusTicket, setFocusTicket] = useState('');
  const [focusMessageId, setFocusMessageId] = useState('');
  const [supportMessageFilter, setSupportMessageFilter] = useState<SupportMessageFilter>('all');
  const [supportMessageKind, setSupportMessageKind] = useState<'report' | 'instruction'>('report');
  const [ttlSeconds, setTtlSeconds] = useState(0);
  // Pending attachment: description only; warnings must be acknowledged before sending.
  const [attachment, setAttachment] = useState<(AttachmentDescription & { warnings: string[]; blocked: string | null }) | null>(null);
  const [attachmentAck, setAttachmentAck] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFile = async (file: File | undefined) => {
    setAttachmentAck(false);
    if (!file) { setAttachment(null); return; }
    const check = checkAttachment(file.name, file.type, file.size);
    const description = check.blocked ? { name: file.name, type: file.type, size: file.size, sha256: '' } : await describeFile(file);
    setAttachment({ ...description, ...check });
  };
  const attachmentReady = !attachment || (!attachment.blocked && (attachment.warnings.length === 0 || attachmentAck));
  const now = useNow(1000);
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const c = params.get('c');
    const messageId = params.get('m');
    if (c) { setActive(c); setFilter('Toutes'); setQuery(''); }
    if (messageId) setFocusMessageId(messageId);
    else if (c) setFocusMessageId('');
    if (c || messageId) setLocation('/messages', { replace: true });
  }, [search, setLocation]);

  const q = query.trim().toLowerCase();
  const filtered = store.conversations.filter(c => (filter === 'Toutes' || c.kind === filter) && (!q || `${titleOf(c, store.profile.name)} ${c.participants.map(person).join(' ')}`.toLowerCase().includes(q) || c.messages.some(m => m.body.toLowerCase().includes(q))));
  const convo = filtered.find(c => c.id === active) ?? filtered[0];
  const sourceMessageUnavailable = !!focusMessageId && !!convo && convo.id === active && !convo.messages.some(message => message.id === focusMessageId);
  const msgLen = convo?.messages.length ?? 0;

  useEffect(() => {
    if (!convo || !focusMessageId) return;
    const sourceMessage = convo.messages.find(message => message.id === focusMessageId);
    if (!sourceMessage) return;
    const element = messageListRef.current
      ? Array.from(messageListRef.current.querySelectorAll<HTMLElement>('[data-message-id]'))
        .find(message => message.dataset.messageId === focusMessageId)
      : undefined;
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [convo?.id, convo?.messages, focusMessageId]);

  useEffect(() => {
    if (!convo) return;
    setStore(s => ({ ...s, conversations: s.conversations.map(c => (c.id === convo.id && c.readCount !== c.messages.length ? { ...c, readCount: c.messages.length } : c)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo?.id, msgLen]);

  const linked = useMemo(() => (convo ? store.tickets.filter(t => t.conversationId === convo.id) : []), [store.tickets, convo]);
  const visibleMessages = convo
    ? convo.kind === 'Support'
      ? filterSupportMessages(convo.messages, supportMessageFilter)
      : convo.messages
    : [];
  const sideTicket = linked.find(t => t.id === focusTicket) ?? linked[0];
  const draft = convo ? store.drafts[convo.id] ?? '' : '';
  const setDraft = (v: string) => convo && setStore(s => ({ ...s, drafts: { ...s.drafts, [convo.id]: v } }));

  const isAuditor = store.profile.clearance.startsWith('N5');
  const closed = convo ? isClosedChannel(convo, now) : false;
  // Announcements are published by the Direction only (the API refuses other posts).
  const announcementReadOnly = convo?.kind === 'Annonce' && !store.profile.clearance.startsWith('N1');
  const readOnly = closed || announcementReadOnly;
  const [postError, setPostError] = useState('');
  const [replyTo, setReplyTo] = useState<{ conversationId: string; messageId: string } | null>(null);
  // Correction (5 minutes) or deletion by the author, through the API only: the workspace save refuses history rewrites.
  const [revising, setRevising] = useState<{ message: Message; conversationId: string; mode: 'edit' | 'delete' } | null>(null);
  const [revisionText, setRevisionText] = useState('');
  const [revisionError, setRevisionError] = useState('');
  const [revisionBusy, setRevisionBusy] = useState(false);
  const openRevision = (message: Message, conversationId: string, mode: 'edit' | 'delete') => { setRevising({ message, conversationId, mode }); setRevisionText(message.body); setRevisionError(''); };
  const submitRevision = () => {
    if (!revising || revisionBusy) return;
    const { message, conversationId, mode } = revising;
    setRevisionBusy(true); setRevisionError('');
    const request = mode === 'edit' ? editItsmMessage(conversationId, message.id, { body: revisionText.trim() }) : deleteItsmMessage(conversationId, message.id);
    void request.then(() => { setRevising(null); resync(); })
      .catch((error: unknown) => setRevisionError(error instanceof Error && error.message ? error.message : 'Modification non enregistrée. Réessayez.'))
      .finally(() => setRevisionBusy(false));
  };
  const send = (e: FormEvent) => {
    e.preventDefault(); if ((!draft.trim() && !attachment) || !convo || readOnly || !attachmentReady) return;
    if (isAuditor) {
      const id = convo.id; const body = draft.trim();
      setPostError('');
      void postItsmTemporaryMessage(id, { body }).then(() => {
        setStore(s => { const drafts = { ...s.drafts }; delete drafts[id]; return { ...s, drafts }; });
        resync();
      }).catch((error: unknown) => setPostError(error instanceof Error && error.message ? error.message : 'Message non enregistré. Réessayez.'));
      return;
    }
    const at = nowIso(); const id = convo.id;
    const isSupport = convo.kind === 'Support';
    const messageId = uid();
    setStore(s => {
      const drafts = { ...s.drafts }; delete drafts[id];
      const message: Message = {
        id: messageId, author: s.profile.name, body: draft.trim() || `Pièce jointe : ${attachment?.name ?? ''}`, time: '', at,
        ...(attachment ? { attachment: { name: attachment.name, type: attachment.type, size: attachment.size, sha256: attachment.sha256, warnings: attachment.warnings, ...(attachment.warnings.length ? { acknowledged: true } : {}) } } : {}),
        ...(isSupport ? { isInstruction: supportMessageKind === 'instruction' } : {}),
        ...(ttlSeconds > 0 ? { ttlSeconds } : {}),
        ...(replyTo?.conversationId === id ? { replyToId: replyTo.messageId } : {}),
      };
      return { ...s, drafts, conversations: s.conversations.map(c => (c.id === id ? { ...c, messages: [...c.messages, message] } : c)) };
    });
    setSupportMessageKind('report');
    setReplyTo(null);
    setAttachment(null); setAttachmentAck(false); if (fileInput.current) fileInput.current.value = '';
    log(`Message envoyé dans la conversation ${id}`, 'Messagerie');
  };
  const toggleRead = (c: Conversation) => {
    const unread = unreadOf(c) > 0;
    setStore(s => ({ ...s, conversations: s.conversations.map(x => (x.id === c.id ? { ...x, readCount: unread ? x.messages.length : Math.max(0, x.messages.length - 1) } : x)) }));
    log(`Conversation ${c.id} marquée comme ${unread ? 'lue' : 'non lue'}`, 'Messagerie');
  };
  const quoteOf = (id: string) => {
    const quoted = convo?.messages.find(x => x.id === id);
    if (!quoted) return { author: '', text: 'Message d’origine indisponible.' };
    const body = quoted.deleted ? 'Message supprimé par son auteur.' : isExpiredMessage(quoted, now) ? 'Message éphémère expiré.' : quoted.body;
    return { author: person(quoted.author), text: body.length > 140 ? `${body.slice(0, 140)}…` : body };
  };
  const replying = replyTo && convo && replyTo.conversationId === convo.id ? quoteOf(replyTo.messageId) : null;
  const [forwarding, setForwarding] = useState<{ message: Message; from: Conversation } | null>(null);
  const [forwardTarget, setForwardTarget] = useState('');
  // Same rules as the API: internal, non-temporary source; lasting, live message; target not open to external members.
  const canForward = (m: Message, c: Conversation) => !isAuditor && c.classification === 'Interne' && c.kind !== 'Temporaire' && !m.system && !m.deleted && !m.expiresAt && !m.ttlSeconds;
  const forwardTargets = forwarding ? store.conversations.filter(c => c.id !== forwarding.from.id && c.kind !== 'Temporaire' && (c.kind !== 'Annonce' || store.profile.clearance.startsWith('N1'))) : [];
  const forward = () => {
    if (!forwarding || !forwardTarget) return;
    const { message: m, from } = forwarding; const target = forwardTarget;
    setStore(s => ({ ...s, conversations: s.conversations.map(c => (c.id === target ? { ...c, messages: [...c.messages, { id: uid(), author: s.profile.name, body: m.body, time: '', at: nowIso(), forwardOf: { conversationId: from.id, messageId: m.id } }] } : c)) }));
    log(`Message transféré de la conversation ${from.id} vers ${target}`, 'Messagerie');
    setForwarding(null); setActive(target); setFilter('Toutes');
  };
  const MAX_PINS = 5;
  const pinnedIds = convo?.pinnedIds ?? [];
  const togglePin = (m: Message) => {
    if (!convo) return;
    const id = convo.id; const pinned = pinnedIds.includes(m.id);
    setStore(s => ({ ...s, conversations: s.conversations.map(c => {
      if (c.id !== id) return c;
      const { pinnedIds: current = [], ...rest } = c;
      const next = pinned ? current.filter(x => x !== m.id) : [...current, m.id];
      return { ...rest, ...(next.length ? { pinnedIds: next } : {}) };
    }) }));
    log(`Message ${pinned ? 'désépinglé' : 'épinglé'} dans la conversation ${id}`, 'Messagerie');
  };
  const ticketFor = (m: Message) => store.tickets.find(t => t.sourceMessageId === m.id || t.id === m.ticketId);

  return <div className="page-enter min-w-0"><Warning />
    <PageIntro kicker="MESSAGERIE · ESPACE PARTAGÉ" title="Échanges de travail" description="Retrouvez les conversations fictives du pilote et leurs informations de visibilité." />
    <div role="note" className="mb-4 rounded-xl border border-[#bfd0d1] bg-[#e8f0ef] px-4 py-3 text-[11px] leading-relaxed text-[#365456] dark:bg-[#24383b] dark:text-[#bdd3d1]"><strong>Messagerie simulée.</strong> Les conversations fictives sont partagées dans le pilote, mais aucun message n’est envoyé à une personne ni à un service externe.</div>
    <div className="panel grid min-h-[650px] min-w-0 overflow-hidden lg:grid-cols-[300px_1fr] 2xl:grid-cols-[300px_1fr_330px]">
      <aside className="min-w-0 border-b border-border lg:border-b-0 lg:border-r"><div className="p-4"><div className="mb-3 flex items-center justify-between"><div><div className="eyebrow">ESPACE DE TRAVAIL</div><h2 className="mt-1 text-[15px] font-semibold">Conversations</h2></div>{!isAuditor && <button data-testid="button-new-conversation" aria-label="Nouvelle conversation" onClick={() => setCreating(true)} className="focus-ring rounded-lg border border-border p-2 hover:bg-muted"><Plus size={16} /></button>}</div>
        <SearchBox testId="input-search-messages" value={query} onChange={setQuery} placeholder="Conversation ou contenu de message" />
        <div className="mt-3 flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden">{['Toutes', 'Annonce', 'Administratif', 'Support', 'Enquête', 'Direct', 'Temporaire', 'Groupe', 'Équipe', 'Comité'].map(f => <button key={f} data-testid={`filter-conv-${f}`} onClick={() => setFilter(f)} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{f}</button>)}</div></div>
        <div className="max-h-[440px] overflow-x-hidden overflow-y-auto lg:max-h-[600px]">{filtered.map(c => { const last = c.messages.at(-1); const u = unreadOf(c); const hits = q ? c.messages.filter(m => m.body.toLowerCase().includes(q)).length : 0; const lastIsSupportMessage = c.kind === 'Support' && last && !last.system; return <button key={c.id} data-testid={`row-conversation-${c.id}`} onClick={() => { setActive(c.id); setFocusMessageId(''); }} className={`w-full border-t border-border/70 px-4 py-3.5 text-left hover:bg-muted/60 ${convo?.id === c.id ? 'bg-[#edf3ed] dark:bg-[#263b36]' : ''}`}><div className="flex gap-3">{c.kind === 'Support' ? <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#213b42] text-[#bfe0cf]"><Headphones size={15} /></div> : <Avatar name={person(directPeer(c, store.profile.name) || c.participants[1] || c.title)} />}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><div className={`flex min-w-0 items-center gap-1 truncate text-[12px] ${u ? 'font-bold' : 'font-semibold'}`}>{channelAccreditation(c.kind) && <LockKeyhole size={11} aria-label="Accès restreint" className="shrink-0 text-[#b8892f]" />}<span className="truncate">{titleOf(c, store.profile.name)}</span></div><span className="shrink-0 text-[10px] text-muted-foreground">{last ? messageTime(last) : ''}</span></div>{lastIsSupportMessage ? <div className="mt-1 flex min-w-0 items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{last.expired ? 'Message éphémère expiré' : last.body}</span><Badge testId={`badge-last-message-kind-${c.id}`} tone={last.isInstruction ? 'amber' : 'blue'}>{last.isInstruction ? 'Consigne' : 'Signalement'}</Badge></div> : <div className="mt-1 truncate text-[11px] text-muted-foreground">{last?.body ?? 'Aucun message'}</div>}<div className="mt-2 flex items-center gap-2"><Badge tone={c.kind === 'Support' ? 'blue' : 'neutral'}>{c.kind}</Badge>{hits > 0 && <span className="text-[10px] text-primary">{hits} message(s) trouvé(s)</span>}{u > 0 && <span data-testid={`badge-unread-${c.id}`} className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-primary-foreground">{u}</span>}</div></div></div></button>; })}{filtered.length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">Aucune conversation ni message trouvé.</div>}</div>
      </aside>

      {convo ? <section className="flex h-[70dvh] min-h-[550px] max-h-[720px] min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 sm:px-5">{convo.kind === 'Support' ? <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#213b42] text-[#bfe0cf]"><Headphones size={15} /></div> : <Avatar name={person(directPeer(convo, store.profile.name) || convo.participants[1] || convo.title)} />}<div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{titleOf(convo, store.profile.name)}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{convo.participants.map(person).join(' · ')}</div></div>{channelAccreditation(convo.kind) && <span data-testid="badge-accreditation" title="Accès restreint aux membres indiqués. Ce pilote n’applique pas de chiffrement de bout en bout." className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#d8b875] bg-[#f4ecd9] px-2 py-0.5 text-[10px] font-semibold text-[#7a5a1f] dark:border-[#8a6d35] dark:bg-[#413720] dark:text-[#ebd8aa]"><LockKeyhole size={11} className="text-[#b8892f]" />{channelAccreditation(convo.kind)}</span>}<Badge tone={convo.classification === 'Interne' ? 'green' : 'amber'}>{convo.classification}</Badge><button data-testid="button-toggle-read" onClick={() => toggleRead(convo)} className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted" title="Basculer lu / non lu">{unreadOf(convo) > 0 ? <><Eye size={13} />Marquer lu</> : <><EyeOff size={13} />Marquer non lu</>}</button></div>
        {pinnedIds.length > 0 && <div data-testid="panel-pinned" className="border-b border-border bg-muted/30 px-5 py-2"><div className="eyebrow mb-1">MESSAGES ÉPINGLÉS · {pinnedIds.length}/{MAX_PINS}</div><ul className="space-y-1">{pinnedIds.map(pid => { const q = quoteOf(pid); return <li key={pid}><button type="button" data-testid={`pinned-${pid}`} onClick={() => setFocusMessageId(pid)} className="block w-full truncate text-left text-[11px] hover:underline">{q.author && <span className="font-semibold">{q.author} · </span>}<span className="text-muted-foreground">{q.text}</span></button></li>; })}</ul></div>}
        {convo.kind === 'Temporaire' && <div role="alert" data-testid="banner-temporary" className={`flex items-center gap-2 border-b px-5 py-2.5 text-[10px] leading-relaxed ${closed ? 'border-border bg-muted text-muted-foreground' : 'border-[#c0574a]/40 bg-[#f5e2df] text-[#7d3a31] dark:bg-[#4c302d] dark:text-[#f0c1b9]'}`}><Timer size={13} className="shrink-0" /><span><strong>{closed ? 'Canal temporaire clos.' : 'Canal temporaire ouvert à des correspondants externes ou auditeurs ponctuels.'}</strong> {closed ? 'Lecture seule : plus aucun message ne peut y être publié et les auditeurs n’y ont plus accès.' : `Ne partagez que ce qui relève de la mission. Clôture automatique le ${convo.expiresAt ? formatWAT(convo.expiresAt, 'datetime') : '—'}.`} Membres : {(convo.memberIds ?? []).map(person).join(', ') || '—'}.</span></div>}
        {convo.kind === 'Enquête' && <div role="note" data-testid="banner-investigation" className="flex items-center gap-2 border-b border-[#d8b875]/70 bg-[#f4ecd9] px-5 py-2.5 text-[10px] leading-relaxed text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]"><LockKeyhole size={13} className="shrink-0" /><span><strong>Salon d’enquête restreint.</strong> Visible uniquement par la Direction (N1) et les analystes invités : {(convo.memberIds ?? []).map(person).join(', ') || '—'}. Les comptes SSI, services d’appui et auditeurs n’y ont pas accès. Ce pilote n’applique pas de chiffrement de bout en bout.</span></div>}
        {convo.kind === 'Annonce' && <div role="note" data-testid="banner-announcement" className="border-b border-border bg-[#e1eaf0]/60 px-5 py-2.5 text-[10px] leading-relaxed text-[#3b6177] dark:bg-[#263c4a]/50 dark:text-[#a8c8d8]"><strong>Annonces générales.</strong> Lues par tous les services, y compris les services d’appui (N4). Publication réservée à la Direction. Aucun contenu d’enquête.</div>}
        {convo.kind === 'Administratif' && <div role="note" data-testid="banner-administrative" className="border-b border-border bg-[#e1eaf0]/60 px-5 py-2.5 text-[10px] leading-relaxed text-[#3b6177] dark:bg-[#263c4a]/50 dark:text-[#a8c8d8]"><strong>Salon administratif.</strong> Ouvert aux services d’appui (N4) et aux autres services. Aucun contenu d’enquête : les auditeurs n’y ont pas accès.</div>}
        {convo.kind === 'Direct' && <div role="note" data-testid="banner-direct" className="flex items-center gap-2 border-b border-[#d8b875]/70 bg-[#f4ecd9] px-5 py-2.5 text-[10px] leading-relaxed text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]"><LockKeyhole size={13} className="shrink-0" /><span><strong>Canal bilatéral.</strong> Visible uniquement par {(convo.memberIds ?? []).map(person).join(' et ') || '—'}. La Direction, les autres agents, les services d’appui et les auditeurs n’y ont pas accès. Ce pilote n’applique pas de chiffrement de bout en bout.</span></div>}
        {convo.kind === 'Support' && <div className="border-b border-border bg-[#e1eaf0]/60 px-5 py-2.5 text-[10px] leading-relaxed text-[#3b6177] dark:bg-[#263c4a]/50 dark:text-[#a8c8d8]">Canal support : seuls ses messages peuvent être convertis en incident, après relecture manuelle d’un résumé technique. Un filtre bloque les données nominatives qu’il détecte, sans remplacer cette relecture.</div>}
        {convo.kind === 'Support' && <SupportAssistant onReport={text => { setSupportMessageKind('report'); setDraft(text); }} />}
        {convo.kind === 'Support' && <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5" role="group" aria-label="Filtrer l’historique du canal support">
          <span className="mr-1 text-[10px] font-semibold text-muted-foreground">Afficher :</span>
          {([
            ['all', 'Tout'],
            ['report', 'Signalements'],
            ['instruction', 'Consignes'],
          ] as const).map(([value, label]) => <button
            key={value}
            type="button"
            data-testid={`filter-support-messages-${value}`}
            aria-pressed={supportMessageFilter === value}
            onClick={() => setSupportMessageFilter(value)}
            className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${supportMessageFilter === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
          >{label}</button>)}
        </div>}
        {sourceMessageUnavailable && <div role="status" data-testid="text-source-message-unavailable" className="border-b border-[#d8b875]/70 bg-[#f4ecd9] px-5 py-3 text-[11px] leading-relaxed text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]">Le message source {focusMessageId} n’est plus disponible dans cette conversation. Vous pouvez consulter le reste de l’historique.</div>}
        <div ref={messageListRef} className="min-h-0 min-w-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto bg-[#f7f6f1] p-5 dark:bg-[#172428] md:p-7" data-testid="list-messages">{visibleMessages.map(m => {
          const mine = m.author === store.profile.name && !m.system; const t = ticketFor(m); const hit = q && m.body.toLowerCase().includes(q);
          const isSourceMessage = convo.id === active && m.id === focusMessageId;
          if (m.system) return <div key={m.id} data-message-id={m.id} data-testid={`message-${m.id}`} className={`flex min-w-0 justify-center rounded-lg ${isSourceMessage ? 'ring-2 ring-[#c88e43]/70 ring-offset-4 ring-offset-[#f7f6f1] dark:ring-offset-[#172428]' : ''}`}><button onClick={() => m.ticketId && setFocusTicket(m.ticketId)} className="max-w-[88%] break-words rounded-full border border-border bg-card px-3.5 py-1.5 text-center text-[10px] text-muted-foreground hover:border-primary/40">{messageTime(m)} {m.body}</button></div>;
          return <div key={m.id} data-message-id={m.id} className={`flex min-w-0 gap-2.5 rounded-lg ${mine ? 'flex-row-reverse' : ''} ${isSourceMessage ? 'ring-2 ring-[#c88e43]/70 ring-offset-4 ring-offset-[#f7f6f1] dark:ring-offset-[#172428]' : ''}`}><Avatar name={person(m.author)} /><div className={`min-w-0 max-w-[78%] ${mine ? 'text-right' : ''}`}><div className={`mb-1 flex flex-wrap items-baseline gap-x-2 text-[10px] text-muted-foreground ${mine ? 'justify-end' : ''}`}><span className="font-semibold text-foreground">{person(m.author)}</span><span>{messageTime(m)}</span></div><div className={`break-words [overflow-wrap:anywhere] rounded-xl px-3.5 py-2.5 text-left text-[12px] leading-relaxed ${hit ? 'ring-2 ring-[#c88e43]/60' : ''} ${mine ? 'rounded-tr-sm bg-[#dcebe2] text-[#274837] dark:bg-[#285143] dark:text-[#e0f0e4]' : 'rounded-tl-sm border border-border bg-card'}`}>{m.forwardedFrom && !m.deleted && !isExpiredMessage(m, now) && <div data-testid={`message-forwarded-${m.id}`} className="mb-1 text-[10px] italic text-muted-foreground">Transféré · message de {person(m.forwardedFrom.author)}{(() => { const origin = store.conversations.find(c => c.id === m.forwardedFrom!.conversationId); return origin ? ` (${titleOf(origin, store.profile.name)})` : ''; })()}</div>}{m.replyToId && !m.deleted && !isExpiredMessage(m, now) && (() => { const q = quoteOf(m.replyToId); return <button type="button" data-testid={`message-quote-${m.id}`} onClick={() => setFocusMessageId(m.replyToId!)} className="mb-1.5 block w-full rounded-md border-l-2 border-primary/60 bg-black/5 px-2 py-1 text-left text-[10px] text-muted-foreground hover:bg-black/10 dark:bg-white/5">{q.author && <span className="font-semibold text-foreground">{q.author} · </span>}{q.text}</button>; })()}{m.deleted ? <span data-testid={`message-deleted-${m.id}`} className="italic text-muted-foreground">Message supprimé par son auteur{m.deletedAt ? ` le ${formatWAT(m.deletedAt, 'datetime')}` : ''}.</span> : isExpiredMessage(m, now) ? <span data-testid={`message-expired-${m.id}`} className="italic text-muted-foreground">Message éphémère expiré — contenu effacé.</span> : m.body}</div>{m.editedAt && !m.deleted && !isExpiredMessage(m, now) && <details data-testid={`message-edited-${m.id}`} className="mt-1 text-left text-[9px] text-muted-foreground"><summary className="cursor-pointer">Modifié {formatWAT(m.editedAt, 'time')} · versions précédentes</summary><ol className="mt-1 space-y-1">{(m.revisions ?? []).map((r, i) => <li key={i} className="break-words rounded bg-muted/60 px-2 py-1"><span className="mono">{r.at ? formatWAT(r.at, 'time') : '—'}</span> {r.body}</li>)}</ol></details>}{!m.deleted && !isExpiredMessage(m, now) && !readOnly && (!isAuditor || (mine && !t)) && <div className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-muted-foreground ${mine ? 'justify-end' : ''}`}>{!isAuditor && <button type="button" data-testid={`button-reply-${m.id}`} onClick={() => setReplyTo({ conversationId: convo.id, messageId: m.id })} className="hover:text-foreground hover:underline">Répondre</button>}{!isAuditor && (pinnedIds.includes(m.id) || pinnedIds.length < MAX_PINS) && <button type="button" data-testid={`button-pin-${m.id}`} aria-pressed={pinnedIds.includes(m.id)} onClick={() => togglePin(m)} className="hover:text-foreground hover:underline">{pinnedIds.includes(m.id) ? 'Désépingler' : 'Épingler'}</button>}{canForward(m, convo) && <button type="button" data-testid={`button-forward-${m.id}`} onClick={() => { setForwarding({ message: m, from: convo }); setForwardTarget(''); }} className="hover:text-foreground hover:underline">Transférer</button>}{mine && !t && canEditMessage(m, now) && <button type="button" data-testid={`button-edit-message-${m.id}`} onClick={() => openRevision(m, convo.id, 'edit')} className="hover:text-foreground hover:underline">Modifier</button>}{mine && !t && <button type="button" data-testid={`button-delete-message-${m.id}`} onClick={() => openRevision(m, convo.id, 'delete')} className="hover:text-destructive hover:underline">Supprimer</button>}</div>}{m.attachment && !isExpiredMessage(m, now) && <div data-testid={`message-attachment-${m.id}`} className="mt-1.5 inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-[10px] text-muted-foreground"><Paperclip size={12} className="shrink-0" /><span className="min-w-0 truncate"><span className="font-semibold text-foreground">{m.attachment.name}</span> · {formatSize(m.attachment.size)} · SHA-256 {m.attachment.sha256.slice(0, 12)}…</span>{m.attachment.warnings.length > 0 && <span title={m.attachment.warnings.join(' ')} className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#9a6a1c]"><AlertTriangle size={11} />Format signalé</span>}</div>}{remainingLabel(m, now) && <div data-testid={`message-ttl-${m.id}`} className={`mt-1 inline-flex items-center gap-1 text-[9px] text-muted-foreground ${mine ? 'justify-end' : ''}`}><Timer size={10} />S’efface dans {remainingLabel(m, now)}</div>}
            {convo.kind === 'Support' && <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={m.isInstruction ? 'amber' : 'blue'}>{m.isInstruction ? 'Consigne' : 'Signalement'}</Badge>
              {t ? <button data-testid={`button-linked-${m.id}`} onClick={() => setFocusTicket(t.id)} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-primary hover:underline"><Badge tone={statusTone(t.status)}>{t.id} · {t.status}</Badge></button> : isConvertibleSupportMessage(m) && <button data-testid={`button-convert-${m.id}`} onClick={() => setConverting({ message: m, conversation: convo })} className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"><TicketPlus size={12} />Convertir en incident</button>}
            </div>}
          </div></div>;
        })}{!visibleMessages.length && <div className="py-10 text-center text-[11px] text-muted-foreground">{convo.messages.length ? 'Aucun message pour ce filtre.' : 'Aucun message. Commencez l’échange ci-dessous.'}</div>}</div>
        <form onSubmit={send} className="border-t border-border p-4"><div className="eyebrow mb-2 flex items-center gap-1.5"><LockKeyhole size={11} />Échange simulé · ne pas saisir de données sensibles</div>
          {convo.kind === 'Support' && <div className="mb-2 max-w-xs"><Field label="Type du message" hint="Une consigne ne peut pas être convertie en incident."><select data-testid="select-support-message-kind" value={supportMessageKind} onChange={e => setSupportMessageKind(e.target.value as 'report' | 'instruction')} className={inputCls}><option value="report">Signalement</option><option value="instruction">Consigne</option></select></Field></div>}
          {announcementReadOnly && <p role="status" data-testid="text-announcement-readonly" className="mb-2 text-[11px] text-muted-foreground">Canal d’annonces : seule la Direction (N1) y publie. Pour une demande, utilisez le salon administratif ou un ticket.</p>}
          {closed && <p role="status" data-testid="text-channel-closed" className="mb-2 text-[11px] text-muted-foreground">Ce canal temporaire est clos : il n’accepte plus de messages.</p>}
          {postError && <p role="alert" className="mb-2 text-[11px] text-destructive">{postError}</p>}
          {replying && !readOnly && <div data-testid="panel-reply" className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2 text-[11px]"><div className="min-w-0 flex-1"><div className="text-[10px] font-semibold text-primary">Réponse à {replying.author || 'un message'}</div><div className="truncate text-muted-foreground">{replying.text}</div></div><button type="button" data-testid="button-cancel-reply" aria-label="Annuler la réponse" onClick={() => setReplyTo(null)} className="focus-ring rounded p-1 hover:bg-black/5"><X size={13} /></button></div>}
          {!isAuditor && <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground"><Timer size={12} /><label htmlFor="select-message-ttl">Durée de vie du message</label><select id="select-message-ttl" data-testid="select-message-ttl" value={ttlSeconds} onChange={e => setTtlSeconds(Number(e.target.value))} className="h-7 rounded-md border border-border bg-card px-2 text-[10px] text-foreground">{MESSAGE_TTL_OPTIONS.map(o => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}</select>{ttlSeconds > 0 && <span>Le texte sera effacé du serveur à expiration.</span>}</div>}
          {attachment && <div data-testid="panel-attachment" className={`mb-2 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed ${attachment.blocked ? 'border-[#d39b90] bg-[#f5e2df] text-[#7d3a31] dark:bg-[#4c302d] dark:text-[#f0c1b9]' : attachment.warnings.length ? 'border-[#d8b875] bg-[#f4ecd9] text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]' : 'border-border bg-muted/40'}`}>
            <div className="flex items-start gap-2"><Paperclip size={13} className="mt-0.5 shrink-0" /><div className="min-w-0 flex-1"><div className="truncate font-semibold">{attachment.name} · {formatSize(attachment.size)}</div>
              {attachment.blocked ? <p data-testid="attachment-blocked" role="alert">{attachment.blocked} Les exécutables et scripts peuvent prendre le contrôle du poste du destinataire.</p>
                : attachment.warnings.length ? <div data-testid="attachment-warning" role="alert"><p className="mt-1 font-semibold">Avant d’envoyer ce fichier :</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{attachment.warnings.map(w => <li key={w}>{w}</li>)}</ul><p className="mt-1">Vérifiez sa provenance, préférez un PDF ou un document sans macro, et ne transmettez jamais un fichier reçu d’un expéditeur inconnu. Les pièces d’enquête réelles ne passent pas par ce pilote.</p><label className="mt-1.5 flex items-center gap-2 font-semibold"><input data-testid="checkbox-attachment-ack" type="checkbox" checked={attachmentAck} onChange={e => setAttachmentAck(e.target.checked)} className="accent-primary" />J’ai vérifié ce fichier et je confirme son envoi</label></div>
                : <p className="text-muted-foreground">Pièce jointe simulée : seuls le nom, le type, la taille et l’empreinte SHA-256 sont transmis, jamais le contenu.</p>}</div>
              <button type="button" data-testid="button-remove-attachment" aria-label="Retirer la pièce jointe" onClick={() => { void pickFile(undefined); if (fileInput.current) fileInput.current.value = ''; }} className="focus-ring rounded p-1 hover:bg-black/5"><X size={13} /></button></div></div>}
          <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:ring-2 focus-within:ring-primary/25">{!isAuditor && <><input ref={fileInput} data-testid="input-attachment" type="file" className="hidden" onChange={e => { void pickFile(e.target.files?.[0]); }} /><button type="button" data-testid="button-attach" aria-label="Joindre un fichier (simulé)" title="Joindre un fichier (seul son descriptif est transmis)" disabled={readOnly} onClick={() => fileInput.current?.click()} className="focus-ring mb-1 rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><Paperclip size={16} /></button></>}<textarea data-testid="input-message" disabled={readOnly} rows={2} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }} placeholder="Écrire un message…" className="max-h-28 min-h-[42px] flex-1 resize-y bg-transparent px-2 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground" aria-label="Message" /><Button type="submit" testId="button-send" className="px-3 py-2" disabled={(!draft.trim() && !attachment) || readOnly || !attachmentReady}><Send size={14} /><span className="hidden sm:inline">Simuler l’envoi</span></Button></div><div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground"><span>{draft ? 'Brouillon temporaire dans cette session' : 'Entrée pour simuler l’envoi · Maj + Entrée pour une nouvelle ligne'}</span><span>Les conversations fictives sont partagées. Aucun message n’est transmis à un destinataire externe.</span></div></form>
      </section> : <div className="grid min-h-[500px] place-items-center text-sm text-muted-foreground">Sélectionnez une conversation.</div>}

      <aside className="min-w-0 border-t border-border p-4 lg:col-span-2 2xl:col-span-1 2xl:border-l 2xl:border-t-0" data-testid="panel-linked-tickets">
        <div className="eyebrow">TICKETS LIÉS À CETTE DISCUSSION</div>
        {!linked.length ? <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-[11px] leading-relaxed text-muted-foreground">{convo?.kind === 'Support' ? 'Aucun ticket encore. Convertissez un message du canal pour suivre ici son état sans quitter la messagerie.' : 'Seul le canal support permet la conversion de messages en incidents.'}</p>
          : <><div className="mt-3 flex flex-wrap gap-1.5">{linked.map(t => <button key={t.id} onClick={() => setFocusTicket(t.id)} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${sideTicket?.id === t.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{t.id}</button>)}</div>{sideTicket && <SideTicket ticket={sideTicket} />}</>}
      </aside>
    </div>

    {creating && <NewConversation onClose={() => setCreating(false)} onCreate={c => { const existing = c.kind === 'Direct' ? store.conversations.find(x => x.kind === 'Direct' && directPeer(x, store.profile.name) === directPeer(c, store.profile.name)) : undefined; if (existing) { setActive(existing.id); setFilter('Toutes'); setCreating(false); return; } setStore(s => ({ ...s, conversations: [c, ...s.conversations] })); setActive(c.id); setFilter('Toutes'); setCreating(false); log(`Conversation ${c.id} créée`, 'Messagerie'); }} />}
    {forwarding && <Modal title="Transférer le message" description="Le message garde son auteur d’origine. Seuls les messages des conversations internes se transfèrent, et jamais vers un canal temporaire ouvert à des externes." onClose={() => setForwarding(null)}>
      <p className="mb-3 break-words rounded-lg bg-muted/60 p-3 text-[12px] text-muted-foreground"><span className="font-semibold text-foreground">{person(forwarding.message.author)} · </span>{forwarding.message.body}</p>
      <Field label="Conversation de destination"><select data-testid="select-forward-target" value={forwardTarget} onChange={e => setForwardTarget(e.target.value)} className={inputCls}><option value="">Choisir une conversation</option>{forwardTargets.map(c => <option key={c.id} value={c.id}>{titleOf(c, store.profile.name)}</option>)}</select></Field>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setForwarding(null)}>Annuler</Button><Button testId="button-confirm-forward" disabled={!forwardTarget} onClick={forward}>Transférer</Button></div>
    </Modal>}
    {revising && <Modal title={revising.mode === 'edit' ? 'Modifier le message' : 'Supprimer le message'} description={revising.mode === 'edit' ? 'Possible pendant 5 minutes après l’envoi. Les membres de la conversation verront la mention « Modifié » et la version précédente.' : 'Le texte est effacé pour tous les membres. Le journal garde la trace de la suppression, sans le contenu.'} onClose={() => setRevising(null)}>
      {revising.mode === 'edit' ? <Field label="Message"><textarea data-testid="input-edit-message" rows={4} value={revisionText} onChange={e => setRevisionText(e.target.value)} maxLength={5000} className={textareaCls} /></Field> : <p className="break-words rounded-lg bg-muted/60 p-3 text-[12px] text-muted-foreground">{revising.message.body}</p>}
      {revisionError && <p role="alert" className="mt-3 text-[11px] text-destructive">{revisionError}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setRevising(null)}>Annuler</Button><Button testId="button-confirm-revision" disabled={revisionBusy || (revising.mode === 'edit' && (!revisionText.trim() || revisionText.trim() === revising.message.body))} onClick={submitRevision}>{revising.mode === 'edit' ? 'Enregistrer' : 'Supprimer'}</Button></div>
    </Modal>}
    {converting && <ConvertDialog message={converting.message} onClose={() => setConverting(null)} onConvert={(title, summary, impact, urgency, serviceId) => {
      const { message, conversation } = converting;
      if (conversation.kind !== 'Support' || !isConvertibleSupportMessage(message) || store.tickets.some(t => t.sourceMessageId === message.id)) { setConverting(null); return; }
      const id = nextTicketId('Incident', store.tickets); const at = nowIso();
      const t = createIncidentFromMessage({ message, conversationId: conversation.id, ticketId: id, title, summary, impact, urgency, serviceId, openedAt: at, actor: store.profile.name });
      setStore(s => {
        if (s.tickets.some(x => x.sourceMessageId === message.id)) return s;
        const next = { ...s, tickets: [t, ...s.tickets], notifications: [{ id: uid(), ticketId: id, title: `Incident ${id} créé depuis le canal support`, body: `${t.priority} · ${title}`, at }, ...s.notifications] };
        return { ...next, conversations: next.conversations.map(c => (c.id === conversation.id ? { ...c, messages: [...c.messages, { id: uid(), author: `Suivi ${id}`, body: `Incident ${id} ouvert en ${t.priority} à partir d’un message du canal.`, time: '', at, system: true, ticketId: id }] } : c)) };
      });
      setFocusTicket(id); setConverting(null);
    }} />}
  </div>;
}

function SideTicket({ ticket }: { ticket: Ticket }) { const { person } = usePeople();
  const { setStore, log } = useStore();
  const now = useNow(1000);
  const [text, setText] = useState('');
  const sla = ticketSla(ticket, now);
  return <div className="mt-4 space-y-3" data-testid={`side-ticket-${ticket.id}`}>
    <div className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="mono text-[10px] text-muted-foreground">{ticket.id} · L{ticket.supportLevel}</span><div className="flex gap-1"><Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge><Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge></div></div><div className="mt-1.5 text-[12px] font-semibold leading-snug">{ticket.title}</div><div className="mt-1 text-[10px] text-muted-foreground">Assigné à {ticket.assignee}</div></div>
    {isOpen(ticket) && ticket.status !== 'Résolu' && <><SlaBar label="Prise en charge" openedAt={ticket.openedAt} deadline={sla.deadlines.acknowledgeBy} completedAt={ticket.acknowledgedAt} now={now} /><SlaBar label="Résolution" openedAt={ticket.openedAt} deadline={sla.deadlines.resolveBy} completedAt={ticket.resolvedAt} now={now} /></>}
    <div><div className="eyebrow mb-2">DERNIÈRES ACTIVITÉS</div><ol className="max-h-44 space-y-2 overflow-y-auto">{[...ticket.updates].reverse().slice(0, 5).map((u, i) => <li key={i} className="text-[10px] leading-relaxed"><span className="font-semibold">{person(u.author)}</span> <span className="mono text-muted-foreground">{u.at ? formatWAT(u.at, 'time') : u.time}</span><div className="text-muted-foreground">{u.body}</div></li>)}</ol></div>
    {isOpen(ticket) && <form onSubmit={e => { e.preventDefault(); if (!text.trim()) return; setStore(s => withTicketEvent(s, ticket.id, text.trim(), {}, s.profile.name, true)); log(`Commentaire ajouté au ticket ${ticket.id} depuis la messagerie`, `Ticket ${ticket.id}`); setText(''); }} className="space-y-2"><textarea data-testid="input-side-comment" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Commenter le ticket (visible dans la discussion)" className="w-full rounded-lg border border-border bg-card p-2.5 text-[11px]" /><Button type="submit" disabled={!text.trim()} className="w-full" testId="button-side-comment"><Send size={13} />Ajouter le commentaire</Button></form>}
    <Link href={`/tickets?ticket=${encodeURIComponent(ticket.id)}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">Ouvrir dans Tickets IT <ArrowRight size={12} /></Link>
  </div>;
}

function NewConversation({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Conversation) => void }) {
  const { store } = useStore();
  const { person } = usePeople();
  const isN1 = store.profile.clearance.startsWith('N1');
  const isN4 = store.profile.clearance.startsWith('N4');
  const [title, setTitle] = useState(''); const [kind, setKind] = useState(isN4 ? 'Administratif' : 'Groupe');
  const [members, setMembers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const temporary = kind === 'Temporaire';
  const investigation = kind === 'Enquête' || temporary;
  const [durationHours, setDurationHours] = useState(72);
  const canDirect = ['N1', 'N2', 'N3'].some(role => store.profile.clearance.startsWith(role));
  const directKind = kind === 'Direct';
  const [peer, setPeer] = useState('');
  const contacts = useQuery({
    queryKey: ['direct-contacts', search],
    queryFn: ({ signal }) => getItsmContacts({ q: search }, { signal }),
    enabled: canDirect && directKind,
  });
  const directory = useQuery({
    queryKey: ['investigation-members', search],
    queryFn: ({ signal }) => getItsmUserDirectory({ q: search, limit: 50, offset: 0 }, { signal }),
    enabled: isN1 && investigation,
  });
  const candidates = (directory.data?.accounts ?? []).filter(account => temporary ? !!account.role && account.role !== 'N4' : account.role === 'N2' || account.role === 'N1')
    .filter(account => account.userId !== store.profile.name);
  return <Modal title="Nouvelle conversation" description={directKind ? 'Échange bilatéral : visible uniquement par vous et le collègue choisi. Données fictives uniquement.' : temporary ? 'Canal temporaire : ouvert aux membres choisis (dont auditeurs N5 et experts externes) jusqu’à sa clôture automatique, puis en lecture seule. Données fictives uniquement.' : investigation ? 'Salon d’enquête restreint : accessible aux N1 et aux seuls analystes N2 invités. Les comptes N3, N4 et N5 n’y ont jamais accès. Données fictives uniquement.' : 'Conversation fictive de démonstration. Aucun contenu sensible.'} onClose={onClose}><form onSubmit={e => { e.preventDefault(); if (directKind) { if (peer) onCreate({ id: `C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, title: 'Échange bilatéral', kind, classification: 'Confidentiel', participants: [store.profile.name, peer], memberIds: [store.profile.name, peer], readCount: 0, messages: [] }); return; } if (!title.trim()) return; onCreate({ id: `C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, title: title.trim(), kind, classification: investigation ? 'Restreint' : 'Interne', participants: investigation ? [store.profile.name, ...members] : [store.profile.name, 'Équipe'], readCount: 0, messages: [], ...(investigation ? { memberIds: [store.profile.name, ...members] } : {}), ...(temporary ? { durationHours } : {}) }); }} className="space-y-3">{!directKind && <Field label="Nom de la conversation"><input data-testid="input-conversation-title" required autoFocus value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder={investigation ? 'Ex. Dossier 2026-14 — analyse des flux' : 'Ex. Coordination opérationnelle'} /></Field>}<Field label="Type"><select data-testid="select-conversation-kind" value={kind} onChange={e => setKind(e.target.value)} className={inputCls}>{(isN4 ? ['Administratif'] : [...(isN1 ? ['Enquête', 'Temporaire', 'Annonce'] : []), ...(canDirect ? ['Direct'] : []), 'Groupe', 'Équipe', 'Comité', 'Administratif']).map(k => <option key={k} value={k}>{k === 'Enquête' ? 'Salon d’enquête (restreint)' : k === 'Temporaire' ? 'Canal temporaire (auditeurs, experts externes)' : k === 'Direct' ? 'Échange bilatéral (2 agents)' : k === 'Annonce' ? 'Canal d’annonces (publication N1)' : k === 'Administratif' ? 'Salon administratif (services d’appui)' : k}</option>)}</select></Field>
    {directKind && <Field label="Collègue" hint="Comptes N1 à N3, recherchés sur leur nom. Le canal n’est visible que par vous deux, y compris pour la Direction.">
      <div className="space-y-2"><input data-testid="input-contact-search" value={search} onChange={e => setSearch(e.target.value)} className={inputCls} placeholder="Rechercher un nom" aria-label="Rechercher un collègue" />
        <div role="radiogroup" aria-label="Collègues" className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{contacts.isLoading ? <p role="status" className="p-2 text-[11px] text-muted-foreground">Chargement des collègues…</p> : contacts.isError ? <p role="alert" className="p-2 text-[11px] text-destructive">Liste des collègues indisponible. Réessayez plus tard.</p> : contacts.data?.contacts.length ? contacts.data.contacts.map(contact => <label key={contact.userId} className="flex cursor-pointer items-center gap-2 rounded-md p-2 text-[11px] hover:bg-muted/50"><input data-testid={`input-contact-${contact.userId}`} type="radio" name="direct-peer" checked={peer === contact.userId} onChange={() => setPeer(contact.userId)} className="accent-primary" /><span className="min-w-0 flex-1 truncate">{contact.name}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold">{contact.role}</span></label>) : <p className="p-2 text-[11px] text-muted-foreground">Aucun collègue trouvé.</p>}</div></div></Field>}
    {temporary && <Field label="Durée du canal" hint="Le canal se ferme automatiquement : il passe en lecture seule et les auditeurs n’y ont plus accès."><select data-testid="select-channel-duration" value={durationHours} onChange={e => setDurationHours(Number(e.target.value))} className={inputCls}>{TEMPORARY_DURATIONS.map(d => <option key={d.hours} value={d.hours}>{d.label}</option>)}</select></Field>}
    {investigation && <Field label={temporary ? 'Membres invités' : 'Analystes invités'} hint={temporary ? 'Tous les rôles sauf N4. La liste des membres ne peut plus être modifiée après création.' : 'Seuls les comptes N1 et N2 peuvent être invités. La liste des membres ne peut plus être modifiée après création.'}>
      <div className="space-y-2"><input value={search} onChange={e => setSearch(e.target.value)} className={inputCls} placeholder="Rechercher un compte (e-mail ou identifiant)" aria-label="Rechercher un compte à inviter" />
        <div role="group" aria-label="Comptes pouvant être invités" className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{directory.isLoading ? <p role="status" className="p-2 text-[11px] text-muted-foreground">Chargement des comptes…</p> : directory.isError ? <p role="alert" className="p-2 text-[11px] text-destructive">Répertoire indisponible. Le salon peut être créé sans invité.</p> : candidates.length ? candidates.map(account => <label key={account.userId} className="flex cursor-pointer items-center gap-2 rounded-md p-2 text-[11px] hover:bg-muted/50"><input data-testid={`input-member-${account.userId}`} type="checkbox" checked={members.includes(account.userId)} onChange={e => setMembers(current => e.target.checked ? [...new Set([...current, account.userId])] : current.filter(id => id !== account.userId))} className="accent-primary" /><span className="min-w-0 flex-1 truncate">{person(account.userId)}<span className="ml-1 text-muted-foreground">· {account.email ?? account.userId}</span></span><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold">{account.role}</span></label>) : <p className="p-2 text-[11px] text-muted-foreground">Aucun compte pouvant être invité.</p>}</div>
        <p className="text-[10px] text-muted-foreground">{members.length} invité(s) en plus de vous.</p></div></Field>}
    <div data-dialog-sticky-actions className="sticky bottom-[-1.25rem] z-10 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-5 pb-5 pt-3"><Button variant="outline" onClick={onClose}>Annuler</Button><Button type="submit" testId="button-submit-conversation" disabled={directKind && !peer}><Plus size={14} />Créer</Button></div></form></Modal>;
}

function ConvertDialog({ message, onClose, onConvert }: { message: Message; onClose: () => void; onConvert: (title: string, summary: string, impact: Level, urgency: Level, serviceId: string) => void }) { const { person } = usePeople();
  const { store } = useStore();
  const [title, setTitle] = useState(message.body.split(/[.!?]/)[0].slice(0, 80));
  const [summary, setSummary] = useState(`Signalement du canal support (${messageTime(message)}).\nSymptôme technique : ${message.body}\nPérimètre observé : à préciser.`);
  const [impact, setImpact] = useState<Level>(2); const [urgency, setUrgency] = useState<Level>(2); const [serviceId, setServiceId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [environment, setEnvironment] = useState<RuntimeEnvironment | null>(null);
  useEffect(() => { void captureEnvironment(() => getItsmWorkspaceVersion()).then(setEnvironment); }, []);
  const findings = findSensitiveData(title, summary);
  const blocked = findings.length > 0;
  return <Modal wide title="Convertir en incident" description="Relisez et modifiez le résumé technique. Le filtre bloque les e-mails, IBAN, cartes, téléphones et mentions d’identité qu’il détecte, mais il ne voit pas tout : retirez vous-même toute donnée personnelle, d’enquête ou sensible." onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (confirmed && !blocked && title.trim() && summary.trim()) onConvert(title.trim(), environment ? `${summary.trim()}\n\n${formatEnvironment(environment)}` : summary.trim(), impact, urgency, serviceId); }} className="space-y-3">
      <div data-testid="conversion-source-message" className="rounded-lg border border-primary/30 bg-muted/50 p-3">
        <div className="eyebrow">MESSAGE SOURCE · {message.id}</div>
        <div className="mt-1 text-[10px] font-semibold text-muted-foreground">{person(message.author)} · {messageTime(message)}</div>
        <p className="mt-1 text-[12px] leading-relaxed">{message.body}</p>
      </div>
      <Field label="Sujet de l’incident"><input data-testid="input-convert-title" required value={title} onChange={e => setTitle(e.target.value)} className={inputCls} /></Field>
      <Field label="Résumé technique relu"><textarea data-testid="input-convert-summary" required rows={5} value={summary} onChange={e => setSummary(e.target.value)} className={textareaCls} /></Field>
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Impact"><select value={impact} onChange={e => setImpact(Number(e.target.value) as Level)} className={inputCls}>{([1, 2, 3] as Level[]).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></Field><Field label="Urgence"><select value={urgency} onChange={e => setUrgency(Number(e.target.value) as Level)} className={inputCls}>{([1, 2, 3] as Level[]).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}</select></Field><Field label="Service"><select value={serviceId} onChange={e => setServiceId(e.target.value)} className={inputCls}><option value="">Aucun</option>{store.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field></div>
      {blocked && <div role="alert" data-testid="alert-sensitive-data" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[11px] text-destructive"><div className="font-semibold">Données nominatives ou financières détectées : retirez-les avant de créer l’incident.</div><ul className="mt-1 list-disc pl-5">{findings.map((f, i) => <li key={i}>{f.kind} ({f.sample})</li>)}</ul><p className="mt-1 text-[10px]">Détection automatique indicative : elle ne remplace pas votre relecture.</p></div>}
      <div data-testid="conversion-environment" className="rounded-lg border border-border bg-muted/40 p-3 text-[10px] leading-relaxed text-muted-foreground"><div className="eyebrow mb-1">ENVIRONNEMENT D’EXÉCUTION JOINT AU TICKET</div>{environment ? <pre className="whitespace-pre-wrap font-sans">{formatEnvironment(environment).split('\n').slice(1).join('\n')}</pre> : 'Relevé en cours…'}</div>
      <PriorityPreview impact={impact} urgency={urgency} />
      <label className="flex items-start gap-2.5 rounded-lg border border-[#d8b875]/70 bg-[#f4ecd9] p-3 text-[11px] text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]"><input data-testid="checkbox-no-sensitive" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5" /><span>J’ai relu ce résumé et je confirme qu’il ne contient aucune donnée personnelle réelle, information d’enquête ou information classifiée.</span></label>
      <div data-dialog-sticky-actions className="sticky bottom-[-1.25rem] z-10 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 border-t border-border bg-card px-5 pb-5 pt-3"><Button variant="outline" onClick={onClose}>Annuler</Button><Button type="submit" disabled={!confirmed || blocked} testId="button-submit-convert"><TicketPlus size={14} />Créer l’incident</Button></div>
    </form>
  </Modal>;
}
